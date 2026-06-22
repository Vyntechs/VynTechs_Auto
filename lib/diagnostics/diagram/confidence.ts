/**
 * Internal confidence accumulator. NEVER rendered to the tech — it exists only
 * to drive the verdict gate and the next-check selection.
 *
 * Confidence is the SUM of the curator-seeded `confidence_boost` weights of the
 * checks the tech has actually confirmed, clamped to [0, 100] (matching the
 * diagnostic_sessions.cumulative_confidence DB CHECK BETWEEN 0 AND 100). It
 * rises ONLY from real confirmed checks — never AI self-grading, never
 * fabricated. Non-finite or negative entries are ignored (treated as 0) so a
 * malformed weight can never corrupt the total.
 */
export function accumulateConfidence(confirmedBoosts: number[]): number {
  let sum = 0
  for (const boost of confirmedBoosts) {
    if (typeof boost === 'number' && Number.isFinite(boost) && boost > 0) {
      sum += boost
    }
  }
  return Math.min(100, Math.max(0, sum))
}
