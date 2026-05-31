'use client'

import { useFlowEditor, FlowEditorMutations } from './flow-editor-provider'
import { CitationListEditor } from './citation-list-editor'
import { ConflictCallout } from './conflict-callout'
import { AnswerEditor } from './answer-editor'

export function NodeDetailPane() {
  const { body, selectedStepId, applyMutation } = useFlowEditor()
  if (!selectedStepId) return <div className="vt-detail-pane">Select a step to edit it.</div>
  const step = body.steps[selectedStepId]
  if (!step) return <div className="vt-detail-pane">Step not found.</div>

  const onTitleChange = (v: string) =>
    applyMutation((b) => FlowEditorMutations.updateStep(b, selectedStepId, { title: v } as Partial<typeof step>))

  return (
    <div className="vt-detail-pane">
      <label>
        Title
        <input value={step.title} onChange={(e) => onTitleChange(e.target.value)} />
      </label>

      {step.kind === 'question' ? (
        <>
          <label>
            Question
            <textarea
              value={step.question}
              onChange={(e) =>
                applyMutation((b) =>
                  FlowEditorMutations.updateStep(b, selectedStepId, { question: e.target.value } as Partial<typeof step>),
                )
              }
            />
          </label>
          <AnswerEditor stepId={selectedStepId} answers={step.answers} />
        </>
      ) : (
        <label>
          Instructions
          <textarea
            value={step.instructions}
            onChange={(e) =>
              applyMutation((b) =>
                FlowEditorMutations.updateStep(b, selectedStepId, { instructions: e.target.value } as Partial<typeof step>),
              )
            }
          />
        </label>
      )}

      <section className="vt-detail-citations">
        <h3>Citations</h3>
        <CitationListEditor stepId={selectedStepId} citations={step.citations ?? []} />
      </section>

      {(step.conflicts ?? []).length > 0 && (
        <section className="vt-detail-conflicts">
          <h3>Conflicts</h3>
          {(step.conflicts ?? []).map((c, i) => (
            <ConflictCallout key={i} stepId={selectedStepId} conflictIndex={i} conflict={c} />
          ))}
        </section>
      )}
    </div>
  )
}
