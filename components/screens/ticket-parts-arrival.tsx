'use client'

import { useRef, useState } from 'react'
import { LocalizedTimestamp } from '@/components/vt/localized-timestamp'
import {
  parsePartsArrivalMutationResponse,
  parsePartsArrivalReadResponse,
  type PartsArrivalJobView,
} from '@/lib/shop-os/parts-arrival-ui'
import styles from './ticket-parts-arrival.module.css'

type Props = {
  ticketId: string
  initialJob: PartsArrivalJobView
}

function reached(
  state: PartsArrivalJobView['lines'][number]['state'],
  action: NonNullable<PartsArrivalJobView['lines'][number]['nextAction']>,
): boolean {
  return action === 'mark_ordered' ? state === 'ordered' || state === 'received' : state === 'received'
}

function nextLabel(action: NonNullable<PartsArrivalJobView['lines'][number]['nextAction']>): string {
  return action === 'mark_ordered' ? 'Mark ordered' : 'Mark received'
}

function stateRank(state: PartsArrivalJobView['lines'][number]['state']): number {
  return state === 'needs_order' ? 0 : state === 'ordered' ? 1 : 2
}

export function TicketPartsArrival({ ticketId, initialJob }: Props): React.JSX.Element {
  const [job, setJob] = useState(initialJob)
  const [pendingLineId, setPendingLineId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const lineRefs = useRef(new Map<string, HTMLLIElement>())
  const actionRefs = useRef(new Map<string, HTMLButtonElement>())

  function install(candidate: PartsArrivalJobView): boolean {
    if (candidate.jobId !== job.jobId
      || candidate.approvedQuoteVersionId !== job.approvedQuoteVersionId) return false
    setJob(candidate)
    return true
  }

  function focusLine(lineId: string) {
    setTimeout(() => {
      window.requestAnimationFrame(() => {
        const action = actionRefs.current.get(lineId)
        const target = action?.isConnected ? action : lineRefs.current.get(lineId)
        target?.focus()
      })
    }, 0)
  }

  async function reconcile(lineId: string, action: NonNullable<PartsArrivalJobView['lines'][number]['nextAction']>) {
    try {
      const response = await fetch(`/api/tickets/${ticketId}/jobs/${job.jobId}/parts-arrival`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        cache: 'no-store',
      })
      const body = await response.json().catch(() => null)
      const current = response.ok ? parsePartsArrivalReadResponse(body) : null
      const currentLine = current?.lines.find((line) => line.id === lineId)
      if (current && currentLine && install(current)) {
        focusLine(lineId)
        return reached(currentLine.state, action)
      }
    } catch {
      // The visible error below is the honest end state after both attempts fail.
    }
    return false
  }

  async function advance(lineId: string, action: NonNullable<PartsArrivalJobView['lines'][number]['nextAction']>) {
    if (pendingLineId) return
    const previousLine = job.lines.find((line) => line.id === lineId)
    if (!previousLine || previousLine.nextAction !== action) return
    setPendingLineId(lineId)
    setError(null)
    try {
      const response = await fetch(`/api/tickets/${ticketId}/jobs/${job.jobId}/parts-arrival/${lineId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = await response.json().catch(() => null)
      const parsed = response.ok ? parsePartsArrivalMutationResponse(body) : null
      const nextLine = parsed?.job.lines.find((line) => line.id === lineId)
      if (parsed && nextLine
        && stateRank(nextLine.state) >= stateRank(previousLine.state)
        && install(parsed.job)) {
        focusLine(lineId)
        return
      }
      if (await reconcile(lineId, action)) return
      setError('Not saved — the repair order is still showing its last confirmed parts state.')
    } catch {
      if (!await reconcile(lineId, action)) {
        setError('Not saved — check the connection and try again.')
      }
    } finally {
      setPendingLineId(null)
    }
  }

  const headingId = `parts-arrival-${job.jobId}`
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>Approved parts</p>
          <h4 id={headingId}>Parts arrival</h4>
        </div>
        <span className={styles.summary} data-all-here={job.allHere || undefined}>
          {job.allHere ? 'All parts here' : `${job.receivedCount} of ${job.totalCount} received`}
        </span>
      </div>
      <p className={styles.helper}>
        {job.readOnly
          ? 'Read-only for technicians'
          : 'Record what the shop ordered and what physically arrived.'}
      </p>
      {job.allHere && (
        <p className={styles.holdTruth}>Work stays on hold until someone resumes it.</p>
      )}
      <ol className={styles.lines}>
        {job.lines.map((line) => (
          <li
            key={line.id}
            ref={(element) => {
              if (element) lineRefs.current.set(line.id, element)
              else lineRefs.current.delete(line.id)
            }}
            className={styles.line}
            tabIndex={-1}
          >
            <div className={styles.lineHeading}>
              <div>
                <p className={styles.description}>{line.description}</p>
                <p className={styles.identity}>
                  {line.quantity}×
                  {line.brand ? ` · ${line.brand}` : ''}
                  {line.partNumber ? ` · ${line.partNumber}` : ''}
                </p>
              </div>
              <span className={styles.current}>{line.state.replace('_', ' ')}</span>
            </div>
            <div className={styles.rail} aria-label={`${line.description} arrival status`}>
              {(['needs_order', 'ordered', 'received'] as const).map((stop) => (
                <span
                  key={stop}
                  className={styles.stop}
                  data-state={stateRank(stop) < stateRank(line.state)
                    ? 'complete'
                    : stop === line.state ? 'current' : 'next'}
                >
                  <i aria-hidden="true" />
                  {stop === 'needs_order' ? 'Needs order' : stop === 'ordered' ? 'Ordered' : 'Received'}
                </span>
              ))}
            </div>
            {(line.ordered || line.received) && (
              <div className={styles.receipts}>
                {line.ordered && (
                  <p>Ordered{line.ordered.actorName ? ` by ${line.ordered.actorName}` : ''} · <LocalizedTimestamp value={line.ordered.at} kind="dateTime" /></p>
                )}
                {line.received && (
                  <p>Received{line.received.actorName ? ` by ${line.received.actorName}` : ''} · <LocalizedTimestamp value={line.received.at} kind="dateTime" /></p>
                )}
              </div>
            )}
            {line.nextAction && (
              <button
                ref={(element) => {
                  if (element) actionRefs.current.set(line.id, element)
                  else actionRefs.current.delete(line.id)
                }}
                type="button"
                className={styles.action}
                disabled={pendingLineId !== null}
                aria-label={pendingLineId === line.id
                  ? `Saving ${line.description}`
                  : `Mark ${line.description} ${line.nextAction === 'mark_ordered' ? 'ordered' : 'received'}`}
                onClick={() => advance(line.id, line.nextAction!)}
              >
                {pendingLineId === line.id ? 'Saving…' : nextLabel(line.nextAction)}
              </button>
            )}
          </li>
        ))}
      </ol>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  )
}
