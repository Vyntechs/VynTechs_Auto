import type { Flow, Step } from '@/lib/flows/types'

// A read-only, plain-English walk of a flow's real stored body. No internal
// step IDs leak: branch targets are shown by the destination step's title,
// findings show the verdict + severity in words, and sources/conflicts are
// summarized honestly. NOT a JSON dump and NOT fabricated.

const SEVERITY_LABEL: Record<string, string> = {
  fixable: 'Fixable',
  investigate: 'Needs investigation',
  'next-system': 'Move to next system',
}

function orderedSteps(body: Flow): Array<[string, Step]> {
  const entries = Object.entries(body.steps)
  // Start step first; the rest keep their stored order.
  entries.sort(([a], [b]) => (a === body.startStepId ? -1 : b === body.startStepId ? 1 : 0))
  return entries
}

export function FlowBodySummary({ body }: { body: Flow }) {
  const ordered = orderedSteps(body)
  const numberById = new Map<string, number>()
  ordered.forEach(([id], i) => numberById.set(id, i + 1))
  const titleFor = (id: string) =>
    body.steps[id]?.title?.trim() || `step ${numberById.get(id) ?? '?'}`

  return (
    <ol className="vt-flow-summary">
      {ordered.map(([id, step], i) => {
        const isStart = id === body.startStepId
        const cites = step.citations ?? []
        const conflicts = step.conflicts ?? []
        return (
          <li key={id} className="vt-flow-summary__step">
            <div className="vt-flow-summary__num">{i + 1}</div>
            <div className="vt-flow-summary__body">
              <div className="vt-flow-summary__head">
                {isStart && <span className="vt-flow-summary__start">Start here</span>}
                <span className="vt-flow-summary__kind">
                  {step.kind === 'question' ? 'Question' : 'Procedure'}
                </span>
              </div>
              <p className="vt-flow-summary__title">{step.title?.trim() || 'Untitled step'}</p>
              <p className="vt-flow-summary__text">
                {step.kind === 'question' ? step.question : step.instructions}
              </p>

              {step.kind === 'question' && step.answers.length > 0 && (
                <ul className="vt-flow-summary__answers">
                  {step.answers.map((a) => (
                    <li key={a.id} className="vt-flow-summary__answer">
                      <span className="vt-flow-summary__answer-label">{a.label || '—'}</span>
                      {a.next ? (
                        <span className="vt-flow-summary__answer-to">
                          go to “{titleFor(a.next)}”
                        </span>
                      ) : a.finding ? (
                        <span className={`vt-flow-summary__answer-end vt-sev--${a.finding.severity}`}>
                          ends here — {a.finding.verdict} · {SEVERITY_LABEL[a.finding.severity] ?? a.finding.severity}
                        </span>
                      ) : (
                        <span className="vt-flow-summary__answer-stuck">not set yet</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {step.kind === 'procedure' && (
                <div className="vt-flow-summary__answers">
                  <span className="vt-flow-summary__answer-to">then go to “{titleFor(step.next)}”</span>
                </div>
              )}

              <div className="vt-flow-summary__meta">
                <span>
                  {cites.length > 0
                    ? `${cites.length} source${cites.length > 1 ? 's' : ''}`
                    : 'No source yet'}
                </span>
                {conflicts.length > 0 && (
                  <span className="vt-flow-summary__conflict">
                    {conflicts.length} unresolved disagreement{conflicts.length > 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
