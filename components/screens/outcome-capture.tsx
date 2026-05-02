'use client'

import { useState } from 'react'
import { VehicleStrip, DtcChip } from '@/components/vt'

type Props = {
  vehicleName: string
  vehicleMeta: string
  timer: string
  diagMin: number
  repairMin: number
}

export function OutcomeCapture({
  vehicleName,
  vehicleMeta,
  timer,
  diagMin,
  repairMin,
}: Props) {
  const [rootCause, setRootCause] = useState('')
  const [actionType, setActionType] = useState('')
  const [oemPart, setOemPart] = useState('')
  // For demo: AI rejection appears when root cause is too vague.
  const aiReject = rootCause.length > 0 && rootCause.trim().split(/\s+/).length < 4

  return (
    <div className="app">
      <VehicleStrip name={vehicleName} vin={vehicleMeta} timer={timer} />
      <form
        onSubmit={(e) => e.preventDefault()}
        style={{ padding: '14px 16px', flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}
      >
        <span className="eyebrow">Outcome capture · all fields required</span>

        <div className="field" style={{ marginTop: 10 }}>
          <label htmlFor="root-cause">Root cause</label>
          <textarea
            id="root-cause"
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            rows={2}
            placeholder="Be specific: location, identifier, what a future tech could find in 60s."
          />
          {aiReject && (
            <div className="ai-reject">
              Be specific. WHERE was the crack? Other techs need to find this in 60 seconds.
            </div>
          )}
        </div>

        <div className="field">
          <label htmlFor="action-type">Action type</label>
          <input
            id="action-type"
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            placeholder="Part replacement · silicone vacuum line"
          />
        </div>

        <div className="field">
          <label htmlFor="oem-part">OEM part number</label>
          <input
            id="oem-part"
            value={oemPart}
            onChange={(e) => setOemPart(e.target.value)}
            style={{ fontFamily: 'var(--vt-font-mono)' }}
            placeholder="—"
          />
        </div>

        <div className="field">
          <label>Verification</label>
          <div style={{ display: 'flex', gap: 8, paddingTop: 4, flexWrap: 'wrap' }}>
            <DtcChip
              style={{ color: 'var(--vt-amber-500)', borderColor: 'var(--vt-amber-500)' }}
            >
              codes cleared
            </DtcChip>
            <DtcChip
              style={{ color: 'var(--vt-amber-500)', borderColor: 'var(--vt-amber-500)' }}
            >
              test drive
            </DtcChip>
            <DtcChip
              style={{ color: 'var(--vt-amber-500)', borderColor: 'var(--vt-amber-500)' }}
            >
              resolved
            </DtcChip>
          </div>
        </div>

        <div className="field">
          <label>Time spent</label>
          <div style={{ fontFamily: 'var(--vt-font-mono)', fontSize: 14 }}>
            diag {diagMin} min · repair {repairMin} min ·{' '}
            <span style={{ color: 'var(--vt-fg-3)' }}>auto</span>
          </div>
        </div>
      </form>
      <div
        style={{
          padding: '12px 14px',
          borderTop: '1px solid var(--vt-rule)',
          display: 'flex',
          gap: 8,
          background: 'var(--vt-graphite-1000)',
        }}
      >
        <button type="button" className="btn btn-ghost" style={{ flex: 1 }}>
          Save draft
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          style={{ flex: 2 }}
          disabled={!rootCause || aiReject}
        >
          Submit & close case
        </button>
      </div>
    </div>
  )
}
