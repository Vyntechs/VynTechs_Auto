import { eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { sessions } from '@/lib/db/schema'

export type DeferredActionResult = { kind: 'ok' } | { kind: 'not-found' }

/**
 * Approve a deferred session: resumes it as active by clearing closedAt and
 * setting status back to 'open'. Records the curator's note.
 */
export async function approveDeferredSession(
  db: AppDb,
  sessionId: string,
  curatorProfileId: string,
  note: string | null,
): Promise<DeferredActionResult> {
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)

  if (!session) return { kind: 'not-found' }

  await db
    .update(sessions)
    .set({
      status: 'open',
      closedAt: null,
      curatorNote: note,
      curatorOverrideAction: null,
    })
    .where(eq(sessions.id, sessionId))

  return { kind: 'ok' }
}

/**
 * Override a deferred session: resumes it as active with a specific override
 * action recorded. overrideAction is required (not nullable).
 */
export async function overrideDeferredSession(
  db: AppDb,
  sessionId: string,
  curatorProfileId: string,
  overrideAction: string,
  note: string | null,
): Promise<DeferredActionResult> {
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)

  if (!session) return { kind: 'not-found' }

  await db
    .update(sessions)
    .set({
      status: 'open',
      closedAt: null,
      curatorOverrideAction: overrideAction,
      curatorNote: note,
    })
    .where(eq(sessions.id, sessionId))

  return { kind: 'ok' }
}

/**
 * Close a deferred session permanently: sets status to 'closed' and
 * re-stamps closedAt to the current time. Records the curator's note.
 */
export async function closeDeferredSession(
  db: AppDb,
  sessionId: string,
  curatorProfileId: string,
  note: string | null,
): Promise<DeferredActionResult> {
  const [session] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1)

  if (!session) return { kind: 'not-found' }

  await db
    .update(sessions)
    .set({
      status: 'closed',
      closedAt: new Date(),
      curatorNote: note,
    })
    .where(eq(sessions.id, sessionId))

  return { kind: 'ok' }
}
