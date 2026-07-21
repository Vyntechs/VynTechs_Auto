'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppHeader } from '@/components/vt'
import type { TeamMember } from '@/lib/intake/team'
import {
  projectLivingTicketCommands,
  type LivingTicketCommand,
} from '@/lib/shop-os/living-ticket'
import { canUseManualWork } from '@/lib/shop-os/manual-work-policy'
import type { TicketDetail } from '@/lib/tickets'
import type { TicketRingOut } from '@/lib/shop-os/ring-out'
import type { TicketPartRequestView } from '@/lib/shop-os/part-requests-ui'
import type {
  SimpleWorkEscalationView,
  SimpleWorkProjectionView,
} from '@/lib/shop-os/simple-work-ui'
import { RingOutSection } from './ring-out-section'
import {
  InlineQuoteWorkspace,
  inlineQuoteWorkspaceId,
  type QuoteWorkspaceProjection,
} from './inline-quote-workspace'
import { TicketAssignmentControl } from './ticket-assignment-control'
import { TicketInterruptionAction } from './ticket-interruption-action'
import { TicketLifecycleControl } from './ticket-lifecycle-control'
import { TicketPartRequests } from './ticket-part-requests'
import { InlineWorkWorkspace } from './inline-work-workspace'
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
  diagnosticsEntitled = true,
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
  diagnosticsEntitled?: boolean
}): React.JSX.Element {
  const [assignmentOverrides, setAssignmentOverrides] = useState<ReadonlyMap<string, AssignmentOverride>>(
    () => new Map(),
  )
  const [quoteOverrides, setQuoteOverrides] = useState<ReadonlyMap<string, QuoteOverride>>(
    () => new Map(),
  )
  const [workOverrides, setWorkOverrides] = useState<ReadonlyMap<string, WorkOverride>>(
    () => new Map(),
  )
  const [escalatedJobs, setEscalatedJobs] = useState<SimpleWorkEscalationView[]>([])
  const [ringOutState, setRingOutState] = useState(ringOut)
  const [ticketStatus, setTicketStatus] = useState(ticket.status)
  const [activeTool, setActiveTool] = useState<
    { kind: 'quote' } | { kind: 'work'; jobId: string } | null
  >(null)
  const jobRefs = useRef(new Map<string, HTMLLIElement>())
  const quoteOpenerRef = useRef<HTMLButtonElement>(null)
  const workOpenerRefs = useRef(new Map<string, HTMLButtonElement>())
  const ringOutRef = useRef<HTMLElement>(null)
  const repairOrder = `RO ${String(ticket.ticketNumber).padStart(6, '0')}`
  const statusLabel = formatLabel(TICKET_STATUS_LABELS, ticketStatus)
  const sourceLabel = formatLabel(TICKET_SOURCE_LABELS, ticket.source)
  const phoneTarget = ticket.customer ? phoneHref(ticket.customer.phone) : null
  const emailTarget = ticket.customer?.email
    ? emailHref(ticket.customer.email)
    : null
  const activities = ticket.activities ?? []
  const baseJobs: DisplayJob[] = [
    ...ticket.jobs,
    ...escalatedJobs.map((job) => ({ ...job, assignedTech: null })),
  ]
  const displayedJobs = baseJobs.map((job) => ({
    ...job,
    workStatus: workOverrides.get(job.id)?.workStatus
      ?? quoteOverrides.get(job.id)?.workStatus
      ?? assignmentOverrides.get(job.id)?.workStatus
      ?? job.workStatus,
    approvalState: quoteOverrides.get(job.id)?.approvalState ?? job.approvalState,
  }))
  const commands = projectLivingTicketCommands({
    role,
    profileId: currentProfileId,
    skillTier,
    ticketStatus,
    jobs: displayedJobs.map((job) => ({
      ...job,
      assignmentState: assignmentOverrides.get(job.id)?.state,
    })),
    ringOut: ringOutState,
    diagnosticsEntitled,
  })
  const allCommands = commands.primary
    ? [commands.primary, ...commands.secondary]
    : commands.secondary
  const quoteCommand = allCommands.find((command) => command.kind === 'quote') ?? null
  const ringOutCommand = allCommands.find((command) => (
    command.kind === 'ring_out' || command.kind === 'close'
  )) ?? null
  const legacyQuoteFallback = !currentProfileId || !role
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
  useEffect(() => setTicketStatus(ticket.status), [ticket.status])
  useEffect(() => setRingOutState(ringOut), [ringOut])

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

        {ticketStatus === 'open' && (
          (canBuildQuote && (quoteCommand || legacyQuoteFallback)) || ringOutCommand
        ) && (
          <div className={styles.actions}>
            {canBuildQuote && (quoteCommand ? (
              <button
                ref={quoteOpenerRef}
                type="button"
                className={styles.quoteAction}
                aria-expanded={activeTool?.kind === 'quote'}
                aria-controls={inlineQuoteWorkspaceId(ticket.id)}
                disabled={activeTool !== null}
                onClick={() => setActiveTool({ kind: 'quote' })}
              >
                {quoteCommand.label}
              </button>
            ) : legacyQuoteFallback ? (
              <Link
                href={`/tickets/${ticket.id}/quote`}
                className={styles.quoteAction}
              >
                Build quote
              </Link>
            ) : null)}
            {ringOutCommand && (
              <button
                type="button"
                className={styles.quoteAction}
                onClick={() => ringOutRef.current?.focus()}
              >
                {ringOutCommand.label}
              </button>
            )}
          </div>
        )}

        {activeTool?.kind === 'quote' && currentProfileId && (
          <InlineQuoteWorkspace
            actorId={currentProfileId}
            workspaceId={inlineQuoteWorkspaceId(ticket.id)}
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

        {activeTool?.kind === 'work' && ticket.customer && ticket.vehicle && (
          <InlineWorkWorkspace
            actorProfileId={currentProfileId ?? undefined}
            ticket={{
              id: ticket.id,
              number: ticket.ticketNumber,
              customerName: ticket.customer.name,
              vehicle: vehicleName(ticket.vehicle),
            }}
            jobId={activeTool.jobId}
            onProjection={(work) => {
              const jobId = activeTool.jobId
              setWorkOverrides((current) => {
                const existing = current.get(jobId)
                if (existing?.workStatus === work.status) return current
                return new Map(current).set(jobId, { workStatus: work.status })
              })
            }}
            onEscalation={(job) => {
              setEscalatedJobs((current) => (
                current.some((existing) => existing.id === job.id) ? current : [...current, job]
              ))
              setTimeout(() => jobRefs.current.get(job.id)?.focus(), 0)
            }}
            onInterrupted={(interrupted) => {
              const jobId = activeTool.jobId
              setWorkOverrides((current) => new Map(current).set(jobId, {
                workStatus: interrupted.workStatus,
              }))
              setActiveTool(null)
              setTimeout(() => jobRefs.current.get(jobId)?.focus(), 0)
            }}
            onClose={() => {
              const jobId = activeTool.jobId
              setActiveTool(null)
              setTimeout(() => {
                const target = workOpenerRefs.current.get(jobId) ?? jobRefs.current.get(jobId)
                target?.focus()
              }, 0)
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
            <span className={styles.jobCount}>{displayedJobs.length} {displayedJobs.length === 1 ? 'line' : 'lines'}</span>
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
                    {resolveHoldCommandFor(allCommands, job.id) ? (
                      <TicketInterruptionAction
                        ticketId={ticket.id}
                        jobId={job.id}
                        className={styles.inlineAction}
                        onApplied={(interrupted) => {
                          setWorkOverrides((current) => {
                            const existing = current.get(job.id)
                            if (existing?.workStatus === interrupted.workStatus) return current
                            return new Map(current).set(job.id, { workStatus: interrupted.workStatus })
                          })
                          setTimeout(() => jobRefs.current.get(job.id)?.focus(), 0)
                        }}
                      />
                    ) : workCommandFor(allCommands, job.id) && ticket.customer && ticket.vehicle ? (
                      <button
                        ref={(element) => {
                          if (element) workOpenerRefs.current.set(job.id, element)
                          else workOpenerRefs.current.delete(job.id)
                        }}
                        type="button"
                        className={styles.inlineAction}
                        aria-expanded={activeTool?.kind === 'work' && activeTool.jobId === job.id}
                      disabled={activeTool !== null}
                      onClick={() => setActiveTool({ kind: 'work', jobId: job.id })}
                      >
                        {workCommandFor(allCommands, job.id)?.label}
                      </button>
                    ) : simpleWorkLink(
                      ticket,
                      job,
                      currentProfileId,
                      diagnosticsEntitled,
                      assignmentOverrides.get(job.id),
                    )}
                  </div>
                  {activeTool === null && currentProfileId && assignmentCommandFor(allCommands, job.id) && (
                    <TicketAssignmentControl
                      ticketId={ticket.id}
                      job={{
                        id: job.id,
                        requiredSkillTier: job.requiredSkillTier,
                        workStatus: job.workStatus as 'open' | 'in_progress' | 'blocked',
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

        {(role === 'advisor' || role === 'owner') && (
          <TicketLifecycleControl
            ticketId={ticket.id}
            status={ticketStatus as 'open' | 'closed' | 'canceled'}
            onApplied={(next) => {
              setTicketStatus(next.status)
              setActiveTool(null)
              setWorkOverrides((current) => {
                const updated = new Map(current)
                for (const job of next.jobs) updated.set(job.id, { workStatus: job.workStatus })
                return updated
              })
            }}
          />
        )}

        {activities.length > 0 && (
          <details className={styles.activity}>
            <summary className={styles.activitySummary}>
              <div>
                <p className={styles.eyebrow}>Durable record</p>
                <h2 id="activity-heading">Repair order activity</h2>
              </div>
              <span>{activities.length} {activities.length === 1 ? 'entry' : 'entries'}</span>
            </summary>
            <ol className={styles.activityList}>
              {activities.map((activity) => (
                <li key={activity.id}>
                  <p>{activity.summary}</p>
                  <span>{activity.actorName ?? 'Shop team'} · {formatActivityTime(activity.createdAt)}</span>
                </li>
              ))}
            </ol>
          </details>
        )}

        <TicketPartRequests ticketId={ticket.id} requests={partRequests} />

        {ringOutState && (
          <RingOutSection
            ticketId={ticket.id}
            initialRingOut={ringOutState}
            sectionRef={ringOutRef}
            onChange={(next) => {
              setRingOutState(next)
              setTicketStatus(next.status)
              if (next.status !== 'open') setActiveTool(null)
            }}
          />
        )}
      </div>
    </main>
  )
}

function simpleWorkLink(
  ticket: TicketDetail,
  job: DisplayJob,
  currentProfileId: string | null,
  diagnosticsEntitled: boolean,
  assignmentOverride?: AssignmentOverride,
) {
  const assignedToCurrent = assignmentOverride
    ? assignmentOverride.state === 'mine'
    : job.assignedTechId === currentProfileId
  if (!ticket.customer || !ticket.vehicle || !currentProfileId
    || !assignedToCurrent
    || !canUseManualWork({
      kind: job.kind,
      sessionId: job.sessionId,
      diagnosticsEntitled,
    })
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

function formatActivityTime(value: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(value)
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

type WorkOverride = {
  workStatus: 'open' | 'in_progress' | 'blocked' | 'done' | 'canceled'
}

type DisplayJob = Pick<TicketDetail['jobs'][number],
  | 'id'
  | 'title'
  | 'kind'
  | 'requiredSkillTier'
  | 'assignedTechId'
  | 'assignedTech'
  | 'sessionId'
  | 'workStatus'
  | 'approvalState'
>

function assigneeLabel(
  job: DisplayJob,
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

function workCommandFor(
  commands: LivingTicketCommand[],
  jobId: string,
): (LivingTicketCommand & { kind: 'work' }) | null {
  const command = commands.find((candidate) => (
    candidate.kind === 'work' && candidate.jobId === jobId
  ))
  return command ? command as LivingTicketCommand & { kind: 'work' } : null
}

function resolveHoldCommandFor(
  commands: LivingTicketCommand[],
  jobId: string,
): (LivingTicketCommand & { kind: 'resolve_hold' }) | null {
  const command = commands.find((candidate) => (
    candidate.kind === 'resolve_hold' && candidate.jobId === jobId
  ))
  return command ? command as LivingTicketCommand & { kind: 'resolve_hold' } : null
}
