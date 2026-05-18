'use client'
import { useRef, useState } from 'react'
import { normalizeDtcForChip } from '@/lib/knowledge/normalize'

export type Scope = {
  yearStart: number
  yearEnd: number
  make: string
  model?: string
  engine?: string
}

export type FieldAttribution = 'verified' | 'unverified' | 'none'

export function FieldGroup({
  label,
  attribution = 'none',
  source,
  children,
}: {
  label: string
  attribution?: FieldAttribution
  source?: string
  children: React.ReactNode
}) {
  const effectiveAttribution: FieldAttribution =
    attribution === 'verified' && !source ? 'unverified' : attribution

  return (
    <div
      className={
        effectiveAttribution === 'verified'
          ? 'vk-fg vk-fg--verified'
          : effectiveAttribution === 'unverified'
            ? 'vk-fg vk-fg--unverified'
            : 'vk-fg'
      }
    >
      <div className="vk-fg__head">
        <label className="vk-fg__label">{label}</label>
        {effectiveAttribution === 'unverified' && (
          <span className="vk-fg__chip vk-fg__chip--verify" aria-label="needs verification">
            ⚠ VERIFY
          </span>
        )}
      </div>
      <div className="vk-fg__body">{children}</div>
      {effectiveAttribution === 'verified' && source && (
        <div className="vk-fg__source">
          <span className="vk-fg__source-prefix">From your paste:</span>
          <mark>{source}</mark>
        </div>
      )}
    </div>
  )
}

export function TagInput({
  values,
  setValues,
  placeholder,
  normalize,
  displaySuffix,
}: {
  values: string[]
  setValues: (v: string[]) => void
  placeholder?: string
  // When provided, runs on Enter/comma. Returns the canonical value (and an
  // optional suffix to display) — or null to hard-reject the input.
  normalize?: (raw: string) => { value: string; suffix: string | null } | null
  // Optional per-chip suffix renderer (for re-displaying suffixes loaded from
  // a parallel state map — e.g. dtcSubCodes — when values were not just typed).
  displaySuffix?: (value: string) => string | null
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const commit = () => {
    const t = draft.trim()
    if (!t) return
    if (normalize) {
      const result = normalize(t)
      if (!result) {
        setError('Not a valid DTC — try P/B/C/U + 4 hex digits (e.g. P0420).')
        return
      }
      setValues([...values, result.value])
    } else {
      setValues([...values, t])
    }
    setDraft('')
    setError(null)
  }

  return (
    <div className="vk-taginput">
      {values.map((v, i) => {
        const suffix = displaySuffix?.(v)
        return (
          <span className="vk-taginput__chip" key={i}>
            {v}
            {suffix && <span className="vk-taginput__chip-sub"> ·{suffix}</span>}
            <button type="button" onClick={() => setValues(values.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        )
      })}
      <input
        className={error ? 'vk-taginput__input vk-taginput__input--error' : 'vk-taginput__input'}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value)
          if (error) setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
          }
        }}
        placeholder={placeholder}
      />
      {error && <div className="vk-taginput__error">{error}</div>}
    </div>
  )
}

// Manages parallel state for DTC chips + sub-codes. The form passes
// (dtcs, setDtcs, normalize, displaySuffix) to TagInput. When a new chip is
// added, the `normalize` callback (a wrapper around normalizeDtcForChip) stashes
// the resulting suffix in a ref; the wrapped `setDtcs` then attaches it to the
// chip just added — and drops sub-code entries for chips that were removed.
export function useDtcChips(initial: {
  dtcs: string[]
  subCodes: Record<string, string>
}) {
  const [dtcs, setDtcsRaw] = useState<string[]>(initial.dtcs)
  const [subCodes, setSubCodes] = useState<Record<string, string>>(initial.subCodes)
  const pendingSuffixRef = useRef<string | null>(null)

  const normalize = (raw: string) => {
    const result = normalizeDtcForChip(raw)
    pendingSuffixRef.current = result?.suffix ?? null
    return result
  }

  const setDtcs = (next: string[]) => {
    const added = next.filter((v) => !dtcs.includes(v))
    const removed = dtcs.filter((v) => !next.includes(v))

    const nextSub = { ...subCodes }
    for (const v of removed) delete nextSub[v]
    if (added.length === 1 && pendingSuffixRef.current !== null) {
      nextSub[added[0]] = pendingSuffixRef.current
    }
    pendingSuffixRef.current = null

    setDtcsRaw(next)
    setSubCodes(nextSub)
  }

  const displaySuffix = (value: string): string | null => subCodes[value] ?? null

  return { dtcs, subCodes, setDtcs, normalize, displaySuffix }
}

export function ChipPicker({
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

export function ScopeEditor({
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
