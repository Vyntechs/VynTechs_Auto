'use client'

import Link from 'next/link'
import { useCallback, useRef, useState } from 'react'
import { AppHeader } from '@/components/vt'
import type { TeamMember } from '@/lib/intake/team'
import {
  projectLivingTicketCommands,
  type LivingTicketCommand,
} from '@/lib/shop-os/living-ticket'
import type { TicketDetail } from '@/lib/tickets'
import type { TicketRingOut } from '@/lib/shop-os/ring-out'
import type { TicketPartRequestView } from '@/lib/shop-os/part-requests-ui'
import { RingOutSection } from './ring-out-section'
import {
  InlineQuoteWorkspace,
  type QuoteWorkspaceProjection,
} from './inline-quote-workspace'
import { TicketAssignmentControl } from './ticket-assignment-control'
import { TicketPartRequests } from './ticket-part-requests'
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
  canCreateVendorAccount = false,
  currentProfileId = null,
  currentProfileName = null,
  role = '',
  skillTier = null,
  team = [],
  ringOut = null,
  partRequests = [],
}: {
  ticket: TicketDetail
  canBuildQuote?: boolean
  canCreateVendorAccount?: boolean
  currentProfileId?: string | null
  currentProfileName?: string | null
  role?: string
  skillTier?: number | null
  team?: TeamMember[]
  ringOut?: TicketRingOut | null
  partRequests?: TicketPartRequestView[]
}): React.JSX.Element {
  const [assignmentOverrides, setAssignmentOverrides] = useState<ReadonlyMap<string, AssignmentOverride>>(
    () => new Map(),
  )
  const [quoteOverrides, setQuoteOverrides] = useState<ReadonlyMap<string, QuoteOverride>>(
    () => new Map(),
  )
  const [activeTool, setActiveTool] = useState<'quote' | null>(null)
  const jobRefs = useRef(new Map<string, HTMLLIElement>())
  const quoteOpenerRef = useRef<HTMLButtonElement>(null)
  const repairOrder = `RO ${String(ticket.ticketNumber).padStart(6, '0')}`
  const statusLabel = formatLabel(TICKET_STATUS_LABELS, ticket.status)
  const sourceLabel = formatLabel(TICKET_SOURCE_LABELS, ticket.source)
  const phoneTarget = ticket.customer ? phoneHref(ticket.customer.phone) : null
  const emailTarget = ticket.customer?.email
    ? emailHref(ticket.customer.email)
    : null
  const displayedJobs = ticket.jobs.map((job) => ({
    ...job,
    workStatus: quoteOverrides.get(job.id)?.workStatus
      ?? assignmentOverrides.get(job.id)?.workStatus
      ?? job.workStatus,
    approvalState: quoteOverrides.get(job.id)?.approvalState ?? job.approvalState,
  }))
  const commands = projectLivingTicketCommands({
    role,
    profileId: currentProfileId,
    skillTier,
    ticketStatus: ticket.status,
    jobs: displayedJobs.map((job) => ({
      ...job,
      assignmentState: assignmentOverrides.get(job.id)?.state,
    })),
    ringOut,
  })
  const allCommands = commands.primary
    ? [commands.primary, ...commands.secondary]
    : commands.secondary
  const quoteCommand = allCommands.find((command) => command.kind === 'quote') ?? null
  const applyQuoteProjection = useCallback((projection: QuoteWorkspaceProjection) => {
    setQuoteOverrides((current) => {
      const next = new Map(current)
      let changed = false
      for (const projected of projection) {
        const existing = current.get(projected.id)
        if (existing?.workStatus === projected.workStatus
          && existing.approvalState === projected.approvalState) continue
        next.set(projected.id, {
          workStatus: projected.workStatus,
          approvalState: projected.approvalState,
        })
        changed = true
      }
      return changed ? next : current
    })
  }, [])

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
            {quoteCommand ? (
              <button
                ref={quoteOpenerRef}
                type="button"
                className={styles.quoteAction}
                aria-expanded={activeTool === 'quote'}
                onClick={() => setActiveTool((current) => current === 'quote' ? null : 'quote')}
              >
                {quoteCommand.label}
              </button>
            ) : (
              <Link
                href={`/tickets/${ticket.id}/quote`}
                className={styles.quoteAction}
              >
                Build quote
              </Link>
            )}
          </div>
        )}

        {activeTool === 'quote' && (
          <InlineQuoteWorkspace
            ticket={{
              id: ticket.id,
              ticketNumber: ticket.ticketNumber,
              concern: ticket.concern,
              customer: ticket.customer ? { name: ticket.customer.name } : null,
              vehicle: ticket.vehicle ? {
                year: ticket.vehicle.year,
                make: ticket.vehicle.make,
                model: ticket.vehicle.model,
              } : null,
            }}
            canCreateVendorAccount={canCreateVendorAccount}
            onProjection={applyQuoteProjection}
            onClose={() => {
              setActiveTool(null)
              setTimeout(() => quoteOpenerRef.current?.focus(), 0)
            }}
          />
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
            {displayedJobs.map((job, index) => (
              <li key={job.id} className={styles.job} tabIndex={-1} ref={(element) => {
                if (element) jobRefs.current.set(job.id, element)
                else jobRefs.current.delete(job.id)
              }}>
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
                    <p>{assigneeLabel(job, assignmentOverrides.get(job.id))}</p>
                    {simpleWorkLink(ticket, job, currentProfileId, assignmentOverrides.get(job.id))}
                  </div>
                  {currentProfileId && assignmentCommandFor(allCommands, job.id) && (
                    <TicketAssignmentControl
                      ticketId={ticket.id}
                      job={{
                        id: job.id,
                        requiredSkillTier: job.requiredSkillTier,
                        assignedTechId: assignmentOverrides.has(job.id)
                          ? assignmentOverrides.get(job.id)?.assignedTechId ?? null
                          : job.assignedTechId,
                      }}
                      command={assignmentCommandFor(allCommands, job.id)!}
                      team={team}
                      currentProfileId={currentProfileId}
                      onApplied={(assignment) => {
                        const selected = team.find((member) => member.id === assignment.assignedTechId)
                        const assignedTechName = assignment.assignedTechName
                          ?? (assignment.state === 'mine' ? currentProfileName : selected?.name)
                          ?? null
                        setAssignmentOverrides((current) => new Map(current).set(job.id, {
                          state: assignment.state,
                          assignedTechId: assignment.assignedTechId,
                          assignedTechName,
                          workStatus: assignment.workStatus,
                          notice: assignment.state === 'unassigned'
                            ? 'Work is open.'
                            : assignment.state === 'mine'
                              ? 'Work is yours.'
                              : `Assigned to ${assignedTechName ?? 'the selected technician'}.`,
                        }))
                        setTimeout(() => jobRefs.current.get(job.id)?.focus(), 0)
                      }}
                      onConflict={({ assignedTechName }) => {
                        setAssignmentOverrides((current) => new Map(current).set(job.id, {
                          state: 'team',
                          assignedTechId: null,
                          assignedTechName,
                          workStatus: 'open',
                          notice: `${assignedTechName} claimed it first. The repair order is current.`,
                        }))
                        setTimeout(() => jobRefs.current.get(job.id)?.focus(), 0)
                      }}
                    />
                  )}
                  {assignmentOverrides.get(job.id)?.notice && (
                    <p className={styles.assignmentNotice} role="status" aria-live="polite">
                      {assignmentOverrides.get(job.id)?.notice}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </section>

        <TicketPartRequests ticketId={ticket.id} requests={partRequests} />

        {ringOut && (
          <RingOutSection ticketId={ticket.id} initialRingOut={ringOut} />
        )}
      </div>
    </main>
  )
}

function simpleWorkLink(
  ticket: TicketDetail,
  job: TicketDetail['jobs'][number],
  currentProfileId: string | null,
  assignmentOverride?: AssignmentOverride,
) {
  const assignedToCurrent = assignmentOverride
    ? assignmentOverride.state === 'mine'
    : job.assignedTechId === currentProfileId
  if (!ticket.customer || !ticket.vehicle || !currentProfileId
    || !assignedToCurrent
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

type AssignmentOverride = {
  state: 'mine' | 'team' | 'unassigned'
  assignedTechId: string | null
  assignedTechName: string | null
  workStatus: 'open' | 'in_progress' | 'blocked'
  notice: string
}

type QuoteOverride = {
  workStatus: 'open' | 'in_progress' | 'blocked'
  approvalState: 'pending_quote' | 'quote_ready' | 'sent' | 'approved' | 'declined'
}

function assigneeLabel(
  job: TicketDetail['jobs'][number],
  override?: AssignmentOverride,
): string {
  if (override?.state === 'unassigned') return 'Open — no technician assigned'
  if (override && override.assignedTechName) return `Assigned · ${override.assignedTechName}`
  if (override) return 'Assigned technician · Name not provided'
  if (!job.assignedTechId) return 'Open — no technician assigned'
  if (job.assignedTech?.fullName) return `Assigned · ${job.assignedTech.fullName}`
  return 'Assigned technician · Name not provided'
}

function assignmentCommandFor(
  commands: LivingTicketCommand[],
  jobId: string,
): (LivingTicketCommand & { kind: 'assign' | 'claim' | 'handoff' }) | null {
  const command = commands.find((candidate) => candidate.jobId === jobId && (
    candidate.kind === 'assign' || candidate.kind === 'claim' || candidate.kind === 'handoff'
  ))
  return command
    ? command as LivingTicketCommand & { kind: 'assign' | 'claim' | 'handoff' }
    : null
}
