'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function NovelActions({ queueEntryId }: { queueEntryId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function reset() {
    setOpen(false)
    setNote('')
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError(null)

    const res = await fetch(`/api/curator/novel/${queueEntryId}/dismiss`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: note.trim() || null }),
    })

    setSubmitting(false)

    if (!res.ok) {
      setError(`Failed to dismiss (${res.status}). Try again.`)
      return
    }

    reset()
    router.refresh()
  }

  return (
    <div className="vt-novel-actions">
      <div className="vt-novel-actions-buttons">
        <button onClick={() => setOpen(true)}>Dismiss</button>
      </div>

      {open && (
        <form className="vt-novel-actions-form" onSubmit={handleSubmit}>
          <div>
            <label htmlFor="vt-novel-note">Note (optional)</label>
            <textarea
              id="vt-novel-note"
              placeholder="Why is this not a corpus-worthy pattern?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {error && (
            <p role="alert" className="vt-novel-actions-error">
              {error}
            </p>
          )}

          <div className="vt-novel-actions-confirm-buttons">
            <button type="submit" disabled={submitting}>Confirm Dismiss</button>
            <button type="button" onClick={reset}>Cancel</button>
          </div>
        </form>
      )}
    </div>
  )
}
