// Per-cell outcome aggregation for the weekly calibration cron.
//
// A "cell" is a (riskClass × vehicleFamily × symptomClass) bucket. For each
// closed session in the window the AI made a gate decision on, we count
// successes (no comeback recorded) vs. comebacks (a follow_up row with
// comeback_recorded = true). The cron feeds these counts into refitThreshold
// to decide whether the per-cell threshold needs to drift.
//
// Risk class is read from sessions.tree_state.gateDecision.riskClass — the
// field that drove the gating decision is the authoritative one. (Earlier
// drafts mistakenly tried session_events.aiResponse->'riskClass'; that key
// only exists nested under declineOrDefer, so it would silently NULL out for
// most allowed actions. See Phase Q corrections callout in the plan.)
//
// The HAVING clause caps results to cells with at least one session, so the
// caller doesn't have to filter empty rows. Symptom class falls back to '*'
// when the customer complaint doesn't match any known regex; the calibration
// table's wildcard rows are designed to absorb those.
import { sql } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'

export type CellOutcome = {
  riskClass: 'zero' | 'low' | 'medium' | 'high' | 'destructive'
  vehicleFamily: string
  symptomClass: string
  successes: number
  comebacks: number
}

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

export async function aggregateOutcomesByCell(
  db: AppDb,
  sinceCutoff: Date,
): Promise<CellOutcome[]> {
  const result = await db.execute(sql`
    WITH closed_sessions AS (
      SELECT
        s.id,
        s.intake,
        s.closed_at,
        LOWER(s.intake ->> 'vehicleMake') || '-' || LOWER(s.intake ->> 'vehicleModel') AS vehicle_family,
        s.tree_state -> 'gateDecision' ->> 'riskClass' AS risk_class
      FROM sessions s
      WHERE s.status = 'closed'
        AND s.closed_at >= ${sinceCutoff}
        AND s.tree_state -> 'gateDecision' ->> 'riskClass' IS NOT NULL
    ),
    classified AS (
      SELECT
        cs.id,
        cs.risk_class,
        cs.vehicle_family,
        CASE
          WHEN cs.intake ->> 'customerComplaint' ~* '(power|stall|hesit|sluggish)' THEN 'power_loss'
          WHEN cs.intake ->> 'customerComplaint' ~* '(start|crank|no.?start)' THEN 'no_start'
          WHEN cs.intake ->> 'customerComplaint' ~* '(misfire|rough)' THEN 'misfire'
          ELSE '*'
        END AS symptom_class,
        EXISTS (
          SELECT 1 FROM follow_ups f
          WHERE f.session_id = cs.id AND f.comeback_recorded = true
        ) AS had_comeback
      FROM closed_sessions cs
    )
    SELECT
      risk_class AS "riskClass",
      vehicle_family AS "vehicleFamily",
      symptom_class AS "symptomClass",
      SUM(CASE WHEN had_comeback THEN 0 ELSE 1 END)::int AS successes,
      SUM(CASE WHEN had_comeback THEN 1 ELSE 0 END)::int AS comebacks
    FROM classified
    GROUP BY risk_class, vehicle_family, symptom_class
    HAVING SUM(1) >= 1
  `)
  return unwrapRows<CellOutcome>(result)
}
