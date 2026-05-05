import { followUps } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'

const DAY_MS = 24 * 60 * 60 * 1000

export type ScheduleFollowUpsInput = {
  sessionId: string
  shopId: string
  techId: string
}

export type ScheduleFollowUpsFn = (
  db: AppDb,
  input: ScheduleFollowUpsInput,
) => Promise<string[]>

/**
 * Insert 7d and 30d follow-up rows for a just-closed session.
 * Returns the inserted ids. The daily cron at
 * `app/api/cron/comeback-prompts-daily/route.ts` flips `surfaced_at`
 * once `due_at` passes; the tech resolves them via the panel on
 * TodayHome (Phase R Task R4).
 */
export const scheduleFollowUps: ScheduleFollowUpsFn = async (db, input) => {
  const now = Date.now()
  const rows = await db
    .insert(followUps)
    .values([
      {
        sessionId: input.sessionId,
        shopId: input.shopId,
        techId: input.techId,
        kind: '7d',
        dueAt: new Date(now + 7 * DAY_MS),
      },
      {
        sessionId: input.sessionId,
        shopId: input.shopId,
        techId: input.techId,
        kind: '30d',
        dueAt: new Date(now + 30 * DAY_MS),
      },
    ])
    .returning()
  return rows.map((r) => r.id)
}
