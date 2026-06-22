'use client'

/**
 * The verdict — the loop's payoff, shown center-stage over the (dimmed) diagram
 * when internal confidence crosses the gate ('verdict') or the authored checks
 * run out first ('handoff'). Everything here is true data only:
 *
 * - "Your N checks line up" — N is the real count of checks the tech actually
 *   confirmed this session. Never a fabricated or derived number.
 * - "N techs have confirmed this fix" — the real prior-fix count, rendered ONLY
 *   when > 0. (The prototype's invented "41 techs" is gone.)
 * - The conclusion + recommended action are the curator's authored prose
 *   (reasoning + nextAction); when neither was authored we degrade honestly
 *   rather than inventing a cause.
 * - NO percent, NO confidence value, NO compass. Internal confidence stays
 *   internal — it only decided whether we earned the right to show this.
 */
type VerdictDirection = { reasoning: string | null; nextAction: string }

type Props = {
  mode: 'verdict' | 'handoff'
  confirmedCount: number
  priorFixCount: number
  direction: VerdictDirection | null
  onRunAgain: () => void
}

export function VerdictPanel({ mode, confirmedCount, priorFixCount, direction, onRunAgain }: Props) {
  const checks = confirmedCount === 1 ? 'check' : 'checks'
  const isVerdict = mode === 'verdict'

  const lead =
    direction?.reasoning?.trim() ||
    (isVerdict
      ? 'Your checks line up — strongest direction below.'
      : "These checks didn't isolate a single cause yet.")

  return (
    <div className="topo-verdict" role="dialog" aria-modal="false" aria-label="Diagnostic verdict">
      <div className="topo-verdict__card">
        <div className={`topo-verdict__eyebrow${isVerdict ? '' : ' is-handoff'}`}>
          {isVerdict ? 'Where your checks point' : 'Authored checks complete'}
        </div>

        <p className="topo-verdict__lead">{lead}</p>

        {direction?.nextAction && (
          <div className="topo-verdict__action">
            <span className="topo-verdict__action-label">Recommended next</span>
            <p className="topo-verdict__action-text">{direction.nextAction}</p>
          </div>
        )}

        <div className="topo-verdict__story">
          <span className="topo-verdict__story-line">
            {isVerdict
              ? `Your ${confirmedCount} ${checks} line up.`
              : `You completed ${confirmedCount} ${checks}.`}
          </span>
          {isVerdict && priorFixCount > 0 && (
            <span className="topo-verdict__story-line topo-verdict__story-line--social">
              {priorFixCount} {priorFixCount === 1 ? 'tech has' : 'techs have'} confirmed this fix.
            </span>
          )}
        </div>

        <button type="button" className="topo-verdict__again" onClick={onRunAgain}>
          Run again
        </button>
      </div>
    </div>
  )
}
