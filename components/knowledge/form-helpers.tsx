'use client'
import { useState } from 'react'

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
