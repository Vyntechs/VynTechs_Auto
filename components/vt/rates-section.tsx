'use client'
import { useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { Module } from './module'
import { formatMoneyCents, parseMoneyToCents } from '@/lib/shop-os/quote-builder-ui'

type Props = {
  initialTaxRateBps: number | null
  initialLaborRateCents: number | null
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const MAX_TAX_RATE_BPS = 10_000

// A typed percent maps to basis points with the same math the quote parser
// uses for dollars→cents ("8.25" → 825), so the two forms stay consistent.
// Both tolerate a nullish or out-of-range column and render an empty field
// rather than throwing during the server render.
function bpsToInput(bps: number | null | undefined): string {
  return bps == null ? '' : (bps / 100).toString()
}

function centsToInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isSafeInteger(cents) || cents < 0) return ''
  return formatMoneyCents(cents).replace(/[$,]/g, '')
}

type FieldEval = { state: 'empty' | 'valid' | 'invalid'; value?: number }

function evalTax(raw: string): FieldEval {
  const trimmed = raw.trim()
  if (trimmed === '') return { state: 'empty' }
  let bps: number
  try {
    bps = parseMoneyToCents(trimmed)
  } catch {
    return { state: 'invalid' }
  }
  if (bps > MAX_TAX_RATE_BPS) return { state: 'invalid' }
  return { state: 'valid', value: bps }
}

function evalLabor(raw: string): FieldEval {
  const trimmed = raw.trim()
  if (trimmed === '') return { state: 'empty' }
  let cents: number
  try {
    cents = parseMoneyToCents(trimmed)
  } catch {
    return { state: 'invalid' }
  }
  return { state: 'valid', value: cents }
}

const hintStyle: CSSProperties = {
  margin: '6px 0 0',
  fontSize: 12,
  lineHeight: 1.45,
  color: 'var(--vt-fg-3)',
}

const errorHintStyle: CSSProperties = {
  ...hintStyle,
  fontStyle: 'italic',
  color: 'var(--vt-risk-high, #b22)',
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginTop: 12,
  flexWrap: 'wrap',
}

const savedStyle: CSSProperties = {
  fontFamily: 'var(--vt-font-mono)',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--vt-fg-3)',
}

const errorStyle: CSSProperties = {
  fontFamily: 'var(--vt-font-serif)',
  fontStyle: 'italic',
  fontSize: 13,
  color: 'var(--vt-risk-high, #b22)',
}

export function RatesSection({ initialTaxRateBps, initialLaborRateCents }: Props) {
  const router = useRouter()
  const initialTax = bpsToInput(initialTaxRateBps)
  const initialLabor = centsToInput(initialLaborRateCents)
  const [tax, setTax] = useState(initialTax)
  const [labor, setLabor] = useState(initialLabor)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)

  const taxEval = evalTax(tax)
  const laborEval = evalLabor(labor)
  const taxChanged = tax.trim() !== initialTax.trim()
  const laborChanged = labor.trim() !== initialLabor.trim()
  const submitTax = taxChanged && taxEval.state === 'valid'
  const submitLabor = laborChanged && laborEval.state === 'valid'
  const anyInvalid = taxEval.state === 'invalid' || laborEval.state === 'invalid'
  const canSave = !anyInvalid && (submitTax || submitLabor)

  function markDirty() {
    if (saveState !== 'idle') setSaveState('idle')
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSave) return
    setSaveState('saving')
    setSaveError(null)

    const payload: { taxRateBps?: number; laborRateCents?: number } = {}
    if (submitTax) payload.taxRateBps = taxEval.value
    if (submitLabor) payload.laborRateCents = laborEval.value

    try {
      const res = await fetch('/api/shop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setSaveError(humanizeSaveError(body.error))
        setSaveState('error')
        return
      }
      setSaveState('saved')
      // Re-runs the server-rendered settings page so the quote builder and
      // canned-jobs preview pick up the new rate without a hard reload.
      router.refresh()
    } catch {
      setSaveError('Could not reach the server. Try again.')
      setSaveState('error')
    }
  }

  return (
    <Module num="02" label="Rates & tax">
      <form onSubmit={save} noValidate>
        <div className="field">
          <label htmlFor="shop-tax-rate">Sales tax rate (%)</label>
          <input
            id="shop-tax-rate"
            inputMode="decimal"
            value={tax}
            onChange={(e) => {
              setTax(e.target.value)
              markDirty()
            }}
            placeholder="e.g. 8.25"
            aria-describedby="shop-tax-rate-hint"
          />
          <p id="shop-tax-rate-hint" style={taxEval.state === 'invalid' ? errorHintStyle : hintStyle}>
            {taxEval.state === 'invalid'
              ? 'Enter a percent between 0 and 100, like 8.25.'
              : 'Applied to taxable lines so every quote can show a real total.'}
          </p>
        </div>

        <div className="field">
          <label htmlFor="shop-labor-rate">Default labor rate ($ / hour)</label>
          <input
            id="shop-labor-rate"
            inputMode="decimal"
            value={labor}
            onChange={(e) => {
              setLabor(e.target.value)
              markDirty()
            }}
            placeholder="e.g. 120"
            aria-describedby="shop-labor-rate-hint"
          />
          <p id="shop-labor-rate-hint" style={laborEval.state === 'invalid' ? errorHintStyle : hintStyle}>
            {laborEval.state === 'invalid'
              ? 'Enter a dollar amount, like 120 or 120.00.'
              : 'Used to price labor lines by the hour.'}
          </p>
        </div>

        <div style={rowStyle}>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSave || saveState === 'saving'}
          >
            {saveState === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {saveState === 'saved' && (
            <span role="status" style={savedStyle}>
              Saved
            </span>
          )}
          {saveState === 'error' && saveError && (
            <span role="alert" style={errorStyle}>
              {saveError}
            </span>
          )}
        </div>
      </form>
    </Module>
  )
}

function humanizeSaveError(code: string | undefined): string {
  if (code === 'invalid_tax_rate') return 'Tax rate must be between 0% and 100%.'
  if (code === 'invalid_labor_rate') return 'Labor rate must be a positive dollar amount.'
  if (code === 'no_changes') return 'Change a rate before saving.'
  if (code === 'forbidden') return 'Only admins can change rates.'
  if (code === 'no_shop') return 'No shop is assigned to your account.'
  if (code === 'paywall') return 'Subscription required to save changes.'
  if (code === 'unauthenticated') return 'Please sign in again.'
  return 'Could not save. Try again.'
}
