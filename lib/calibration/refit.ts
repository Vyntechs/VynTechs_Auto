// Beta-Binomial threshold re-fit with a weak prior.
//
// PRIOR_CONCENTRATION encodes how much pseudo-data the prior threshold is
// "worth": with concentration 10, real outcomes overtake the prior after
// roughly 30 samples. Lower → more reactive (jittery on small N); higher →
// more conservative (slower to move).
//
// The model: each cell has a true comeback rate p. Prior on p is Beta with
// mean (1 - priorThreshold) — i.e., the prior expects the cell's calibrated
// comeback rate to match the risk-class baseline (zero/low/medium/high/
// destructive thresholds in spec §8.3 imply baseline comeback rates of
// 1, 0.3, 0.2, 0.1, 0.05 respectively). Observing live (successes, comebacks)
// updates p; we then move the threshold by the deviation between the
// posterior comeback rate and the target. Above target → tighten; below →
// ease. The threshold is clamped to [0.5, 0.99] so calibration cannot
// disable the safety floor.
const PRIOR_CONCENTRATION = 10
const MIN_THRESHOLD = 0.5
const MAX_THRESHOLD = 0.99

export type RefitInput = {
  priorThreshold: number
  successes: number
  comebacks: number
}

export type RefitResult = {
  newThreshold: number
  sampleSize: number
  comebackRate: number
  drift: number
}

export function refitThreshold(input: RefitInput): RefitResult {
  const { priorThreshold, successes, comebacks } = input
  const sampleSize = successes + comebacks

  if (sampleSize === 0) {
    return { newThreshold: priorThreshold, sampleSize: 0, comebackRate: 0, drift: 0 }
  }

  // Beta prior on comeback rate: E[Beta(α₀, β₀)] = 1 - priorThreshold.
  const alpha0 = (1 - priorThreshold) * PRIOR_CONCENTRATION
  const beta0 = PRIOR_CONCENTRATION - alpha0
  const posteriorComebackRate = (alpha0 + comebacks) / (PRIOR_CONCENTRATION + sampleSize)

  const targetComebackRate = 1 - priorThreshold
  const adjustment = posteriorComebackRate - targetComebackRate
  const newThreshold = Math.min(
    MAX_THRESHOLD,
    Math.max(MIN_THRESHOLD, priorThreshold + adjustment),
  )

  return {
    newThreshold,
    sampleSize,
    comebackRate: comebacks / sampleSize,
    drift: Math.abs(newThreshold - priorThreshold),
  }
}
