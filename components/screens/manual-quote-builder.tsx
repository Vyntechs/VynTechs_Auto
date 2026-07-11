import Link from 'next/link'
import {
  formatMoneyCents,
  summarizeQuoteMoney,
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
  const lines = builder.jobs.flatMap((job) => job.lines)
  const totals = summarizeQuoteMoney(lines, builder.configuration.taxRateBps)

  return (
    <main className={`app ${styles.screen}`}>
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
          {builder.ticket.reconciled
            ? 'Customer and vehicle · Ready'
            : 'Customer and vehicle · Still needed'}
        </p>
        <p>
          Labor rate · {builder.configuration.laborRateCents === null
            ? 'Not configured'
            : `${formatMoneyCents(builder.configuration.laborRateCents)}/hr`}
        </p>
        <p>
          Tax rate · {builder.configuration.taxRateBps === null
            ? 'Not configured'
            : formatTaxRate(builder.configuration.taxRateBps)}
        </p>
      </section>

      {!builder.ticket.reconciled && (
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
            <p>{builder.jobs.length} {builder.jobs.length === 1 ? 'job' : 'jobs'}</p>
          </div>

          {builder.jobs.length === 0 ? (
            <p className={styles.empty}>No eligible jobs on this ticket.</p>
          ) : (
            <ol className={styles.jobs}>
              {builder.jobs.map((job, index) => (
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
                          <li key={line.id} className={styles.line}>
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
                          </li>
                        ))}
                      </ul>
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
          <p className={styles.version}>
            {builder.activeVersion
              ? `Current prepared version · V${builder.activeVersion.versionNumber}`
              : 'No prepared version'}
          </p>
        </aside>
      </div>
    </main>
  )
}

type BuilderLine = QuoteBuilder['jobs'][number]['lines'][number]

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
