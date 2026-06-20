'use client'

import { useFlowEditor, FlowEditorMutations } from './flow-editor-provider'
import { Field, Input, Textarea } from '@/components/vt/desktop'
import { CitationListEditor } from './citation-list-editor'
import { ConflictCallout } from './conflict-callout'
import { AnswerEditor } from './answer-editor'

export function NodeDetailPane({ onBack }: { onBack?: () => void }) {
  const { body, selectedStepId, applyMutation } = useFlowEditor()

  if (!selectedStepId || !body.steps[selectedStepId]) {
    return (
      <div className="vt-detailpane vt-detailpane--empty">
        <p>Pick a step on the left to edit it.</p>
      </div>
    )
  }
  const step = body.steps[selectedStepId]
  const isStart = selectedStepId === body.startStepId

  const patch = (p: Partial<typeof step>) =>
    applyMutation((b) => FlowEditorMutations.updateStep(b, selectedStepId, p))

  return (
    <div className="vt-detailpane">
      {onBack && (
        <button type="button" className="vt-detailpane__back" onClick={onBack}>
          ← All steps
        </button>
      )}

      <div className="vt-detailpane__head">
        {isStart && <span className="vt-steprow__start">Start</span>}
        <span className="vt-steprow__kind">{step.kind === 'question' ? 'Question step' : 'Procedure step'}</span>
      </div>

      <div className="vt-detailpane__section">
        <Field label="Title (what the tech sees at the top of this step)" htmlFor="d-title">
          <Input
            id="d-title"
            value={step.title}
            placeholder="e.g. Check fuel pressure at the rail"
            onChange={(e) => patch({ title: e.target.value } as Partial<typeof step>)}
          />
        </Field>
      </div>

      {step.kind === 'question' ? (
        <>
          <div className="vt-detailpane__section">
            <Field label="What you ask the tech" htmlFor="d-question">
              <Textarea
                id="d-question"
                value={step.question}
                placeholder="e.g. Is fuel pressure within spec?"
                onChange={(e) => patch({ question: e.target.value } as Partial<typeof step>)}
              />
            </Field>
          </div>
          <AnswerEditor stepId={selectedStepId} answers={step.answers} />
        </>
      ) : (
        <div className="vt-detailpane__section">
          <Field label="What you tell the tech to do" htmlFor="d-instructions">
            <Textarea
              id="d-instructions"
              value={step.instructions}
              placeholder="e.g. Hook up the fuel-pressure gauge and crank the engine."
              onChange={(e) => patch({ instructions: e.target.value } as Partial<typeof step>)}
            />
          </Field>
        </div>
      )}

      {step.note?.trim() && (
        <div className="vt-detailpane__section">
          <div className="vt-eyebrow">Note shown to the tech</div>
          <p className="vt-detailpane__note">{step.note}</p>
        </div>
      )}

      <div className="vt-detailpane__section">
        <div className="vt-eyebrow vt-detailpane__section-label">Sources backing this step</div>
        <CitationListEditor stepId={selectedStepId} citations={step.citations ?? []} />
      </div>

      {(step.conflicts ?? []).length > 0 && (
        <div className="vt-detailpane__section">
          <div className="vt-eyebrow vt-detailpane__section-label vt-detailpane__section-label--warn">
            Source disagreements to settle
          </div>
          {(step.conflicts ?? []).map((c, i) => (
            <ConflictCallout key={i} stepId={selectedStepId} conflictIndex={i} conflict={c} />
          ))}
        </div>
      )}
    </div>
  )
}
