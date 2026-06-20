'use client'

import { useFlowEditor, FlowEditorMutations } from './flow-editor-provider'
import { Field, Input, Textarea } from '@/components/vt/desktop'
import type { Citation, EvidenceGrade } from '@/lib/flows/types'

const GRADE_HINT: Record<EvidenceGrade, string> = {
  confirmed: 'A source directly confirms this.',
  plausible: 'A source suggests it, but it’s not nailed down.',
  unverified: 'Not yet backed by a source — needs checking.',
}

export function CitationListEditor({ stepId, citations }: { stepId: string; citations: Citation[] }) {
  const { applyMutation } = useFlowEditor()

  const setCitations = (next: Citation[]) =>
    applyMutation((b) =>
      FlowEditorMutations.updateStep(b, stepId, { citations: next } as Partial<{ citations: Citation[] }>),
    )

  const addBlank = () =>
    setCitations([
      ...citations,
      { sourceUrl: '', title: '', fetchedAt: new Date().toISOString(), excerpt: '', evidenceGrade: 'unverified' },
    ])
  const update = (idx: number, patch: Partial<Citation>) =>
    setCitations(citations.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  const remove = (idx: number) => setCitations(citations.filter((_, i) => i !== idx))

  return (
    <div className="vt-cites">
      {citations.length === 0 && (
        <p className="vt-cites__empty">No sources yet. Add the page that backs up this step.</p>
      )}

      {citations.map((c, i) => (
        <div key={i} className={`vt-cite vt-cite--${c.evidenceGrade}`}>
          <div className="vt-cite__top">
            <span className={`vt-grade vt-grade--${c.evidenceGrade}`}>
              <span className="vt-grade__dot" aria-hidden="true" />
              {c.evidenceGrade === 'confirmed' ? 'Confirmed by source'
                : c.evidenceGrade === 'plausible' ? 'Plausible from source'
                : 'Not yet verified'}
            </span>
            <button
              type="button"
              className="vt-cite__remove"
              onClick={() => remove(i)}
              aria-label="Remove this source"
            >
              ✕
            </button>
          </div>

          <Field label="Source title" htmlFor={`ct-${i}`}>
            <Input id={`ct-${i}`} value={c.title} placeholder="e.g. Ford TSB 06-21-9" onChange={(e) => update(i, { title: e.target.value })} />
          </Field>

          <Field
            label="Link"
            htmlFor={`cu-${i}`}
            hint={c.sourceUrl ? undefined : 'Paste the page address you pulled this from.'}
          >
            <Input id={`cu-${i}`} mono value={c.sourceUrl} placeholder="https://…" onChange={(e) => update(i, { sourceUrl: e.target.value })} />
          </Field>

          <Field
            label="The exact line from the source"
            htmlFor={`ce-${i}`}
            hint={GRADE_HINT[c.evidenceGrade]}
          >
            <Textarea
              id={`ce-${i}`}
              value={c.excerpt}
              placeholder="Paste the sentence that backs up this step — word for word."
              onChange={(e) => update(i, { excerpt: e.target.value })}
            />
          </Field>

          <Field label="How solid is it" htmlFor={`cg-${i}`}>
            <select
              id={`cg-${i}`}
              className="vt-field__select"
              value={c.evidenceGrade}
              onChange={(e) => update(i, { evidenceGrade: e.target.value as EvidenceGrade })}
            >
              <option value="confirmed">Confirmed — the source says it plainly</option>
              <option value="plausible">Plausible — the source hints at it</option>
              <option value="unverified">Not verified — no quote yet</option>
            </select>
          </Field>
        </div>
      ))}

      <button type="button" onClick={addBlank} className="vt-btn vt-btn--sm vt-cites__add">+ Add a source</button>
    </div>
  )
}
