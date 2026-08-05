'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { AppHeader } from '@/components/vt'
import { LocalizedTimestamp } from '@/components/vt/localized-timestamp'
import type { TeamMember } from '@/lib/intake/team'
import {
  projectLivingTicketCommands,
  projectTechnicianJobReadiness,
  type LivingTicketCommand,
} from '@/lib/shop-os/living-ticket'
import { canAssignWork } from '@/lib/shop-os/capabilities'
import { canUseManualWork } from '@/lib/shop-os/manual-work-policy'
import type { TicketDetail, TodayTicketJob } from '@/lib/tickets'
import type { TicketRingOut } from '@/lib/shop-os/ring-out'
import type { TicketPartRequestView } from '@/lib/shop-os/part-requests-ui'
import type { CustomerCopyProjection, CustomerCopyResult } from '@/lib/shop-os/customer-copy'
import type {
  SimpleWorkEscalationView,
  SimpleWorkProjectionView,
} from '@/lib/shop-os/simple-work-ui'
import type { TicketCorrectionTarget } from '@/lib/shop-os/ticket-correction-draft'
import { RingOutSection } from './ring-out-section'
import {
  InlineQuoteWorkspace,
  inlineQuoteWorkspaceId,
  type QuoteWorkspaceProjection,
} from './inline-quote-workspace'
import { TicketAssignmentControl } from './ticket-assignment-control'
import { TicketCannedJobAction } from './ticket-canned-job-action'
import { TicketInterruptionAction } from './ticket-interruption-action'
import { TicketLifecycleControl } from './ticket-lifecycle-control'
import { TicketPartRequests } from './ticket-part-requests'
import { InlineWorkWorkspace } from './inline-work-workspace'
import { CustomerCopy } from './customer-copy'
import {
  TicketCorrectionWorkspace,
  type TicketCorrectionAppliedProjection,
} from './ticket-correction-workspace'
import styles from './ticket-detail.module.css'

const TICKET_STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  closed: 'Closed',
  canceled: 'Canceled',
}

const TICKET_SOURCE_LABELS: Record<string, string> = {
  counter: 'Written up',
  tech_quick: 'Started by a tech',
  quick_quote: 'Quick ticket',
  legacy_repair_order: 'Brought over',
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
  open: 'Not started',
  in_progress: 'Being worked',
  blocked: 'On hold',
  done: 'Finished',
  canceled: 'Not doing it',
}

const APPROVAL_STATE_LABELS: Record<string, string> = {
  pending_quote: 'No price yet',
  quote_ready: 'Priced',
  sent: 'Link opened',
  approved: 'Approved',
  declined: 'Declined',
  deferred: 'Decision deferred',
}

const IDENTITY_CORRECTION_TARGET = { kind: 'identity' } as const
const CONCERN_CORRECTION_TARGET = { kind: 'concern' } as const
const TICKET_QUOTE_KEY = 'ticket'

export function TicketDetailScreen({
  ticket: initialTicket,
  canBuildQuote = false,
  canCorrectTicket = false,
  canCreateVendorAccount = false,
  canManageCannedJobs = false,
  currentProfileId = null,
  currentProfileName = null,
  role = '',
  skillTier = null,
  team = [],
  ringOut = null,
  partRequests = [],
  diagnosticsEntitled = true,
  customerCopy = null,
  refreshCustomerCopyAction,
}: {
  ticket: TicketDetail
  canBuildQuote?: boolean
  canCorrectTicket?: boolean
  canCreateVendorAccount?: boolean
  canManageCannedJobs?: boolean
  currentProfileId?: string | null
  currentProfileName?: string | null
  role?: string
  skillTier?: number | null
  team?: TeamMember[]
  ringOut?: TicketRingOut | null
  partRequests?: TicketPartRequestView[]
  diagnosticsEntitled?: boolean
  customerCopy?: CustomerCopyProjection | null
  refreshCustomerCopyAction?: (ticketId: string) => Promise<CustomerCopyResult>
}): React.JSX.Element {
  const [correctionTruth, setCorrectionTruth] = useState<{
    ticket: TicketDetail
    quote: TicketCorrectionAppliedProjection['quote']
  } | null>(null)
  const [confirmedCorrection, setConfirmedCorrection] = useState<ConfirmedCorrection | null>(null)
  const ticket = correctionTruth?.ticket ?? initialTicket
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
  const [customerCopyOpen, setCustomerCopyOpen] = useState(false)
  const [customerCopyStale, setCustomerCopyStale] = useState(false)
  const [effectiveCustomerCopy, setEffectiveCustomerCopy] = useState(customerCopy)
  const [customerCopyRefreshing, setCustomerCopyRefreshing] = useState(false)
  const [customerCopyError, setCustomerCopyError] = useState(false)
  const [selectedPrimaryJobId, setSelectedPrimaryJobId] = useState<string | null>(null)
  const [primaryGroupOpen, setPrimaryGroupOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [activeTool, setActiveTool] = useState<
    | { kind: 'quote'; jobId: string | null }
    | { kind: 'work'; jobId: string }
    | { kind: 'correction'; target: TicketCorrectionTarget }
    | null
  >(null)
  const [lifecycleMutationActive, setLifecycleMutationActive] = useState(false)
  const lifecycleMutationActiveRef = useRef(false)
  const identityTargetRef = useRef<HTMLDivElement>(null)
  const concernTargetRef = useRef<HTMLElement>(null)
  const jobRefs = useRef(new Map<string, HTMLLIElement>())
  const quoteOpenerRefs = useRef(new Map<string, HTMLButtonElement>())
  const workOpenerRefs = useRef(new Map<string, HTMLButtonElement>())
  const correctionOpenerRefs = useRef(new Map<string, HTMLButtonElement>())
  const ringOutRef = useRef<HTMLElement>(null)
  const customerCopyGenerationRef = useRef(0)
  const customerCopyRequestRef = useRef(0)
  const primaryGroupSignatureRef = useRef<string | null>(null)
  const approvalStateRef = useRef(new Map(
    ticket.jobs.map((job) => [job.id, job.approvalState]),
  ))
  const repairOrder = `RO ${String(ticket.ticketNumber).padStart(6, '0')}`
  const statusLabel = formatLabel(TICKET_STATUS_LABELS, ticketStatus)
  const sourceLabel = formatLabel(TICKET_SOURCE_LABELS, ticket.source)
  const phoneTarget = ticket.customer ? phoneHref(ticket.customer.phone) : null
  const emailTarget = ticket.customer?.email
    ? emailHref(ticket.customer.email)
    : null
  const activities = ticket.activities ?? []
  const correctedRemovedJobIds = new Set(ticket.correctedRemovedJobIds ?? activities.flatMap((activity) => (
    activity.kind === 'ticket_corrected'
      && activity.correctionScope === 'job_removed'
      && activity.jobId
      ? [activity.jobId]
      : []
  )))
  const baseJobs: DisplayJob[] = [
    ...ticket.jobs,
    ...escalatedJobs.map((job) => ({ ...job, assignedTech: null })),
  ]
  const displayedJobs = baseJobs.map((job) => ({
    ...job,
    workStatus: workOverrides.get(job.id)?.workStatus
      ?? quoteOverrides.get(job.id)?.workStatus
      ?? assignmentOverrides.get(job.id)?.workStatus
      ?? correctionTruth?.quote.jobs.find((quoteJob) => quoteJob.id === job.id)?.workStatus
      ?? job.workStatus,
    approvalState: quoteOverrides.get(job.id)?.approvalState
      ?? correctionTruth?.quote.jobs.find((quoteJob) => quoteJob.id === job.id)?.approval.state
      ?? assignmentOverrides.get(job.id)?.approvalState
      ?? job.approvalState,
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
  const primaryCommand = commands.primary?.kind === 'quote' && !canBuildQuote
    ? null
    : commands.primary
  const primaryGroupCommands = (commands.primaryGroup?.commands ?? []).filter((command) => (
    command.kind !== 'quote' || canBuildQuote
  ))
  const secondaryCommands = commands.secondary.filter((command) => (
    command.kind !== 'quote' || canBuildQuote
  ))
  const selectedPrimaryCommand = primaryGroupCommands.length > 1
    ? primaryGroupCommands.find((command) => command.jobId === selectedPrimaryJobId) ?? null
    : null
  const projectedCommands = [
    ...(primaryCommand ? [primaryCommand] : []),
    ...(primaryGroupCommands.length === 1 ? primaryGroupCommands : []),
    ...(selectedPrimaryCommand ? [selectedPrimaryCommand] : []),
    ...(moreOpen ? secondaryCommands : []),
  ]
  const emphasizedCommand = selectedPrimaryCommand
    ?? primaryCommand
    ?? (primaryGroupCommands.length === 1 ? primaryGroupCommands[0] : null)
  const visibleCommands = activeTool?.kind === 'quote' ? [] : projectedCommands
  const ticketQuoteCommand = visibleCommands.find((command) => (
    command.kind === 'quote' && command.jobId === undefined
  )) ?? null
  const ringOutCommand = visibleCommands.find((command) => (
    command.kind === 'ring_out' || command.kind === 'close'
  )) ?? null
  const commandProjectionSignature = `${commandSignature(commands)}|canBuildQuote:${String(canBuildQuote)}`
  const primaryGroupCommandSignature = primaryGroupCommands.map(commandIdentity).join('|')
  const legacyQuoteFallback = !currentProfileId || !role
  const correctionAvailable = canCorrectTicket
    && canAssignWork(role)
    && currentProfileId !== null
    && ticketStatus === 'open'
  const toolBlocked = activeTool !== null || lifecycleMutationActive
  const markCustomerCopyStale = useCallback(() => {
    if (!effectiveCustomerCopy) return
    customerCopyGenerationRef.current += 1
    customerCopyRequestRef.current += 1
    setCustomerCopyOpen(false)
    setCustomerCopyStale(true)
    setCustomerCopyError(false)
    setCustomerCopyRefreshing(false)
  }, [effectiveCustomerCopy])
  const applyQuoteProjection = useCallback((projection: QuoteWorkspaceProjection) => {
    const preparedJob = projection.find((projected) => (
      approvalStateRef.current.get(projected.id) === 'pending_quote'
        && projected.approvalState === 'quote_ready'
    ))
    const financialStateChanged = projection.some((projected) => (
      approvalStateRef.current.get(projected.id) !== projected.approvalState
    ))
    for (const projected of projection) {
      approvalStateRef.current.set(projected.id, projected.approvalState)
    }
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
    if (financialStateChanged) markCustomerCopyStale()
    if (preparedJob && activeTool?.kind === 'quote') {
      setActiveTool(null)
      setTimeout(() => {
        const target = quoteOpenerRefs.current.get(preparedJob.id)
          ?? jobRefs.current.get(preparedJob.id)
        target?.focus()
      }, 0)
    }
  }, [activeTool, markCustomerCopyStale])
  const openCorrection = useCallback((target: TicketCorrectionTarget) => {
    if (activeTool !== null || lifecycleMutationActiveRef.current) return
    setCustomerCopyOpen(false)
    setConfirmedCorrection(null)
    setActiveTool({ kind: 'correction', target })
  }, [activeTool])
  const trackLifecycleMutation = useCallback((active: boolean) => {
    lifecycleMutationActiveRef.current = active
    setLifecycleMutationActive(active)
  }, [])
  const applyCorrection = useCallback((result: TicketCorrectionAppliedProjection) => {
    setCorrectionTruth({ ticket: result.ticket, quote: result.quote })
    setAssignmentOverrides(new Map())
    setQuoteOverrides(new Map())
    setWorkOverrides(new Map())
    setEscalatedJobs([])
    setTicketStatus(result.ticket.status)
    markCustomerCopyStale()
    setConfirmedCorrection({
      target: result.target,
      outcome: result.outcome,
      invalidatedVersionNumber: result.invalidatedVersionNumber,
      announcement: result.announcement,
    })
    setActiveTool(null)
    setTimeout(() => {
      correctionTargetElement(
        result.target,
        identityTargetRef.current,
        concernTargetRef.current,
        jobRefs.current,
      )?.focus()
    }, 0)
  }, [markCustomerCopyStale])
  useEffect(() => setTicketStatus(ticket.status), [ticket.status])
  useEffect(() => setRingOutState(ringOut), [ringOut])
  useEffect(() => {
    customerCopyGenerationRef.current += 1
    customerCopyRequestRef.current += 1
    setEffectiveCustomerCopy(customerCopy)
    setCustomerCopyStale(false)
    setCustomerCopyError(false)
    setCustomerCopyOpen(false)
    setCustomerCopyRefreshing(false)
  }, [customerCopy])
  useEffect(() => {
    approvalStateRef.current = new Map(ticket.jobs.map((job) => [job.id, job.approvalState]))
  }, [ticket.jobs])
  useEffect(() => {
    setCorrectionTruth(null)
    setConfirmedCorrection(null)
  }, [initialTicket])
  useEffect(() => {
    const previousPrimaryGroupSignature = primaryGroupSignatureRef.current
    const primaryGroupChanged = previousPrimaryGroupSignature !== null
      && previousPrimaryGroupSignature !== primaryGroupCommandSignature
    primaryGroupSignatureRef.current = primaryGroupCommandSignature
    setMoreOpen(false)
    setPrimaryGroupOpen(false)
    setSelectedPrimaryJobId((selected) => (
      selected && !primaryGroupChanged && primaryGroupCommands.length > 1
        && primaryGroupCommands.some((command) => command.jobId === selected)
        ? selected
        : null
    ))
  }, [commandProjectionSignature, primaryGroupCommandSignature])

  async function refreshStaleCustomerCopy(): Promise<void> {
    if (!customerCopyStale || customerCopyRefreshing) return
    const generation = customerCopyGenerationRef.current
    const requestId = customerCopyRequestRef.current + 1
    customerCopyRequestRef.current = requestId
    setCustomerCopyRefreshing(true)
    setCustomerCopyError(false)
    try {
      const result = refreshCustomerCopyAction
        ? await refreshCustomerCopyAction(ticket.id)
        : null
      if (customerCopyGenerationRef.current !== generation
        || customerCopyRequestRef.current !== requestId) return
      if (!isCustomerCopySuccess(result)) {
        setCustomerCopyError(true)
        return
      }
      setEffectiveCustomerCopy(result.copy)
      setCustomerCopyStale(false)
      setCustomerCopyOpen(true)
    } catch {
      if (customerCopyGenerationRef.current === generation
        && customerCopyRequestRef.current === requestId) setCustomerCopyError(true)
    } finally {
      if (customerCopyRequestRef.current === requestId) setCustomerCopyRefreshing(false)
    }
  }

  return (
    <main className={`app ${styles.screen}`} data-customer-copy-shell>
      <AppHeader
        title={repairOrder}
        meta={<span>{statusLabel} · {sourceLabel}</span>}
        back={{ href: '/today', label: canAssignWork(role) ? 'Shop floor' : 'My work' }}
      />

      <div className={styles.content} data-customer-copy-container>
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

        {((ticketStatus === 'open' && (
          (canBuildQuote && (ticketQuoteCommand || legacyQuoteFallback))
            || primaryGroupCommands.length > 1 || secondaryCommands.length > 0 || ringOutCommand
        )) || effectiveCustomerCopy) && (
          <div className={styles.actions}>
            {commands.primaryGroup && primaryGroupCommands.length > 1
              && !selectedPrimaryCommand && activeTool === null && (
              <div className={styles.commandGroup}>
                <button
                  type="button"
                  className={styles.quoteAction}
                  aria-expanded={primaryGroupOpen}
                  onClick={() => setPrimaryGroupOpen((open) => !open)}
                >
                  {primaryGroupCommands.length === commands.primaryGroup.commands.length
                    ? commands.primaryGroup.label
                    : `${primaryGroupCommands.length} jobs need attention`}
                </button>
                {primaryGroupOpen && (
                  <div className={styles.commandChoices}>
                    {primaryGroupCommands.map((command) => {
                      const groupJob = displayedJobs.find((job) => job.id === command.jobId)
                      return groupJob ? (
                        <button
                          key={commandIdentity(command)}
                          type="button"
                          onClick={() => {
                            setSelectedPrimaryJobId(groupJob.id)
                            setPrimaryGroupOpen(false)
                            setTimeout(() => jobRefs.current.get(groupJob.id)?.focus(), 0)
                          }}
                        >
                          {groupJob.title}
                        </button>
                      ) : null
                    })}
                  </div>
                )}
              </div>
            )}
            {canBuildQuote && (ticketQuoteCommand ? (
              <button
                ref={(element) => setQuoteOpenerRef(quoteOpenerRefs.current, null, element)}
                type="button"
                className={styles.quoteAction}
                aria-expanded={activeTool?.kind === 'quote' && activeTool.jobId === null}
                aria-controls={inlineQuoteWorkspaceId(ticket.id)}
                disabled={toolBlocked}
                onClick={() => {
                  if (!lifecycleMutationActiveRef.current) {
                    setCustomerCopyOpen(false)
                    setActiveTool({ kind: 'quote', jobId: null })
                  }
                }}
              >
                {ticketQuoteCommand.label}
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
            {secondaryCommands.length > 0 && activeTool === null && (
              <button
                type="button"
                className={styles.moreAction}
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              >
                More
              </button>
            )}
            {effectiveCustomerCopy && (
              <button
                type="button"
                className={styles.customerCopyAction}
                aria-expanded={customerCopyOpen}
                disabled={toolBlocked || customerCopyRefreshing}
                onClick={() => {
                  if (customerCopyStale) void refreshStaleCustomerCopy()
                  else setCustomerCopyOpen((open) => !open)
                }}
              >
                {customerCopyStale
                  ? customerCopyRefreshing ? 'Refreshing customer copy…' : 'Refresh customer copy'
                  : customerCopyOpen ? 'Hide customer copy' : 'Customer copy'}
              </button>
            )}
          </div>
        )}

        {customerCopyError && (
          <p className={styles.customerCopyError} role="alert">
            Customer copy could not be refreshed. Nothing was reopened or printed. Try again.
          </p>
        )}

        {customerCopyOpen && !customerCopyStale && effectiveCustomerCopy && (
          <CustomerCopy
            copy={effectiveCustomerCopy}
            canManageShopIdentity={role === 'owner'}
            ticketId={ticket.id}
            refreshCopy={refreshCustomerCopyAction}
          />
        )}

        {activeTool?.kind === 'quote' && activeTool.jobId === null && currentProfileId && (
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
            focusJobId={null}
            onProjection={applyQuoteProjection}
            onClose={() => {
              setActiveTool(null)
              setTimeout(() => quoteOpenerRefs.current.get(TICKET_QUOTE_KEY)?.focus(), 0)
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

        <div
          ref={identityTargetRef}
          className={styles.correctionTarget}
          aria-label="Customer and vehicle correction target"
          data-correction-target="identity"
          data-correction-state={correctionDataState(confirmedCorrection, IDENTITY_CORRECTION_TARGET)}
          tabIndex={-1}
        >
          {!ticket.customer || !ticket.vehicle ? (
            <section
              className={styles.provisional}
              aria-labelledby="provisional-title"
            >
              <p className={styles.eyebrow}>Missing</p>
              <h1 id="provisional-title">No customer or vehicle yet</h1>
              <p>
                You can price the work now. Sending it, getting the customer&apos;s answer, and closing it stay locked until the customer and vehicle are on here.
              </p>
            </section>
          ) : (
            <div className={styles.identityGrid}>
              <section aria-labelledby="customer-heading" className={styles.factSection}>
                <h2 id="customer-heading">Customer</h2>
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
          {correctionAvailable && (
            <button
              ref={(element) => setCorrectionOpenerRef(correctionOpenerRefs.current, IDENTITY_CORRECTION_TARGET, element)}
              type="button"
              className={styles.correctionAction}
              disabled={toolBlocked}
              aria-expanded={activeTool?.kind === 'correction'
                && sameCorrectionTarget(activeTool.target, IDENTITY_CORRECTION_TARGET)}
              onClick={() => openCorrection(IDENTITY_CORRECTION_TARGET)}
            >
              {ticket.customer && ticket.vehicle ? 'Correct customer or vehicle' : 'Add customer or vehicle'}
            </button>
          )}
          {activeTool?.kind === 'correction'
            && sameCorrectionTarget(activeTool.target, IDENTITY_CORRECTION_TARGET)
            && currentProfileId && (
              <TicketCorrectionWorkspace
                actorId={currentProfileId}
                ticket={ticket}
                target={IDENTITY_CORRECTION_TARGET}
                onApplied={applyCorrection}
                onClose={() => {
                  setActiveTool(null)
                  setTimeout(() => correctionOpenerRefs.current.get(
                    correctionTargetKey(IDENTITY_CORRECTION_TARGET),
                  )?.focus(), 0)
                }}
              />
            )}
          <CorrectionConfirmationView
            confirmation={confirmationFor(confirmedCorrection, IDENTITY_CORRECTION_TARGET)}
          />
        </div>

        <section
          ref={concernTargetRef}
          className={styles.concern}
          aria-label="Concern correction target"
          data-correction-target="concern"
          data-correction-state={correctionDataState(confirmedCorrection, CONCERN_CORRECTION_TARGET)}
          tabIndex={-1}
        >
          <p className={styles.eyebrow}>What brought it in</p>
          <h2 id="concern-heading">{ticket.concern}</h2>
          {(ticket.whenStarted || ticket.howOften) && (
            <dl className={styles.storyFacts}>
              {ticket.whenStarted && (
                <>
                  <dt>When it started</dt>
                  <dd>{ticket.whenStarted}</dd>
                </>
              )}
              {ticket.howOften && (
                <>
                  <dt>How often</dt>
                  <dd>{ticket.howOften}</dd>
                </>
              )}
            </dl>
          )}
          {correctionAvailable && (
            <button
              ref={(element) => setCorrectionOpenerRef(correctionOpenerRefs.current, CONCERN_CORRECTION_TARGET, element)}
              type="button"
              className={styles.correctionAction}
              disabled={toolBlocked}
              aria-expanded={activeTool?.kind === 'correction'
                && sameCorrectionTarget(activeTool.target, CONCERN_CORRECTION_TARGET)}
              onClick={() => openCorrection(CONCERN_CORRECTION_TARGET)}
            >
              Correct concern
            </button>
          )}
          {activeTool?.kind === 'correction'
            && sameCorrectionTarget(activeTool.target, CONCERN_CORRECTION_TARGET)
            && currentProfileId && (
              <TicketCorrectionWorkspace
                actorId={currentProfileId}
                ticket={ticket}
                target={CONCERN_CORRECTION_TARGET}
                onApplied={applyCorrection}
                onClose={() => {
                  setActiveTool(null)
                  setTimeout(() => correctionOpenerRefs.current.get(
                    correctionTargetKey(CONCERN_CORRECTION_TARGET),
                  )?.focus(), 0)
                }}
              />
            )}
          <CorrectionConfirmationView
            confirmation={confirmationFor(confirmedCorrection, CONCERN_CORRECTION_TARGET)}
          />
        </section>

        <section className={styles.jobs} aria-labelledby="jobs-heading">
          <div className={styles.sectionHeading}>
            <div>
              <p className={styles.eyebrow}>On this repair order</p>
              <h2 id="jobs-heading">Jobs</h2>
            </div>
            <span className={styles.jobCount}>{displayedJobs.length} {displayedJobs.length === 1 ? 'job' : 'jobs'}</span>
          </div>

          <ol className={styles.ledger}>
            {displayedJobs.map((job, index) => {
              const correctionTarget = { kind: 'job', jobId: job.id } as const
              const correctionEligible = correctionAvailable && jobCanBeCorrected(job)
              const readiness = role === 'tech' && currentProfileId
                ? projectDetailTechnicianReadiness(
                    job,
                    currentProfileId,
                    skillTier,
                    assignmentOverrides.get(job.id),
                  )
                : null
              const showReadiness = readiness && [
                'below_tier',
                'waiting_quote',
                'waiting_advisor',
                'waiting_customer',
                'declined',
                'running',
                'paused',
              ].includes(readiness.state)
              return (
                <li
                  key={job.id}
                  className={styles.job}
                  aria-label={`Job correction target ${String(index + 1).padStart(2, '0')}`}
                  data-correction-target={`job:${job.id}`}
                  data-correction-state={correctionDataState(confirmedCorrection, correctionTarget)}
                  tabIndex={-1}
                  ref={(element) => {
                    if (element) jobRefs.current.set(job.id, element)
                    else jobRefs.current.delete(job.id)
                  }}
                >
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
                        {correctedRemovedJobIds.has(job.id)
                          ? 'Removed'
                          : formatLabel(WORK_STATUS_LABELS, job.workStatus)}
                      </span>
                      <span className={styles.stamp} data-state={job.approvalState}>
                        {formatLabel(APPROVAL_STATE_LABELS, job.approvalState)}
                      </span>
                      {showReadiness && (
                        <span className={styles.stamp} data-state={readiness.state}>
                          {readiness.label}
                          {readiness.state === 'running' && (
                            <> <LocalizedTimestamp value={readiness.clockedOnSince} kind="time" /></>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={styles.assignmentRow}>
                    <p>{assigneeLabel(job, assignmentOverrides.get(job.id))}</p>
                    {quoteCommandFor(visibleCommands, job.id) && canBuildQuote ? (
                      <button
                        ref={(element) => setQuoteOpenerRef(quoteOpenerRefs.current, job.id, element)}
                        type="button"
                        className={emphasizedCommand
                          && commandIdentity(emphasizedCommand) === commandIdentity(quoteCommandFor(visibleCommands, job.id)!)
                          ? styles.inlinePrimaryAction
                          : styles.inlineAction}
                        aria-expanded={activeTool?.kind === 'quote' && activeTool.jobId === job.id}
                        aria-controls={inlineQuoteWorkspaceId(ticket.id)}
                        disabled={toolBlocked}
                        onClick={() => {
                          if (!lifecycleMutationActiveRef.current) {
                            setCustomerCopyOpen(false)
                            setActiveTool({ kind: 'quote', jobId: job.id })
                          }
                        }}
                      >
                        {quoteCommandFor(visibleCommands, job.id)?.label}
                      </button>
                    ) : cancelJobCommandFor(visibleCommands, job.id) ? (
                      <TicketInterruptionAction
                        ticketId={ticket.id}
                        jobId={job.id}
                        action="cancel_job"
                        className={styles.inlineAction}
                        onApplied={(retired) => {
                          setWorkOverrides((current) => new Map(current).set(job.id, {
                            workStatus: retired.workStatus,
                            notice: 'Dropped. This job was declined.',
                          }))
                          setTimeout(() => jobRefs.current.get(job.id)?.focus(), 0)
                        }}
                      />
                    ) : resolveHoldCommandFor(visibleCommands, job.id) ? (
                      <TicketInterruptionAction
                        ticketId={ticket.id}
                        jobId={job.id}
                        className={styles.inlineAction}
                        onApplied={(interrupted) => {
                          setWorkOverrides((current) => new Map(current).set(job.id, {
                            workStatus: interrupted.workStatus,
                            notice: 'Hold resolved.',
                          }))
                          setTimeout(() => jobRefs.current.get(job.id)?.focus(), 0)
                        }}
                      />
                    ) : workCommandFor(visibleCommands, job.id) && ticket.customer && ticket.vehicle ? (
                      <button
                        ref={(element) => {
                          if (element) workOpenerRefs.current.set(job.id, element)
                          else workOpenerRefs.current.delete(job.id)
                        }}
                        type="button"
                        className={styles.inlineAction}
                        aria-expanded={activeTool?.kind === 'work' && activeTool.jobId === job.id}
                        disabled={toolBlocked}
                        onClick={() => {
                          if (!lifecycleMutationActiveRef.current) {
                            setCustomerCopyOpen(false)
                            setActiveTool({ kind: 'work', jobId: job.id })
                          }
                        }}
                      >
                        {workCommandFor(visibleCommands, job.id)?.label}
                      </button>
                    ) : activeTool === null ? simpleWorkLink(
                      ticket,
                      job,
                      currentProfileId,
                      diagnosticsEntitled,
                      assignmentOverrides.get(job.id),
                      role === 'tech',
                    ) : null}
                  </div>
                  {activeTool?.kind === 'quote'
                    && activeTool.jobId === job.id
                    && currentProfileId && (
                      <InlineQuoteWorkspace
                        actorId={currentProfileId}
                        workspaceId={inlineQuoteWorkspaceId(ticket.id)}
                        focusJobId={job.id}
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
                          const jobId = job.id
                          setActiveTool(null)
                          setTimeout(() => {
                            const target = quoteOpenerRefs.current.get(jobId)
                              ?? jobRefs.current.get(jobId)
                            target?.focus()
                          }, 0)
                        }}
                      />
                    )}
                  {correctionEligible && (
                    <button
                      ref={(element) => setCorrectionOpenerRef(
                        correctionOpenerRefs.current,
                        correctionTarget,
                        element,
                      )}
                      type="button"
                      className={styles.correctionAction}
                      aria-label={`Correct job ${String(index + 1).padStart(2, '0')}: ${job.title}`}
                      aria-expanded={activeTool?.kind === 'correction'
                        && sameCorrectionTarget(activeTool.target, correctionTarget)}
                      disabled={toolBlocked}
                      onClick={() => openCorrection(correctionTarget)}
                    >
                      Correct job
                    </button>
                  )}
                  {activeTool?.kind === 'correction'
                    && sameCorrectionTarget(activeTool.target, correctionTarget)
                    && currentProfileId && (
                      <TicketCorrectionWorkspace
                        actorId={currentProfileId}
                        ticket={ticket}
                        target={correctionTarget}
                        onApplied={applyCorrection}
                        onClose={() => {
                          setActiveTool(null)
                          setTimeout(() => correctionOpenerRefs.current.get(
                            correctionTargetKey(correctionTarget),
                          )?.focus(), 0)
                        }}
                      />
                    )}
                  <CorrectionConfirmationView
                    confirmation={confirmationFor(confirmedCorrection, correctionTarget)}
                  />
                  {currentProfileId && assignmentCommandFor(projectedCommands, job.id) && (
                    <div hidden={activeTool !== null}>
                      <TicketAssignmentControl
                        ticketId={ticket.id}
                        job={{
                          id: job.id,
                          requiredSkillTier: job.requiredSkillTier,
                          workStatus: job.workStatus as 'open' | 'in_progress' | 'blocked',
                          approvalState: job.approvalState,
                          hasAssignee: assignmentOverrides.has(job.id)
                            ? assignmentOverrides.get(job.id)?.assignedTechId !== null
                            : job.assignedTechId !== null,
                        }}
                        command={assignmentCommandFor(projectedCommands, job.id)!}
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
                            approvalState: assignment.approvalState,
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
                            approvalState: job.approvalState,
                            notice: `${assignedTechName} claimed it first. The repair order is current.`,
                          }))
                          setTimeout(() => jobRefs.current.get(job.id)?.focus(), 0)
                        }}
                      />
                    </div>
                  )}
                  {assignmentOverrides.get(job.id)?.notice && (
                    <p className={styles.assignmentNotice} role="status" aria-live="polite">
                      {assignmentOverrides.get(job.id)?.notice}
                    </p>
                  )}
                  {workOverrides.get(job.id)?.notice && (
                    <p className={styles.assignmentNotice} role="status" aria-live="polite">
                      {workOverrides.get(job.id)?.notice}
                    </p>
                  )}
                  {activeTool === null && canManageCannedJobs && job.approvalState === 'approved' && (
                    <TicketCannedJobAction
                      jobId={job.id}
                      onSaved={() => setTimeout(() => jobRefs.current.get(job.id)?.focus(), 0)}
                    />
                  )}
                </div>
                </li>
              )
            })}
          </ol>
        </section>

        {(role === 'advisor' || role === 'owner') && (
          <TicketLifecycleControl
            ticketId={ticket.id}
            status={ticketStatus as 'open' | 'closed' | 'canceled'}
            blocked={activeTool !== null}
            onMutationStateChange={trackLifecycleMutation}
            onApplied={(next) => {
              setTicketStatus(next.status)
              setActiveTool(null)
              markCustomerCopyStale()
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
                <p className={styles.eyebrow}>Every change</p>
                <h2 id="activity-heading">History</h2>
              </div>
              <span>{activities.length} {activities.length === 1 ? 'entry' : 'entries'}</span>
            </summary>
            <ol className={styles.activityList}>
              {activities.map((activity) => (
                <li key={activity.id}>
                  <p>{activity.summary}</p>
                  <span>{activity.actorName ?? 'Shop team'} · <LocalizedTimestamp value={activity.createdAt} kind="dateTime" /></span>
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
              markCustomerCopyStale()
            }}
          />
        )}
      </div>
    </main>
  )
}

type ConfirmedCorrection = Pick<
  TicketCorrectionAppliedProjection,
  'target' | 'outcome' | 'invalidatedVersionNumber' | 'announcement'
>

function correctionTargetKey(target: TicketCorrectionTarget): string {
  return target.kind === 'job' ? `job:${target.jobId}` : target.kind
}

function sameCorrectionTarget(
  first: TicketCorrectionTarget,
  second: TicketCorrectionTarget,
): boolean {
  return correctionTargetKey(first) === correctionTargetKey(second)
}

function confirmationFor(
  confirmation: ConfirmedCorrection | null,
  target: TicketCorrectionTarget,
): ConfirmedCorrection | null {
  return confirmation && sameCorrectionTarget(confirmation.target, target)
    ? confirmation
    : null
}

function correctionDataState(
  confirmation: ConfirmedCorrection | null,
  target: TicketCorrectionTarget,
): 'confirmed' | undefined {
  const current = confirmationFor(confirmation, target)
  return current && current.outcome !== 'unchanged' ? 'confirmed' : undefined
}

function setCorrectionOpenerRef(
  refs: Map<string, HTMLButtonElement>,
  target: TicketCorrectionTarget,
  element: HTMLButtonElement | null,
): void {
  const key = correctionTargetKey(target)
  if (element) refs.set(key, element)
  else refs.delete(key)
}

function correctionTargetElement(
  target: TicketCorrectionTarget,
  identity: HTMLDivElement | null,
  concern: HTMLElement | null,
  jobs: Map<string, HTMLLIElement>,
): HTMLElement | null {
  if (target.kind === 'identity') return identity
  if (target.kind === 'concern') return concern
  return jobs.get(target.jobId) ?? null
}

function CorrectionConfirmationView({
  confirmation,
}: {
  confirmation: ConfirmedCorrection | null
}): React.JSX.Element | null {
  if (!confirmation) return null
  const signaled = confirmation.outcome !== 'unchanged'
  return (
    <div className={styles.correctionConfirmation}>
      {signaled && (
        <span
          className={styles.correctionRail}
          data-testid="correction-signal-rail"
          aria-hidden="true"
        />
      )}
      <p className={styles.correctionStatus} role="status" aria-live="polite">
        {confirmation.announcement}
      </p>
      {confirmation.invalidatedVersionNumber !== null && (
        <p className={styles.correctionVersion}>
          Current draft · V{confirmation.invalidatedVersionNumber} no longer current
        </p>
      )}
    </div>
  )
}

function simpleWorkLink(
  ticket: TicketDetail,
  job: DisplayJob,
  currentProfileId: string | null,
  diagnosticsEntitled: boolean,
  assignmentOverride?: AssignmentOverride,
  requiresApproval = false,
) {
  const assignedToCurrent = assignmentOverride
    ? assignmentOverride.state === 'mine'
    : job.assignedTechId === currentProfileId
  if (!ticket.customer || !ticket.vehicle || !currentProfileId
    || !assignedToCurrent
    || (requiresApproval && job.approvalState !== 'approved' && job.workStatus !== 'done')
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

type AssignmentOverride = {
  state: 'mine' | 'team' | 'unassigned'
  assignedTechId: string | null
  assignedTechName: string | null
  workStatus: 'open' | 'in_progress' | 'blocked'
  approvalState: string
  notice: string
}

type QuoteOverride = {
  workStatus: 'open' | 'in_progress' | 'blocked'
  approvalState: 'pending_quote' | 'quote_ready' | 'sent' | 'approved' | 'declined' | 'deferred'
}

type WorkOverride = {
  workStatus: 'open' | 'in_progress' | 'blocked' | 'done' | 'canceled'
  // Retiring a declined line, or resolving a hold, removes the very command
  // that offered it — so the control announcing the result unmounts in the same
  // render that succeeds. The confirmation has to be spoken by the row, which
  // stays.
  notice?: string
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
  | 'clockedOnSince'
  | 'approvalState'
> & { diagnosticStartState?: string }

const detailApprovalStates = new Set<TodayTicketJob['approvalState']>([
  'pending_quote', 'quote_ready', 'sent', 'approved', 'declined', 'deferred',
])
const detailWorkStatuses = new Set<TodayTicketJob['workStatus']>([
  'open', 'in_progress', 'blocked',
])
const detailClaimableApprovalStates = new Set<TodayTicketJob['approvalState']>([
  'pending_quote', 'quote_ready', 'sent', 'approved',
])

function projectDetailTechnicianReadiness(
  job: DisplayJob,
  currentProfileId: string,
  skillTier: number | null,
  override?: AssignmentOverride,
) {
  if (!detailApprovalStates.has(job.approvalState as TodayTicketJob['approvalState'])
    || !detailWorkStatuses.has(job.workStatus as TodayTicketJob['workStatus'])) return null
  const assignmentState = override?.state
    ?? (job.assignedTechId === null
      ? 'unassigned'
      : job.assignedTechId.toLowerCase() === currentProfileId.toLowerCase()
        ? 'mine'
        : 'team')
  const approvalState = job.approvalState as TodayTicketJob['approvalState']
  return projectTechnicianJobReadiness({
    assignmentState,
    approvalState,
    workStatus: job.workStatus as TodayTicketJob['workStatus'],
    canClaim: assignmentState === 'unassigned'
      && skillTier !== null
      && skillTier >= job.requiredSkillTier
      && detailClaimableApprovalStates.has(approvalState),
    requiredSkillTier: job.requiredSkillTier,
    clockedOnSince: job.clockedOnSince ?? null,
  })
}

function jobCanBeCorrected(job: DisplayJob): boolean {
  return job.workStatus === 'open'
    && job.sessionId === null
    && !(job.kind === 'diagnostic'
      && (job.diagnosticStartState === 'initializing'
        || job.diagnosticStartState === 'ambiguous'))
}

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

function commandIdentity(command: LivingTicketCommand): string {
  return `${command.kind}:${command.jobId ?? 'ticket'}`
}

function commandSignature(commands: ReturnType<typeof projectLivingTicketCommands>): string {
  return [
    commands.primary ? `primary:${commandIdentity(commands.primary)}` : 'primary:none',
    ...(commands.primaryGroup?.commands.map((command) => `group:${commandIdentity(command)}`) ?? []),
    ...commands.secondary.map((command) => `secondary:${commandIdentity(command)}`),
  ].join('|')
}

function setQuoteOpenerRef(
  refs: Map<string, HTMLButtonElement>,
  jobId: string | null,
  element: HTMLButtonElement | null,
): void {
  const key = jobId ?? TICKET_QUOTE_KEY
  if (element) refs.set(key, element)
  else refs.delete(key)
}

function quoteCommandFor(
  commands: LivingTicketCommand[],
  jobId: string,
): (LivingTicketCommand & { kind: 'quote'; jobId: string }) | null {
  const command = commands.find((candidate) => (
    candidate.kind === 'quote' && candidate.jobId === jobId
  ))
  return command
    ? command as LivingTicketCommand & { kind: 'quote'; jobId: string }
    : null
}

function isCustomerCopySuccess(
  result: unknown,
): result is { ok: true; copy: CustomerCopyProjection } {
  if (!isRecord(result)
    || !hasExactKeys(result, ['ok', 'copy'])
    || result.ok !== true
    || !isRecord(result.copy)) return false
  const copy = result.copy
  if (!hasExactKeys(copy, [
    'documentKind', 'readyToPrint', 'blockers', 'shop', 'ticketNumber', 'customer',
    'vehicle', 'jobs', 'decisions', 'totals', 'closedAt',
  ])
    || !['estimate', 'invoice', 'paid_receipt'].includes(String(copy.documentKind))
    || typeof copy.readyToPrint !== 'boolean'
    || !Array.isArray(copy.blockers)
    || !copy.blockers.every((value) => (
      ['shop_phone', 'shop_address_line_1', 'shop_city', 'shop_region', 'shop_postal_code', 'pricing_unavailable']
        .includes(String(value))
    ))
    || new Set(copy.blockers).size !== copy.blockers.length
    || copy.readyToPrint !== (copy.blockers.length === 0)
    || !isCustomerCopyShop(copy.shop)
    || !isSafeNonnegativeInteger(copy.ticketNumber)
    || !isCustomerCopyCustomer(copy.customer)
    || !isCustomerCopyVehicle(copy.vehicle)
    || !Array.isArray(copy.jobs) || !copy.jobs.every(isCustomerCopyJob)
    || !Array.isArray(copy.decisions) || !copy.decisions.every(isCustomerCopyDecision)
    || !isCustomerCopyTotals(copy.totals)
    || !(copy.closedAt === null || isExactIsoTimestamp(copy.closedAt))) return false
  const validatedCopy = copy as CustomerCopyProjection
  const lineSubtotalCents = sumCustomerCopyLineCents(validatedCopy.jobs)
  if (!validatedCopy.blockers.includes('pricing_unavailable')
    && lineSubtotalCents !== validatedCopy.totals.subtotalCents) return false
  return !validatedCopy.blockers.includes('pricing_unavailable') || validatedCopy.jobs.length === 0
}

function isCustomerCopyShop(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['name', 'phone', 'address'])
    && typeof value.name === 'string'
    && (value.phone === null || typeof value.phone === 'string')
    && Array.isArray(value.address)
    && value.address.every((line) => typeof line === 'string')
}

function isCustomerCopyCustomer(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['name'])
    && typeof value.name === 'string'
}

function isCustomerCopyVehicle(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['year', 'make', 'model', 'vin', 'odometer'])
    && isSafeNonnegativeInteger(value.year)
    && typeof value.make === 'string'
    && typeof value.model === 'string'
    && (value.vin === null || typeof value.vin === 'string')
    && (value.odometer === null || isSafeNonnegativeInteger(value.odometer))
}

function isCustomerCopyJob(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['title', 'kind', 'lines'])
    && typeof value.title === 'string'
    && ['diagnostic', 'repair', 'maintenance'].includes(String(value.kind))
    && Array.isArray(value.lines)
    && value.lines.every(isCustomerCopyLine)
}

function isCustomerCopyLine(value: unknown): boolean {
  if (!isRecord(value)
    || typeof value.description !== 'string'
    || !isSafeCents(value.priceCents)
    || typeof value.taxable !== 'boolean') return false
  if (value.kind === 'part') return hasExactKeys(value, [
    'kind', 'description', 'quantity', 'priceCents', 'taxable', 'partNumber', 'brand',
  ])
    && typeof value.quantity === 'string'
    && (value.partNumber === null || typeof value.partNumber === 'string')
    && (value.brand === null || typeof value.brand === 'string')
  if (value.kind === 'labor') return hasExactKeys(value, [
    'kind', 'description', 'hours', 'priceCents', 'taxable', 'laborRateCents',
  ])
    && typeof value.hours === 'string'
    && (value.laborRateCents === null || isSafeCents(value.laborRateCents))
  return value.kind === 'fee'
    && hasExactKeys(value, ['kind', 'description', 'priceCents', 'taxable'])
}

function sumCustomerCopyLineCents(jobs: CustomerCopyProjection['jobs']): number | null {
  let subtotalCents = 0
  for (const job of jobs) {
    for (const line of job.lines) {
      subtotalCents += line.priceCents
      if (!Number.isSafeInteger(subtotalCents)) return null
    }
  }
  return subtotalCents
}

function isCustomerCopyDecision(value: unknown): boolean {
  return isRecord(value)
    && hasExactKeys(value, ['jobTitle', 'decision', 'method', 'recordedAt'])
    && typeof value.jobTitle === 'string'
    && ['approved', 'declined', 'deferred'].includes(String(value.decision))
    && (value.method === null || ['phone', 'in_person'].includes(String(value.method)))
    && isExactIsoTimestamp(value.recordedAt)
}

function isCustomerCopyTotals(value: unknown): boolean {
  if (!isRecord(value)
    || !hasExactKeys(value, [
      'subtotalCents', 'taxCents', 'totalCents', 'payments', 'paidCents', 'balanceCents',
    ])
    || !isSafeCents(value.subtotalCents)
    || !isSafeCents(value.taxCents)
    || !isSafeCents(value.totalCents)
    || !isSafeCents(value.paidCents)
    || !isSafeCents(value.balanceCents)
    || !Array.isArray(value.payments)) return false
  if (value.subtotalCents + value.taxCents !== value.totalCents
    || value.totalCents - value.paidCents !== value.balanceCents) return false
  let paymentTotal = 0
  for (const payment of value.payments) {
    if (!isCustomerCopyPayment(payment)) return false
    paymentTotal += payment.amountCents
    if (!Number.isSafeInteger(paymentTotal)) return false
  }
  return paymentTotal === value.paidCents
}

function isCustomerCopyPayment(
  value: unknown,
): value is CustomerCopyProjection['totals']['payments'][number] {
  return isRecord(value)
    && hasExactKeys(value, ['amountCents', 'method', 'recordedAt'])
    && isSafeCents(value.amountCents)
    && ['cash', 'card', 'check', 'other'].includes(String(value.method))
    && isExactIsoTimestamp(value.recordedAt)
}

function isSafeCents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isSafeNonnegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isExactIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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

function cancelJobCommandFor(
  commands: LivingTicketCommand[],
  jobId: string,
): (LivingTicketCommand & { kind: 'cancel_job' }) | null {
  const command = commands.find((candidate) => (
    candidate.kind === 'cancel_job' && candidate.jobId === jobId
  ))
  return command ? command as LivingTicketCommand & { kind: 'cancel_job' } : null
}
