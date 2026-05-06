'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

type ActionKind = 'approve' | 'override' | 'close' | null

export function DeferredActions({ sessionId }: { sessionId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState<ActionKind>(null)
  const [note, setNote] = useState('')
  const [overrideAction, setOverrideAction] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setOpen(null)
    setNote('')
    setOverrideAction('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)

    const endpoint = `/api/curator/sessions/${sessionId}/${open}`
    const body: Record<string, string | null> = { note: note.trim() || null }
    if (open === 'override') {
      const action = overrideAction.trim()
      if (!action) {
        setError('Override action is required.')
        setSubmitting(false)
        return
      }
      body.overrideAction = action
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    setSubmitting(false)

    if (!res.ok) {
      const label = open === 'approve' ? 'approve' : open === 'override' ? 'override' : 'close'
      setError(`Failed to ${label} session (${res.status}). Try again.`)
      return
    }

    reset()
    router.refresh()
  }

  return (
    <div className="vt-deferred-actions">
      <div className="vt-deferred-actions-buttons">
        <button onClick={() => setOpen('approve')}>Approve</button>
        <button onClick={() => setOpen('override')}>Override</button>
        <button onClick={() => setOpen('close')}>Close</button>
      </div>

      {open && (
        <form className="vt-deferred-actions-form" onSubmit={handleSubmit}>
          {open === 'override' && (
            <div>
              <label htmlFor="vt-override-action">Override action (required)</label>
              <input
                id="vt-override-action"
                type="text"
                required
                placeholder="e.g. proceed-with-replacement"
                value={overrideAction}
                onChange={(e) => setOverrideAction(e.target.value)}
              />
            </div>
          )}

          <div>
            <label htmlFor="vt-deferred-note">
              Note (optional)
            </label>
            <textarea
              id="vt-deferred-note"
              placeholder="Note (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="vt-deferred-actions-error">
              {error}
            </p>
          )}

          <div className="vt-deferred-actions-confirm-buttons">
            <button type="submit" disabled={submitting}>
              Confirm{' '}
              {open === 'approve'
                ? 'Approve'
                : open === 'override'
                  ? 'Override'
                  : 'Close'}
            </button>
            <button type="button" onClick={reset}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
