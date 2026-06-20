'use client'

import { useState } from 'react'
import type { Citation, Flow, WizardState } from '@/lib/flows/types'
import { advance, back, currentStep, isTerminal } from '@/lib/wizard-state'
import { WizardFindingCard } from './wizard-finding-card'

type Props = {
  sessionId: string
  flowVersionId: string
  versionNumber: number
  body: Flow
  initialState: WizardState | null
  /** True when the flow's currently-published version differs from this session's pinned one. */
  newerVersionAvailable: boolean
}

function Citations({ citations }: { citations?: Citation[] }) {
  if (!citations || citations.length === 0) return null
  return (
    <ul className="vt-curator-wizard-citations">
      {citations.map((c) => (
        <li key={c.sourceUrl}>
          <a href={c.sourceUrl} target="_blank" rel="noreferrer">{c.title}</a>
          {/* Citation.excerpt is required non-empty UNLESS evidenceGrade === 'unverified',
              in which case it may be empty. Only render the quote block when there's a
              real fetched excerpt — an unverified citation with an empty excerpt must NOT
              render an empty quote box. This is the honest replacement for the fabricated
              ledger #98 removed. */}
          {c.excerpt.trim() !== '' && <blockquote>{c.excerpt}</blockquote>}
        </li>
      ))}
    </ul>
  )
}

export function CuratorGuidedWizard({
  sessionId,
  flowVersionId,
  versionNumber,
  body,
  initialState,
  newerVersionAvailable,
}: Props) {
  const [state, setState] = useState<WizardState>(
    initialState ?? { flowVersionId, stepId: body.startStepId, history: [], finding: null },
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const persist = (next: WizardState) => {
    setState(next)
    void fetch(`/api/sessions/${sessionId}/wizard-state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    })
      .then(async (res) => {
        if (!res.ok) {
          // 409 = the session was locked elsewhere or the version pin no longer matches;
          // the local state has diverged from the server. Tell the tech to reload.
          setError(
            res.status === 409
              ? 'This session can no longer be edited here — reload to continue.'
              : 'Your progress could not be saved.',
          )
        }
      })
      .catch((e) => setError('Your progress could not be saved — ' + (e instanceof Error ? e.message : 'save failed')))
  }

  const onAnswer = (answerId: string) => {
    try {
      persist(advance(state, body, answerId))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'invalid answer')
    }
  }

  const onBack = () => persist(back(state, body))

  const onLockIn = async () => {
    if (!state.finding) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/lock-in-diagnosis`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ finding: state.finding, history: state.history, flowVersionId: state.flowVersionId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error((err as { error?: string }).error ?? `lock-in failed (${res.status})`)
      }
      const data = (await res.json()) as { redirectTo: string }
      // Full-page navigation intentional: the session page is a Server Component; after
      // lock-in it must re-run server-side so `alreadyLocked` flips and it renders
      // RepairPhaseView. router.push to the same URL would NOT refetch the RSC.
      window.location.href = data.redirectTo
    } catch (e) {
      setSubmitting(false)
      setError(e instanceof Error ? e.message : 'lock-in failed')
    }
  }

  if (isTerminal(state) && state.finding) {
    return (
      <WizardFindingCard finding={state.finding} history={state.history} onBack={onBack} onLockIn={onLockIn} pending={submitting} error={error} />
    )
  }

  const step = currentStep(state, body)
  if (!step) return <div className="vt-form-error">Flow rendering error: step {state.stepId} not found.</div>

  return (
    <article className="vt-curator-wizard">
      {newerVersionAvailable && (
        <aside className="vt-curator-wizard-banner">
          A newer version of this flow has been published. This session continues on the version it started on.
        </aside>
      )}

      <header className="vt-curator-wizard-header">
        <h2>{step.title}</h2>
        {/* Real progress from the authored step (n/of) + the real pinned version. Not a fake timer. */}
        <p className="vt-curator-wizard-progress">Step {step.n} of {step.of} · v{versionNumber}</p>
      </header>

      {step.kind === 'question' ? (
        <>
          <p className="vt-curator-wizard-question">{step.question}</p>
          <Citations citations={step.citations} />
          <div className="vt-curator-wizard-answers">
            {step.answers.map((a) => (
              <button key={a.id} onClick={() => onAnswer(a.id)} className="vt-curator-wizard-answer">
                {a.label}
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="vt-curator-wizard-instructions">{step.instructions}</p>
          {step.note && <aside className="vt-curator-wizard-note">{step.note}</aside>}
          <Citations citations={step.citations} />
          <button onClick={() => onAnswer('_proc')} className="vt-curator-wizard-answer">Continue</button>
        </>
      )}

      {state.history.length > 0 && (
        <button onClick={onBack} className="vt-btn vt-btn-tertiary">← Back</button>
      )}

      {error && <div className="vt-form-error" role="alert">{error}</div>}
    </article>
  )
}
