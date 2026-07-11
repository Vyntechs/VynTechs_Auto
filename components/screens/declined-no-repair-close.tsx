'use client'

import { useState } from 'react'
import { Module, VehicleStrip } from '@/components/vt'

type Props = {
  sessionId: string
  vehicleName: string
  successHref?: string
}

export function DeclinedNoRepairClose({
  sessionId,
  vehicleName,
  successHref = '/today',
}: Props) {
  const [confirming, setConfirming] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirmClose() {
    if (busy) return
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/sessions/${sessionId}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'declined_no_repair',
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    })
    if (!response.ok) {
      setBusy(false)
      setError((await response.text().catch(() => '')) || 'Closeout could not be recorded. Refresh and try again.')
      return
    }
    window.location.href = successHref
  }

  return (
    <div className="app">
      <VehicleStrip
        name={vehicleName}
        vin={`No-repair closeout · session ${sessionId.slice(0, 8)}`}
        timer="—"
        back={{ href: `/sessions/${sessionId}`, label: 'Diagnosis' }}
      />
      <div style={{ padding: '14px 16px', flex: 1, overflow: 'auto' }}>
        <Module num="—" label="Customer decision">
          <h1 style={{ margin: '0 0 10px', fontFamily: 'var(--vt-font-serif)', fontWeight: 400 }}>
            No repair authorized
          </h1>
          {!confirming ? (
            <>
              <p style={{ margin: '0 0 16px', color: 'var(--vt-fg-2)', lineHeight: 1.5 }}>
                The customer declined this work. Close the diagnosis without claiming a repair or verification.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                style={{ minHeight: 44 }}
                onClick={() => setConfirming(true)}
              >
                Close without repair
              </button>
            </>
          ) : (
            <form onSubmit={(event) => { event.preventDefault(); void confirmClose() }}>
              <div
                style={{
                  borderLeft: '3px solid var(--vt-signal-500)',
                  padding: '10px 12px',
                  marginBottom: 16,
                  background: 'var(--vt-paper)',
                }}
              >
                <p style={{ margin: '0 0 4px', fontWeight: 600 }}>Customer declined this work.</p>
                <p style={{ margin: '0 0 4px' }}>No repair performed.</p>
                <p style={{ margin: 0 }}>No verification will be recorded.</p>
              </div>
              <div className="field">
                <label htmlFor="closeout-note">Closeout note</label>
                <textarea
                  id="closeout-note"
                  value={note}
                  maxLength={2000}
                  rows={3}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Optional internal context"
                />
              </div>
              {error && <div role="alert" style={{ marginBottom: 12, color: 'var(--vt-signal-700)' }}>{error}</div>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ minHeight: 44 }}
                  disabled={busy}
                  onClick={() => setConfirming(false)}
                >
                  Keep open
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ minHeight: 44 }}
                  disabled={busy}
                >
                  {busy ? 'Recording…' : 'Confirm no repair'}
                </button>
              </div>
            </form>
          )}
        </Module>
      </div>
    </div>
  )
}
