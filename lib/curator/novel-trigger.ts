import { eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { novelPatternQueue } from '@/lib/db/schema'

/**
 * Similarity threshold below which a session is considered a novel pattern
 * and enqueued for curator review. Configurable via env var
 * NOVEL_PATTERN_SIMILARITY_THRESHOLD; defaults to 0.6.
 */
function getThreshold(): number {
  const raw = process.env.NOVEL_PATTERN_SIMILARITY_THRESHOLD
  if (raw !== undefined) {
    const parsed = parseFloat(raw)
    if (!isNaN(parsed)) return parsed
  }
  return 0.6
}

/**
 * Enqueues a session in novel_pattern_queue when its max corpus retrieval
 * similarity score is below the configured threshold.
 *
 * Idempotent for sequential calls (SELECT-then-INSERT). Concurrent
 * same-session closes could double-insert; in practice impossible since
 * sessions close once.
 *
 * @param db - App database connection
 * @param sessionId - The session to evaluate
 * @param maxSimilarity - Maximum corpus similarity score across all retrieval
 *   calls for this session. Pass 0 when no corpus matches were found.
 */
export async function enqueueIfNovelPattern(
  db: AppDb,
  sessionId: string,
  maxSimilarity: number,
): Promise<void> {
  const threshold = getThreshold()
  if (maxSimilarity >= threshold) return

  // Guard against double-enqueue: skip if a row already exists for this session.
  const existing = await db
    .select({ id: novelPatternQueue.id })
    .from(novelPatternQueue)
    .where(eq(novelPatternQueue.sessionId, sessionId))
    .limit(1)

  if (existing.length > 0) return

  await db.insert(novelPatternQueue).values({
    sessionId,
    maxRetrievalSimilarity: maxSimilarity,
  })
}
