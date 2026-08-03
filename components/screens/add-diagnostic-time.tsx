'use client'

import { useRef, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import type { SafeCannedJobTemplate } from '@/lib/shop-os/canned-jobs-ui'
import { Btn, Field, FormRow, Input } from '@/components/vt/desktop'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DEFAULT_DIAGNOSTIC_TITLE = 'Additional diagnostic time'

type ExpectedConfirmation = {
  clientKey: string
  title: string
  laborHours: number
  priceCents: number
}

type ConfirmedTicketTruth = {
  id: string
  ticketNumber: number
  source: string
  status: 'open'
  concern: string
  jobs: Array<{
    id: string
    title: string
    kind: 'diagnostic' | 'repair' | 'maintenance'
    requiredSkillTier: 1 | 2 | 3
    assignedTechId: string | null
    sessionId: string | null
    workStatus: 'open' | 'in_progress' | 'blocked' | 'done' | 'canceled'
    approvalState: 'pending_quote' | 'quote_ready' | 'sent' | 'approved' | 'declined' | 'deferred'
  }>
}

function parseConfirmation(
  value: unknown,
  expected: ExpectedConfirmation,
): { jobId: string; title: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const confirmation = value as Record<string, unknown>
  if (confirmation.clientKey !== expected.clientKey
    || typeof confirmation.jobId !== 'string'
    || !UUID.test(confirmation.jobId)
    || confirmation.title !== expected.title
    || confirmation.laborHours !== expected.laborHours
    || confirmation.priceCents !== expected.priceCents) return null
  return { jobId: confirmation.jobId, title: expected.title }
}

function requestSignature(
  ticketId: string,
  description: string,
  laborHours: number,
  priceCents: number,
): string {
  return JSON.stringify([
    ticketId.toLowerCase(),
    description.trim() || DEFAULT_DIAGNOSTIC_TITLE,
    laborHours,
    priceCents,
  ])
}

function parseConfirmedTicketTruth(
  value: unknown,
  expectedTicketId: string,
  expectedJobId: string,
  expectedJobTitle: string,
): ConfirmedTicketTruth | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const ticket = value as Record<string, unknown>
  if (typeof ticket.id !== 'string'
    || ticket.id.toLowerCase() !== expectedTicketId.toLowerCase()
    || !UUID.test(ticket.id)
    || !Number.isSafeInteger(ticket.ticketNumber)
    || Number(ticket.ticketNumber) < 1
    || typeof ticket.source !== 'string'
    || ticket.status !== 'open'
    || typeof ticket.concern !== 'string'
    || !Array.isArray(ticket.jobs)
    || ticket.jobs.length === 0) return null
  const jobs = ticket.jobs as unknown[]
  const validJobs = jobs.every((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const job = value as Record<string, unknown>
    return typeof job.id === 'string'
      && UUID.test(job.id)
      && typeof job.title === 'string'
      && ['diagnostic', 'repair', 'maintenance'].includes(String(job.kind))
      && Number.isInteger(job.requiredSkillTier)
      && Number(job.requiredSkillTier) >= 1
      && Number(job.requiredSkillTier) <= 3
      && (job.assignedTechId === null || (typeof job.assignedTechId === 'string' && UUID.test(job.assignedTechId)))
      && (job.sessionId === null || (typeof job.sessionId === 'string' && UUID.test(job.sessionId)))
      && ['open', 'in_progress', 'blocked', 'done', 'canceled'].includes(String(job.workStatus))
      && ['pending_quote', 'quote_ready', 'sent', 'approved', 'declined', 'deferred'].includes(String(job.approvalState))
  })
  if (!validJobs) return null
  const createdJob = jobs.find((value) => (
    value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as Record<string, unknown>).id === expectedJobId
  )) as Record<string, unknown> | undefined
  if (!createdJob
    || !UUID.test(expectedJobId)
    || createdJob.title !== expectedJobTitle
    || createdJob.kind !== 'diagnostic'
    || createdJob.requiredSkillTier !== 2) return null
  return ticket as ConfirmedTicketTruth
}

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
  onAdded?: (ticket: ConfirmedTicketTruth) => void
}): React.JSX.Element {
  const router = useRouter()
  const [description, setDescription] = useState('')
  const [hours, setHours] = useState('')
  const [price, setPrice] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRequest = useRef<{ signature: string; clientKey: string } | null>(null)
  const inFlight = useRef(false)
  const latestSignature = useRef('')
  latestSignature.current = requestSignature(
    ticketId,
    description,
    Number(hours),
    Math.round(Number(price) * 100),
  )

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
    if (inFlight.current || !ready) return
    inFlight.current = true
    setBusy(true)
    setError(null)
    const trimmed = description.trim()
    const laborHours = Number(hours)
    const priceCents = Math.round(Number(price) * 100)
    const signature = requestSignature(ticketId, trimmed, laborHours, priceCents)
    const currentRequest = pendingRequest.current?.signature === signature
      ? pendingRequest.current
      : { signature, clientKey: crypto.randomUUID() }
    pendingRequest.current = currentRequest
    try {
      const response = await fetch(`/api/tickets/${ticketId}/quote/diagnostic-time`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          clientKey: currentRequest.clientKey,
          ...(trimmed ? { description: trimmed } : {}),
          laborHours,
          priceCents,
        }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const retryable = payload && typeof payload === 'object'
          && (payload as Record<string, unknown>).retryable === true
        setError(retryable
          ? 'The repair order is busy. Retry with the same details.'
          : 'Could not add diagnostic time. Review the fields and try again.')
        return
      }
      const responseBody = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? payload as Record<string, unknown>
        : null
      const confirmation = response.status === 201 && responseBody
        ? parseConfirmation(responseBody.confirmation, {
            clientKey: currentRequest.clientKey,
            title: trimmed || DEFAULT_DIAGNOSTIC_TITLE,
            laborHours,
            priceCents,
          })
        : null
      const ticket = confirmation && responseBody
        ? parseConfirmedTicketTruth(
            responseBody.ticket,
            ticketId,
            confirmation.jobId,
            confirmation.title,
          )
        : null
      if (!ticket) {
        setError('The save response could not be confirmed. Retry with the same details.')
        return
      }
      pendingRequest.current = null
      if (latestSignature.current === currentRequest.signature) {
        setDescription('')
        setHours('')
        setPrice('')
        setTemplateId('')
      }
      if (onAdded) onAdded(ticket)
      else router.refresh()
    } catch {
      setError('Connection interrupted. Retry with the same details.')
    } finally {
      inFlight.current = false
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
