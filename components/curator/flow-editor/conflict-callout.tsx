'use client'

import { useState } from 'react'
import { useFlowEditor, FlowEditorMutations } from './flow-editor-provider'
import type { Citation, Conflict } from '@/lib/flows/types'

// A source conflict from the research pipeline: two (or more) sources disagree.
// The curator settles it — keep one side, or keep both with a condition note —
// and an unresolved conflict blocks publish (enforced in flow-validation).

function sideName(side: { stance: string; citations: Citation[] }, i: number): string {
  return side.citations[0]?.title?.trim() || `Source ${i + 1}`
}

export function ConflictCallout({
  stepId,
  conflictIndex,
  conflict,
}: {
  stepId: string
  conflictIndex: number
  conflict: Conflict
}) {
  const { applyMutation, body } = useFlowEditor()
  const [keepBothOpen, setKeepBothOpen] = useState(false)
  const [note, setNote] = useState('')

  // Resolving: attach the kept side(s)' sources to the step (dedup by URL),
  // optionally record a condition note, and drop the conflict from the
  // unresolved list so publish can proceed.
  const resolve = (keepCitations: Citation[], conditionNote?: string) =>
    applyMutation((b) => {
      const step = b.steps[stepId]
      if (!step) return b
      const existing = step.citations ?? []
      const merged = [...existing]
      for (const c of keepCitations) {
        if (!merged.some((m) => m.sourceUrl === c.sourceUrl && m.title === c.title)) merged.push(c)
      }
      const remaining = (step.conflicts ?? []).filter((_, i) => i !== conflictIndex)
      const patch: Record<string, unknown> = { citations: merged, conflicts: remaining }
      if (conditionNote?.trim()) {
        const prev = (step as { note?: string }).note?.trim()
        patch.note = prev ? `${prev}\n${conditionNote.trim()}` : conditionNote.trim()
      }
      return FlowEditorMutations.updateStep(b, stepId, patch as Partial<typeof step>)
    })

  void body // keep hook reference stable; body changes drive re-render via provider

  return (
    <aside className="vt-conflict">
      <div className="vt-conflict__head">
        <span className="vt-conflict__badge">Disagreement</span>
        <p className="vt-conflict__desc">{conflict.description}</p>
      </div>

      <div className="vt-conflict__sides">
        {conflict.sides.map((s, i) => (
          <div key={i} className="vt-conflict__side">
            <div className="vt-conflict__side-name">{sideName(s, i)}</div>
            <p className="vt-conflict__stance">{s.stance}</p>
            {s.citations.map((c, j) => (
              <div key={j} className="vt-conflict__quote">
                <blockquote>{c.excerpt || '(no quote provided)'}</blockquote>
                {c.sourceUrl && (
                  <a href={c.sourceUrl} target="_blank" rel="noreferrer noopener" className="vt-conflict__source">
                    {c.title || c.sourceUrl}
                  </a>
                )}
              </div>
            ))}
            <button
              type="button"
              className="vt-btn vt-btn--sm"
              onClick={() => resolve(s.citations)}
            >
              Keep {sideName(s, i)}
            </button>
          </div>
        ))}
      </div>

      <div className="vt-conflict__both">
        {keepBothOpen ? (
          <div className="vt-conflict__both-form">
            <label className="vt-field__label" htmlFor={`cn-${stepId}-${conflictIndex}`}>
              When does each one apply? (shown to the tech)
            </label>
            <textarea
              id={`cn-${stepId}-${conflictIndex}`}
              className="vt-field__textarea"
              value={note}
              placeholder="e.g. Use the TSB spec for 2003–2004 trucks; the manual spec for 2005 and up."
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="vt-conflict__both-actions">
              <button
                type="button"
                className="vt-btn vt-btn--accent vt-btn--sm"
                disabled={!note.trim()}
                onClick={() => resolve(conflict.sides.flatMap((s) => s.citations), note)}
              >
                Keep both with this note
              </button>
              <button type="button" className="vt-btn vt-btn--sm" onClick={() => setKeepBothOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="vt-btn vt-btn--sm vt-conflict__both-btn" onClick={() => setKeepBothOpen(true)}>
            Keep both — add a condition note
          </button>
        )}
      </div>
    </aside>
  )
}
