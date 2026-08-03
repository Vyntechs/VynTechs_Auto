'use client'

import { useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { formatMoneyCents } from '@/lib/shop-os/quote-builder-ui'
import {
  parseCustomerApprovalQuote,
  parseCustomerApprovalReceipt,
  selectedApprovalTotal,
  type CustomerApprovalQuote,
  type CustomerApprovalReceipt,
} from '@/lib/shop-os/customer-approval-ui'
import styles from './customer-approval.module.css'

type Choice = 'approved' | 'declined'
type SubmissionCommand = {
  requestKey: string
  decisions: Array<{ jobId: string; decision: Choice }>
  body: string
}

function vehicleLabel(vehicle: CustomerApprovalQuote['vehicle']): string {
  return [vehicle.year, vehicle.make, vehicle.model]
    .filter((value): value is number | string => value !== null && value !== '')
    .join(' ') || 'Vehicle details unavailable'
}

async function readJson(response: Response): Promise<unknown> {
  try { return await response.json() } catch { return null }
}

function unavailable() {
  return (
    <main className={styles.shell}>
      <section className={styles.recovery} aria-labelledby="approval-unavailable">
        <p className={styles.eyebrow}>Repair order</p>
        <h1 id="approval-unavailable">This link is no longer available</h1>
        <p>Contact the shop for the current repair order.</p>
      </section>
    </main>
  )
}

function retryable(retry: () => void) {
  return (
    <main className={styles.shell}>
      <section className={styles.recovery} aria-labelledby="approval-retryable">
        <p className={styles.eyebrow}>Repair order</p>
        <h1 id="approval-retryable">The connection paused</h1>
        <p>Your secure link is still here. Try the same step again.</p>
        <button type="button" onClick={retry}>Try again</button>
      </section>
    </main>
  )
}

export function CustomerApproval(): React.JSX.Element {
  const tokenRef = useRef<string | null>(null)
  const commandRef = useRef<SubmissionCommand | null>(null)
  const receiptRef = useRef<HTMLElement>(null)
  const scrubbedRef = useRef(false)
  const [quote, setQuote] = useState<CustomerApprovalQuote | null>(null)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [receipt, setReceipt] = useState<CustomerApprovalReceipt | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'sending' | 'retryable' | 'submit-retryable' | 'unavailable'>('loading')
  const [message, setMessage] = useState('')
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    if (receipt) receiptRef.current?.focus()
  }, [receipt])

  useEffect(() => {
    const scrubPrivateState = () => {
      scrubbedRef.current = true
      tokenRef.current = null
      commandRef.current = null
      flushSync(() => {
        setQuote(null)
        setChoices({})
        setReceipt(null)
        setMessage('')
        setState('unavailable')
      })
    }
    const scrubRestoredPage = (event: PageTransitionEvent) => {
      if (event.persisted) scrubPrivateState()
    }
    window.addEventListener('pagehide', scrubPrivateState)
    window.addEventListener('pageshow', scrubRestoredPage)
    return () => {
      window.removeEventListener('pagehide', scrubPrivateState)
      window.removeEventListener('pageshow', scrubRestoredPage)
    }
  }, [])

  useEffect(() => {
    let token = tokenRef.current
    if (!token) {
      token = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : ''
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
        setState('unavailable')
        return
      }
      tokenRef.current = token
    }
    let live = true
    void (async () => {
      try {
        const response = await fetch('/api/public/quote-approval', {
          method: 'GET',
          headers: { accept: 'application/json', authorization: `Bearer ${token}` },
        })
        const parsed = parseCustomerApprovalQuote(response.status, await readJson(response))
        if (!live || scrubbedRef.current) return
        if (!parsed) {
          setState(response.status === 429 || response.status === 503 ? 'retryable' : 'unavailable')
          return
        }
        setQuote(parsed)
        setState('ready')
      } catch {
        if (live && !scrubbedRef.current) setState('retryable')
      }
    })()
    return () => { live = false }
  }, [loadAttempt])

  function choose(jobId: string, choice: Choice): void {
    if (state !== 'ready') return
    setChoices((current) => ({ ...current, [jobId]: choice }))
    setMessage('')
  }

  async function submit(): Promise<void> {
    if (!quote || !tokenRef.current || state === 'sending' || scrubbedRef.current) return
    let command = commandRef.current
    if (!command) {
      const remaining = quote.jobs.filter((job) => !choices[job.id]).length
      if (remaining > 0) {
        setMessage(`Choose approve or decline for ${remaining} remaining job${remaining === 1 ? '' : 's'}.`)
        return
      }
      const requestKey = crypto.randomUUID()
      const decisions = quote.jobs.map((job) => ({ jobId: job.id, decision: choices[job.id]! }))
      command = {
        requestKey,
        decisions,
        body: JSON.stringify({ requestKey, decisions }),
      }
      commandRef.current = command
    }
    setState('sending')
    setMessage('')
    try {
      const response = await fetch('/api/public/quote-approval', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          authorization: `Bearer ${tokenRef.current}`,
        },
        body: command.body,
      })
      const parsed = parseCustomerApprovalReceipt(
        response.status,
        await readJson(response),
        quote,
        command.decisions,
      )
      if (scrubbedRef.current) return
      if (!parsed) {
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          commandRef.current = null
          setState('unavailable')
          return
        }
        setState('submit-retryable')
        setMessage('We could not confirm the receipt. Try sending the same decisions again.')
        return
      }
      commandRef.current = null
      tokenRef.current = null
      setReceipt(parsed)
      setState('ready')
    } catch {
      if (scrubbedRef.current) return
      setState('submit-retryable')
      setMessage('Connection interrupted. Try sending the same decisions again.')
    }
  }

  if (state === 'unavailable') return unavailable()
  if (state === 'retryable') return retryable(() => {
    setState('loading')
    setLoadAttempt((attempt) => attempt + 1)
  })
  if (!quote) {
    return (
      <main className={styles.shell}>
        <section className={styles.loading} aria-live="polite">
          <span className={styles.loadingMark} aria-hidden="true" />
          <p>Opening the current repair order…</p>
        </section>
      </main>
    )
  }

  const approvedCents = receipt?.approvedTotalCents ?? selectedApprovalTotal(quote, choices)
  if (receipt) {
    return (
      <main className={styles.shell}>
        <section
          ref={receiptRef}
          className={`${styles.instrument} ${styles.receipt}`}
          aria-labelledby="approval-recorded"
          aria-live="polite"
          tabIndex={-1}
        >
          <header className={styles.header}>
            <p className={styles.eyebrow}>{quote.shop.name} · RO {quote.ticketNumber} · V{receipt.versionNumber}</p>
            <h1 id="approval-recorded">Your decisions are recorded</h1>
            <p>{vehicleLabel(quote.vehicle)}</p>
          </header>
          <div className={styles.receiptTotal}>
            <span>Approved work</span>
            <strong>{formatMoneyCents(approvedCents)} approved</strong>
          </div>
          <ol className={styles.receiptList}>
            {quote.jobs.map((job) => {
              const result = receipt.decisions.find((item) => item.jobId === job.id)?.decision
              return (
                <li key={job.id}>
                  <span>{job.title}</span>
                  <strong>{result === 'approved' ? 'Approved' : result === 'declined' ? 'Declined' : ''}</strong>
                </li>
              )
            })}
          </ol>
          <p className={styles.contact}>The shop now has this response.{quote.shop.phone ? ` Call ${quote.shop.phone} if anything changes.` : ''}</p>
        </section>
      </main>
    )
  }

  return (
    <main className={styles.shell}>
      <section className={styles.instrument} aria-labelledby="approval-title">
        <header className={styles.header}>
          <p className={styles.eyebrow}>{quote.shop.name} · RO {quote.ticketNumber} · V{quote.versionNumber}</p>
          <h1 id="approval-title">Review your repair order</h1>
          <p>
            <span>{quote.customer.name}</span>
            <span aria-hidden="true"> · </span>
            <span>{vehicleLabel(quote.vehicle)}</span>
          </p>
        </header>

        <div className={styles.jobs}>
          {quote.jobs.map((job, index) => {
            const choice = choices[job.id]
            return (
              <article
                key={job.id}
                className={`${styles.job} ${choice ? styles.decided : ''}`}
                aria-label={job.title}
                data-choice={choice ?? 'pending'}
              >
                <div className={styles.jobIndex}>{String(index + 1).padStart(2, '0')}</div>
                <div className={styles.jobBody}>
                  <div className={styles.jobTitle}><h2>{job.title}</h2><strong>{formatMoneyCents(job.subtotalCents)}</strong></div>
                  {job.story && (
                    <div className={styles.story}>
                      <p><strong>You told us</strong><span>{job.story.whatYouToldUs}</span></p>
                      <p><strong>What we found</strong><span>{job.story.whatWeFound}</span></p>
                      {job.story.howWeKnow.map((evidence, evidenceIndex) => (
                        <p key={`${job.id}:evidence:${evidenceIndex}`}>
                          <strong>How we know</strong><span>{evidence.claim}</span>
                        </p>
                      ))}
                      <p><strong>If left as-is</strong><span>{job.story.whatItMeansIfWaived}</span></p>
                      <p><strong>Recommendation</strong><span>{job.story.whatWeRecommend}</span></p>
                    </div>
                  )}
                  <ul className={styles.lines}>{job.lines.map((line, lineIndex) => (
                    <li key={`${job.id}:${lineIndex}`}>
                      <span>{line.kind === 'part' && line.quantity !== '1' ? `Qty ${line.quantity} · ${line.description}` : line.description}</span>
                      <span>{formatMoneyCents(line.priceCents)}</span>
                    </li>
                  ))}</ul>
                  <div className={styles.choices} role="group" aria-label={`Decision for ${job.title}`}>
                    <button
                      type="button"
                      aria-pressed={choice === 'approved'}
                      aria-label={`Approve ${job.title}`}
                      disabled={state !== 'ready'}
                      onClick={() => choose(job.id, 'approved')}
                    >Approve</button>
                    <button
                      type="button"
                      aria-pressed={choice === 'declined'}
                      aria-label={`Decline ${job.title}`}
                      disabled={state !== 'ready'}
                      onClick={() => choose(job.id, 'declined')}
                    >Decline</button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>

        <footer className={styles.review}>
          <div><span>Current selection</span><strong>{formatMoneyCents(approvedCents)} approved</strong></div>
          {message && <p role="alert">{message}</p>}
          <button type="button" onClick={() => void submit()} disabled={state === 'sending'}>
            {state === 'sending' ? 'Recording decisions…'
              : state === 'submit-retryable' ? 'Try sending again'
                : 'Send decisions'}
          </button>
          <small>Total quote {formatMoneyCents(quote.totals.totalCents)} · Taxes update with your choices.</small>
        </footer>
      </section>
    </main>
  )
}
