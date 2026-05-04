import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm'
import { followUps, sessions } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'
import type { IntakePayload } from '@/lib/types'

export type DueFollowUp = {
  id: string
  sessionId: string
  kind: '7d' | '30d'
  dueAt: Date
  surfacedAt: Date
  intake: IntakePayload
}

/**
 * Surfaced + unresolved follow-ups for a single tech, oldest-due first.
 * Joins to sessions to carry the intake payload (vehicle + complaint)
 * so the UI can render without an extra round-trip per row.
 */
export async function listDueFollowUpsForTech(
  db: AppDb,
  techId: string,
): Promise<DueFollowUp[]> {
  const rows = await db
    .select({
      id: followUps.id,
      sessionId: followUps.sessionId,
      kind: followUps.kind,
      dueAt: followUps.dueAt,
      surfacedAt: followUps.surfacedAt,
      intake: sessions.intake,
    })
    .from(followUps)
    .innerJoin(sessions, eq(sessions.id, followUps.sessionId))
    .where(
      and(
        eq(followUps.techId, techId),
        isNotNull(followUps.surfacedAt),
        isNull(followUps.resolvedAt),
      ),
    )
    .orderBy(asc(followUps.dueAt))

  return rows.map((r) => ({
    id: r.id,
    sessionId: r.sessionId,
    kind: r.kind as '7d' | '30d',
    dueAt: r.dueAt,
    // safe non-null: filtered by isNotNull above
    surfacedAt: r.surfacedAt as Date,
    intake: r.intake,
  }))
}
