'use client'

import { useFlowEditor } from './flow-editor-provider'
import { CitationPopover } from './citation-popover'

export function SourcesPane() {
  const { body } = useFlowEditor()
  const all = Object.entries(body.steps).flatMap(([id, step]) =>
    (step.citations ?? []).map((c, i) => ({ stepId: id, idx: i, citation: c })),
  )
  return (
    <div className="vt-sources-pane">
      <h3>Sources</h3>
      {all.length === 0 ? (
        <p className="vt-sources-empty">No citations yet.</p>
      ) : (
        <ul>
          {all.map((entry, i) => (
            <li key={i} className="vt-sources-item">
              <span className="vt-sources-step">{entry.stepId}:</span>
              <CitationPopover index={i} citation={entry.citation} />
              <span className="vt-sources-title"> {entry.citation.title || entry.citation.sourceUrl}</span>
              {/* N2 renders the stored evidenceGrade as plain text; the styled
                  badge/indicator is PR-N7 scope. No synthesized score. */}
              <span className="vt-evidence-grade-text">{entry.citation.evidenceGrade}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
