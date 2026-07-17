import { createHash } from 'node:crypto'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { checkAccess } from '@/lib/auth-access'
import type { AppDb } from '@/lib/db/queries'
import { profiles, sessions, ticketJobs, tickets } from '@/lib/db/schema'
import { isAdaptiveCanvasEnabled } from '@/lib/feature-flags'
import { assertLiveLockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import type { LockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/lock-order'

export type AdaptiveMutationActor = {
  userId: string
  profileId: string
  shopId: string
}

export type AdaptiveMutationDependencies = {
  hasPaidAccess: (db: AppDb, userId: string) => Promise<boolean>
}

export const adaptiveMutationDependencies: AdaptiveMutationDependencies = {
  hasPaidAccess: async (db, userId) => (await checkAccess(db, userId)).kind === 'allow',
}

export function authorizeAdaptiveMutationInLockedScopeV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  input: {
    actor: AdaptiveMutationActor
    sessionId: string
    expectedRevision: number
  },
): { sessionId: string; jobId: string; revision: number } | null {
  assertLiveLockedMutationScopeV1(tx, scope)
  const actorProfile = scope.profiles.find(({ id }) => id === scope.actor.id)
  if (
    scope.actor.id !== input.actor.profileId ||
    scope.actor.shopId !== input.actor.shopId ||
    !['tech', 'advisor', 'parts', 'owner'].includes(scope.actor.role) ||
    typeof scope.actor.skillTier !== 'number' ||
    !actorProfile || actorProfile.userId !== input.actor.userId ||
    actorProfile.shopId !== scope.actor.shopId
  ) return null

  const session = scope.sessions.find(({ id }) => id === input.sessionId)
  const linked = scope.tickets.flatMap((graph) => graph.jobs
    .filter(({ sessionId }) => sessionId === input.sessionId)
    .map((job) => ({ graph, job })))
  if (!session || linked.length !== 1) return null
  const [{ graph, job }] = linked
  if (
    session.shopId !== scope.actor.shopId || session.techId !== scope.actor.id ||
    session.status !== 'open' || session.adaptiveRevision !== input.expectedRevision ||
    graph.ticket.shopId !== scope.actor.shopId || graph.ticket.status !== 'open' ||
    job.shopId !== scope.actor.shopId || job.ticketId !== graph.ticket.id ||
    job.assignedTechId !== scope.actor.id || job.kind !== 'diagnostic' ||
    !['open', 'in_progress', 'blocked'].includes(job.workStatus) ||
    scope.actor.skillTier < job.requiredSkillTier
  ) return null
  return { sessionId: session.id, jobId: job.id, revision: session.adaptiveRevision }
}

function canonicalJson(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('fingerprint body must be parsed JSON')
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') {
    throw new TypeError('fingerprint body must be parsed JSON')
  }
  if (ancestors.has(value)) throw new TypeError('fingerprint body must be acyclic')
  ancestors.add(value)

  try {
    if (Array.isArray(value)) {
      const items: string[] = []
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) throw new TypeError('fingerprint arrays must not be sparse')
        items.push(canonicalJson(value[index], ancestors))
      }
      return `[${items.join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('fingerprint body must contain plain objects')
    }
    if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) {
      throw new TypeError('fingerprint body must contain string keys')
    }
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key], ancestors)}`)
      .join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

export function adaptiveRequestFingerprint(kind: string, normalizedBody: unknown): string {
  if (kind.length === 0) throw new TypeError('fingerprint kind is required')
  return createHash('sha256')
    .update(`${JSON.stringify(kind)}\n${canonicalJson(normalizedBody, new WeakSet())}`)
    .digest('hex')
}

export async function authorizeAdaptiveMutation(
  db: AppDb,
  input: {
    actor: AdaptiveMutationActor
    sessionId: string
    expectedRevision: number
  },
  dependencies: AdaptiveMutationDependencies,
): Promise<{ sessionId: string; jobId: string; revision: number } | null> {
  if (!isAdaptiveCanvasEnabled()) return null

  let paid = false
  try {
    paid = await dependencies.hasPaidAccess(db, input.actor.userId)
  } catch {
    return null
  }
  if (!paid) return null

  const [authorized] = await db
    .select({
      sessionId: sessions.id,
      jobId: ticketJobs.id,
      revision: sessions.adaptiveRevision,
    })
    .from(sessions)
    .innerJoin(
      ticketJobs,
      and(
        eq(ticketJobs.sessionId, sessions.id),
        eq(ticketJobs.shopId, sessions.shopId),
      ),
    )
    .innerJoin(
      tickets,
      and(
        eq(tickets.id, ticketJobs.ticketId),
        eq(tickets.shopId, ticketJobs.shopId),
      ),
    )
    .innerJoin(
      profiles,
      and(
        eq(profiles.id, input.actor.profileId),
        eq(profiles.shopId, sessions.shopId),
      ),
    )
    .where(and(
      eq(sessions.id, input.sessionId),
      eq(sessions.shopId, input.actor.shopId),
      eq(sessions.techId, input.actor.profileId),
      eq(sessions.status, 'open'),
      eq(sessions.adaptiveRevision, input.expectedRevision),
      eq(ticketJobs.assignedTechId, input.actor.profileId),
      eq(ticketJobs.kind, 'diagnostic'),
      inArray(ticketJobs.workStatus, ['open', 'in_progress', 'blocked']),
      eq(tickets.status, 'open'),
      eq(profiles.userId, input.actor.userId),
      eq(profiles.membershipStatus, 'active'),
      isNotNull(profiles.membershipActivatedAt),
      isNotNull(profiles.skillTier),
      isNull(profiles.deactivatedAt),
      inArray(profiles.role, ['tech', 'advisor', 'parts', 'owner']),
    ))
    .limit(1)

  return authorized ?? null
}
