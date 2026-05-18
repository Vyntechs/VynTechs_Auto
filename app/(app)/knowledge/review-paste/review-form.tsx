'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import type { PasteRouteResponse } from '@/lib/knowledge/classify-paste'
import { TYPE_LABELS, SYSTEM_CODES } from '@/lib/knowledge/constants'
import {
  ChipPicker,
  FieldGroup,
  ScopeEditor,
  TagInput,
  useDtcChips,
  type Scope,
} from '@/components/knowledge/form-helpers'

type Stored = {
  proposal: PasteRouteResponse
  rawText: string
  scopeHint: string
}

const SIMPLE_TYPES = ['cause_fix', 'reference_doc', 'bulletin', 'note'] as const
type SimpleType = (typeof SIMPLE_TYPES)[number]

const FIELD_LABELS: Record<string, string> = {
  type: 'Type',
  title: 'Title',
  body: 'Body',
  complaint: 'Complaint',
  cause: 'Cause',
  correction: 'Correction',
  first_check: 'First check',
  source: 'Source',
  bulletin_id: 'Bulletin ID',
  summary: 'Summary',
  link: 'Link',
  dtcList: 'DTCs',
  systemCodes: 'System codes',
  symptoms: 'Symptoms',
}

function labelFor(field: string): string {
  return FIELD_LABELS[field] ?? field
}

export function ReviewForm() {
  const router = useRouter()
  const [hydrated, setHydrated] = useState(false)
  const [stored, setStored] = useState<Stored | null>(null)
  const [type, setType] = useState<SimpleType>('note')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [structured, setStructured] = useState<Record<string, string>>({})
  const {
    dtcs,
    subCodes: dtcSubCodes,
    setDtcs,
    normalize: normalizeDtcInput,
    displaySuffix: dtcSuffix,
  } = useDtcChips({ dtcs: [], subCodes: {} })
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
      const tooShortInit = parsed.proposal.status === 'paste_too_short'
      setBody(d.body ?? (tooShortInit ? parsed.rawText : ''))
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
  const unverified = useMemo(
    () => new Set(stored?.proposal.unverified ?? []),
    [stored],
  )
  const stripped = useMemo(() => stored?.proposal.stripped ?? [], [stored])
  const tooShort = stored?.proposal.status === 'paste_too_short'

  function attributionFor(field: string): 'verified' | 'unverified' | 'none' {
    if (editedFields.has(field)) return 'none'
    if (unverified.has(field)) return 'unverified'
    if (sources[field]) return 'verified'
    return 'none'
  }

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
        dtcSubCodes: Object.keys(dtcSubCodes).length > 0 ? dtcSubCodes : undefined,
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
    if (!confirm('Throw away this paste?')) return
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
      {tooShort && (
        <div className="vk-fg__notice">
          Paste too short to assist — fill the form manually.
        </div>
      )}
      {!tooShort && stripped.length > 0 && (
        <div className="vk-fg__notice">
          Couldn&apos;t find these in your paste — fill them yourself:{' '}
          {stripped.map(labelFor).join(', ')}.
        </div>
      )}
      <FieldGroup
        label="Type"
        attribution={attributionFor('type')}
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
        attribution={attributionFor('title')}
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
          attribution={attributionFor('body')}
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
            attribution={attributionFor(k)}
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
            attribution={attributionFor(k)}
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
        attribution={attributionFor('dtcList')}
        source={sources.dtcList}
      >
        <TagInput
          values={dtcs}
          setValues={(v) => {
            setDtcs(v)
            markEdited('dtcList')
          }}
          placeholder="P0562"
          normalize={normalizeDtcInput}
          displaySuffix={dtcSuffix}
        />
      </FieldGroup>

      <FieldGroup
        label="System codes"
        attribution={attributionFor('systemCodes')}
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
        attribution={attributionFor('symptoms')}
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
        attribution="none"
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
