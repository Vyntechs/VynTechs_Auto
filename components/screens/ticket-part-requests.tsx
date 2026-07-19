'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parsePartRequestResponse, type TicketPartRequestView } from '@/lib/shop-os/part-requests-ui'
import styles from './ticket-part-requests.module.css'

type Props = {
  ticketId: string
  requests: TicketPartRequestView[]
}

export function TicketPartRequests({ ticketId, requests }: Props) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (requests.length === 0) return null

  const waiting = requests.filter((request) => request.status === 'requested')
  const handled = requests.filter((request) => request.status !== 'requested')

  async function resolve(requestId: string, status: 'sourced' | 'dismissed') {
    if (pendingId) return
    setPendingId(requestId)
    setError(null)
    try {
      const response = await fetch(`/api/tickets/${ticketId}/part-requests/${requestId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !parsePartRequestResponse(body)) throw new Error('resolve_failed')
      router.refresh()
    } catch {
      setError('Not saved — check your connection and try again.')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <section className={styles.section} aria-labelledby="parts-requested-heading">
      <h2 id="parts-requested-heading" className={styles.title}>Parts the tech asked for</h2>
      <p className={styles.helper}>Source these in RepairLink / First Call, then mark them.</p>

      {waiting.length > 0 && (
        <ul className={styles.list}>
          {waiting.map((request) => (
            <li key={request.id} className={styles.item}>
              <div className={styles.main}>
                <span className={styles.qty}>{request.quantity}×</span>
                <span className={styles.desc}>{request.description}</span>
              </div>
              {request.preference && <p className={styles.pref}>Wants: {request.preference}</p>}
              <p className={styles.meta}>
                {request.jobTitle}{request.requestedByName ? ` · ${request.requestedByName}` : ''}
              </p>
              <div className={styles.actions}>
                <button type="button" className={styles.got} disabled={pendingId !== null}
                  onClick={() => resolve(request.id, 'sourced')}>
                  {pendingId === request.id ? 'Saving…' : 'Got it'}
                </button>
                <button type="button" className={styles.drop} disabled={pendingId !== null}
                  onClick={() => resolve(request.id, 'dismissed')}>
                  Not needed
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {handled.length > 0 && (
        <ul className={styles.handledList}>
          {handled.map((request) => (
            <li key={request.id} className={styles.handledItem}>
              <span>{request.quantity}× {request.description}</span>
              <span className={styles.handledMark} data-status={request.status}>
                {request.status === 'sourced' ? 'Got it' : 'Not needed'}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  )
}
