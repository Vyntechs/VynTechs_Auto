'use client'

import { useState } from 'react'
import type { TopologyTestAction } from '@/lib/diagnostics/load-system-topology'
import type { ReadingInput } from '@/lib/diagnostics/diagram/verdict-from-reading'
import type { ForkVerdict } from '@/lib/diagnostics/diagram/step-sequence'

/**
 * The current-check console — the one ask in the elimination loop. The tech
 * either enters a numeric reading (only where the curator authored a threshold,
 * `expectedValue != null` — one step in the seeded fuel flow) or taps the
 * outcome of an observation against the shown expectation. The whole point is to
 * make this single ask painless: a big, obvious input and one tap to move on.
 *
 * Honesty rules baked in here:
 * - We NEVER invent a numeric threshold. Numeric judging happens upstream in
 *   `verdictFromReading` only where `expectedValue` exists; otherwise the tech's
 *   own tap is the verdict.
 * - "Skip — I already know this" advances WITHOUT recording an outcome: the
 *   parent treats it as a non-confirmed check (no confidence credit).
 * - No step number, no "N of M", no percent. The current check is the view.
 */
type Props = {
  step: TopologyTestAction
  onSubmit: (input: ReadingInput) => void
  onSkip: () => void
}

const OUTCOMES: { verdict: ForkVerdict; label: string; tone: 'pass' | 'neutral' | 'fail' }[] = [
  { verdict: 'pass', label: 'Matches expected', tone: 'pass' },
  { verdict: 'neutral', label: 'Borderline / unsure', tone: 'neutral' },
  { verdict: 'fail', label: 'Out of spec / fault', tone: 'fail' },
]

export function ReadingEntry({ step, onSubmit, onSkip }: Props) {
  const numeric = step.expectedValue != null
  const [raw, setRaw] = useState('')

  const parsed = raw.trim() === '' ? null : Number(raw)
  const numericReady = parsed !== null && Number.isFinite(parsed)

  const expectedText = numeric
    ? `Expected ${step.expectedValue}${step.expectedUnit ? ` ${step.expectedUnit}` : ''}` +
      (step.expectedTolerance != null ? ` ± ${step.expectedTolerance}` : '')
    : step.expectedObservation

  return (
    <section className="topo-loop" aria-label="Current check">
      <div className="topo-loop__eyebrow">Current check</div>
      <p className="topo-loop__ask">{step.description}</p>

      {expectedText && (
        <p className="topo-loop__expect">
          <span className="topo-loop__expect-label">What good looks like</span>
          {expectedText}
        </p>
      )}

      {numeric ? (
        <form
          className="topo-loop__numeric"
          onSubmit={(e) => {
            e.preventDefault()
            if (numericReady) onSubmit({ value: parsed, observedVerdict: null })
          }}
        >
          <div className="topo-loop__field">
            <input
              type="number"
              inputMode="decimal"
              step="any"
              autoFocus
              className="topo-loop__input"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="0.0"
              aria-label={`Measured reading${step.expectedUnit ? ` in ${step.expectedUnit}` : ''}`}
            />
            {step.expectedUnit && <span className="topo-loop__unit">{step.expectedUnit}</span>}
          </div>
          <button type="submit" className="topo-loop__record" disabled={!numericReady}>
            Record reading
          </button>
        </form>
      ) : (
        <div className="topo-loop__outcomes" role="group" aria-label="Outcome of this check">
          {OUTCOMES.map((o) => (
            <button
              key={o.verdict}
              type="button"
              className={`topo-loop__outcome topo-loop__outcome--${o.tone}`}
              onClick={() => onSubmit({ value: null, observedVerdict: o.verdict })}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

      <button type="button" className="topo-loop__skip" onClick={onSkip}>
        I already know this — skip
      </button>
    </section>
  )
}
