'use client'

import { useState } from 'react'

type Props = {
  sessionId: string
  /** Defaults to /sessions/[sessionId]; the page re-renders in repair-phase mode after lock. */
  redirectTo?: string
}

export function LockDiagnosisButton({ sessionId, redirectTo }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    if (busy) return
    setBusy(true)
    setError(null)

    const res = await fetch(`/api/sessions/${sessionId}/lock-diagnosis`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    })

    if (!res.ok) {
      setBusy(false)
      const errText = await res.text().catch(() => '')
      setError(errText || 'Could not lock diagnosis')
      return
    }
    window.location.href = redirectTo ?? `/sessions/${sessionId}`
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="btn btn-primary"
      >
        {busy ? 'Locking diagnosis…' : 'Lock in diagnosis & start repair →'}
      </button>
      {error && (
        <div role="alert" style={{ marginTop: 8, color: 'var(--vt-signal-700)' }}>
          {error}
        </div>
      )}
    </>
  )
}
