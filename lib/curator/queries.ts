import { sql, isNull, and, eq, asc, desc, getTableColumns, count, or, isNotNull, type SQL } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { driftAlerts, sessions, novelPatternQueue, confidenceCalibration, corpusEntries, profiles, shops, type RiskClass, type Session, type DriftAlert, type ConfidenceCalibration, type IntakePayload } from '@/lib/db/schema'
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
// Lists sessions in deferred status, newest deferral first. Note: closedAt
// is populated when the tech defers (set by setSessionTerminalStatus in
// lib/db/queries.ts), so it doubles as the deferral timestamp.

export type DeferredSessionRow = Pick<
  Session,
  'id' | 'intake' | 'closedAt' | 'createdAt'
>

export async function listDeferredSessions(db: AppDb): Promise<DeferredSessionRow[]> {
  return db
    .select({
      id: sessions.id,
      intake: sessions.intake,
      closedAt: sessions.closedAt,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(eq(sessions.status, 'deferred'))
    .orderBy(desc(sessions.closedAt))
}

// ---------------------------------------------------------------------------
// listPendingNovelPatterns
// ---------------------------------------------------------------------------
//
// Returns novel_pattern_queue rows where reviewed_at IS NULL, joined with their
// parent session for intake data. Ordered newest-first. Used by Screen 7.

export async function listPendingNovelPatterns(db: AppDb) {
  return db.select({
    queue: novelPatternQueue,
    session: sessions,
  })
  .from(novelPatternQueue)
  .innerJoin(sessions, eq(novelPatternQueue.sessionId, sessions.id))
  .where(isNull(novelPatternQueue.reviewedAt))
  .orderBy(desc(novelPatternQueue.createdAt))
}

// ---------------------------------------------------------------------------
// listCorpusEntries
// ---------------------------------------------------------------------------
//
// Returns corpus_entries rows ordered newest-first. Optional curatorOnly flag
// filters to rows where is_curator_entry = true. Drizzle's .where(undefined)
// is a no-op so no separate query path is needed.

export async function listCorpusEntries(
  db: AppDb,
  opts: { curatorOnly?: boolean } = {},
) {
  return db
    .select()
    .from(corpusEntries)
    .where(opts.curatorOnly ? eq(corpusEntries.isCuratorEntry, true) : undefined)
    .orderBy(desc(corpusEntries.createdAt))
}

// ---------------------------------------------------------------------------
// listAllCases
// ---------------------------------------------------------------------------
//
// Cross-shop session browser for the /curator/cases index. Beta-scale: hard
// LIMIT 100, no pagination. Joins shop + tech (profile) so the table can show
// who's working on what across all beta shops without an N+1.
//
// Search matches the JSON intake fields most useful for "find that Tahoe with
// the misfire" — vehicle make, model, and customer complaint. Case-insensitive
// via ilike. VIN search would require joining vehicles; deferred until asked.

export type CaseStatusFilter = 'open' | 'closed' | 'declined' | 'deferred'

export type AllCasesRow = {
  id: string
  shopId: string
  shopName: string | null
  techId: string
  techName: string | null
  status: 'open' | 'closed' | 'declined' | 'deferred'
  intake: IntakePayload
  createdAt: Date
  closedAt: Date | null
}

export async function listAllCases(
  db: AppDb,
  filters: {
    status?: CaseStatusFilter
    shopId?: string
    techId?: string
    search?: string
    limit?: number
  } = {},
): Promise<AllCasesRow[]> {
  const wheres: SQL[] = []
  if (filters.status) wheres.push(eq(sessions.status, filters.status))
  if (filters.shopId) wheres.push(eq(sessions.shopId, filters.shopId))
  if (filters.techId) wheres.push(eq(sessions.techId, filters.techId))
  if (filters.search && filters.search.trim()) {
    const term = `%${filters.search.trim()}%`
    const searchExpr = or(
      sql`${sessions.intake} ->> 'vehicleMake' ILIKE ${term}`,
      sql`${sessions.intake} ->> 'vehicleModel' ILIKE ${term}`,
      sql`${sessions.intake} ->> 'customerComplaint' ILIKE ${term}`,
    )
    if (searchExpr) wheres.push(searchExpr)
  }

  const rows = await db
    .select({
      id: sessions.id,
      shopId: sessions.shopId,
      shopName: shops.name,
      techId: sessions.techId,
      techName: profiles.fullName,
      status: sessions.status,
      intake: sessions.intake,
      createdAt: sessions.createdAt,
      closedAt: sessions.closedAt,
    })
    .from(sessions)
    .leftJoin(shops, eq(shops.id, sessions.shopId))
    .leftJoin(profiles, eq(profiles.id, sessions.techId))
    .where(wheres.length ? and(...wheres) : undefined)
    .orderBy(desc(sessions.createdAt))
    .limit(filters.limit ?? 100)

  return rows
}

// ---------------------------------------------------------------------------
// listCaseFilterOptions
// ---------------------------------------------------------------------------
//
// Populates the shop + tech dropdowns on /curator/cases. Returns every shop
// and every tech with a name set; sessions whose tech has no fullName still
// appear in the listing but won't show up as a filter choice. Cheap enough
// to call on every page render at beta scale.

export type CaseFilterOptions = {
  shops: { id: string; name: string }[]
  techs: { id: string; fullName: string; shopId: string | null }[]
}

export async function listCaseFilterOptions(db: AppDb): Promise<CaseFilterOptions> {
  const [shopRows, techRows] = await Promise.all([
    db
      .select({ id: shops.id, name: shops.name })
      .from(shops)
      .orderBy(asc(shops.name)),
    db
      .select({ id: profiles.id, fullName: profiles.fullName, shopId: profiles.shopId })
      .from(profiles)
      .where(isNotNull(profiles.fullName))
      .orderBy(asc(profiles.fullName)),
  ])
  return {
    shops: shopRows,
    techs: techRows.filter((t): t is { id: string; fullName: string; shopId: string | null } => t.fullName !== null),
  }
}
