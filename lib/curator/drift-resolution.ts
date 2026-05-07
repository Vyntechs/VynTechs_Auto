import { eq, inArray, isNull, and, sql } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { driftAlerts, confidenceCalibration } from '@/lib/db/schema'

export type ResolutionResult =
  | { kind: 'ok' }
  | { kind: 'not-found' }
  | { kind: 'already-decided' }

export async function applyDriftAlert(
  db: AppDb,
  alertId: string,
  curatorProfileId: string,
  note: string | null,
): Promise<ResolutionResult> {
  return db.transaction(async (tx) => {
    const [alert] = await tx
      .select()
      .from(driftAlerts)
      .where(eq(driftAlerts.id, alertId))
      .limit(1)

    if (!alert) return { kind: 'not-found' }
    if (alert.decision !== null) return { kind: 'already-decided' }

    await tx
      .update(driftAlerts)
      .set({
        decision: 'applied',
        decidedAt: sql`now()`,
        decidedByUserId: curatorProfileId,
        decisionNote: note,
      })
      .where(eq(driftAlerts.id, alertId))

    await tx
      .update(confidenceCalibration)
      .set({
        thresholdPct: alert.newThreshold,
        lastRefitAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(confidenceCalibration.riskClass, alert.riskClass),
          eq(confidenceCalibration.vehicleFamily, alert.vehicleFamily),
          eq(confidenceCalibration.symptomClass, alert.symptomClass),
        ),
      )

    return { kind: 'ok' }
  })
}

export async function dismissDriftAlert(
  db: AppDb,
  alertId: string,
  curatorProfileId: string,
  note: string | null,
): Promise<ResolutionResult> {
  const [alert] = await db
    .select({ id: driftAlerts.id, decision: driftAlerts.decision })
    .from(driftAlerts)
    .where(eq(driftAlerts.id, alertId))
    .limit(1)

  if (!alert) return { kind: 'not-found' }
  if (alert.decision !== null) return { kind: 'already-decided' }

  await db
    .update(driftAlerts)
    .set({
      decision: 'dismissed',
      decidedAt: sql`now()`,
      decidedByUserId: curatorProfileId,
      decisionNote: note,
    })
    .where(eq(driftAlerts.id, alertId))

  return { kind: 'ok' }
}

export async function bulkDismissDriftAlerts(
  db: AppDb,
  alertIds: string[],
  curatorProfileId: string,
  note: string | null,
): Promise<{ kind: 'ok'; dismissedCount: number }> {
  if (alertIds.length === 0) {
    return { kind: 'ok', dismissedCount: 0 }
  }

  const updated = await db
    .update(driftAlerts)
    .set({
      decision: 'dismissed',
      decidedAt: sql`now()`,
      decidedByUserId: curatorProfileId,
      decisionNote: note,
    })
    .where(and(inArray(driftAlerts.id, alertIds), isNull(driftAlerts.decision)))
    .returning()

  return { kind: 'ok', dismissedCount: updated.length }
}
