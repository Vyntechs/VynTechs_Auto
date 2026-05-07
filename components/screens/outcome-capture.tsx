'use client'

import { useState } from 'react'
import { VehicleStrip } from '@/components/vt'

const ACTION_TYPES = [
  ['part_replacement', 'Part replacement'],
  ['repair', 'Repair'],
  ['adjustment', 'Adjustment'],
  ['cleaning', 'Cleaning'],
  ['no_fix', 'No fix needed'],
  ['referred', 'Referred to other shop'],
] as const

type ActionType = (typeof ACTION_TYPES)[number][0]
type SymptomsResolved = 'yes' | 'partial' | 'no'

type Props = {
  vehicleName: string
  vehicleMeta: string
  timer: string
  diagMin: number
  repairMin: number
  /**
   * Real session id. When omitted, the component renders in design-preview
   * mode — the form is interactive but submit is disabled and no fetch is made.
   */
  sessionId?: string
  /** Override the default redirect target (defaults to /sessions). */
  successHref?: string
}

function ToggleChip({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      style={{
        font: 'inherit',
        cursor: 'pointer',
        padding: '4px 10px',
        borderRadius: 999,
        background: 'transparent',
        color: checked ? 'var(--vt-signal-500)' : 'var(--vt-fg-3)',
        border: `1px solid ${checked ? 'var(--vt-signal-500)' : 'var(--vt-rule)'}`,
        fontFamily: 'var(--vt-font-mono)',
        fontSize: 11,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        transition: 'color 120ms, border-color 120ms',
      }}
    >
      {label}
    </button>
  )
}

export function OutcomeCapture({
  vehicleName,
  vehicleMeta,
  timer,
  diagMin,
  repairMin,
  sessionId,
  successHref = '/sessions',
}: Props) {
  const [rootCause, setRootCause] = useState('')
  const [actionType, setActionType] = useState<ActionType>('part_replacement')
  const [partName, setPartName] = useState('')
  const [oemNumber, setOemNumber] = useState('')
  const [partCost, setPartCost] = useState('')
  const [codesCleared, setCodesCleared] = useState(true)
  const [testDrive, setTestDrive] = useState(true)
  const [symptomsResolved, setSymptomsResolved] = useState<SymptomsResolved>('yes')
  const [notes, setNotes] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [attemptCount, setAttemptCount] = useState(0)
  const [lastFeedback, setLastFeedback] = useState<string | null>(null)

  const requiresPart = actionType === 'part_replacement'
  const previewMode = !sessionId
  const canSubmit =
    !previewMode &&
    !busy &&
    rootCause.trim().length >= 10 &&
    (!requiresPart || partName.trim().length > 0)

  async function handleSubmit() {
    if (!sessionId) return
    setBusy(true)
    setError(null)

    const isOverride = attemptCount >= 1 && lastFeedback !== null

    const payload: Record<string, unknown> = {
      rootCause: rootCause.trim(),
      actionType,
      verification: {
        codesCleared,
        testDrive,
        symptomsResolved,
      },
      diagMinutes: diagMin,
      repairMinutes: repairMin,
    }
    if (requiresPart) {
      payload.partInfo = {
        name: partName.trim(),
        ...(oemNumber.trim() ? { oemNumber: oemNumber.trim() } : {}),
        ...(partCost ? { cost: Number(partCost) } : {}),
      }
    }
    if (notes.trim()) payload.notes = notes.trim()
    if (isOverride) {
      payload.override = {
        at: new Date().toISOString(),
        lastFeedback: lastFeedback ?? '',
      }
    } else {
      setFeedback(null)
    }

    const res = await fetch(`/api/sessions/${sessionId}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)

    if (res.status === 422) {
      const data = await res.json().catch(() => ({}))
      const fb = data.feedback ?? 'Be more specific.'
      setFeedback(fb)
      setLastFeedback(fb)
      setAttemptCount((n) => n + 1)
      return
    }
    if (!res.ok) {
      setError((await res.text().catch(() => '')) || 'Failed to close session')
      return
    }
    window.location.href = successHref
  }

  return (
    <div className="app">
      <VehicleStrip name={vehicleName} vin={vehicleMeta} timer={timer} />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
        }}
        style={{
          padding: '14px 16px',
          flex: 1,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <span className="eyebrow">Closing the case · all fields required</span>

        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="root-cause">Root cause</label>
          <textarea
            id="root-cause"
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            rows={3}
            placeholder="Be specific: location, identifier, what a future tech could find in 60s."
          />
          {feedback && <div className="ai-reject">{feedback}</div>}
        </div>

        <div className="field">
          <label htmlFor="action-type">Action type</label>
          <select
            id="action-type"
            value={actionType}
            onChange={(e) => setActionType(e.target.value as ActionType)}
          >
            {ACTION_TYPES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>

        {requiresPart && (
          <>
            <div className="field">
              <label htmlFor="part-name">Part name</label>
              <input
                id="part-name"
                value={partName}
                onChange={(e) => setPartName(e.target.value)}
                placeholder="Silicone vacuum line, 4mm ID"
              />
            </div>
            <div className="field">
              <label htmlFor="oem-part">OEM number</label>
              <input
                id="oem-part"
                value={oemNumber}
                onChange={(e) => setOemNumber(e.target.value)}
                style={{ fontFamily: 'var(--vt-font-mono)' }}
                placeholder="—"
              />
            </div>
            <div className="field">
              <label htmlFor="part-cost">Part cost ($)</label>
              <input
                id="part-cost"
                type="number"
                step="0.01"
                inputMode="decimal"
                value={partCost}
                onChange={(e) => setPartCost(e.target.value)}
                style={{ fontFamily: 'var(--vt-font-mono)' }}
                placeholder="—"
              />
            </div>
          </>
        )}

        <div className="field">
          <label>Verification</label>
          <div style={{ display: 'flex', gap: 8, paddingTop: 4, flexWrap: 'wrap' }}>
            <ToggleChip
              label="codes cleared"
              checked={codesCleared}
              onToggle={() => setCodesCleared((v) => !v)}
            />
            <ToggleChip
              label="test drive"
              checked={testDrive}
              onToggle={() => setTestDrive((v) => !v)}
            />
          </div>
          <div style={{ display: 'flex', gap: 8, paddingTop: 8, flexWrap: 'wrap' }}>
            {(['yes', 'partial', 'no'] as const).map((opt) => (
              <ToggleChip
                key={opt}
                label={`resolved: ${opt}`}
                checked={symptomsResolved === opt}
                onToggle={() => setSymptomsResolved(opt)}
              />
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="notes">Notes for next time (optional)</label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Anything a future tech should know about this case."
          />
        </div>

        <div className="field">
          <label>Time spent</label>
          <div style={{ fontFamily: 'var(--vt-font-mono)', fontSize: 14 }}>
            diag {diagMin} min · repair {repairMin} min ·{' '}
            <span style={{ color: 'var(--vt-fg-3)' }}>auto</span>
          </div>
        </div>

        {error && (
          <div className="ai-reject" role="alert">
            {error}
          </div>
        )}
      </form>
      <div
        style={{
          padding: '12px 14px',
          borderTop: '0.5px solid var(--vt-rule)',
          display: 'flex',
          gap: 8,
          background: 'var(--vt-bone-50)',
        }}
      >
        <button type="button" className="btn btn-ghost" style={{ flex: 1 }} disabled>
          Save draft
        </button>
        <button
          type="button"
          className="btn btn-primary"
          style={{ flex: 2 }}
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          {busy
            ? 'Validating…'
            : attemptCount >= 1
              ? 'Submit & close case (override AI)'
              : 'Submit & close case'}
        </button>
      </div>
    </div>
  )
}
