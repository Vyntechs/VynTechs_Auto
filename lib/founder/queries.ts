import { desc, eq, isNull } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { founderNotesQueue, type FounderNotesQueueRow } from '@/lib/db/schema'

export async function listPendingFounderNotes(db: AppDb): Promise<FounderNotesQueueRow[]> {
  return db
    .select()
    .from(founderNotesQueue)
    .where(isNull(founderNotesQueue.reviewedAt))
    .orderBy(desc(founderNotesQueue.createdAt))
}

export async function getFounderNote(
  db: AppDb,
  id: string,
): Promise<FounderNotesQueueRow | null> {
  const [row] = await db
    .select()
    .from(founderNotesQueue)
    .where(eq(founderNotesQueue.id, id))
    .limit(1)
  return row ?? null
}

export async function countPendingFounderNotes(db: AppDb): Promise<number> {
  const rows = await db
    .select({ id: founderNotesQueue.id })
    .from(founderNotesQueue)
    .where(isNull(founderNotesQueue.reviewedAt))
  return rows.length
}
