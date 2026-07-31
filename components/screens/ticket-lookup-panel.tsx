'use client'

import Link from 'next/link'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import styles from './ticket-lookup-panel.module.css'

const DEBOUNCE_MS = 150

/**
 * The lookup projection as it arrives over JSON — `openedAt` and `closedAt`
 * are ISO strings on this side of the wire, not Dates.
 */
export type TicketLookupRow = {
  ticketId: string
  ticketNumber: number
  status: 'open' | 'closed' | 'canceled'
  concern: string
  customerName: string | null
  vehicle: { year: number; make: string; model: string } | null
  openedAt: string
  closedAt: string | null
}

type State =
  | { kind: 'idle' }
  | { kind: 'searching'; query: string }
  | { kind: 'matched'; query: string; tickets: TicketLookupRow[] }
  | { kind: 'no-match'; query: string }
  | { kind: 'error'; query: string }

function formatDay(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function TicketLookupPanel() {
  const [value, setValue] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputId = useId()

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (debounceRef.current !== null) clearTimeout(debounceRef.current)
    debounceRef.current = null
  }, [])

  useEffect(() => () => abort(), [abort])

  const fire = useCallback(async (query: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState({ kind: 'searching', query })
    try {
      const res = await fetch('/api/tickets/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ q: query }),
        signal: controller.signal,
      })
      if (controller.signal.aborted) return
      // A refusal is not an absence. Intake's search collapses these two and
      // then invites the advisor to create a customer who already exists; this
      // one says the lookup failed and leaves the shop's records alone.
      if (!res.ok) {
        setState({ kind: 'error', query })
        return
      }
      const body = (await res.json()) as { tickets: TicketLookupRow[] }
      const tickets = Array.isArray(body.tickets) ? body.tickets : []
      setState(tickets.length === 0 ? { kind: 'no-match', query } : { kind: 'matched', query, tickets })
    } catch (err) {
      if ((err as Error).name === 'AbortError') return
      setState({ kind: 'error', query })
    }
  }, [])

  const onChange = useCallback(
    (next: string) => {
      setValue(next)
      if (debounceRef.current !== null) clearTimeout(debounceRef.current)
      if (next.trim() === '') {
        abort()
        setState({ kind: 'idle' })
        return
      }
      debounceRef.current = setTimeout(() => {
        void fire(next)
      }, DEBOUNCE_MS)
    },
    [abort, fire],
  )

  return (
    <section className={styles.panel} aria-label="Repair order lookup">
      <label className={styles.label} htmlFor={inputId}>
        Find a repair order
      </label>
      <input
        id={inputId}
        className={styles.input}
        type="search"
        autoComplete="off"
        placeholder="RO number, customer, plate, VIN or vehicle"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <div aria-live="polite" className={styles.panel}>
        {state.kind === 'searching' && <p className={styles.note}>Searching…</p>}
        {state.kind === 'no-match' && (
          <p className={styles.note}>
            Nothing matches “{state.query}”. Closed and open repair orders are both searched.
          </p>
        )}
        {state.kind === 'error' && (
          <p className={styles.error}>
            Lookup is unavailable right now. The repair order may still exist — try again in a
            moment rather than writing a new one.
          </p>
        )}
        {state.kind === 'matched' && (
          <ul className={styles.list}>
            {state.tickets.map((hit) => (
              <li key={hit.ticketId}>
                <Link className={styles.hit} href={`/tickets/${hit.ticketId}`}>
                  <span className={styles.hitHead}>
                    <span className={styles.number}>RO {hit.ticketNumber}</span>
                    <span className={styles.status} data-status={hit.status}>
                      {hit.status === 'open'
                        ? 'Open'
                        : hit.status === 'canceled'
                          ? 'Canceled'
                          : `Closed ${formatDay(hit.closedAt ?? hit.openedAt)}`}
                    </span>
                    <span className={styles.who}>{hit.customerName ?? 'No customer on file'}</span>
                  </span>
                  {hit.vehicle && (
                    <p className={styles.vehicle}>
                      {hit.vehicle.year} {hit.vehicle.make} {hit.vehicle.model}
                    </p>
                  )}
                  <p className={styles.concern}>{hit.concern}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
