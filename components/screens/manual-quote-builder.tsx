'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  buildManualLineInput,
  classifyQuoteFailure,
  formatMoneyCents,
  getQuotePreparationState,
  parseQuoteBuilderProjection,
  parsePreparedVersionResponse,
  summarizeQuoteMoney,
  type ManualLineFormValues,
  type ManualLineKind,
} from '@/lib/shop-os/quote-builder-ui'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'
import type { TicketDetail } from '@/lib/tickets'
import styles from './manual-quote-builder.module.css'

type QuoteBuilder = Extract<QuoteBuilderResult, { ok: true }>['builder']

export function ManualQuoteBuilder({
  ticket,
  builder,
}: {
  ticket: TicketDetail
  builder: QuoteBuilder
}): React.JSX.Element {
  const router = useRouter()
  const [current, setCurrent] = useState(builder)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [modal, setModal] = useState<ModalState | null>(null)
  const [error, setError] = useState<{ message: string; refresh: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [focusTarget, setFocusTarget] = useState<string | null>(null)
  const focusRefs = useRef(new Map<string, HTMLElement>())
  const inFlightRef = useRef(false)
  const editorFirstInputRef = useRef<HTMLInputElement>(null)
  const quotePath = `/tickets/${ticket.id}/quote`

  useEffect(() => setCurrent(builder), [builder])
  useEffect(() => {
    if (!focusTarget) return
    const element = focusRefs.current.get(focusTarget)
    if (element) {
      element.focus()
      setFocusTarget(null)
    }
  }, [current, focusTarget])

  const lines = current.jobs.flatMap((job) => job.lines)
  const totals = summarizeQuoteMoney(lines, current.configuration.taxRateBps)
  const preparation = getQuotePreparationState({
    builder: current,
    totals,
    editorOpen: editor !== null,
    modalOpen: modal !== null,
    busy,
  })

  function beginOperation(): boolean {
    if (inFlightRef.current) return false
    inFlightRef.current = true
    setBusy(true)
    return true
  }

  function endOperation(): void {
    inFlightRef.current = false
    setBusy(false)
  }

  function requestEditor(target: EditorTarget, invoker: HTMLElement): void {
    if (inFlightRef.current || modal) return
    if (editor?.dirty) {
      setModal({ kind: 'discard', target, invoker })
      return
    }
    setError(null)
    setEditor(createEditor(target))
  }

  function createEditor(target: EditorTarget): EditorState {
    const line = target.line
    return {
      ...target,
      dirty: false,
      hoursChanged: false,
      clientKey: target.mode === 'create' ? crypto.randomUUID() : null,
      values: line ? valuesFromLine(line) : emptyValues(),
    }
  }

  function updateValue<K extends keyof ManualLineFormValues>(
    key: K,
    value: ManualLineFormValues[K],
  ): void {
    setEditor((active) => active ? {
      ...active,
      dirty: true,
      hoursChanged: active.hoursChanged || key === 'hours',
      clientKey: active.mode === 'create' ? crypto.randomUUID() : active.clientKey,
      values: { ...active.values, [key]: value },
    } : null)
  }

  async function readJson(response: Response): Promise<unknown> {
    try { return await response.json() } catch { return {} }
  }

  function applyFailure(status: number, body: unknown): void {
    const action = classifyQuoteFailure(status, body, quotePath)
    if (action.kind === 'navigate') {
      if (status === 404) router.replace(action.href)
      else router.push(action.href)
      return
    }
    setError({ message: action.message, refresh: action.refresh })
  }

  async function refreshQuote(
    nextFocus?: string,
    closeEditor = false,
    nested = false,
    expectedVersion?: { id: string; versionNumber: number },
  ): Promise<boolean> {
    const ownsOperation = !nested
    if (ownsOperation && !beginOperation()) return false
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/quote`, {
        method: 'GET', headers: { accept: 'application/json' },
      })
      const body = await readJson(response)
      if (!response.ok) {
        applyFailure(response.status, body)
        return false
      }
      const refreshed = body && typeof body === 'object' && 'builder' in body
        ? parseQuoteBuilderProjection((body as { builder: unknown }).builder)
        : null
      if (!refreshed || refreshed.ticket.id !== ticket.id.toLowerCase()) {
        setError({ message: 'Review the visible fields, then refresh and retry.', refresh: true })
        return false
      }
      if (expectedVersion && (
        refreshed.activeVersion?.id !== expectedVersion.id
        || refreshed.activeVersion.versionNumber !== expectedVersion.versionNumber
      )) {
        setError({ message: 'Review the visible fields, then refresh and retry.', refresh: true })
        return false
      }
      setCurrent(refreshed)
      setError(null)
      const editorLineStillExists = editor?.mode !== 'edit' || refreshed.jobs.some((job) =>
        job.id === editor.jobId && job.lines.some((line) => line.id === editor.line?.id))
      if (closeEditor || !editorLineStillExists) setEditor(null)
      if (nextFocus) setFocusTarget(nextFocus)
      return true
    } catch {
      setError({ message: 'Connection interrupted. Retry with the same details.', refresh: false })
      return false
    } finally {
      if (ownsOperation) endOperation()
    }
  }

  async function submitEditor(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!editor || inFlightRef.current) return
    let line: Record<string, unknown>
    try {
      const laborRate = editor.mode === 'edit' && editor.line?.kind === 'labor'
        ? editor.line.laborRateCents
        : current.configuration.laborRateCents
      line = buildManualLineInput(
        editor.kind,
        editor.values,
        laborRate,
      )
      if (editor.mode === 'edit' && editor.line) line.sort = editor.line.sort
      if (
        editor.mode === 'edit'
        && editor.line?.kind === 'labor'
        && !editor.hoursChanged
      ) {
        line.priceCents = editor.line.priceCents
      }
      if (editor.mode === 'edit' && editor.line?.kind === 'part') {
        line.coreChargeCents = editor.line.coreChargeCents
      }
    } catch {
      setError({ message: 'Review the visible fields, then refresh and retry.', refresh: false })
      return
    }

    const base = `/api/tickets/${ticket.id}/quote/jobs/${editor.jobId}/lines`
    const url = editor.mode === 'create' ? base : `${base}/${editor.line?.id}`
    const body = editor.mode === 'create'
      ? { clientKey: editor.clientKey, line }
      : line
    if (!beginOperation()) return
    setError(null)
    try {
      const response = await fetch(url, {
        method: editor.mode === 'create' ? 'POST' : 'PUT',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      })
      const result = await readJson(response)
      if (!response.ok) {
        applyFailure(response.status, result)
        return
      }
      const returnedLine = result && typeof result === 'object' && 'line' in result
        ? (result as { line?: { id?: unknown } }).line
        : null
      const lineId = typeof returnedLine?.id === 'string'
        ? returnedLine.id
        : editor.line?.id
      await refreshQuote(lineId ? `line:${lineId}` : `add:${editor.jobId}:part`, true, true)
    } catch {
      setError({ message: 'Connection interrupted. Retry with the same details.', refresh: false })
    } finally {
      endOperation()
    }
  }

  async function confirmRemove(): Promise<void> {
    if (modal?.kind !== 'remove' || !beginOperation()) return
    const removeTarget = modal.target
    setError(null)
    try {
      const response = await fetch(
        `/api/tickets/${ticket.id}/quote/jobs/${removeTarget.jobId}/lines/${removeTarget.line.id}`,
        { method: 'DELETE', headers: { accept: 'application/json' } },
      )
      const body = await readJson(response)
      if (!response.ok) {
        closeModal()
        applyFailure(response.status, body)
        return
      }
      const jobId = removeTarget.jobId
      setModal(null)
      if (editor?.mode === 'edit' && editor.line?.id === removeTarget.line.id) setEditor(null)
      await refreshQuote(`add:${jobId}:part`, false, true)
    } catch {
      closeModal()
      setError({ message: 'Connection interrupted. Retry with the same details.', refresh: false })
    } finally {
      endOperation()
    }
  }

  async function prepareQuote(): Promise<void> {
    if (preparation.kind !== 'ready' || !beginOperation()) return
    setError(null)
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/quote/versions`, {
        method: 'POST',
        headers: { accept: 'application/json' },
      })
      const body = await readJson(response)
      if (!response.ok) {
        applyFailure(response.status, body)
        return
      }
      const prepared = parsePreparedVersionResponse(response.status, body)
      if (!prepared) {
        setError({ message: 'Review the visible fields, then refresh and retry.', refresh: true })
        return
      }
      await refreshQuote('prepared', false, true, prepared.version)
    } catch {
      setError({ message: 'Connection interrupted. Retry with the same details.', refresh: false })
    } finally {
      endOperation()
    }
  }

  function closeModal(restore: 'invoker' | 'editor' = 'invoker'): void {
    const invoker = modal?.invoker
    setModal(null)
    setTimeout(() => {
      if (restore === 'editor') editorFirstInputRef.current?.focus()
      else invoker?.focus()
    }, 0)
  }

  return (
    <main className={`app ${styles.screen}`}>
      <div data-testid="quote-background" inert={modal ? true : undefined}>
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>
            Repair order {String(ticket.ticketNumber).padStart(6, '0')}
          </p>
          <h1>Build quote</h1>
          {ticket.customer && ticket.vehicle && (
            <p className={styles.identity}>
              <span>{ticket.customer.name}</span>
              <span>{vehicleName(ticket.vehicle)}</span>
            </p>
          )}
        </div>
        <Link href={`/tickets/${ticket.id}`}>Back to ticket</Link>
      </div>

      <section className={styles.truth} aria-label="Quote readiness">
        <p>
          {current.ticket.reconciled
            ? 'Customer and vehicle · Ready'
            : 'Customer and vehicle · Still needed'}
        </p>
        <p>
          Labor rate · {current.configuration.laborRateCents === null
            ? 'Not configured'
            : `${formatMoneyCents(current.configuration.laborRateCents)}/hr`}
        </p>
        <p>
          Tax rate · {current.configuration.taxRateBps === null
            ? 'Not configured'
            : formatTaxRate(current.configuration.taxRateBps)}
        </p>
      </section>

      {!current.ticket.reconciled && (
        <p className={styles.notice}>
          Draft quote lines now. Prepare stays blocked until customer and vehicle are added.
        </p>
      )}

      <div className={styles.workspace}>
        <section className={styles.ledger} aria-labelledby="quote-jobs-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Persisted work</p>
              <h2 id="quote-jobs-heading">Quote ledger</h2>
            </div>
            <p>{current.jobs.length} {current.jobs.length === 1 ? 'job' : 'jobs'}</p>
          </div>

          {current.jobs.length === 0 ? (
            <p className={styles.empty}>No eligible jobs on this ticket.</p>
          ) : (
            <ol className={styles.jobs}>
              {current.jobs.map((job, index) => (
                <li key={job.id} className={styles.job}>
                  <div className={styles.jobNumber} aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </div>
                  <div className={styles.jobBody}>
                    <div className={styles.jobHeader}>
                      <div>
                        <p className={styles.eyebrow}>{job.kind} · {formatStatus(job.workStatus)}</p>
                        <h3>{job.title}</h3>
                      </div>
                      <p>{job.lines.length} {job.lines.length === 1 ? 'line' : 'lines'}</p>
                    </div>

                    {job.lines.length === 0 ? (
                      <p className={styles.empty}>No quote lines yet.</p>
                    ) : (
                      <ul className={styles.lines}>
                        {job.lines.map((line) => (
                          <li
                            key={line.id}
                            className={styles.line}
                            tabIndex={-1}
                            ref={(element) => {
                              if (element) focusRefs.current.set(`line:${line.id}`, element)
                              else focusRefs.current.delete(`line:${line.id}`)
                            }}
                          >
                            <div className={styles.lineLead}>
                              <div>
                                <p className={styles.lineKind}>{lineLabel(line)}</p>
                                <p className={styles.description}>{line.description}</p>
                              </div>
                              <div className={styles.linePrice}>
                                <span>Line price</span>
                                <strong className={styles.money}>{safeMoney(line.priceCents)}</strong>
                              </div>
                            </div>
                            <LineFacts line={line} />
                            <div className={styles.lineControls}>
                              <button
                                type="button"
                                className={styles.lineAction}
                                disabled={busy}
                                onClick={(event) => requestEditor(
                                  { mode: 'edit', jobId: job.id, kind: line.kind, line },
                                  event.currentTarget,
                                )}
                              >
                                Edit {line.description}
                              </button>
                              <button
                                type="button"
                                className={styles.lineAction}
                                disabled={busy}
                                onClick={(event) => {
                                  if (!inFlightRef.current && !modal) {
                                    setModal({
                                      kind: 'remove', target: { jobId: job.id, line },
                                      invoker: event.currentTarget,
                                    })
                                  }
                                }}
                              >
                                Remove {line.description}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className={styles.addActions}>
                      {(['part', 'labor', 'fee'] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          className={styles.lineAction}
                          disabled={busy}
                          ref={(element) => {
                            const key = `add:${job.id}:${kind}`
                            if (element) focusRefs.current.set(key, element)
                            else focusRefs.current.delete(key)
                          }}
                          onClick={(event) => requestEditor(
                            { mode: 'create', jobId: job.id, kind },
                            event.currentTarget,
                          )}
                        >
                          Add {kind}
                        </button>
                      ))}
                    </div>
                    {editor?.jobId === job.id && (
                      <LineEditor
                        editor={editor}
                        laborRateCents={current.configuration.laborRateCents}
                        busy={busy}
                        firstInputRef={editorFirstInputRef}
                        onChange={updateValue}
                        onCancel={() => {
                          if (inFlightRef.current) return
                          setEditor(null)
                          setError(null)
                        }}
                        onSubmit={submitEditor}
                      />
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>

        <aside className={styles.tape} aria-label="Quote totals">
          <p className={styles.eyebrow}>Live quote tape</p>
          <h2>Current draft</h2>
          {!totals.ok ? (
            <div className={styles.blocked}>
              <strong>Totals unavailable</strong>
              <p>Stored quote money could not be totaled safely. Review the quote data.</p>
            </div>
          ) : (
            <dl className={styles.totalList}>
              <div>
                <dt>Subtotal</dt>
                <dd className={styles.money}>{formatMoneyCents(totals.subtotalCents)}</dd>
              </div>
              <div>
                <dt>Taxable subtotal</dt>
                <dd className={styles.money}>{formatMoneyCents(totals.taxableSubtotalCents)}</dd>
              </div>
              {totals.taxConfigured ? (
                <div>
                  <dt>Tax</dt>
                  <dd className={styles.money}>{formatMoneyCents(totals.taxCents)}</dd>
                </div>
              ) : (
                <div className={styles.unavailable}>
                  <dt>Tax — Not configured</dt>
                  <dd>—</dd>
                </div>
              )}
              <div className={styles.grandTotal}>
                <dt>Total</dt>
                <dd className={totals.totalCents === null ? undefined : styles.money}>
                  {totals.totalCents === null
                    ? 'Total unavailable'
                    : formatMoneyCents(totals.totalCents)}
                </dd>
              </div>
            </dl>
          )}
          {!current.activeVersion && <p className={styles.version}>No prepared version</p>}
          {preparation.kind === 'prepared' ? (
            <p
              className={styles.preparedState}
              role="status"
              aria-live="polite"
              tabIndex={-1}
              ref={(element) => {
                if (element) focusRefs.current.set('prepared', element)
                else focusRefs.current.delete('prepared')
              }}
            >
              Prepared version V{preparation.version.versionNumber}
            </p>
          ) : (
            <div className={styles.prepareState}>
              {preparation.kind === 'blocked' && (
                <ul>
                  {preparation.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                </ul>
              )}
              <button
                type="button"
                className={styles.prepareAction}
                disabled={preparation.kind !== 'ready'}
                onClick={prepareQuote}
              >
                {busy ? 'Preparing…' : 'Prepare quote'}
              </button>
            </div>
          )}
        </aside>
      </div>

      {error && (
        <div className={styles.error} aria-live="assertive">
          <p>{error.message}</p>
          {error.refresh && (
            <button type="button" className={styles.lineAction} disabled={busy} onClick={() => refreshQuote()}>
              Refresh quote
            </button>
          )}
        </div>
      )}
      </div>

      {modal && (
        <ConfirmationModal
          modal={modal}
          busy={busy}
          onCancel={() => {
            if (!inFlightRef.current) closeModal()
          }}
          onDiscard={() => {
            if (modal.kind !== 'discard' || inFlightRef.current) return
            setEditor(createEditor(modal.target))
            closeModal('editor')
            setError(null)
          }}
          onRemove={confirmRemove}
        />
      )}
    </main>
  )
}

type BuilderLine = QuoteBuilder['jobs'][number]['lines'][number]

type EditorTarget = {
  mode: 'create' | 'edit'
  jobId: string
  kind: ManualLineKind
  line?: BuilderLine
}

type EditorState = EditorTarget & {
  values: ManualLineFormValues
  dirty: boolean
  hoursChanged: boolean
  clientKey: string | null
}

type ModalState =
  | { kind: 'discard'; target: EditorTarget; invoker: HTMLElement }
  | {
    kind: 'remove'
    target: { jobId: string; line: BuilderLine }
    invoker: HTMLElement
  }

function LineEditor({
  editor,
  laborRateCents,
  busy,
  firstInputRef,
  onChange,
  onCancel,
  onSubmit,
}: {
  editor: EditorState
  laborRateCents: number | null
  busy: boolean
  firstInputRef: React.RefObject<HTMLInputElement | null>
  onChange: <K extends keyof ManualLineFormValues>(key: K, value: ManualLineFormValues[K]) => void
  onCancel: () => void
  onSubmit: (event: React.FormEvent) => void
}): React.JSX.Element {
  const effectiveLaborRate = editor.mode === 'edit' && editor.line?.kind === 'labor'
    ? editor.line.laborRateCents
    : laborRateCents
  let calculated: string | null = null
  if (editor.kind === 'labor' && effectiveLaborRate !== null) {
    try {
      const payload = buildManualLineInput('labor', editor.values, effectiveLaborRate)
      calculated = formatMoneyCents(payload.priceCents as number)
    } catch { calculated = null }
  }
  return (
    <form className={styles.editor} onSubmit={onSubmit}>
      <h4>{editor.mode === 'create' ? 'Add' : 'Edit'} {editor.kind} line</h4>
      <label>
        Description
        <input
          ref={firstInputRef}
          value={editor.values.description}
          maxLength={500}
          autoComplete="off"
          onChange={(event) => onChange('description', event.target.value)}
        />
      </label>
      {editor.kind === 'part' && (
        <>
          <label>Quantity<input inputMode="decimal" autoComplete="off" value={editor.values.quantity} onChange={(event) => onChange('quantity', event.target.value)} /></label>
          <label>Part number<input autoComplete="off" value={editor.values.partNumber} onChange={(event) => onChange('partNumber', event.target.value)} /></label>
          <label>Brand<input autoComplete="off" value={editor.values.brand} onChange={(event) => onChange('brand', event.target.value)} /></label>
          <label>Fitment<input autoComplete="off" value={editor.values.fitment} onChange={(event) => onChange('fitment', event.target.value)} /></label>
        </>
      )}
      {editor.kind === 'labor' && (
        <label>Hours<input inputMode="decimal" autoComplete="off" value={editor.values.hours} onChange={(event) => onChange('hours', event.target.value)} /></label>
      )}
      {(editor.kind !== 'labor' || effectiveLaborRate === null) && (
        <label>Line price<input inputMode="decimal" autoComplete="off" value={editor.values.price} onChange={(event) => onChange('price', event.target.value)} /></label>
      )}
      {editor.kind === 'labor' && effectiveLaborRate !== null && (
        <p className={styles.calculated}>
          {editor.mode === 'edit' && !editor.hoursChanged
            ? `Stored line price · ${safeMoney(editor.line?.priceCents ?? 0)}`
            : `Calculated line price · ${calculated ?? 'Enter valid hours'}`}
        </p>
      )}
      <label className={styles.checkbox}>
        <input type="checkbox" checked={editor.values.taxable} onChange={(event) => onChange('taxable', event.target.checked)} />
        Taxable
      </label>
      <div className={styles.editorActions}>
        <button type="button" className={styles.lineAction} disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className={styles.lineAction} disabled={busy}>{busy ? 'Saving…' : 'Save line'}</button>
      </div>
    </form>
  )
}

function ConfirmationModal({
  modal,
  busy,
  onCancel,
  onDiscard,
  onRemove,
}: {
  modal: ModalState
  busy: boolean
  onCancel: () => void
  onDiscard: () => void
  onRemove: () => void
}): React.JSX.Element {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleId = `quote-confirm-${modal.kind}`
  useEffect(() => cancelRef.current?.focus(), [])
  useEffect(() => {
    if (busy) dialogRef.current?.focus()
  }, [busy])

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      if (busy) return
      event.preventDefault()
      onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const buttons = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    )
    if (buttons.length === 0) {
      event.preventDefault()
      dialogRef.current?.focus()
      return
    }
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const discard = modal.kind === 'discard'
  return (
    <div
      ref={dialogRef}
      className={styles.confirmation}
      role="alertdialog"
      tabIndex={-1}
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
    >
      <strong id={titleId}>
        {discard ? 'Discard unsaved line changes?' : 'Remove this quote line?'}
      </strong>
      {!discard && <p>{modal.target.line.description}</p>}
      <div>
        <button ref={cancelRef} type="button" className={styles.lineAction} disabled={busy} onClick={onCancel}>
          {discard ? 'Keep editing' : 'Keep line'}
        </button>
        <button
          type="button"
          className={styles.lineAction}
          disabled={busy}
          onClick={discard ? onDiscard : onRemove}
        >
          {discard ? 'Discard changes' : 'Confirm remove'}
        </button>
      </div>
    </div>
  )
}

function emptyValues(): ManualLineFormValues {
  return {
    description: '', quantity: '1', hours: '1', price: '', taxable: true,
    partNumber: '', brand: '', fitment: '',
  }
}

function valuesFromLine(line: BuilderLine): ManualLineFormValues {
  return {
    description: line.description,
    quantity: line.quantity,
    hours: line.laborHours ?? '1',
    price: formatMoneyCents(line.priceCents).slice(1).replace(/,/g, ''),
    taxable: line.taxable,
    partNumber: line.partNumber ?? '',
    brand: line.brand ?? '',
    fitment: line.fitment ?? '',
  }
}

function LineFacts({ line }: { line: BuilderLine }): React.JSX.Element | null {
  const facts: string[] = []
  if (line.kind === 'part') {
    if (line.partNumber || line.brand) facts.push([line.partNumber, line.brand].filter(Boolean).join(' · '))
    if (line.fitment) facts.push(`Fitment · ${line.fitment}`)
  }
  if (line.kind === 'labor' && line.laborRateCents !== null) {
    facts.push(`Rate · ${safeMoney(line.laborRateCents)}/hr`)
  }
  if (line.coreChargeCents !== null) {
    facts.push(`Included in line price · ${safeMoney(line.coreChargeCents)}`)
  }
  if (line.taxable) facts.push('Taxable')
  if (facts.length === 0) return null
  return (
    <div className={styles.lineFacts}>
      {facts.map((fact) => <span key={fact}>{fact}</span>)}
    </div>
  )
}

function lineLabel(line: BuilderLine): string {
  if (line.kind === 'part') return `Part · Qty ${line.quantity}`
  if (line.kind === 'labor') return `Labor · ${line.laborHours ?? '—'} hr`
  return 'Fee'
}

function safeMoney(cents: number): string {
  try {
    return formatMoneyCents(cents)
  } catch {
    return 'Unavailable'
  }
}

function formatTaxRate(bps: number): string {
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 10_000) return 'Unavailable'
  const value = BigInt(bps)
  const whole = value / 100n
  const fraction = (value % 100n).toString().padStart(2, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}%` : `${whole}%`
}

function vehicleName(vehicle: NonNullable<TicketDetail['vehicle']>): string {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`
}

function formatStatus(status: string): string {
  return status.replace('_', ' ')
}
