import { sql, isNull, and, eq, asc, desc, getTableColumns } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { driftAlerts, type RiskClass } from '@/lib/db/schema'

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
