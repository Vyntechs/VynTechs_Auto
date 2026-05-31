'use client'

import { useFlowEditor, FlowEditorMutations } from './flow-editor-provider'
import type { Answer } from '@/lib/flows/types'

export function AnswerEditor({ stepId, answers }: { stepId: string; answers: Answer[] }) {
  const { body, applyMutation } = useFlowEditor()
  const otherStepIds = Object.keys(body.steps).filter((id) => id !== stepId)

  const addAnswer = () =>
    applyMutation((b) =>
      // With another step to branch to, default to it; otherwise default to a
      // FINDING (the only sensible terminal on a single-step flow). This keeps
      // the answer-target <select> matched to a real option and surfaces the
      // verdict/action fields, instead of a stuck next:'' that shows "→ FINDING"
      // with no finding behind it.
      FlowEditorMutations.addAnswer(
        b,
        stepId,
        (otherStepIds[0]
          ? { id: `a${answers.length + 1}`, label: '', next: otherStepIds[0] }
          : { id: `a${answers.length + 1}`, label: '', finding: { verdict: '', action: '', severity: 'fixable' } }) as Answer,
      ),
    )

  return (
    <section className="vt-answer-editor">
      <header>
        <h3>Answers</h3>
        <button onClick={addAnswer}>+ Answer</button>
      </header>
      {answers.map((a) => (
        <div key={a.id} className="vt-answer-row">
          <input
            value={a.label}
            placeholder="Label (e.g. Yes / No)"
            onChange={(e) => applyMutation((b) => FlowEditorMutations.updateAnswer(b, stepId, a.id, { label: e.target.value }))}
          />
          <select
            value={a.next ?? '__finding'}
            onChange={(e) => {
              const val = e.target.value
              if (val === '__finding') {
                applyMutation((b) =>
                  FlowEditorMutations.updateAnswer(b, stepId, a.id, {
                    next: undefined,
                    finding: { verdict: '', action: '', severity: 'fixable' },
                  } as Partial<Answer>),
                )
              } else {
                applyMutation((b) =>
                  FlowEditorMutations.updateAnswer(b, stepId, a.id, { finding: undefined, next: val } as Partial<Answer>),
                )
              }
            }}
          >
            <option value="__finding">→ FINDING</option>
            {otherStepIds.map((id) => (
              <option key={id} value={id}>→ {id}</option>
            ))}
          </select>
          {'finding' in a && a.finding && (
            <div className="vt-answer-finding-editor">
              <input
                placeholder="Verdict"
                value={a.finding.verdict}
                onChange={(e) =>
                  applyMutation((b) =>
                    FlowEditorMutations.updateAnswer(b, stepId, a.id, { finding: { ...a.finding!, verdict: e.target.value } } as Partial<Answer>),
                  )
                }
              />
              <input
                placeholder="Action"
                value={a.finding.action}
                onChange={(e) =>
                  applyMutation((b) =>
                    FlowEditorMutations.updateAnswer(b, stepId, a.id, { finding: { ...a.finding!, action: e.target.value } } as Partial<Answer>),
                  )
                }
              />
              <select
                value={a.finding.severity}
                onChange={(e) =>
                  applyMutation((b) =>
                    FlowEditorMutations.updateAnswer(b, stepId, a.id, {
                      finding: { ...a.finding!, severity: e.target.value as 'fixable' | 'investigate' | 'next-system' },
                    } as Partial<Answer>),
                  )
                }
              >
                <option value="fixable">Fixable</option>
                <option value="investigate">Investigate</option>
                <option value="next-system">Next system</option>
              </select>
            </div>
          )}
          <button onClick={() => applyMutation((b) => FlowEditorMutations.removeAnswer(b, stepId, a.id))} aria-label={`Remove answer ${a.label}`}>
            ✕
          </button>
        </div>
      ))}
    </section>
  )
}
