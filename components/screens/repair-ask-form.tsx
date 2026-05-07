'use client'

import { useState } from 'react'

type Props = {
  sessionId: string
}

export function RepairAskForm({ sessionId }: Props) {
  const [observation, setObservation] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = !busy && observation.trim().length > 0

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)

    const res = await fetch(`/api/sessions/${sessionId}/repair-observation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ observation: observation.trim() }),
    })

    if (!res.ok) {
      setBusy(false)
      const data = await res.json().catch(() => ({}))
      setError(data?.error || 'Could not submit. Try again?')
      return
    }

    // Success — clear textarea + reload so the server-side data fetch
    // picks up the new observation + guidance event pair.
    setObservation('')
    setBusy(false)
    window.location.reload()
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label htmlFor="repair-observation" className="eyebrow">
        Ask a question or report what you found
      </label>
      <textarea
        id="repair-observation"
        value={observation}
        onChange={e => setObservation(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="e.g., master cyl bolts are corroded — should I replace?"
        disabled={busy}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="submit" disabled={!canSubmit} className="btn btn-primary">
          {busy ? 'Asking AI…' : 'Submit'}
        </button>
        {error && (
          <span role="alert" style={{ color: 'var(--vt-signal-700)', fontSize: 13 }}>
            {error}
          </span>
        )}
      </div>
    </form>
  )
}
