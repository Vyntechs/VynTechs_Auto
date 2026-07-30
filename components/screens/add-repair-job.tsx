'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Btn, Field, FormRow, Input } from '@/components/vt/desktop'
import { parseAddedJobResponse } from '@/lib/shop-os/quote-builder-ui'

/**
 * Puts the repair the shop just diagnosed onto an open repair order without a
 * saved template. It creates the job only — price it with the Add part / Add
 * labor / Add fee actions already on that job — and it never edits any other
 * job's authorized scope.
 */
export function AddRepairJob({
  ticketId,
  onAdded,
}: {
  ticketId: string
  onAdded?: () => void
}): React.JSX.Element {
  const router = useRouter()
  const [kind, setKind] = useState<'repair' | 'maintenance'>('repair')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Held across retries so a repeat of the same submission is a replay, not a
  // second job. Cleared only once the server has recorded this one.
  const clientKeyRef = useRef<string | null>(null)

  const ready = title.trim().length > 0

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy || !ready) return
    clientKeyRef.current ??= crypto.randomUUID()
    setBusy(true)
    setError(null)
    const trimmed = title.trim()
    try {
      const response = await fetch(`/api/tickets/${ticketId}/quote/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          clientKey: clientKeyRef.current,
          job: { title: trimmed, kind },
        }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
        setError(record.error === 'job_limit_reached'
          ? 'This repair order already has 25 jobs. Remove a job before adding another.'
          : response.status === 409
            ? 'The quote changed. Refresh and add it again.'
            : 'Could not add this work. Review the fields and try again.')
        return
      }
      const added = parseAddedJobResponse(response.status, body)
      if (!added || added.job.title !== trimmed || added.job.kind !== kind) {
        setError('Refresh the quote to see what was recorded.')
        return
      }
      clientKeyRef.current = null
      setTitle('')
      if (onAdded) onAdded()
      else router.refresh()
    } catch {
      setError('Connection interrupted. Retry with the same details.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="vt-form__group" aria-label="Add repair">
      <div className="vt-form__group-label">
        <span className="vt-form__group-name">Add repair</span>
        <span className="vt-form__group-hint">
          Adds a new approvable job. Price it with its own part, labor and fee lines.
        </span>
      </div>
      <form className="vt-form__group-fields" onSubmit={submit}>
        <FormRow>
          <Field label="Work type" htmlFor="arj-kind">
            <select
              id="arj-kind"
              name="repairKind"
              className="vt-field__input"
              value={kind}
              onChange={(event) => setKind(event.target.value as 'repair' | 'maintenance')}
            >
              <option value="repair">Repair</option>
              <option value="maintenance">Maintenance</option>
            </select>
          </Field>
          <Field label="What are we doing" htmlFor="arj-title">
            <Input
              id="arj-title"
              name="repairTitle"
              maxLength={200}
              placeholder="e.g. replace corroded engine ground strap"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
        </FormRow>
        {error && (
          <p role="alert" className="vt-field__hint vt-field__hint--accent">
            {error}
          </p>
        )}
        <Btn kind="primary" type="submit" disabled={!ready || busy}>
          {busy ? 'Adding…' : 'Add repair'}
        </Btn>
      </form>
    </section>
  )
}
