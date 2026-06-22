import type { ForkVerdict } from '@/lib/diagnostics/diagram/step-sequence'
import type { TopologyTestAction } from '@/lib/diagnostics/load-system-topology'

/**
 * What the tech supplies for the current check:
 * - `value`: a numeric reading, when they entered one (else null)
 * - `observedVerdict`: the outcome they tapped against the shown expectation,
 *   when no numeric threshold exists (else null)
 */
export type ReadingInput = { value: number | null; observedVerdict: ForkVerdict | null }

/**
 * Turn a tech's input into a ForkVerdict the engine can route on.
 *
 * Only auto-judges numerically where the curator authored a threshold
 * (`expectedValue`): within `expectedValue ± (expectedTolerance ?? 0)` → 'pass',
 * else 'fail'. For prose-only steps (the majority of the fuel flow) there is NO
 * authored threshold, so we never invent one — we return the tech's own tap
 * (`observedVerdict`). Returns null when neither a numeric judgement nor a tap
 * is available: the caller MUST NOT advance on null.
 */
export function verdictFromReading(
  input: ReadingInput,
  step: TopologyTestAction,
): ForkVerdict | null {
  if (step.expectedValue != null && input.value != null) {
    const tolerance = step.expectedTolerance ?? 0
    return Math.abs(input.value - step.expectedValue) <= tolerance ? 'pass' : 'fail'
  }
  return input.observedVerdict
}
