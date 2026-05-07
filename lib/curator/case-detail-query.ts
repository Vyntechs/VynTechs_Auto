import { eq, desc } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { sessions, sessionEvents, artifacts } from '@/lib/db/schema'

export type CuratorCaseDetail = {
  session: typeof sessions.$inferSelect
  events: (typeof sessionEvents.$inferSelect)[]
  artifacts: (typeof artifacts.$inferSelect)[]
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
  const arts = await db
    .select()
    .from(artifacts)
    .where(eq(artifacts.sessionId, sessionId))
    .orderBy(desc(artifacts.createdAt))
  return { session, events, artifacts: arts }
}
