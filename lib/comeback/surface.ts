import { and, isNull, lte } from 'drizzle-orm'
import { followUps } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'

/**
 * Daily-cron entry point. Flips `surfaced_at` to NOW() for any follow-up
 * row that has come due and isn't yet surfaced or resolved. Returns the
 * count for the cron caller to log. Idempotent: a second invocation in
 * the same window is a no-op because `surfaced_at IS NULL` no longer
 * matches the rows from the prior run.
 */
export async function surfaceDueFollowUps(db: AppDb): Promise<{ surfaced: number }> {
  const now = new Date()
  const rows = await db
    .update(followUps)
    .set({ surfacedAt: now })
    .where(
      and(
        lte(followUps.dueAt, now),
        isNull(followUps.surfacedAt),
        isNull(followUps.resolvedAt),
      ),
    )
    .returning()
  return { surfaced: rows.length }
}
