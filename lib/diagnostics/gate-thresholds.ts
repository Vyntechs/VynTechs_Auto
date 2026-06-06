// Per-symptom commit-gate thresholds. Hard-coded for PR 1.
// Source: Phase 2 run-1 progress report (P0087 = 0.85). Same default for the
// others until field calibration data exists.
// TODO (post-PR-1): relocate to a symptoms.gate_threshold column or the
// confidence_calibration table once per-cell calibration data exists.

const GATE_THRESHOLDS: Record<string, number> = {
  'p0087': 0.85,
  'p0088': 0.85,
  'no-start-cranks-normally-fuel-system-suspect': 0.85,
}

const DEFAULT_GATE = 0.8

export function getGateThreshold(symptomSlug: string): number {
  return GATE_THRESHOLDS[symptomSlug] ?? DEFAULT_GATE
}
