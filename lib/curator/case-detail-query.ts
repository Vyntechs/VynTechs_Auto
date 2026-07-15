import { eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { sessions, sessionEvents } from '@/lib/db/schema'

export type CuratorCaseDetail = {
  session: typeof sessions.$inferSelect
  events: (typeof sessionEvents.$inferSelect)[]
} | null

export async function fetchCuratorCaseDetail(
  db: AppDb,
  sessionId: string,
): Promise<CuratorCaseDetail> {
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1)
  if (!session) return null
  const events = await db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, sessionId))
    .orderBy(sessionEvents.createdAt)
  return { session, events }
}
