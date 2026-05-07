import { eq, sql } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { novelPatternQueue } from '@/lib/db/schema'

export async function dismissNovelPattern(
  db: AppDb,
  queueEntryId: string,
  curatorProfileId: string,
  note: string | null,
): Promise<{ kind: 'ok' }> {
  await db.update(novelPatternQueue).set({
    reviewedAt: sql`now()`,
    reviewedDecision: 'dismissed',
    reviewedByUserId: curatorProfileId,
    reviewedNote: note,
  }).where(eq(novelPatternQueue.id, queueEntryId))
  return { kind: 'ok' }
}
