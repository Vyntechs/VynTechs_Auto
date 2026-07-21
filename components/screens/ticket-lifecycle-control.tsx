'use client'

import { useRef, useState } from 'react'
import styles from './ticket-detail.module.css'

type TicketLifecycleView = {
  id: string
  status: 'open' | 'closed' | 'canceled'
  jobs: Array<{
    id: string
    workStatus: 'open' | 'in_progress' | 'blocked' | 'done' | 'canceled'
  }>
}

function parseTicket(value: unknown): TicketLifecycleView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const ticket = value as Record<string, unknown>
  if (typeof ticket.id !== 'string'
    || !['open', 'closed', 'canceled'].includes(String(ticket.status))
    || !Array.isArray(ticket.jobs)
    || !ticket.jobs.every((job) => (
      job && typeof job === 'object' && !Array.isArray(job)
      && typeof (job as Record<string, unknown>).id === 'string'
      && ['open', 'in_progress', 'blocked', 'done', 'canceled'].includes(String((job as Record<string, unknown>).workStatus))
    ))) return null
  return ticket as TicketLifecycleView
}

export function TicketLifecycleControl({
  ticketId,
  status,
  onApplied,
}: {
  ticketId: string
  status: 'open' | 'closed' | 'canceled'
  onApplied: (ticket: TicketLifecycleView) => void
}): React.JSX.Element | null {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'status' | 'error'; text: string } | null>(null)
  const pendingRequest = useRef<{ fingerprint: string; requestKey: string } | null>(null)

  if (status === 'closed') return null

  async function mutate(action: 'cancel' | 'reopen'): Promise<void> {
    const normalizedReason = reason.trim()
    if (action === 'cancel' && (normalizedReason.length < 1 || normalizedReason.length > 500)) {
      setNotice({ kind: 'error', text: 'Say why this repair order is being canceled.' })
      return
    }
    const fingerprint = JSON.stringify([ticketId, action, normalizedReason])
    const requestKey = pendingRequest.current?.fingerprint === fingerprint
      ? pendingRequest.current.requestKey
      : crypto.randomUUID()
    pendingRequest.current = { fingerprint, requestKey }
    setBusy(true)
    setNotice({ kind: 'status', text: action === 'cancel' ? 'Canceling repair order…' : 'Reopening repair order…' })
    try {
      const response = await fetch(`/api/tickets/${ticketId}/lifecycle`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'cancel'
          ? { action, requestKey, reason: normalizedReason }
          : { action, requestKey }),
      })
      const body = await response.json().catch(() => null)
      const ticket = response.ok && body && typeof body === 'object'
        ? parseTicket((body as { ticket?: unknown }).ticket)
        : null
      if (!ticket || ticket.id.toLowerCase() !== ticketId.toLowerCase()) throw new Error('lifecycle_failed')
      pendingRequest.current = null
      setReason('')
      setNotice(null)
      onApplied(ticket)
    } catch {
      setNotice({ kind: 'error', text: 'The repair order was not changed. Check the connection and retry.' })
    } finally {
      setBusy(false)
    }
  }

  if (status === 'canceled') {
    return (
      <section className={styles.lifecycleControl} aria-label="Canceled repair order">
        <p>This repair order is canceled. Its work history is retained.</p>
        <button className={styles.inlineAction} type="button" disabled={busy} onClick={() => void mutate('reopen')}>
          {busy ? 'Reopening…' : 'Reopen repair order'}
        </button>
        {notice && <p className={notice.kind === 'error' ? styles.assignmentError : styles.assignmentNotice}
          role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">{notice.text}</p>}
      </section>
    )
  }

  return (
    <details className={styles.lifecycleControl}>
      <summary>Cancel repair order</summary>
      <form onSubmit={(event) => { event.preventDefault(); void mutate('cancel') }}>
        <p>Active work is stopped, its time and history are retained, and this repair order can be reopened later.</p>
        <label htmlFor="cancellation-reason">Cancellation reason</label>
        <textarea
          id="cancellation-reason"
          value={reason}
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
        />
        <button className={styles.inlineAction} type="submit" disabled={busy || reason.trim().length < 1}>
          {busy ? 'Canceling…' : 'Cancel repair order'}
        </button>
      </form>
      {notice && <p className={notice.kind === 'error' ? styles.assignmentError : styles.assignmentNotice}
        role={notice.kind === 'error' ? 'alert' : 'status'} aria-live="polite">{notice.text}</p>}
    </details>
  )
}
