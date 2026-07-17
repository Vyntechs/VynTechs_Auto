import { and, eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { sessions, ticketJobs } from '@/lib/db/schema'

export type DeferredActionResult = { kind: 'ok' } | { kind: 'not-found' }

type DeferredSessionUpdate = {
  status: 'open' | 'closed'
  closedAt: Date | null
  curatorNote: string | null
  curatorOverrideAction?: string | null
}

export type DeferredActionDependencies = Readonly<{
  afterSessionLock?: () => Promise<void>
}>

async function mutateDeferredSession(
  db: AppDb,
  sessionId: string,
  values: DeferredSessionUpdate,
  dependencies: DeferredActionDependencies = {},
): Promise<DeferredActionResult> {
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: sessions.id, status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1)
      .for('update')

    if (!session || session.status !== 'deferred') return { kind: 'not-found' }
    await dependencies.afterSessionLock?.()

    const [ticketLink] = await tx
      .select({ id: ticketJobs.id })
      .from(ticketJobs)
      .where(eq(ticketJobs.sessionId, sessionId))
      .limit(1)

    if (ticketLink) return { kind: 'not-found' }

    const [updated] = await tx
      .update(sessions)
      .set(values)
      .where(and(eq(sessions.id, sessionId), eq(sessions.status, 'deferred')))
      .returning()

    return updated ? { kind: 'ok' } : { kind: 'not-found' }
  })
}

// Curator attribution (e.g., a curator_id column on sessions) was not
// included in the Phase P spec. If audit attribution becomes a requirement,
// add the column + parameter then.

/**
 * Approve a deferred session: resumes it as active by clearing closedAt and
 * setting status back to 'open'. Records the curator's note.
 */
export async function approveDeferredSession(
  db: AppDb,
  sessionId: string,
  note: string | null,
  dependencies: DeferredActionDependencies = {},
): Promise<DeferredActionResult> {
  return mutateDeferredSession(db, sessionId, {
    status: 'open',
    closedAt: null,
    curatorNote: note,
    curatorOverrideAction: null,
  }, dependencies)
}

/**
 * Override a deferred session: resumes it as active with a specific override
 * action recorded. overrideAction is required (not nullable).
 */
export async function overrideDeferredSession(
  db: AppDb,
  sessionId: string,
  overrideAction: string,
  note: string | null,
  dependencies: DeferredActionDependencies = {},
): Promise<DeferredActionResult> {
  return mutateDeferredSession(db, sessionId, {
    status: 'open',
    closedAt: null,
    curatorOverrideAction: overrideAction,
    curatorNote: note,
  }, dependencies)
}

/**
 * Close a deferred session permanently: sets status to 'closed' and
 * re-stamps closedAt to the current time. Records the curator's note.
 */
export async function closeDeferredSession(
  db: AppDb,
  sessionId: string,
  note: string | null,
  dependencies: DeferredActionDependencies = {},
): Promise<DeferredActionResult> {
  return mutateDeferredSession(db, sessionId, {
    status: 'closed',
    closedAt: new Date(),
    curatorNote: note,
  }, dependencies)
}
