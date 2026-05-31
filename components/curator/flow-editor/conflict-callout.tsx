'use client'

import { useFlowEditor, FlowEditorMutations } from './flow-editor-provider'
import type { Conflict } from '@/lib/flows/types'

/**
 * In N2, conflicts originate from N3's research pipeline; until N3 ships, a
 * manually-authored flow has none. The editor surfaces any present conflicts
 * as explicit "arbitrate this" callouts (the spec's AI-source conflict surface).
 * Brandon resolves by editing the affected answer then dismissing the conflict.
 * Renders only real stored conflict data.
 */
export function ConflictCallout({ stepId, conflictIndex, conflict }: { stepId: string; conflictIndex: number; conflict: Conflict }) {
  const { applyMutation, body } = useFlowEditor()
  const step = body.steps[stepId]
  const conflicts = step?.conflicts ?? []

  const dismiss = () =>
    applyMutation((b) =>
      FlowEditorMutations.updateStep(b, stepId, {
        conflicts: conflicts.filter((_, i) => i !== conflictIndex),
      } as Partial<{ conflicts: Conflict[] }>),
    )

  return (
    <aside className="vt-conflict-callout">
      <header><strong>Conflict to resolve</strong></header>
      <p>{conflict.description}</p>
      {conflict.sides.map((s, i) => (
        <div key={i} className="vt-conflict-side">
          <strong>Side {i + 1}:</strong> {s.stance}
          <ul>
            {s.citations.map((c, j) => (
              <li key={j}><a href={c.sourceUrl} target="_blank" rel="noreferrer noopener">{c.title}</a></li>
            ))}
          </ul>
        </div>
      ))}
      <button onClick={dismiss} className="vt-btn vt-btn-tertiary">Resolved — dismiss this conflict</button>
    </aside>
  )
}
