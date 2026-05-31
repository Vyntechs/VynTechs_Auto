'use client'

import { useFlowEditor, FlowEditorMutations } from './flow-editor-provider'
import type { Citation, EvidenceGrade } from '@/lib/flows/types'

export function CitationListEditor({ stepId, citations }: { stepId: string; citations: Citation[] }) {
  const { applyMutation } = useFlowEditor()

  const addBlank = () =>
    applyMutation((b) =>
      FlowEditorMutations.updateStep(b, stepId, {
        citations: [
          ...citations,
          { sourceUrl: '', title: '', fetchedAt: new Date().toISOString(), excerpt: '', evidenceGrade: 'unverified' as EvidenceGrade },
        ],
      } as Partial<{ citations: Citation[] }>),
    )

  const update = (idx: number, patch: Partial<Citation>) =>
    applyMutation((b) =>
      FlowEditorMutations.updateStep(b, stepId, {
        citations: citations.map((c, i) => (i === idx ? { ...c, ...patch } : c)),
      } as Partial<{ citations: Citation[] }>),
    )

  const remove = (idx: number) =>
    applyMutation((b) =>
      FlowEditorMutations.updateStep(b, stepId, {
        citations: citations.filter((_, i) => i !== idx),
      } as Partial<{ citations: Citation[] }>),
    )

  return (
    <div className="vt-citation-list">
      <button onClick={addBlank} className="vt-btn vt-btn-secondary">+ Citation</button>
      {citations.map((c, i) => (
        <div key={i} className="vt-citation-row">
          <input placeholder="Title" value={c.title} onChange={(e) => update(i, { title: e.target.value })} />
          <input placeholder="URL" value={c.sourceUrl} onChange={(e) => update(i, { sourceUrl: e.target.value })} />
          <textarea
            placeholder="Excerpt (required unless Unverified)"
            value={c.excerpt}
            onChange={(e) => update(i, { excerpt: e.target.value })}
          />
          <select value={c.evidenceGrade} onChange={(e) => update(i, { evidenceGrade: e.target.value as EvidenceGrade })}>
            <option value="confirmed">Confirmed</option>
            <option value="plausible">Plausible</option>
            <option value="unverified">Unverified</option>
          </select>
          <button onClick={() => remove(i)} aria-label="remove citation">✕</button>
        </div>
      ))}
    </div>
  )
}
