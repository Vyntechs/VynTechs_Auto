import { getGateThreshold } from '@/lib/diagnostics/gate-thresholds'

/**
 * Has the internal confidence earned the right to a verdict?
 *
 * `cumulative_confidence` is on a 0–100 scale; `getGateThreshold` returns a 0–1
 * threshold. We reconcile by comparing on the 0–1 scale (`confidence / 100`)
 * rather than scaling the threshold up — `0.85 * 100` is `85.00000000000001`
 * in IEEE-754, which would make an exact 85 read as below an 0.85 gate.
 *
 * Internal only: the boolean drives whether the loop offers a verdict; the
 * underlying number is never shown to the tech.
 */
export function hasReachedGate(confidence0to100: number, symptomSlug: string): boolean {
  return confidence0to100 / 100 >= getGateThreshold(symptomSlug)
}
