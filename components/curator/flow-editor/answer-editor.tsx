'use client'

import { useFlowEditor, FlowEditorMutations } from './flow-editor-provider'
import { Field, Input } from '@/components/vt/desktop'
import type { Answer } from '@/lib/flows/types'

const END = '__finding'

export function AnswerEditor({ stepId, answers }: { stepId: string; answers: Answer[] }) {
  const { body, applyMutation } = useFlowEditor()
  const otherSteps = Object.keys(body.steps)
    .filter((id) => id !== stepId)
    .map((id) => ({ id, title: body.steps[id]?.title?.trim() || 'Untitled step' }))

  const addAnswer = () =>
    applyMutation((b) =>
      FlowEditorMutations.addAnswer(
        b,
        stepId,
        (otherSteps[0]
          ? { id: `a${answers.length + 1}`, label: '', next: otherSteps[0].id }
          : { id: `a${answers.length + 1}`, label: '', finding: { verdict: '', action: '', severity: 'fixable' } }) as Answer,
      ),
    )

  const update = (id: string, patch: Partial<Answer>) =>
    applyMutation((b) => FlowEditorMutations.updateAnswer(b, stepId, id, patch))

  return (
    <section className="vt-answers">
      <div className="vt-answers__head">
        <div className="vt-eyebrow vt-detailpane__section-label">
          Answers the tech can pick — each one continues or ends the diagnosis
        </div>
        <button type="button" onClick={addAnswer} className="vt-btn vt-btn--sm">+ Answer</button>
      </div>

      {answers.length === 0 && (
        <p className="vt-answers__empty">No answers yet. Add at least one so the tech can move on.</p>
      )}

      {answers.map((a) => {
        const ends = !a.next
        return (
          <div key={a.id} className="vt-answer">
            <div className="vt-answer__top">
              <Field label="If the tech answers…" htmlFor={`ans-${a.id}`}>
                <Input
                  id={`ans-${a.id}`}
                  value={a.label}
                  placeholder="e.g. Yes / No / Above 45 psi"
                  onChange={(e) => update(a.id, { label: e.target.value })}
                />
              </Field>
              <Field label="Then…" htmlFor={`tgt-${a.id}`}>
                <select
                  id={`tgt-${a.id}`}
                  className="vt-field__select"
                  value={a.next ?? END}
                  onChange={(e) => {
                    const val = e.target.value
                    if (val === END) {
                      update(a.id, { next: undefined, finding: { verdict: '', action: '', severity: 'fixable' } } as Partial<Answer>)
                    } else {
                      update(a.id, { finding: undefined, next: val } as Partial<Answer>)
                    }
                  }}
                >
                  <option value={END}>End the diagnosis here</option>
                  {otherSteps.map((s) => (
                    <option key={s.id} value={s.id}>Go to: {s.title}</option>
                  ))}
                </select>
              </Field>
              <button
                type="button"
                className="vt-answer__remove"
                onClick={() => applyMutation((b) => FlowEditorMutations.removeAnswer(b, stepId, a.id))}
                aria-label={`Remove answer ${a.label || ''}`}
              >
                ✕
              </button>
            </div>

            {ends && a.finding && (
              <div className="vt-finding">
                <div className="vt-finding__label">When it ends here, tell the tech:</div>
                <Field label="What’s wrong" htmlFor={`v-${a.id}`}>
                  <Input
                    id={`v-${a.id}`}
                    value={a.finding.verdict}
                    placeholder="e.g. Failed lift pump"
                    onChange={(e) => update(a.id, { finding: { ...a.finding!, verdict: e.target.value } } as Partial<Answer>)}
                  />
                </Field>
                <Field label="What to do about it" htmlFor={`act-${a.id}`}>
                  <Input
                    id={`act-${a.id}`}
                    value={a.finding.action}
                    placeholder="e.g. Replace the lift pump and re-test pressure"
                    onChange={(e) => update(a.id, { finding: { ...a.finding!, action: e.target.value } } as Partial<Answer>)}
                  />
                </Field>
                <Field label="How serious" htmlFor={`sev-${a.id}`}>
                  <select
                    id={`sev-${a.id}`}
                    className="vt-field__select"
                    value={a.finding.severity}
                    onChange={(e) =>
                      update(a.id, {
                        finding: { ...a.finding!, severity: e.target.value as 'fixable' | 'investigate' | 'next-system' },
                      } as Partial<Answer>)
                    }
                  >
                    <option value="fixable">Fixable — this is the repair</option>
                    <option value="investigate">Needs investigation — dig further</option>
                    <option value="next-system">Move to the next system</option>
                  </select>
                </Field>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
