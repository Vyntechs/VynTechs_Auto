import { sql } from 'drizzle-orm'

/**
 * SQL fragments for computing the (risk, vehicle, symptom) cell membership
 * of a session row. Used by both the calibration cron (aggregate.ts) and
 * the curator drift drill-down (queries.ts) to ensure identical
 * classification — if the cron rebuckets a session, the drill-down agrees.
 *
 * If you change a fragment here, the change applies to both consumers.
 *
 * The expressions assume a session-table alias of `s` (e.g. `FROM sessions s`).
 * Callers that don't alias the table will need to write the JSON paths inline.
 */

export const CELL_RISK_CLASS_SQL = sql`s.tree_state -> 'gateDecision' ->> 'riskClass'`

export const CELL_VEHICLE_FAMILY_SQL = sql`LOWER(s.intake ->> 'vehicleMake') || '-' || LOWER(s.intake ->> 'vehicleModel')`

export const CELL_SYMPTOM_CLASS_SQL = sql`CASE
  WHEN s.intake ->> 'customerComplaint' ~* '(power|stall|hesit|sluggish)' THEN 'power_loss'
  WHEN s.intake ->> 'customerComplaint' ~* '(start|crank|no.?start)' THEN 'no_start'
  WHEN s.intake ->> 'customerComplaint' ~* '(misfire|rough)' THEN 'misfire'
  ELSE '*'
END`
