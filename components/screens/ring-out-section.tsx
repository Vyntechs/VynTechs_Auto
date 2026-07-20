'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatMoneyCents, parseMoneyToCents } from '@/lib/shop-os/quote-builder-ui'
import type { TicketPaymentMethod, TicketRingOut } from '@/lib/shop-os/ring-out'
import styles from './ring-out-section.module.css'

const METHOD_LABELS: Record<TicketPaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  check: 'Check',
  other: 'Other',
}

const METHOD_ORDER: TicketPaymentMethod[] = ['cash', 'card', 'check', 'other']

function balanceDollars(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function humanizeError(error: unknown): string {
  switch (error) {
    case 'overpayment':
      return 'That’s more than the balance owed. Enter the balance or less.'
    case 'balance_outstanding':
      return 'There’s still a balance to collect before this can close.'
    case 'unfinished_work':
      return 'Finish or cancel every work item before closing this repair order.'
    case 'ticket_not_open':
      return 'This ticket is already closed.'
    case 'forbidden':
    case 'no_shop':
    case 'inactive_profile':
      return 'You don’t have permission to do that.'
    case 'not_found':
      return 'This ticket couldn’t be found.'
    default:
      return 'Couldn’t save that. Try again.'
  }
}

export function RingOutSection({
  ticketId,
  initialRingOut,
}: {
  ticketId: string
  initialRingOut: TicketRingOut
}): React.JSX.Element | null {
  const router = useRouter()
  const [ringOut, setRingOut] = useState(initialRingOut)
  const [amount, setAmount] = useState(() => balanceDollars(initialRingOut.balanceCents))
  const [method, setMethod] = useState<TicketPaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingPayment = useRef<{ fingerprint: string; requestKey: string } | null>(null)

  const { owed, payments } = ringOut
  const isClosed = ringOut.status !== 'open'
  const relevant = owed.totalCents > 0 || payments.length > 0 || isClosed
  if (!relevant) return null

  async function submitPayment(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    let amountCents: number
    try {
      amountCents = parseMoneyToCents(amount.trim().replace(/[$,]/g, ''))
    } catch {
      setError('Enter a dollar amount like 140 or 140.00.')
      return
    }
    if (amountCents < 1) {
      setError('Enter an amount greater than zero.')
      return
    }
    const normalizedNote = note.trim() ? note.trim() : null
    const fingerprint = JSON.stringify([ticketId, amountCents, method, normalizedNote])
    const requestKey = pendingPayment.current?.fingerprint === fingerprint
      ? pendingPayment.current.requestKey
      : crypto.randomUUID()
    pendingPayment.current = { fingerprint, requestKey }
    setBusy(true)
    try {
      const res = await fetch(`/api/tickets/${ticketId}/payments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          requestKey,
          amountCents,
          method,
          note: normalizedNote,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ringOut) {
        setError(humanizeError(data?.error))
        return
      }
      const next = data.ringOut as TicketRingOut
      pendingPayment.current = null
      setRingOut(next)
      setNote('')
      setAmount(balanceDollars(next.balanceCents))
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function closeOut() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/tickets/${ticketId}/close`, { method: 'POST' })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ringOut) {
        setError(humanizeError(data?.error))
        return
      }
      setRingOut(data.ringOut as TicketRingOut)
      router.refresh()
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={styles.ringOut} aria-labelledby="ringout-heading">
      <div className={styles.head}>
        <div>
          <p className={styles.eyebrow}>Getting paid</p>
          <h2 id="ringout-heading">{isClosed ? 'Receipt' : 'Ring out'}</h2>
        </div>
        {isClosed && ringOut.closedAt && (
          <span className={styles.closedStamp}>Closed {formatDate(ringOut.closedAt)}</span>
        )}
      </div>

      {owed.jobs.length > 0 ? (
        <dl className={styles.bill}>
          {owed.jobs.map((job) => (
            <div key={job.jobId} className={styles.billRow}>
              <dt>{job.title}</dt>
              <dd>{formatMoneyCents(job.subtotalCents)}</dd>
            </div>
          ))}
          <div className={styles.billRow}>
            <dt>Subtotal</dt>
            <dd>{formatMoneyCents(owed.subtotalCents)}</dd>
          </div>
          <div className={styles.billRow}>
            <dt>Tax</dt>
            <dd>{formatMoneyCents(owed.taxCents)}</dd>
          </div>
          <div className={`${styles.billRow} ${styles.total}`}>
            <dt>Total</dt>
            <dd>{formatMoneyCents(owed.totalCents)}</dd>
          </div>
        </dl>
      ) : (
        <p className={styles.empty}>No approved work to bill on this ticket.</p>
      )}

      {payments.length > 0 && (
        <ul className={styles.payments}>
          {payments.map((payment) => (
            <li key={payment.id} className={styles.payment}>
              <span className={styles.payMethod}>{METHOD_LABELS[payment.method]}</span>
              <span className={styles.payAmount}>{formatMoneyCents(payment.amountCents)}</span>
              {payment.note && <span className={styles.payNote}>{payment.note}</span>}
              <span className={styles.payDate}>{formatDate(payment.recordedAt)}</span>
            </li>
          ))}
        </ul>
      )}

      <dl className={styles.tally}>
        <div>
          <dt>Paid</dt>
          <dd>{formatMoneyCents(ringOut.paidCents)}</dd>
        </div>
        <div className={styles.balance}>
          <dt>Balance</dt>
          <dd>{formatMoneyCents(Math.max(0, ringOut.balanceCents))}</dd>
        </div>
      </dl>

      {ringOut.canRecordPayment && (
        <form onSubmit={submitPayment} className={styles.form}>
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span>Amount</span>
              <input
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                aria-label="Payment amount"
              />
            </label>
            <label className={styles.field}>
              <span>How paid</span>
              <select
                value={method}
                onChange={(event) => setMethod(event.target.value as TicketPaymentMethod)}
                aria-label="How paid"
              >
                {METHOD_ORDER.map((value) => (
                  <option key={value} value={value}>{METHOD_LABELS[value]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className={styles.field}>
            <span>Note (optional)</span>
            <input
              value={note}
              maxLength={500}
              onChange={(event) => setNote(event.target.value)}
              aria-label="Payment note"
            />
          </label>
          <button type="submit" className={styles.recordButton} disabled={busy}>
            {busy ? 'Recording…' : 'Record payment'}
          </button>
        </form>
      )}

      {ringOut.canClose && (
        <button
          type="button"
          onClick={closeOut}
          className={styles.closeButton}
          disabled={busy}
        >
          {busy
            ? 'Closing…'
            : owed.totalCents > 0
              ? 'Mark paid & close ticket'
              : 'Close ticket'}
        </button>
      )}

      {error && <p role="alert" className={styles.error}>{error}</p>}
    </section>
  )
}
