import { createHash } from 'node:crypto'
import { and, eq, inArray, isNotNull, isNull } from 'drizzle-orm'
import { checkAccess } from '@/lib/auth-access'
import type { AppDb } from '@/lib/db/queries'
import { profiles, sessions, ticketJobs, tickets } from '@/lib/db/schema'
import { isAdaptiveCanvasEnabled } from '@/lib/feature-flags'

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
      isNull(profiles.deactivatedAt),
      inArray(profiles.role, ['tech', 'advisor', 'parts', 'owner']),
    ))
    .limit(1)

  return authorized ?? null
}
