'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Btn, Field, FormRow, Input } from '@/components/vt/desktop'

/**
 * Records customer-approved diagnostic overage as its own new job on an open
 * repair order. It never edits the in-progress job's frozen scope — it posts a
 * brand-new "Additional diagnostic time" diagnostic job that then flows through
 * the normal quote → approval path alongside the original estimate.
 */
export function AddDiagnosticTime({
  ticketId,
  onAdded,
}: {
  ticketId: string
  onAdded?: () => void
}): React.JSX.Element {
  const router = useRouter()
  const [description, setDescription] = useState('')
  const [hours, setHours] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = Number(hours) > 0 && price.trim() !== '' && Number(price) >= 0

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (busy || !ready) return
    setBusy(true)
    setError(null)
    const trimmed = description.trim()
    try {
      const response = await fetch(`/api/tickets/${ticketId}/quote/diagnostic-time`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          ...(trimmed ? { description: trimmed } : {}),
          laborHours: Number(hours),
          priceCents: Math.round(Number(price) * 100),
        }),
      })
      if (!response.ok) {
        setError('Could not add diagnostic time. Review the fields and try again.')
        return
      }
      setDescription('')
      setHours('')
      setPrice('')
      if (onAdded) onAdded()
      else router.refresh()
    } catch {
      setError('Connection interrupted. Retry with the same details.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="vt-form__group" aria-label="Add diagnostic time">
      <div className="vt-form__group-label">
        <span className="vt-form__group-name">Add diagnostic time</span>
        <span className="vt-form__group-hint">
          Adds a new approvable job. It never edits the in-progress diagnosis.
        </span>
      </div>
      <form className="vt-form__group-fields" onSubmit={submit}>
        <Field label="Diagnostic description" htmlFor="adt-description">
          <Input
            id="adt-description"
            name="diagnosticDescription"
            maxLength={200}
            placeholder="e.g. additional time to trace intermittent no-start"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <FormRow>
          <Field label="Diagnostic hours" htmlFor="adt-hours">
            <Input
              id="adt-hours"
              name="diagnosticHours"
              inputMode="decimal"
              mono
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </Field>
          <Field label="Diagnostic price (USD)" htmlFor="adt-price">
            <Input
              id="adt-price"
              name="diagnosticPrice"
              inputMode="decimal"
              mono
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </Field>
        </FormRow>
        {error && (
          <p role="alert" className="vt-field__hint vt-field__hint--accent">
            {error}
          </p>
        )}
        <Btn kind="primary" type="submit" disabled={!ready || busy}>
          {busy ? 'Adding…' : 'Add diagnostic time'}
        </Btn>
      </form>
    </section>
  )
}
