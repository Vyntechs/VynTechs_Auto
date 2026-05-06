// Weekly calibration analysis — passive recommendations, not active refits.
//
// For each (risk × vehicle_family × symptom) cell with closed-session
// outcomes in the trailing window, the analyzer computes a Beta-Binomial
// refit recommendation (lib/calibration/refit.ts). When the recommendation
// would move the threshold by ≥ 5 points and rests on at least 10 sessions,
// it writes a row to drift_alerts. The confidence_calibration table itself
// is read-only here — the curator approves recommendations on the drift
// dashboard (Phase P) before any threshold actually changes. See the Phase Q
// corrections callout in docs/superpowers/plans/2026-05-01-vyntechs-implementation-plan.md.
//
// The 0.05 / 10-sample filter prevents the dashboard from flooding with
// rounding-error movements on tiny cells; tune in Phase P if signal is
// missed.
import { and, eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { SPEC_8_3_FALLBACK } from '@/lib/db/queries'
import { confidenceCalibration, driftAlerts } from '@/lib/db/schema'
import { aggregateOutcomesByCell } from './aggregate'
import { refitThreshold } from './refit'

const DEFAULT_WINDOW_DAYS = 90
const DRIFT_THRESHOLD = 0.05
const MIN_SAMPLE_SIZE = 10
const ONE_DAY_MS = 24 * 60 * 60 * 1000

export type CalibrationAnalysisResult = {
  cellsAnalyzed: number
  alertsRaised: number
  windowDays: number
}

export async function runCalibrationAnalysis(
  db: AppDb,
  options: { now?: Date; windowDays?: number } = {},
): Promise<CalibrationAnalysisResult> {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS
  const now = options.now ?? new Date()
  const cutoff = new Date(now.getTime() - windowDays * ONE_DAY_MS)

  const cells = await aggregateOutcomesByCell(db, cutoff)
  let alertsRaised = 0

  for (const cell of cells) {
    const [existing] = await db
      .select()
      .from(confidenceCalibration)
      .where(
        and(
          eq(confidenceCalibration.riskClass, cell.riskClass),
          eq(confidenceCalibration.vehicleFamily, cell.vehicleFamily),
          eq(confidenceCalibration.symptomClass, cell.symptomClass),
        ),
      )
      .limit(1)
    const priorThreshold = existing
      ? Number(existing.thresholdPct)
      : SPEC_8_3_FALLBACK[cell.riskClass]

    const refit = refitThreshold({
      priorThreshold,
      successes: cell.successes,
      comebacks: cell.comebacks,
    })

    if (refit.drift >= DRIFT_THRESHOLD && refit.sampleSize >= MIN_SAMPLE_SIZE) {
      await db.insert(driftAlerts).values({
        riskClass: cell.riskClass,
        vehicleFamily: cell.vehicleFamily,
        symptomClass: cell.symptomClass,
        oldThreshold: priorThreshold,
        newThreshold: refit.newThreshold,
        comebackRate: refit.comebackRate,
        sampleSize: refit.sampleSize,
      })
      alertsRaised++
    }
  }

  return { cellsAnalyzed: cells.length, alertsRaised, windowDays }
}
