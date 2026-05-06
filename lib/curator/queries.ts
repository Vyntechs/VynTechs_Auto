import { sql, isNull, and, eq, asc, desc, getTableColumns, count } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { driftAlerts, sessions, confidenceCalibration, type RiskClass, type Session, type DriftAlert, type ConfidenceCalibration, type IntakePayload } from '@/lib/db/schema'
import { unwrapRows } from '@/lib/db/unwrap-rows'
import { CELL_RISK_CLASS_SQL, CELL_VEHICLE_FAMILY_SQL, CELL_SYMPTOM_CLASS_SQL } from '@/lib/calibration/cell-sql'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CasesForAlertRow = Pick<
  Session,
  'id' | 'status' | 'intake' | 'treeState' | 'outcome' | 'closedAt' | 'createdAt'
>

export type ListCasesForDriftAlertResult = {
  alert: DriftAlert
  cases: CasesForAlertRow[]
}

const RISK_RANK_SQL = sql`CASE ${driftAlerts.riskClass}
  WHEN 'destructive' THEN 5
  WHEN 'high' THEN 4
  WHEN 'medium' THEN 3
  WHEN 'low' THEN 2
  WHEN 'zero' THEN 1
  ELSE 0
END`

export type PendingDriftAlertRow =
  typeof driftAlerts.$inferSelect & { wasDismissedRecently: boolean }

export async function listPendingDriftAlerts(
  db: AppDb,
  filters: {
    riskClass?: RiskClass
    vehicleFamily?: string
    symptomClass?: string
  } = {},
): Promise<PendingDriftAlertRow[]> {
  const wheres = [isNull(driftAlerts.decision)]
  if (filters.riskClass)     wheres.push(eq(driftAlerts.riskClass, filters.riskClass))
  if (filters.vehicleFamily) wheres.push(eq(driftAlerts.vehicleFamily, filters.vehicleFamily))
  if (filters.symptomClass)  wheres.push(eq(driftAlerts.symptomClass, filters.symptomClass))

  const rows = await db
    .select({
      ...getTableColumns(driftAlerts),
      wasDismissedRecently: sql<boolean>`EXISTS (
        SELECT 1 FROM drift_alerts d2
        WHERE d2.risk_class = drift_alerts.risk_class
        AND d2.vehicle_family = drift_alerts.vehicle_family
        AND d2.symptom_class = drift_alerts.symptom_class
        AND d2.decision = 'dismissed'
        AND d2.decided_at > now() - interval '90 days'
        AND d2.id != drift_alerts.id
      )`,
    })
    .from(driftAlerts)
    .where(and(...wheres))
    .orderBy(desc(RISK_RANK_SQL), asc(driftAlerts.createdAt))

  return rows as PendingDriftAlertRow[]
}

// ---------------------------------------------------------------------------
// listCasesForDriftAlert
// ---------------------------------------------------------------------------
//
// SCHEMA NOTE: sessions does NOT have flat riskClass / vehicleFamily /
// symptomClass columns. Cell membership is computed dynamically:
//
//   riskClass    ← sessions.tree_state -> 'gateDecision' ->> 'riskClass'
//   vehicleFamily← LOWER(intake->>'vehicleMake') || '-' || LOWER(intake->>'vehicleModel')
//   symptomClass ← CASE WHEN on intake->>'customerComplaint' regex (mirrors aggregate.ts)
//
// This matches exactly how lib/calibration/aggregate.ts computes cell buckets
// for the weekly cron, so the cases shown here are the same cases that fed the
// threshold recommendation.
//
// The 4-week window (28 days) is tighter than the cron's 90-day default to
// show only the recent evidence that tipped the alert, rather than the full
// calibration corpus.

const FOUR_WEEKS_MS = 28 * 24 * 60 * 60 * 1000

export async function listCasesForDriftAlert(
  db: AppDb,
  alertId: string,
): Promise<ListCasesForDriftAlertResult | null> {
  // 1. Fetch the alert
  const [alert] = await db
    .select()
    .from(driftAlerts)
    .where(eq(driftAlerts.id, alertId))
    .limit(1)

  if (!alert) return null

  // 2. Compute the 4-week cutoff relative to when the alert was created so
  //    that the displayed cases are stable even after the weekly cron re-runs.
  const cutoff = new Date(alert.createdAt.getTime() - FOUR_WEEKS_MS)

  // 3. Filter sessions by computed cell values using the same expressions as
  //    aggregate.ts. Raw SQL is required because the cell columns don't exist
  //    as flat columns on the sessions table.
  const result = await db.execute(sql`
    SELECT
      s.id,
      s.status,
      s.intake,
      s.tree_state AS "treeState",
      s.outcome,
      s.closed_at AS "closedAt",
      s.created_at AS "createdAt"
    FROM sessions s
    WHERE s.status = 'closed'
      AND s.closed_at >= ${cutoff}
      AND ${CELL_RISK_CLASS_SQL} = ${alert.riskClass}
      AND ${CELL_VEHICLE_FAMILY_SQL} = ${alert.vehicleFamily}
      AND ${CELL_SYMPTOM_CLASS_SQL} = ${alert.symptomClass}
    ORDER BY s.closed_at DESC
  `)

  const cases = unwrapRows<CasesForAlertRow>(result)

  return { alert, cases }
}

// ---------------------------------------------------------------------------
// listCalibrationCells
// ---------------------------------------------------------------------------
//
// Returns all confidence_calibration rows ordered by risk rank → vehicle
// family → symptom class. Supports optional filter by riskClass, vehicleFamily,
// and symptomClass. Used by the calibration thresholds dashboard (Screen 4).

const CALIBRATION_RISK_RANK_SQL = sql`CASE ${confidenceCalibration.riskClass}
  WHEN 'destructive' THEN 5
  WHEN 'high' THEN 4
  WHEN 'medium' THEN 3
  WHEN 'low' THEN 2
  WHEN 'zero' THEN 1
  ELSE 0
END`

export type CalibrationCellRow = ConfidenceCalibration

export async function listCalibrationCells(
  db: AppDb,
  filters: {
    riskClass?: RiskClass
    vehicleFamily?: string
    symptomClass?: string
  } = {},
): Promise<CalibrationCellRow[]> {
  const wheres = []
  if (filters.riskClass)     wheres.push(eq(confidenceCalibration.riskClass, filters.riskClass))
  if (filters.vehicleFamily) wheres.push(eq(confidenceCalibration.vehicleFamily, filters.vehicleFamily))
  if (filters.symptomClass)  wheres.push(eq(confidenceCalibration.symptomClass, filters.symptomClass))

  return db
    .select()
    .from(confidenceCalibration)
    .where(wheres.length > 0 ? and(...wheres) : undefined)
    .orderBy(
      desc(CALIBRATION_RISK_RANK_SQL),
      asc(confidenceCalibration.vehicleFamily),
      asc(confidenceCalibration.symptomClass),
    )
}

// ---------------------------------------------------------------------------
// countPendingDriftAlerts
// ---------------------------------------------------------------------------
//
// Returns the count of drift_alerts rows where decision IS NULL.  Used by
// the calibration dashboard header to render a "🔔 N pending" link.

export async function countPendingDriftAlerts(db: AppDb): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(driftAlerts)
    .where(isNull(driftAlerts.decision))

  return row?.n ?? 0
}

// ---------------------------------------------------------------------------
// listHistoryForCell
// ---------------------------------------------------------------------------
//
// Returns the last `limit` drift alerts for a specific (riskClass, vehicleFamily,
// symptomClass) cell, ordered newest-first. Used by the per-category history
// page (Screen 5) to show the audit trail of threshold recommendations.

export async function listHistoryForCell(
  db: AppDb,
  riskClass: RiskClass,
  vehicleFamily: string,
  symptomClass: string,
  limit = 6,
): Promise<DriftAlert[]> {
  return db
    .select()
    .from(driftAlerts)
    .where(
      and(
        eq(driftAlerts.riskClass, riskClass),
        eq(driftAlerts.vehicleFamily, vehicleFamily),
        eq(driftAlerts.symptomClass, symptomClass),
      ),
    )
    .orderBy(desc(driftAlerts.createdAt))
    .limit(limit)
}

// ---------------------------------------------------------------------------
// listDeferredSessions
// ---------------------------------------------------------------------------
//
// Returns sessions where status='deferred' AND closed_at IS NULL, ordered
// newest-first by createdAt.
//
// SCHEMA NOTE: There is no dedicated `deferred_at` column on sessions. The
// status transitions to 'deferred' when the tech calls the decline-or-defer
// handler, but the deferral timestamp is not recorded in a top-level column
// (closed_at stays NULL for deferred sessions). We therefore sort by
// createdAt DESC (session start time) as the best available proxy.

export type DeferredSessionRow = Pick<
  Session,
  'id' | 'intake' | 'createdAt'
>

export async function listDeferredSessions(db: AppDb): Promise<DeferredSessionRow[]> {
  return db
    .select({
      id: sessions.id,
      intake: sessions.intake,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.status, 'deferred'),
        isNull(sessions.closedAt),
      ),
    )
    .orderBy(desc(sessions.createdAt))
}
