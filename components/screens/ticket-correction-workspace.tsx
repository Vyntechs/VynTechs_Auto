'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PredictiveIntakeSearch } from '@/components/vt/intake-search'
import {
  encodeTicketCorrectionDraft,
  parseTicketCorrectionDraft,
  prepareTicketCorrectionRequest,
  ticketCorrectionDraftKey,
  type PendingTicketCorrectionRequest,
  type TicketCorrectionFields,
  type TicketCorrectionTarget,
} from '@/lib/shop-os/ticket-correction-draft'
import {
  correctionAnnouncementFor,
  parseTicketCorrectionBaseline,
  parseTicketCorrectionQuoteResponse,
  parseTicketCorrectionSuccess,
  quoteMatchesTicket,
  type TicketCorrectionBaseline,
  type TicketCorrectionOutcome,
  type TicketCorrectionQuoteProjection,
  type TicketCorrectionScope,
} from '@/lib/shop-os/ticket-correction-ui'
import type { TicketDetail } from '@/lib/tickets'
import styles from './ticket-correction-workspace.module.css'

export type TicketCorrectionAppliedProjection = {
  target: TicketCorrectionTarget
  outcome: TicketCorrectionOutcome
  ticket: TicketDetail
  quote: TicketCorrectionQuoteProjection
  invalidatedVersionNumber: number | null
  announcement: string
}

type Phase = 'loading' | 'ready' | 'saving' | 'recovery'

export function TicketCorrectionWorkspace({
  actorId,
  ticket,
  target,
  onApplied,
  onClose,
}: {
  actorId: string
  ticket: TicketDetail
  target: TicketCorrectionTarget
  onApplied: (result: TicketCorrectionAppliedProjection) => void
  onClose: () => void
}): React.JSX.Element {
  const [baseline, setBaseline] = useState<TicketCorrectionBaseline | null>(null)
  const [fields, setFields] = useState<TicketCorrectionFields | null>(null)
  const [pending, setPending] = useState<PendingTicketCorrectionRequest | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [currentValue, setCurrentValue] = useState<string | null>(null)
  const [retryAllowed, setRetryAllowed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const retryRef = useRef<HTMLButtonElement>(null)
  const scope = { actorId, ticketId: ticket.id, target }
  const storageKey = ticketCorrectionDraftKey(actorId, ticket.id, target)

  useEffect(() => {
    let canceled = false
    setPhase('loading')
    setMessage(null)
    setRetryAllowed(false)
    void loadFreshBaseline(ticket.id, target).then((fresh) => {
      if (canceled) return
      if (!fresh) {
        setPhase('recovery')
        setMessage('Current repair-order truth could not be checked. Try again here; nothing has changed.')
        return
      }
      let restored = null
      try {
        const raw = sessionStorage.getItem(storageKey)
        restored = raw ? parseTicketCorrectionDraft(raw, scope) : null
        if (raw && !restored) sessionStorage.removeItem(storageKey)
      } catch {
        // Storage recovery is optional; fresh server truth still opens safely.
      }
      setBaseline(fresh)
      setFields(restored?.fields ?? fieldsFromBaseline(fresh, target))
      setPending(restored?.pending ?? null)
      setPhase('ready')
    })
    return () => { canceled = true }
  // Target objects are stable for the lifetime of one mounted workspace.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId, loadAttempt, storageKey, ticket.id])

  useEffect(() => {
    if (phase === 'recovery' && retryAllowed) {
      queueMicrotask(() => retryRef.current?.focus())
    }
  }, [phase, retryAllowed])

  const persist = useCallback((nextFields: TicketCorrectionFields, nextPending: PendingTicketCorrectionRequest | null) => {
    try {
      sessionStorage.setItem(storageKey, encodeTicketCorrectionDraft({
        version: 1,
        actorId,
        ticketId: ticket.id,
        target,
        fields: nextFields,
        pending: nextPending,
        savedAt: Date.now(),
      }))
    } catch {
      // A blocked/full session store cannot make the mounted correction unsafe.
    }
  }, [actorId, storageKey, target, ticket.id])

  useEffect(() => {
    if (baseline && fields) persist(fields, pending)
  }, [baseline, fields, pending, persist])

  function updateFields(next: TicketCorrectionFields): void {
    setFields(next)
    setPending(null)
    setMessage(null)
    setCurrentValue(null)
    setRetryAllowed(false)
    setPhase('ready')
  }

  function discardAndClose(): void {
    try { sessionStorage.removeItem(storageKey) } catch { /* no stored recovery to discard */ }
    onClose()
  }

  async function submit(): Promise<void> {
    if (!baseline || !fields || phase === 'saving') return
    const built = buildIntent(baseline, fields, target)
    if (!built.ok) {
      setPhase('recovery')
      setMessage(built.message)
      setRetryAllowed(false)
      return
    }
    const nextPending = prepareTicketCorrectionRequest(built.intent, pending)
    setPending(nextPending)
    persist(fields, nextPending)
    setPhase('saving')
    setMessage(null)
    setRetryAllowed(false)

    let response: Response
    let body: unknown
    try {
      response = await fetch(`/api/tickets/${ticket.id}/corrections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: nextPending.body,
      })
      body = await response.json().catch(() => null)
    } catch {
      recover('The correction could not be confirmed. Retry uses the same saved request.', true)
      return
    }

    if (!response.ok) {
      const error = errorCode(body)
      if (error === 'conflict') {
        const fresh = await loadFreshBaseline(ticket.id, target)
        if (!fresh) {
          recover('Current repair-order truth could not be refreshed. The editor and saved request are still here.', false)
          return
        }
        const refreshed = buildIntent(fresh, fields, target)
        if (!refreshed.ok) {
          setBaseline(fresh)
          recover(refreshed.message, false)
          return
        }
        const rotated = prepareTicketCorrectionRequest(refreshed.intent, nextPending)
        setBaseline(fresh)
        setPending(rotated)
        setCurrentValue(currentFactValue(fresh, target))
        persist(fields, rotated)
        recover('Current repair-order truth changed. Review the current value, then retry.', true)
        return
      }
      recover(refusalMessage(error), false)
      return
    }

    const success = parseTicketCorrectionSuccess(body, {
      ticketId: ticket.id,
      expectedScope: built.scope,
      target,
    })
    if (!success) {
      recover('The correction response could not be verified. Retry uses the same saved request.', true)
      return
    }

    const quote = await loadFreshQuote(ticket.id)
    if (!quote || !quoteMatchesTicket(success.ticket, quote)) {
      recover('The correction may be saved, but current quote truth could not be checked. Retry here before leaving.', true)
      return
    }

    const announcement = correctionAnnouncementFor({
      outcome: success.outcome,
      scope: success.scope,
      ticket: success.ticket,
      targetJobId: target.kind === 'job' ? target.jobId : null,
    })
    try { sessionStorage.removeItem(storageKey) } catch { /* confirmed truth does not depend on cleanup */ }
    onApplied({
      target,
      outcome: success.outcome,
      ticket: success.ticket,
      quote,
      invalidatedVersionNumber: success.invalidatedVersionNumber,
      announcement,
    })
  }

  function recover(nextMessage: string, canRetry: boolean): void {
    setMessage(nextMessage)
    setRetryAllowed(canRetry)
    setPhase('recovery')
  }

  function chooseRemoval(): void {
    if (!baseline || !fields || fields.kind !== 'job') return
    if (baseline.ticket.jobs.filter((job) => job.workStatus !== 'canceled').length <= 1) {
      recover('This is the last active job. Add the replacement job before removing it.', false)
      return
    }
    updateFields({ ...fields, remove: true })
  }

  const label = correctionLabel(target)
  return (
    <section
      className={styles.workspace}
      role="region"
      aria-label={label}
      aria-busy={phase === 'loading' || phase === 'saving' ? true : undefined}
      data-correction-state={phase === 'recovery' ? 'recovery' : undefined}
    >
      {phase === 'loading' ? (
        <p className={styles.state} role="status" aria-live="polite">
          Checking current repair-order truth…
        </p>
      ) : !baseline || !fields ? (
        <div className={styles.recovery}>
          <p role="alert">{message}</p>
          <div className={styles.actions}>
            <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
              Check current truth
            </button>
            <button type="button" onClick={discardAndClose}>Cancel</button>
          </div>
        </div>
      ) : (
        <fieldset className={styles.editor} disabled={phase === 'saving'}>
          <legend>{label}</legend>
          {fields.kind === 'identity' ? (
            <IdentityEditor fields={fields} onChange={updateFields} />
          ) : fields.kind === 'concern' ? (
            <label className={styles.field}>
              <span>Corrected concern</span>
              <textarea
                aria-label="Corrected concern"
                value={fields.concern}
                maxLength={5_000}
                onChange={(event) => updateFields({ ...fields, concern: event.target.value })}
              />
            </label>
          ) : (
            <JobEditor fields={fields} onChange={updateFields} onRemove={chooseRemoval} />
          )}

          {currentValue && (
            <p className={styles.currentValue}>Current repair-order value: {currentValue}</p>
          )}
          {phase === 'saving' && (
            <p className={styles.state} role="status" aria-live="polite">Saving correction…</p>
          )}
          {phase === 'recovery' && message && <p className={styles.error} role="alert">{message}</p>}

          <div className={styles.actions}>
            {fields.kind === 'job' && fields.remove ? (
              <>
                {(phase !== 'recovery' || retryAllowed) && (
                  <button
                    ref={retryAllowed ? retryRef : undefined}
                    type="button"
                    className={styles.primary}
                    onClick={() => void submit()}
                  >
                    {retryAllowed ? 'Retry correction' : 'Confirm removal'}
                  </button>
                )}
                <button type="button" onClick={() => updateFields({ ...fields, remove: false })}>
                  Keep job
                </button>
              </>
            ) : (
              (phase !== 'recovery' || retryAllowed) && (
                <button
                  ref={retryAllowed ? retryRef : undefined}
                  type="button"
                  className={styles.primary}
                  onClick={() => void submit()}
                >
                  {retryAllowed ? 'Retry correction' : 'Save correction'}
                </button>
              )
            )}
            <button type="button" onClick={discardAndClose}>Cancel</button>
          </div>
        </fieldset>
      )}
    </section>
  )
}

function IdentityEditor({
  fields,
  onChange,
}: {
  fields: Extract<TicketCorrectionFields, { kind: 'identity' }>
  onChange: (fields: TicketCorrectionFields) => void
}): React.JSX.Element {
  return (
    <div className={styles.identityEditor}>
      <PredictiveIntakeSearch
        recentCustomers={[]}
        onPickVehicle={(vehicleId) => onChange({ ...fields, mode: 'existing', vehicleId })}
        onCreateNew={(prefill) => onChange({
          ...fields,
          mode: 'new',
          vehicleId: null,
          name: prefill.name ?? '',
          phone: prefill.phone ?? '',
          email: prefill.email ?? '',
          year: prefill.year ? String(prefill.year) : '',
          make: prefill.make ?? '',
          model: '',
          vin: prefill.vin ?? '',
          plate: prefill.plate ?? '',
        })}
      />
      {fields.mode === 'existing' && (
        <div className={styles.selection} role="status">
          <span>Existing vehicle selected.</span>
          <button type="button" onClick={() => onChange({ ...fields, mode: 'search', vehicleId: null })}>
            Change
          </button>
        </div>
      )}
      {fields.mode === 'new' && (
        <div className={styles.formGrid}>
          <TextField label="Customer name" value={fields.name} maximum={200} onChange={(name) => onChange({ ...fields, name })} />
          <TextField label="Phone" value={fields.phone} maximum={100} onChange={(phone) => onChange({ ...fields, phone })} />
          <TextField label="Email" value={fields.email} maximum={320} type="email" onChange={(email) => onChange({ ...fields, email })} />
          <TextField label="Year" value={fields.year} maximum={4} inputMode="numeric" onChange={(year) => onChange({ ...fields, year })} />
          <TextField label="Make" value={fields.make} maximum={100} onChange={(make) => onChange({ ...fields, make })} />
          <TextField label="Model" value={fields.model} maximum={100} onChange={(model) => onChange({ ...fields, model })} />
          <TextField label="Engine" value={fields.engine} maximum={200} onChange={(engine) => onChange({ ...fields, engine })} />
          <TextField label="VIN" value={fields.vin} maximum={17} onChange={(vin) => onChange({ ...fields, vin })} />
          <TextField label="Mileage" value={fields.mileage} maximum={16} inputMode="numeric" onChange={(mileage) => onChange({ ...fields, mileage })} />
          <TextField label="Plate" value={fields.plate} maximum={32} onChange={(plate) => onChange({ ...fields, plate })} />
        </div>
      )}
    </div>
  )
}

function JobEditor({
  fields,
  onChange,
  onRemove,
}: {
  fields: Extract<TicketCorrectionFields, { kind: 'job' }>
  onChange: (fields: TicketCorrectionFields) => void
  onRemove: () => void
}): React.JSX.Element {
  if (fields.remove) {
    return (
      <div className={styles.removeConfirmation}>
        <strong>Remove this job from active work?</strong>
        <p>Its correction receipt and history remain on the repair order.</p>
      </div>
    )
  }
  return (
    <div className={styles.formGrid}>
      <TextField label="Job title" value={fields.title} maximum={200} onChange={(title) => onChange({ ...fields, title })} />
      <label className={styles.field}>
        <span>Job kind</span>
        <select
          value={fields.jobKind}
          onChange={(event) => onChange({
            ...fields,
            jobKind: event.target.value as typeof fields.jobKind,
            customerSuppliedPartsNote: event.target.value === 'diagnostic'
              ? ''
              : fields.customerSuppliedPartsNote,
          })}
        >
          <option value="diagnostic">Diagnostic</option>
          <option value="repair">Repair</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </label>
      {fields.jobKind !== 'diagnostic' && (
        <TextField
          label="Customer-supplied parts note"
          value={fields.customerSuppliedPartsNote}
          maximum={500}
          onChange={(customerSuppliedPartsNote) => onChange({ ...fields, customerSuppliedPartsNote })}
        />
      )}
      <button type="button" className={styles.removeAction} onClick={onRemove}>
        Remove from active work
      </button>
    </div>
  )
}

function TextField({
  label,
  value,
  maximum,
  type = 'text',
  inputMode,
  onChange,
}: {
  label: string
  value: string
  maximum: number
  type?: 'text' | 'email'
  inputMode?: 'numeric'
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      <input
        aria-label={label}
        type={type}
        inputMode={inputMode}
        value={value}
        maxLength={maximum}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

async function loadFreshBaseline(
  ticketId: string,
  target: TicketCorrectionTarget,
): Promise<TicketCorrectionBaseline | null> {
  try {
    const [ticketResponse, quoteResponse] = await Promise.all([
      fetch(`/api/tickets/${ticketId}`, { cache: 'no-store' }),
      fetch(`/api/tickets/${ticketId}/quote`, { cache: 'no-store' }),
    ])
    const [ticketBody, quoteBody] = await Promise.all([
      ticketResponse.json().catch(() => null),
      quoteResponse.json().catch(() => null),
    ])
    if (!ticketResponse.ok || !quoteResponse.ok) return null
    const rawTicket = property(ticketBody, 'ticket')
    const rawQuote = property(quoteBody, 'builder')
    if (rawTicket === undefined || rawQuote === undefined) return null
    return parseTicketCorrectionBaseline(
      { ticket: rawTicket, quote: rawQuote },
      { ticketId, target },
    )
  } catch {
    return null
  }
}

async function loadFreshQuote(ticketId: string): Promise<TicketCorrectionQuoteProjection | null> {
  try {
    const response = await fetch(`/api/tickets/${ticketId}/quote`, { cache: 'no-store' })
    const body = await response.json().catch(() => null)
    return response.ok ? parseTicketCorrectionQuoteResponse(body, ticketId) : null
  } catch {
    return null
  }
}

function fieldsFromBaseline(
  baseline: TicketCorrectionBaseline,
  target: TicketCorrectionTarget,
): TicketCorrectionFields {
  if (target.kind === 'identity') {
    return {
      kind: 'identity', mode: 'search', vehicleId: null,
      name: '', phone: '', email: '', year: '', make: '', model: '', engine: '',
      vin: '', mileage: '', plate: '',
    }
  }
  if (target.kind === 'concern') return { kind: 'concern', concern: baseline.ticket.concern }
  const job = baseline.ticket.jobs.find((candidate) => candidate.id === target.jobId)
  if (!job) throw new Error('validated correction target is missing')
  return {
    kind: 'job',
    title: job.title,
    jobKind: job.kind as 'diagnostic' | 'repair' | 'maintenance',
    customerSuppliedPartsNote: job.customerSuppliedPartsNote ?? '',
    remove: false,
  }
}

function buildIntent(
  baseline: TicketCorrectionBaseline,
  fields: TicketCorrectionFields,
  target: TicketCorrectionTarget,
): { ok: true; intent: Record<string, unknown>; scope: TicketCorrectionScope }
  | { ok: false; message: string } {
  const common = {
    expectedTicketUpdatedAt: baseline.ticket.updatedAt.toISOString(),
    expectedActiveVersionId: baseline.quote.activeVersion?.id ?? null,
  }
  if (fields.kind === 'concern' && target.kind === 'concern') {
    const concern = fields.concern.trim()
    return concern
      ? { ok: true, intent: { action: 'concern', ...common, concern }, scope: 'concern' }
      : { ok: false, message: 'Enter the concern that belongs on this repair order.' }
  }
  if (fields.kind === 'identity' && target.kind === 'identity') {
    if (fields.mode === 'existing' && fields.vehicleId) {
      return {
        ok: true,
        intent: { action: 'identity', ...common, selection: { mode: 'existing', vehicleId: fields.vehicleId } },
        scope: 'identity',
      }
    }
    const year = Number(fields.year)
    const mileage = fields.mileage.trim() === '' ? null : Number(fields.mileage)
    if (fields.mode !== 'new' || !fields.name.trim() || !fields.phone.trim()
      || !Number.isInteger(year) || !fields.make.trim() || !fields.model.trim()
      || (mileage !== null && (!Number.isInteger(mileage) || mileage < 0))
      || (fields.vin.trim() !== '' && fields.vin.trim().length !== 17)) {
      return { ok: false, message: 'Choose an existing vehicle or enter the customer and vehicle facts you can verify.' }
    }
    return {
      ok: true,
      intent: {
        action: 'identity', ...common,
        selection: {
          mode: 'new',
          customer: {
            name: fields.name.trim(), phone: fields.phone.trim(),
            email: fields.email.trim() || null,
          },
          vehicle: {
            year, make: fields.make.trim(), model: fields.model.trim(),
            engine: fields.engine.trim() || null,
            vin: fields.vin.trim() || null,
            mileage,
            plate: fields.plate.trim() || null,
          },
        },
      },
      scope: 'identity',
    }
  }
  if (fields.kind === 'job' && target.kind === 'job') {
    const job = baseline.ticket.jobs.find((candidate) => candidate.id === target.jobId)
    if (!job) return { ok: false, message: 'This job is no longer on the repair order. Close this editor and use current work.' }
    const jobCommon = { ...common, jobId: job.id, expectedJobUpdatedAt: job.updatedAt.toISOString() }
    if (fields.remove) {
      if (baseline.ticket.jobs.filter((candidate) => candidate.workStatus !== 'canceled').length <= 1) {
        return { ok: false, message: 'This is the last active job. Add the replacement job before removing it.' }
      }
      return { ok: true, intent: { action: 'remove_job', ...jobCommon }, scope: 'job_removed' }
    }
    const title = fields.title.trim()
    if (!title) return { ok: false, message: 'Enter the job title that belongs on this repair order.' }
    return {
      ok: true,
      intent: {
        action: 'job', ...jobCommon, title, kind: fields.jobKind,
        customerSuppliedPartsNote: fields.jobKind === 'diagnostic'
          ? null
          : fields.customerSuppliedPartsNote.trim() || null,
      },
      scope: 'job',
    }
  }
  return { ok: false, message: 'This saved correction does not match the fact being edited. Discard it and start here again.' }
}

function currentFactValue(baseline: TicketCorrectionBaseline, target: TicketCorrectionTarget): string {
  if (target.kind === 'concern') return baseline.ticket.concern
  if (target.kind === 'identity') {
    const customer = baseline.ticket.customer?.name ?? 'No customer'
    const vehicle = baseline.ticket.vehicle
      ? `${baseline.ticket.vehicle.year} ${baseline.ticket.vehicle.make} ${baseline.ticket.vehicle.model}`
      : 'No vehicle'
    return `${customer} · ${vehicle}`
  }
  return baseline.ticket.jobs.find((job) => job.id === target.jobId)?.title ?? 'Job no longer active'
}

function correctionLabel(target: TicketCorrectionTarget): string {
  if (target.kind === 'identity') return 'Correct customer or vehicle'
  if (target.kind === 'concern') return 'Correct concern'
  return 'Correct job'
}

function refusalMessage(error: string | null): string {
  switch (error) {
    case 'forbidden': return 'Your correction access changed. Ask an advisor or owner to make this correction.'
    case 'job_not_open': return 'Work has already started. Finish or cancel the started work before correcting this fact.'
    case 'ticket_not_open': return 'This repair order is no longer open. Reopen the repair order before correcting its facts.'
    case 'last_job': return 'This is the last active job. Add the replacement job before removing it.'
    case 'not_found': return 'This repair order or job is no longer available. Close this editor and use current work.'
    case 'invalid_input': return 'One corrected value is not valid. Check the marked facts and save again.'
    case 'unavailable': return 'Corrections are not available here. The repair order and saved draft are unchanged.'
    default: return 'The correction was refused. Check current repair-order truth before trying again.'
  }
}

function errorCode(value: unknown): string | null {
  const error = property(value, 'error')
  return typeof error === 'string' ? error : null
}

function property(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && !Array.isArray(value) && key in value
    ? (value as Record<string, unknown>)[key]
    : undefined
}
