import { sql, isNull, and, eq, asc, desc, getTableColumns } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { driftAlerts, sessions, type RiskClass, type Session, type DriftAlert } from '@/lib/db/schema'

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

function unwrapRows<R>(result: unknown): R[] {
  if (Array.isArray(result)) return result as R[]
  if (
    result !== null &&
    typeof result === 'object' &&
    'rows' in result &&
    Array.isArray((result as { rows: unknown }).rows)
  ) {
    return (result as { rows: R[] }).rows
  }
  return []
}

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
      AND s.tree_state -> 'gateDecision' ->> 'riskClass' = ${alert.riskClass}
      AND LOWER(s.intake ->> 'vehicleMake') || '-' || LOWER(s.intake ->> 'vehicleModel') = ${alert.vehicleFamily}
      AND CASE
            WHEN s.intake ->> 'customerComplaint' ~* '(power|stall|hesit|sluggish)' THEN 'power_loss'
            WHEN s.intake ->> 'customerComplaint' ~* '(start|crank|no.?start)' THEN 'no_start'
            WHEN s.intake ->> 'customerComplaint' ~* '(misfire|rough)' THEN 'misfire'
            ELSE '*'
          END = ${alert.symptomClass}
    ORDER BY s.closed_at DESC
  `)

  const cases = unwrapRows<CasesForAlertRow>(result)

  return { alert, cases }
}
