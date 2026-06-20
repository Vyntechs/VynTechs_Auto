'use client'

import { useFlowEditor, FlowEditorMutations } from './flow-editor-provider'
import type { Flow } from '@/lib/flows/types'

// The flow's structure as a readable, selectable STEP LIST (not a drag-canvas:
// canvases break on phones and read as "circuits" to a non-engineer). Reading
// order from the start step; each row shows where its answers lead by the
// destination step's TITLE — never a raw step ID — so the branching is legible.

type Ordered = { id: string; num: number; reachable: boolean }

function orderSteps(body: Flow): Ordered[] {
  const seen = new Set<string>()
  const order: string[] = []
  const visit = (id: string) => {
    if (seen.has(id) || !body.steps[id]) return
    seen.add(id)
    order.push(id)
    const s = body.steps[id]
    if (s.kind === 'question') s.answers.forEach((a) => a.next && visit(a.next))
    else visit(s.next)
  }
  visit(body.startStepId)
  const unreachable = Object.keys(body.steps).filter((id) => !seen.has(id))
  return [...order, ...unreachable].map((id, i) => ({
    id,
    num: i + 1,
    reachable: seen.has(id),
  }))
}

const SEVERITY_LABEL: Record<string, string> = {
  fixable: 'Fixable',
  investigate: 'Needs investigation',
  'next-system': 'Move to next system',
}

export function StepListPane({ onPick }: { onPick?: () => void }) {
  const { body, selectedStepId, selectStep, applyMutation } = useFlowEditor()
  const ordered = orderSteps(body)
  const numById = new Map(ordered.map((o) => [o.id, o.num] as const))
  const titleFor = (id: string) =>
    body.steps[id]?.title?.trim() || `step ${numById.get(id) ?? '?'}`

  const onAddStep = () => {
    const newId = `step-${Object.keys(body.steps).length + 1}`
    applyMutation((b) =>
      FlowEditorMutations.addStep(b, { id: newId, kind: 'question', title: '', question: '' }),
    )
    selectStep(newId)
    onPick?.()
  }

  const pick = (id: string) => {
    selectStep(id)
    onPick?.()
  }

  return (
    <div className="vt-steplist">
      <div className="vt-steplist__head">
        <span className="vt-eyebrow">Steps</span>
        <button type="button" onClick={onAddStep} className="vt-btn vt-btn--sm">+ Step</button>
      </div>
      <ul className="vt-steplist__items">
        {ordered.map(({ id, num, reachable }) => {
          const step = body.steps[id]
          const isStart = id === body.startStepId
          const active = id === selectedStepId
          const conflicts = step.conflicts?.length ?? 0
          const sources = step.citations?.length ?? 0
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => pick(id)}
                className={`vt-steprow${active ? ' vt-steprow--active' : ''}`}
                aria-current={active ? 'true' : undefined}
              >
                <span className="vt-steprow__num">{num}</span>
                <span className="vt-steprow__body">
                  <span className="vt-steprow__head">
                    {isStart && <span className="vt-steprow__start">Start</span>}
                    <span className="vt-steprow__kind">
                      {step.kind === 'question' ? 'Question' : 'Procedure'}
                    </span>
                    {!reachable && <span className="vt-steprow__warn">Not reachable</span>}
                    {conflicts > 0 && (
                      <span className="vt-steprow__conflict" title="Unresolved source conflict" />
                    )}
                  </span>
                  <span className="vt-steprow__title">
                    {step.title?.trim() || 'Untitled step'}
                  </span>
                  {step.kind === 'question' && step.answers.length > 0 && (
                    <span className="vt-steprow__answers">
                      {step.answers.map((a, i) => (
                        <span key={a.id} className="vt-steprow__answer">
                          <span className="vt-steprow__answer-label">{a.label || `answer ${i + 1}`}</span>
                          {a.next ? (
                            <span className="vt-steprow__answer-to">{titleFor(a.next)}</span>
                          ) : a.finding ? (
                            <span className={`vt-steprow__answer-end vt-sev--${a.finding.severity}`}>
                              ends · {SEVERITY_LABEL[a.finding.severity] ?? a.finding.severity}
                            </span>
                          ) : (
                            <span className="vt-steprow__answer-stuck">not set</span>
                          )}
                        </span>
                      ))}
                    </span>
                  )}
                  {step.kind === 'procedure' && (
                    <span className="vt-steprow__answers">
                      <span className="vt-steprow__answer">
                        <span className="vt-steprow__answer-to">then → {titleFor(step.next)}</span>
                      </span>
                    </span>
                  )}
                  {sources > 0 && (
                    <span className="vt-steprow__sources">{sources} source{sources > 1 ? 's' : ''}</span>
                  )}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
