'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { SafeCannedJobTemplate } from '@/lib/shop-os/canned-jobs-ui'
import { Btn, Field, FormRow, Input } from '@/components/vt/desktop'

/**
 * Records customer-approved diagnostic overage as its own new job on an open
 * repair order. It never edits the in-progress job's frozen scope — it posts a
 * brand-new "Additional diagnostic time" diagnostic job that then flows through
 * the normal quote → approval path alongside the original estimate.
 *
 * Saved diagnostic templates are priced here rather than in the canned-job
 * picker: a diagnostic job carries authorization, so it is always written as a
 * new approvable job. Choosing one fills these fields and leaves every value
 * editable — the shop's standard hour is a starting point, not a fixed price.
 */
export function AddDiagnosticTime({
  ticketId,
  templates = [],
  onAdded,
}: {
  ticketId: string
  templates?: SafeCannedJobTemplate[]
  onAdded?: () => void
}): React.JSX.Element {
  const router = useRouter()
  const [description, setDescription] = useState('')
  const [hours, setHours] = useState('')
  const [price, setPrice] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function applyTemplate(id: string): void {
    setTemplateId(id)
    const template = templates.find((candidate) => candidate.id === id)
    if (!template) return
    setDescription(template.title)
    setHours(templateLaborHours(template))
    setPrice((template.summary.subtotalCents / 100).toFixed(2))
    setError(null)
  }

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
      setTemplateId('')
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
          Adds a job the customer can say yes to. It never touches work already under way.
        </span>
      </div>
      <form className="vt-form__group-fields" onSubmit={submit}>
        {templates.length > 0 && (
          <Field
            label="Saved diagnostic"
            htmlFor="adt-template"
            hint="Fills the fields below. Every value stays editable."
          >
            <select
              id="adt-template"
              className="vt-field__select"
              value={templateId}
              onChange={(event) => applyTemplate(event.target.value)}
            >
              <option value="">Write it manually</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.title}</option>
              ))}
            </select>
          </Field>
        )}
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

/**
 * A diagnostic template carries labor and fee lines but never parts, so the
 * billable hour is the sum of its labor lines. Trailing zeros are dropped so
 * the field reads "1" rather than "1.00".
 */
function templateLaborHours(template: SafeCannedJobTemplate): string {
  const total = template.lines.reduce(
    (sum, item) => item.kind === 'labor' ? sum + Number(item.hours) : sum,
    0,
  )
  return total > 0 ? String(Number(total.toFixed(2))) : ''
}
