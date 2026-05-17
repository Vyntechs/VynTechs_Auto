'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import type { KnowledgeListRow } from '@/lib/knowledge/list'
import {
  ChipPicker,
  FieldGroup,
  ScopeEditor,
  TagInput,
  type Scope,
} from '@/components/knowledge/form-helpers'
import { SYSTEM_CODES } from '@/lib/knowledge/constants'

type Section = { heading: string; body: string }

export function TheoryForm({ existing }: { existing: KnowledgeListRow | null }) {
  const router = useRouter()
  const sd = (existing?.structuredData ?? {}) as {
    title?: string
    sections?: Section[]
  }
  const [title, setTitle] = useState(existing?.title ?? '')
  const [theoryTitle, setTheoryTitle] = useState(sd.title ?? '')
  const [sections, setSections] = useState<Section[]>(
    sd.sections ?? [{ heading: '', body: '' }],
  )
  const [dtcs, setDtcs] = useState<string[]>(existing?.dtcList ?? [])
  const [systemCodes, setSystemCodes] = useState<string[]>(existing?.systemCodes ?? [])
  const [symptoms, setSymptoms] = useState<string[]>(existing?.symptoms ?? [])
  const [scopes, setScopes] = useState<Scope[]>(
    existing?.vehicleScopes.map((s) => ({
      yearStart: s.yearStart,
      yearEnd: s.yearEnd,
      make: s.make,
      model: s.model ?? undefined,
      engine: s.engine ?? undefined,
    })) ?? [{ yearStart: 2020, yearEnd: 2020, make: '' }],
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const payload = {
        type: 'theory_of_operation' as const,
        title,
        structuredData: {
          title: theoryTitle || title,
          sections,
        },
        dtcList: dtcs,
        systemCodes,
        symptoms,
        vehicleScopes: scopes,
      }
      const url = existing ? `/api/knowledge/${existing.id}` : '/api/knowledge/save'
      const method = existing ? 'PATCH' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const id = existing ? existing.id : ((await res.json()) as { id: string }).id
      router.push(`/knowledge?detail=${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      className="vk-form"
      onSubmit={(e) => {
        e.preventDefault()
        handleSave()
      }}
    >
      <FieldGroup label="Title">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          maxLength={200}
        />
      </FieldGroup>
      <FieldGroup label="Theory title">
        <input
          value={theoryTitle}
          onChange={(e) => setTheoryTitle(e.target.value)}
          maxLength={200}
          placeholder="defaults to title if blank"
        />
      </FieldGroup>

      <FieldGroup label="Sections (≥ 1)">
        {sections.map((s, i) => (
          <div className="vk-section-row" key={i}>
            <span className="vk-section-row__num">{i + 1}</span>
            <div className="vk-section-row__body">
              <input
                className="vk-section-row__head"
                value={s.heading}
                placeholder="Heading"
                onChange={(e) =>
                  setSections(
                    sections.map((x, j) =>
                      j === i ? { ...x, heading: e.target.value } : x,
                    ),
                  )
                }
              />
              <textarea
                rows={4}
                value={s.body}
                placeholder="Body"
                onChange={(e) =>
                  setSections(
                    sections.map((x, j) =>
                      j === i ? { ...x, body: e.target.value } : x,
                    ),
                  )
                }
              />
            </div>
            <button
              type="button"
              disabled={sections.length === 1}
              onClick={() => setSections(sections.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
        ))}
        <button
          type="button"
          className="vk-btn vk-btn--ghost"
          onClick={() => setSections([...sections, { heading: '', body: '' }])}
        >
          + Add section
        </button>
      </FieldGroup>

      <FieldGroup label="Vehicle scope">
        <ScopeEditor scopes={scopes} setScopes={setScopes} />
      </FieldGroup>
      <FieldGroup label="DTCs">
        <TagInput values={dtcs} setValues={setDtcs} placeholder="P0562" />
      </FieldGroup>
      <FieldGroup label="System codes">
        <ChipPicker
          values={systemCodes}
          options={[...SYSTEM_CODES]}
          setValues={setSystemCodes}
        />
      </FieldGroup>
      <FieldGroup label="Symptoms">
        <TagInput
          values={symptoms}
          setValues={setSymptoms}
          placeholder="rough_idle"
        />
      </FieldGroup>

      {error && <div className="vk-form__error">{error}</div>}

      <footer className="vk-form__actions">
        <button
          type="button"
          className="vk-btn vk-btn--ghost"
          onClick={() => router.push('/knowledge')}
        >
          Cancel
        </button>
        <button type="submit" className="vk-btn vk-btn--primary" disabled={busy}>
          {busy ? 'Saving…' : existing ? 'Save changes' : 'Save'}
        </button>
      </footer>
    </form>
  )
}
