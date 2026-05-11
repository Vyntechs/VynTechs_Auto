'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function FounderNoteSubmitForm() {
  const router = useRouter()
  const [rawText, setRawText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitting || rawText.trim().length === 0) return
    setSubmitting(true)
    setError(null)

    const res = await fetch('/api/founder-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText: rawText.trim() }),
    })

    if (!res.ok) {
      setSubmitting(false)
      setError(`Submit failed (${res.status}). Try again.`)
      return
    }

    const json = (await res.json()) as { id: string }
    router.push(`/curator/founder-notes/${json.id}`)
  }

  return (
    <form className="vt-founder-note-submit-form" onSubmit={handleSubmit}>
      <label>
        Note
        <textarea
          required
          rows={8}
          autoFocus
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder="e.g. 2014-2018 F-150 5.0L cold-start misfire with P0316 — 9 times out of 10 it's the cam phasers, not the coils. Replaced phasers, cleared codes, road-tested 30 min."
        />
      </label>
      {error && (
        <p role="alert" className="vt-founder-note-submit-error">
          {error}
        </p>
      )}
      <button type="submit" disabled={submitting || rawText.trim().length === 0}>
        {submitting ? 'Structuring...' : 'Submit for review'}
      </button>
    </form>
  )
}
