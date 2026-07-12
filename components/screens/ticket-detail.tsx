import Link from 'next/link'
import { AppHeader } from '@/components/vt'
import type { TicketDetail } from '@/lib/tickets'
import styles from './ticket-detail.module.css'

const TICKET_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  closed: 'Closed',
  canceled: 'Canceled',
}

const TICKET_SOURCE_LABELS: Record<string, string> = {
  counter: 'Counter intake',
  tech_quick: 'Tech quick',
  quick_quote: 'Quick ticket',
  legacy_repair_order: 'Legacy repair order',
}

const JOB_KIND_LABELS: Record<string, string> = {
  diagnostic: 'Diagnostic',
  repair: 'Repair',
  maintenance: 'Maintenance',
}

const TIER_LABELS: Record<number, string> = {
  3: 'A-tech',
  2: 'B-tech',
  1: 'C-tech',
}

const WORK_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
  canceled: 'Canceled',
}

const APPROVAL_STATE_LABELS: Record<string, string> = {
  pending_quote: 'Quote not built',
  quote_ready: 'Quote ready',
  sent: 'Sent',
  approved: 'Approved',
  declined: 'Declined',
}

export function TicketDetailScreen({
  ticket,
  canBuildQuote = false,
  currentProfileId = null,
}: {
  ticket: TicketDetail
  canBuildQuote?: boolean
  currentProfileId?: string | null
}): React.JSX.Element {
  const repairOrder = `RO ${String(ticket.ticketNumber).padStart(6, '0')}`
  const statusLabel = formatLabel(TICKET_STATUS_LABELS, ticket.status)
  const sourceLabel = formatLabel(TICKET_SOURCE_LABELS, ticket.source)
  const phoneTarget = ticket.customer ? phoneHref(ticket.customer.phone) : null
  const emailTarget = ticket.customer?.email
    ? emailHref(ticket.customer.email)
    : null

  return (
    <main className={`app ${styles.screen}`}>
      <AppHeader
        title={repairOrder}
        meta={<span>{statusLabel} · {sourceLabel}</span>}
        back={{ href: '/today', label: 'My Jobs' }}
      />

      <div className={styles.content}>
        <header className={styles.identity}>
          <div>
            <p className={styles.eyebrow}>Repair order</p>
            <p className={styles.repairOrder}>{repairOrder}</p>
          </div>
          {ticket.customer && ticket.vehicle && (
            <div className={styles.identityCopy}>
              <h1>{ticket.customer.name}</h1>
              <p>{vehicleName(ticket.vehicle)}</p>
              {ticket.vehicle.engine && <p>{ticket.vehicle.engine}</p>}
            </div>
          )}
        </header>

        {ticket.status === 'open' && canBuildQuote && (
          <div className={styles.actions}>
            <Link
              href={`/tickets/${ticket.id}/quote`}
              className={styles.quoteAction}
            >
              Build quote
            </Link>
          </div>
        )}

        {!ticket.customer || !ticket.vehicle ? (
          <section
            className={styles.provisional}
            aria-labelledby="provisional-title"
          >
            <p className={styles.eyebrow}>Provisional ticket</p>
            <h1 id="provisional-title">Customer and vehicle still needed</h1>
            <p>
              Draft quote lines now. Prepare, send, approval, delivery, and closeout stay blocked until this ticket is reconciled.
            </p>
          </section>
        ) : (
          <div className={styles.identityGrid}>
            <section aria-labelledby="customer-heading" className={styles.factSection}>
              <h2 id="customer-heading">Customer contact</h2>
              <p className={styles.factLead}>{ticket.customer.name}</p>
              <div className={styles.linkStack}>
                {phoneTarget ? (
                  <a href={phoneTarget}>{ticket.customer.phone}</a>
                ) : (
                  <span>{ticket.customer.phone}</span>
                )}
                {ticket.customer.email && (emailTarget ? (
                  <a href={emailTarget}>{ticket.customer.email}</a>
                ) : (
                  <span>{ticket.customer.email}</span>
                ))}
              </div>
            </section>

            <section aria-labelledby="vehicle-heading" className={styles.factSection}>
              <h2 id="vehicle-heading">Vehicle</h2>
              <p className={styles.factLead}>{vehicleName(ticket.vehicle)}</p>
              {ticket.vehicle.engine && <p className={styles.secondary}>{ticket.vehicle.engine}</p>}
              <dl className={styles.dataList}>
                {ticket.vehicle.vin && (
                  <>
                    <dt>VIN</dt>
                    <dd>{ticket.vehicle.vin}</dd>
                  </>
                )}
                {ticket.vehicle.mileage !== null && (
                  <>
                    <dt>Mileage</dt>
                    <dd>{ticket.vehicle.mileage.toLocaleString('en-US')} mi</dd>
                  </>
                )}
                {ticket.vehicle.plate && (
                  <>
                    <dt>Plate</dt>
                    <dd>{ticket.vehicle.plate}</dd>
                  </>
                )}
              </dl>
              <Link href={`/vehicles/${ticket.vehicle.id}`} className={styles.textLink}>
                View vehicle history
              </Link>
            </section>
          </div>
        )}

        <section className={styles.concern} aria-labelledby="concern-heading">
          <p className={styles.eyebrow}>What brought it in</p>
          <h2 id="concern-heading">{ticket.concern}</h2>
          {(ticket.whenStarted || ticket.howOften) && (
            <dl className={styles.storyFacts}>
              {ticket.whenStarted && (
                <>
                  <dt>Started</dt>
                  <dd>{ticket.whenStarted}</dd>
                </>
              )}
              {ticket.howOften && (
                <>
                  <dt>Frequency</dt>
                  <dd>{ticket.howOften}</dd>
                </>
              )}
            </dl>
          )}
          {(ticket.diagnosticAuthorizedCents !== null || ticket.diagnosticAuthorizationNote) && (
            <div className={styles.authorization}>
              <p className={styles.authorizationLabel}>Diagnostic authorization</p>
              {ticket.diagnosticAuthorizedCents !== null && (
                <p className={styles.authorizationAmount}>
                  {formatCents(ticket.diagnosticAuthorizedCents)}
                </p>
              )}
              {ticket.diagnosticAuthorizationNote && (
                <p className={styles.authorizationNote}>
                  {ticket.diagnosticAuthorizationNote}
                </p>
              )}
            </div>
          )}
        </section>

        <section className={styles.jobs} aria-labelledby="jobs-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>Persisted work</p>
              <h2 id="jobs-heading">Job ledger</h2>
            </div>
            <span className={styles.jobCount}>{ticket.jobs.length} {ticket.jobs.length === 1 ? 'line' : 'lines'}</span>
          </div>

          <ol className={styles.ledger}>
            {ticket.jobs.map((job, index) => (
              <li key={job.id} className={styles.job}>
                <div className={styles.railMark} aria-hidden="true">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </div>
                <div className={styles.jobBody}>
                  <div className={styles.jobLead}>
                    <div>
                      <p className={styles.jobMeta}>
                        {formatLabel(JOB_KIND_LABELS, job.kind)} · {tierLabel(job.requiredSkillTier)}
                      </p>
                      <h3>{job.title}</h3>
                    </div>
                    <div className={styles.stamps}>
                      <span className={styles.stamp} data-state={job.workStatus}>
                        Work · {formatLabel(WORK_STATUS_LABELS, job.workStatus)}
                      </span>
                      <span className={styles.stamp} data-state={job.approvalState}>
                        Approval · {formatLabel(APPROVAL_STATE_LABELS, job.approvalState)}
                      </span>
                    </div>
                  </div>

                  <div className={styles.assignmentRow}>
                    <p>{assigneeLabel(job)}</p>
                    {job.sessionId && (
                      <Link href={`/sessions/${job.sessionId}`} className={styles.diagnosisLink}>
                        Open diagnosis
                      </Link>
                    )}
                    {simpleWorkLink(ticket, job, currentProfileId)}
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </main>
  )
}

function simpleWorkLink(
  ticket: TicketDetail,
  job: TicketDetail['jobs'][number],
  currentProfileId: string | null,
) {
  if (!ticket.customer || !ticket.vehicle || !currentProfileId
    || job.assignedTechId !== currentProfileId
    || (job.kind !== 'repair' && job.kind !== 'maintenance')
    || job.sessionId !== null
    || (ticket.status !== 'open' && job.workStatus !== 'done')
    || !['open', 'in_progress', 'done'].includes(job.workStatus)) return null
  const label = job.workStatus === 'done'
    ? 'View work history'
    : job.workStatus === 'in_progress' ? 'Continue work' : 'Open work'
  return (
    <Link href={`/tickets/${ticket.id}/jobs/${job.id}/work`} className={styles.diagnosisLink}>
      {label}
    </Link>
  )
}

function formatLabel(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value
}

function tierLabel(tier: number): string {
  return TIER_LABELS[tier] ?? `Tier ${tier}`
}

function vehicleName(vehicle: NonNullable<TicketDetail['vehicle']>): string {
  return `${vehicle.year} ${vehicle.make} ${vehicle.model}`
}

function phoneHref(phone: string): string | null {
  const match = phone.trim().match(
    /^(\+?[\d().\s-]{7,30}?)(?:\s*(?:ext\.?|extension|x)\s*(\d{1,8}))?$/i,
  )
  if (!match) return null

  const digits = match[1].replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null

  const subscriber = match[1].trim().startsWith('+')
    ? `+${digits}`
    : digits.length === 10
      ? `+1${digits}`
      : digits
  const extension = match[2] ? `;ext=${match[2]}` : ''
  return `tel:${subscriber}${extension}`
}

function emailHref(email: string): string | null {
  const value = email.trim()
  if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return null
  return `mailto:${value}`
}

function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100)
}

function assigneeLabel(job: TicketDetail['jobs'][number]): string {
  if (!job.assignedTechId) return 'Open — no technician assigned'
  if (job.assignedTech?.fullName) return `Assigned · ${job.assignedTech.fullName}`
  return 'Assigned technician · Name not provided'
}
