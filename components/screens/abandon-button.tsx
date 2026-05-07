'use client'

import { useState } from 'react'

type Props = {
  sessionId: string
  variant?: 'ghost' | 'inline'
  redirectTo?: string
}

export function AbandonButton({
  sessionId,
  variant = 'ghost',
  redirectTo = '/today',
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    if (busy) return
    const ok = window.confirm(
      "Mark this case incomplete?\n\nUse this when you started by mistake, it was a test, or the customer left without finishing. The case goes to the Incomplete bucket on the curator console.\n\nThis can't be undone.",
    )
    if (!ok) return

    setBusy(true)
    setError(null)
    const res = await fetch(`/api/sessions/${sessionId}/abandon`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'mistake' }),
    })
    if (!res.ok) {
      setBusy(false)
      const errText = await res.text().catch(() => '')
      setError(errText || 'Could not mark incomplete')
      return
    }
    window.location.href = redirectTo
  }

  if (variant === 'inline') {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          disabled={busy}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            color: 'var(--vt-fg-2)',
            cursor: busy ? 'wait' : 'pointer',
            textDecoration: 'underline',
            font: 'inherit',
          }}
        >
          {busy ? 'Marking incomplete…' : 'Mark this case incomplete →'}
        </button>
        {error && (
          <div role="alert" style={{ marginTop: 8, color: 'var(--vt-signal-700)' }}>
            {error}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="btn btn-ghost"
      >
        {busy ? 'Marking incomplete…' : 'Mark incomplete'}
      </button>
      {error && (
        <div role="alert" style={{ marginTop: 8, color: 'var(--vt-signal-700)' }}>
          {error}
        </div>
      )}
    </>
  )
}
