'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { ClassifiedPasteResult } from '@/lib/knowledge/classify-paste'
import { TYPE_LABELS, SYSTEM_CODES } from '@/lib/knowledge/constants'

type Stored = {
  proposal: ClassifiedPasteResult
  rawText: string
  scopeHint: string
}

const SIMPLE_TYPES = ['cause_fix', 'reference_doc', 'bulletin', 'note'] as const
type SimpleType = (typeof SIMPLE_TYPES)[number]

type Scope = {
  yearStart: number
  yearEnd: number
  make: string
  model?: string
  engine?: string
}

export function ReviewForm() {
  const router = useRouter()
  const [hydrated, setHydrated] = useState(false)
  const [stored, setStored] = useState<Stored | null>(null)
  const [type, setType] = useState<SimpleType>('note')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [structured, setStructured] = useState<Record<string, string>>({})
  const [dtcs, setDtcs] = useState<string[]>([])
  const [systemCodes, setSystemCodes] = useState<string[]>([])
  const [symptoms, setSymptoms] = useState<string[]>([])
  const [scopes, setScopes] = useState<Scope[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editedFields, setEditedFields] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('vk-paste-proposal')
      if (!raw) {
        router.replace('/knowledge')
        return
      }
      const parsed = JSON.parse(raw) as Stored
      setStored(parsed)
      const d = parsed.proposal.draft
      if (d.type && (SIMPLE_TYPES as readonly string[]).includes(d.type)) {
        setType(d.type as SimpleType)
      }
      setTitle(d.title ?? '')
      setBody(d.body ?? '')
      setStructured((d.structuredData as Record<string, string>) ?? {})
      setDtcs(d.dtcList ?? [])
      setSystemCodes(d.systemCodes ?? [])
      setSymptoms(d.symptoms ?? [])
      setScopes(
        (d.vehicleScopes ?? []).map((s) => ({
          yearStart: s.yearStart,
          yearEnd: s.yearEnd,
          make: s.make,
          model: s.model,
          engine: s.engine,
        })),
      )
    } finally {
      setHydrated(true)
    }
  }, [router])

  const sources = useMemo(() => stored?.proposal.sourceSpans ?? {}, [stored])

  function markEdited(field: string) {
    setEditedFields((prev) => new Set(prev).add(field))
  }

  async function handleSave() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = {
        type,
        title,
        dtcList: dtcs,
        systemCodes,
        symptoms,
        vehicleScopes: scopes,
      }
      if (type === 'cause_fix') {
        payload.structuredData = {
          cause: structured.cause ?? '',
          correction: structured.correction ?? '',
          complaint: structured.complaint,
          first_check: structured.first_check,
        }
      } else if (type === 'bulletin') {
        payload.structuredData = {
          source: structured.source ?? '',
          bulletin_id: structured.bulletin_id ?? '',
          summary: structured.summary,
          body: structured.body,
          link: structured.link,
        }
      } else {
        payload.body = body
      }

      const res = await fetch('/api/knowledge/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.message || j.error || `HTTP ${res.status}`)
      }
      const { id } = (await res.json()) as { id: string }
      sessionStorage.removeItem('vk-paste-proposal')
      router.push(`/knowledge?detail=${id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save failed')
    } finally {
      setBusy(false)
    }
  }

  function discard() {
    if (!confirm('Throw away the paste and the AI sort?')) return
    sessionStorage.removeItem('vk-paste-proposal')
    router.push('/knowledge')
  }

  if (!hydrated) return <div className="vk-form">Loading…</div>
  if (!stored) return null

  return (
    <form
      className="vk-form"
      onSubmit={(e) => {
        e.preventDefault()
        handleSave()
      }}
    >
      <FieldGroup
        label="Type"
        aiAttributed={!editedFields.has('type') && !!sources.type}
        source={sources.type}
      >
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value as SimpleType)
            markEdited('type')
          }}
        >
          {SIMPLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </FieldGroup>

      <FieldGroup
        label="Title"
        aiAttributed={!editedFields.has('title') && !!sources.title}
        source={sources.title}
      >
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            markEdited('title')
          }}
          required
          maxLength={200}
        />
      </FieldGroup>

      {(type === 'reference_doc' || type === 'note') && (
        <FieldGroup
          label="Body"
          aiAttributed={!editedFields.has('body') && !!sources.body}
          source={sources.body}
        >
          <textarea
            rows={8}
            value={body}
            onChange={(e) => {
              setBody(e.target.value)
              markEdited('body')
            }}
            required
          />
        </FieldGroup>
      )}

      {type === 'cause_fix' &&
        (['complaint', 'cause', 'correction', 'first_check'] as const).map((k) => (
          <FieldGroup
            key={k}
            label={k.replace('_', ' ')}
            aiAttributed={!editedFields.has(k) && !!sources[k]}
            source={sources[k]}
          >
            <textarea
              rows={3}
              value={structured[k] ?? ''}
              onChange={(e) => {
                setStructured({ ...structured, [k]: e.target.value })
                markEdited(k)
              }}
              required={k === 'cause' || k === 'correction'}
            />
          </FieldGroup>
        ))}

      {type === 'bulletin' &&
        (['source', 'bulletin_id', 'summary', 'body', 'link'] as const).map((k) => (
          <FieldGroup
            key={k}
            label={k.replace('_', ' ')}
            aiAttributed={!editedFields.has(k) && !!sources[k]}
            source={sources[k]}
          >
            <input
              value={structured[k] ?? ''}
              onChange={(e) => {
                setStructured({ ...structured, [k]: e.target.value })
                markEdited(k)
              }}
              required={k === 'source' || k === 'bulletin_id'}
            />
          </FieldGroup>
        ))}

      <FieldGroup
        label="DTCs"
        aiAttributed={!editedFields.has('dtcList') && !!sources.dtcList}
        source={sources.dtcList}
      >
        <TagInput
          values={dtcs}
          setValues={(v) => {
            setDtcs(v)
            markEdited('dtcList')
          }}
          placeholder="P0562"
        />
      </FieldGroup>

      <FieldGroup
        label="System codes"
        aiAttributed={!editedFields.has('systemCodes') && !!sources.systemCodes}
        source={sources.systemCodes}
      >
        <ChipPicker
          values={systemCodes}
          options={[...SYSTEM_CODES]}
          setValues={(v) => {
            setSystemCodes(v)
            markEdited('systemCodes')
          }}
        />
      </FieldGroup>

      <FieldGroup
        label="Symptoms"
        aiAttributed={!editedFields.has('symptoms') && !!sources.symptoms}
        source={sources.symptoms}
      >
        <TagInput
          values={symptoms}
          setValues={(v) => {
            setSymptoms(v)
            markEdited('symptoms')
          }}
          placeholder="hard_shift"
        />
      </FieldGroup>

      <FieldGroup
        label="Vehicle scope"
        aiAttributed={!editedFields.has('scopes') && scopes.length > 0}
      >
        <ScopeEditor
          scopes={scopes}
          setScopes={(v) => {
            setScopes(v)
            markEdited('scopes')
          }}
        />
      </FieldGroup>

      {error && <div className="vk-form__error">{error}</div>}

      <footer className="vk-form__actions">
        <button type="button" className="vk-btn vk-btn--ghost" onClick={discard}>
          Discard
        </button>
        <button type="button" className="vk-btn" disabled title="Drafts ship in v2">
          Save draft
        </button>
        <button type="submit" className="vk-btn vk-btn--primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </footer>
    </form>
  )
}

function FieldGroup({
  label,
  aiAttributed,
  source,
  children,
}: {
  label: string
  aiAttributed: boolean
  source?: string
  children: React.ReactNode
}) {
  return (
    <div className={`vk-fg ${aiAttributed ? 'vk-fg--ai' : ''}`}>
      <div className="vk-fg__head">
        <label className="vk-fg__label">{label}</label>
        {aiAttributed && <span className="vk-fg__badge">AI</span>}
      </div>
      <div className="vk-fg__body">{children}</div>
      {aiAttributed && source && (
        <div className="vk-fg__source">
          <span className="vk-fg__source-prefix">AI · from your paste:</span>
          <mark>{source}</mark>
        </div>
      )}
    </div>
  )
}

function TagInput({
  values,
  setValues,
  placeholder,
}: {
  values: string[]
  setValues: (v: string[]) => void
  placeholder?: string
}) {
  const [draft, setDraft] = useState('')
  return (
    <div className="vk-taginput">
      {values.map((v, i) => (
        <span className="vk-taginput__chip" key={i}>
          {v}
          <button type="button" onClick={() => setValues(values.filter((_, j) => j !== i))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            const t = draft.trim()
            if (t) setValues([...values, t])
            setDraft('')
          }
        }}
        placeholder={placeholder}
      />
    </div>
  )
}

function ChipPicker({
  values,
  options,
  setValues,
}: {
  values: string[]
  options: string[]
  setValues: (v: string[]) => void
}) {
  return (
    <div className="vk-chippicker">
      {options.map((o) => (
        <button
          type="button"
          key={o}
          className={`vk-chip ${values.includes(o) ? 'vk-chip--active' : ''}`}
          onClick={() => {
            if (values.includes(o)) setValues(values.filter((v) => v !== o))
            else setValues([...values, o])
          }}
        >
          {o}
        </button>
      ))}
    </div>
  )
}

function ScopeEditor({
  scopes,
  setScopes,
}: {
  scopes: Scope[]
  setScopes: (s: Scope[]) => void
}) {
  return (
    <div className="vk-scopes">
      {scopes.map((s, i) => (
        <div className="vk-scopes__row" key={i}>
          <input
            type="number"
            value={s.yearStart}
            onChange={(e) =>
              setScopes(
                scopes.map((x, j) => (j === i ? { ...x, yearStart: Number(e.target.value) } : x)),
              )
            }
          />
          <input
            type="number"
            value={s.yearEnd}
            onChange={(e) =>
              setScopes(
                scopes.map((x, j) => (j === i ? { ...x, yearEnd: Number(e.target.value) } : x)),
              )
            }
          />
          <input
            value={s.make}
            placeholder="Make"
            onChange={(e) =>
              setScopes(scopes.map((x, j) => (j === i ? { ...x, make: e.target.value } : x)))
            }
          />
          <input
            value={s.model ?? ''}
            placeholder="Model"
            onChange={(e) =>
              setScopes(
                scopes.map((x, j) => (j === i ? { ...x, model: e.target.value || undefined } : x)),
              )
            }
          />
          <input
            value={s.engine ?? ''}
            placeholder="Engine"
            onChange={(e) =>
              setScopes(
                scopes.map((x, j) => (j === i ? { ...x, engine: e.target.value || undefined } : x)),
              )
            }
          />
          <button type="button" onClick={() => setScopes(scopes.filter((_, j) => j !== i))}>
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="vk-btn vk-btn--ghost"
        onClick={() => setScopes([...scopes, { yearStart: 2020, yearEnd: 2020, make: '' }])}
      >
        + Add scope row
      </button>
    </div>
  )
}
