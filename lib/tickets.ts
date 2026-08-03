import { createHash } from 'node:crypto'
import { and, asc, desc, eq, exists, inArray, isNotNull, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  jobLines,
  jobPartRequests,
  profiles,
  quoteVersions,
  sessions,
  shops,
  ticketActivity,
  ticketJobs,
  tickets,
  vehicles,
  type Profile,
} from '@/lib/db/schema'
import {
  canAssignWork,
  canCreateTickets,
  isShopRole,
} from '@/lib/shop-os/capabilities'
import {
  cannedJobLineInsertValues,
  type SafeCannedJobLine,
} from '@/lib/shop-os/canned-jobs'
import { MAX_TICKET_JOBS_PER_TICKET, ticketAtJobLimit } from '@/lib/shop-os/job-limits'
import {
  listReadyToCollectTickets,
  type ReadyToCollectTicket,
} from '@/lib/shop-os/ready-to-collect'
import { appendTicketActivity } from '@/lib/shop-os/ticket-activity'
import {
  invalidateActiveQuoteVersion,
  isLockUnavailable,
  validatedQuoteSnapshot,
} from '@/lib/shop-os/quotes'
import { formatScaledDecimal, parseScaledDecimal } from '@/lib/shop-os/quote-math'

export type TicketActor = {
  profileId: string
  shopId: string | null
  role: string
  skillTier: number | null
  membershipStatus: string
  deactivatedAt: Date | null
}

export type TicketDomainError =
  | 'forbidden'
  | 'no_shop'
  | 'inactive_profile'
  | 'invalid_input'
  | 'not_found'
  | 'conflict'
  | 'invalid_assignee'
  | 'tier_confirmation_required'
  | 'ticket_not_open'
  | 'job_not_open'
  | 'assignment_conflict'
  | 'overpayment'
  | 'balance_outstanding'
  | 'unfinished_work'
  | 'job_limit_reached'

export type AssignmentTierWarning = {
  code: 'below_required_tier'
  assignedTechId: string
  assignedSkillTier: 1 | 2 | 3
  requiredSkillTier: 1 | 2 | 3
}

export type TicketActivityView = {
  id: string
  jobId: string | null
  kind: 'work_paused' | 'work_resumed' | 'job_blocked' | 'job_hold_resolved' | 'job_reassigned' | 'job_handed_off' | 'ticket_canceled' | 'ticket_reopened'
  actorName: string | null
  summary: string
  createdAt: Date
}

export type TicketDetail = {
  id: string
  ticketNumber: number
  source: string
  status: string
  concern: string
  whenStarted: string | null
  howOften: string | null
  diagnosticAuthorizedCents: number | null
  diagnosticAuthorizationNote: string | null
  customer: { id: string; name: string; phone: string; email: string | null } | null
  vehicle: {
    id: string
    year: number
    make: string
    model: string
    engine: string | null
    vin: string | null
    mileage: number | null
    plate: string | null
  } | null
  jobs: Array<{
    id: string
    title: string
    kind: string
    requiredSkillTier: number
    assignedTechId: string | null
    assignedTech: {
      id: string
      fullName: string | null
      role: string
      skillTier: number | null
    } | null
    sessionId: string | null
    workStatus: string
    approvalState: string
    customerSuppliedPartsNote: string | null
    workNotes: string | null
    diagnosticStartState: string
    diagnosticStartErrorCode: string | null
    createdAt: Date
    updatedAt: Date
  }>
  activities?: TicketActivityView[]
  createdAt: Date
  updatedAt: Date
}

// ---- Vehicle history (read-only) -------------------------------------------
// A vehicle's past repair orders and the jobs on them, powering the
// vehicle-history screen. The "recommended, not done" surface is derived from
// jobs the customer declined (approvalState === 'declined').

export type VehicleHistoryJob = {
  id: string
  ticketId: string
  ticketNumber: number
  title: string
  kind: 'diagnostic' | 'repair' | 'maintenance'
  approvalState: 'pending_quote' | 'quote_ready' | 'sent' | 'approved' | 'declined' | 'deferred'
  workStatus: 'open' | 'in_progress' | 'blocked' | 'done' | 'canceled'
}

export type VehicleHistoryTicket = {
  id: string
  ticketNumber: number
  concern: string
  status: 'open' | 'closed' | 'canceled'
  createdAt: Date
  closedAt: Date | null
  jobs: VehicleHistoryJob[]
  jobsHasMore?: boolean
}

export type VehicleHistoryResult = {
  visits: VehicleHistoryTicket[]
  hasMore: boolean
}

const VEHICLE_HISTORY_VISIT_LIMIT = 100
export { MAX_TICKET_JOBS_PER_TICKET }

// Flat (ticket × job) row before grouping. Job columns are null for a ticket
// that has no jobs yet (left join).
export type VehicleHistoryRow = {
  ticketId: string
  ticketNumber: number
  concern: string
  status: 'open' | 'closed' | 'canceled'
  createdAt: Date
  closedAt: Date | null
  jobId: string | null
  jobTitle: string | null
  jobKind: 'diagnostic' | 'repair' | 'maintenance' | null
  jobApprovalState: VehicleHistoryJob['approvalState'] | null
  jobWorkStatus: VehicleHistoryJob['workStatus'] | null
}

/**
 * Collapse flat ticket×job rows into tickets carrying their jobs, preserving
 * the query's row order (tickets newest-first; jobs oldest-first within a
 * ticket). Pure, so the grouping is unit-testable without a database.
 */
export function groupVehicleHistoryRows(
  rows: VehicleHistoryRow[],
): VehicleHistoryTicket[] {
  const byTicket = new Map<string, VehicleHistoryTicket>()
  const order: string[] = []
  for (const row of rows) {
    let ticket = byTicket.get(row.ticketId)
    if (!ticket) {
      ticket = {
        id: row.ticketId,
        ticketNumber: row.ticketNumber,
        concern: row.concern,
        status: row.status,
        createdAt: row.createdAt,
        closedAt: row.closedAt,
        jobs: [],
        jobsHasMore: false,
      }
      byTicket.set(row.ticketId, ticket)
      order.push(row.ticketId)
    }
    // The lateral query returns at most 26 newest jobs. The twenty-sixth is a
    // sentinel only; never let it reach the browser as a rendered job.
    if (row.jobId && ticket.jobs.length >= MAX_TICKET_JOBS_PER_TICKET) {
      ticket.jobsHasMore = true
      continue
    }
    if (row.jobId) {
      ticket.jobs.push({
        id: row.jobId,
        ticketId: row.ticketId,
        ticketNumber: row.ticketNumber,
        title: row.jobTitle ?? '',
        kind: row.jobKind ?? 'repair',
        approvalState: row.jobApprovalState ?? 'pending_quote',
        workStatus: row.jobWorkStatus ?? 'open',
      })
    }
  }
  return order.map((id) => byTicket.get(id) as VehicleHistoryTicket)
}

/**
 * A vehicle's newest repair-order history within its shop, each ticket
 * carrying its jobs. The sentinel row reports older stored visits without
 * sending an unbounded backlog to the server or browser.
 */
export async function listVehicleTicketHistory(
  db: AppDb,
  opts: { shopId: string; vehicleId: string },
): Promise<VehicleHistoryResult> {
  // Fetch one extra repair order solely as the history sentinel. The lateral
  // job lookup below sees only the 100 visible tickets, so an older visit
  // never triggers any job-table work.
  const ticketWindow = db
    .select({
      shopId: tickets.shopId,
      ticketId: tickets.id,
      ticketNumber: tickets.ticketNumber,
      concern: tickets.concern,
      status: tickets.status,
      createdAt: tickets.createdAt,
      closedAt: tickets.closedAt,
    })
    .from(tickets)
    .where(
      and(eq(tickets.shopId, opts.shopId), eq(tickets.vehicleId, opts.vehicleId)),
    )
    .orderBy(desc(tickets.ticketNumber))
    .limit(VEHICLE_HISTORY_VISIT_LIMIT + 1)
    .as('vehicle_ticket_window')
  const visibleTickets = db
    .select({
      shopId: ticketWindow.shopId,
      ticketId: ticketWindow.ticketId,
      ticketNumber: ticketWindow.ticketNumber,
      concern: ticketWindow.concern,
      status: ticketWindow.status,
      createdAt: ticketWindow.createdAt,
      closedAt: ticketWindow.closedAt,
      historyHasMore: sql<boolean>`(
        select count(*) > ${VEHICLE_HISTORY_VISIT_LIMIT}
        from ${ticketWindow}
      )`.as('history_has_more'),
    })
    .from(ticketWindow)
    .orderBy(desc(ticketWindow.ticketNumber))
    .limit(VEHICLE_HISTORY_VISIT_LIMIT)
    .as('visible_vehicle_tickets')
  const boundedJobs = db
    .select({
      id: ticketJobs.id,
      title: ticketJobs.title,
      kind: ticketJobs.kind,
      approvalState: ticketJobs.approvalState,
      workStatus: ticketJobs.workStatus,
      createdAt: ticketJobs.createdAt,
    })
    .from(ticketJobs)
    .where(and(
      eq(ticketJobs.shopId, visibleTickets.shopId),
      eq(ticketJobs.ticketId, visibleTickets.ticketId),
    ))
    .orderBy(desc(ticketJobs.createdAt), desc(ticketJobs.id))
    .limit(MAX_TICKET_JOBS_PER_TICKET + 1)
    .as('bounded_vehicle_ticket_jobs')
  const rows = await db
    .select({
      ticketId: visibleTickets.ticketId,
      ticketNumber: visibleTickets.ticketNumber,
      concern: visibleTickets.concern,
      status: visibleTickets.status,
      createdAt: visibleTickets.createdAt,
      closedAt: visibleTickets.closedAt,
      historyHasMore: visibleTickets.historyHasMore,
      jobId: boundedJobs.id,
      jobTitle: boundedJobs.title,
      jobKind: boundedJobs.kind,
      jobApprovalState: boundedJobs.approvalState,
      jobWorkStatus: boundedJobs.workStatus,
    })
    .from(visibleTickets)
    .leftJoinLateral(boundedJobs, sql`true`)
    .orderBy(
      desc(visibleTickets.ticketNumber),
      desc(boundedJobs.createdAt),
      desc(boundedJobs.id),
    )
  const grouped = groupVehicleHistoryRows(rows).map((ticket) => ({
    ...ticket,
    jobs: [...ticket.jobs].reverse(),
  }))
  return {
    visits: grouped.slice(0, VEHICLE_HISTORY_VISIT_LIMIT),
    hasMore: rows[0]?.historyHasMore ?? false,
  }
}

export type CreateTicketResult =
  | { ok: true; ticket: TicketDetail }
  | {
      ok: false
      error: TicketDomainError
      warning?: AssignmentTierWarning
      retryable?: boolean
    }

type TicketActorProfile = Pick<
  Profile,
  'id' | 'shopId' | 'role' | 'skillTier' | 'membershipStatus' | 'deactivatedAt'
>

export function ticketActorFromProfile(profile: TicketActorProfile): TicketActor {
  return {
    profileId: profile.id,
    shopId: profile.shopId,
    role: profile.role,
    skillTier: profile.skillTier,
    membershipStatus: profile.membershipStatus,
    deactivatedAt: profile.deactivatedAt,
  }
}

export type TodayTicketJob = {
  id: string
  ticketId: string
  ticketNumber: number
  concern: string
  customerName: string | null
  vehicle: { year: number; make: string; model: string } | null
  title: string
  kind: 'diagnostic' | 'repair' | 'maintenance'
  requiredSkillTier: number
  sessionId: string | null
  workStatus: 'open' | 'in_progress' | 'blocked'
  approvalState: 'pending_quote' | 'quote_ready' | 'sent' | 'approved' | 'declined' | 'deferred'
  canClaim: boolean
  assignmentState: 'mine' | 'team' | 'unassigned'
  assignedTechName: string | null
  createdByMe: boolean
  /** Last real mutation to this job, serialized for the read-only attention clock. */
  attentionAt: string
  // Only projected to the parts desk: enough context to finish the next
  // request in place, without leaking parts details to every role.
  partRequest?: {
    id: string
    description: string
    preference: string | null
    quantity: number
  } | null
  diagnosticStartState?: 'idle' | 'initializing' | 'ready' | 'failed' | 'ambiguous'
  diagnosticStartErrorCode?: TodayDiagnosticStartErrorCode | null
}

export type TodayDiagnosticStartErrorCode =
  | 'rate_limited'
  | 'open_session_limit'
  | 'initializer_outcome_uncertain'
  | 'lease_expired'

const safeDiagnosticStartErrorCodes = new Set<TodayDiagnosticStartErrorCode>([
  'rate_limited',
  'open_session_limit',
  'initializer_outcome_uncertain',
  'lease_expired',
])

function safeDiagnosticStartErrorCode(value: string | null): TodayDiagnosticStartErrorCode | null {
  return safeDiagnosticStartErrorCodes.has(value as TodayDiagnosticStartErrorCode)
    ? value as TodayDiagnosticStartErrorCode
    : null
}

export type TodayTicketJobs = {
  myJobs: TodayTicketJob[]
  openJobs: TodayTicketJob[]
  createdJobs: TodayTicketJob[]
  teamJobs: TodayTicketJob[]
  partsJobs: TodayTicketJob[]
  // Repair orders whose work is finished but which are still open and still
  // owed. Ticket-level, not job-level, and empty for anyone who cannot close
  // tickets. See `lib/shop-os/ready-to-collect.ts`.
  readyToCollect: ReadyToCollectTicket[]
  linkedSessionIds: string[]
  hasMore?: boolean
}

const TODAY_JOB_LIMIT = 200

const emptyTodayTicketJobs = (): TodayTicketJobs => ({
  myJobs: [],
  openJobs: [],
  createdJobs: [],
  teamJobs: [],
  partsJobs: [],
  readyToCollect: [],
  linkedSessionIds: [],
})

export async function listTodayTicketJobs(
  db: AppDb,
  input: { actor: TicketActor },
): Promise<TodayTicketJobs> {
  const { actor } = input
  if (
    !actor.shopId ||
    !isShopRole(actor.role) ||
    actor.membershipStatus !== 'active' ||
    actor.deactivatedAt
  ) {
    return emptyTodayTicketJobs()
  }

  const claimable =
    actor.skillTier !== null && [1, 2, 3].includes(actor.skillTier)
      ? and(
          isNull(ticketJobs.assignedTechId),
          eq(ticketJobs.workStatus, 'open'),
          lte(ticketJobs.requiredSkillTier, actor.skillTier),
        )
      : undefined
  const visibleOpenWork = canAssignWork(actor.role)
    ? and(
        isNull(ticketJobs.assignedTechId),
        eq(ticketJobs.workStatus, 'open'),
      )
    : claimable
  const createdActiveWork = and(
    eq(tickets.createdByProfileId, actor.profileId),
    inArray(ticketJobs.workStatus, ['open', 'in_progress', 'blocked']),
  )
  const canDispatch = canAssignWork(actor.role)
  const visibleTeamWork = canDispatch
    ? and(
        isNotNull(ticketJobs.assignedTechId),
        ne(ticketJobs.assignedTechId, actor.profileId),
        inArray(ticketJobs.workStatus, ['open', 'in_progress', 'blocked']),
      )
    : undefined
  const hasRequestedParts = exists(
    db.select({ id: jobPartRequests.id })
      .from(jobPartRequests)
      .where(and(
        eq(jobPartRequests.shopId, ticketJobs.shopId),
        eq(jobPartRequests.ticketId, tickets.id),
        eq(jobPartRequests.jobId, ticketJobs.id),
        eq(jobPartRequests.status, 'requested'),
      )),
  )
  const nextPartRequestId = sql<string | null>`(
    select ${jobPartRequests.id}
    from ${jobPartRequests}
    where ${jobPartRequests.shopId} = ${ticketJobs.shopId}
      and ${jobPartRequests.ticketId} = ${tickets.id}
      and ${jobPartRequests.jobId} = ${ticketJobs.id}
      and ${jobPartRequests.status} = 'requested'
    order by ${jobPartRequests.createdAt} asc, ${jobPartRequests.id} asc
    limit 1
  )`
  const nextPartRequestDescription = sql<string | null>`(
    select ${jobPartRequests.description}
    from ${jobPartRequests}
    where ${jobPartRequests.shopId} = ${ticketJobs.shopId}
      and ${jobPartRequests.ticketId} = ${tickets.id}
      and ${jobPartRequests.jobId} = ${ticketJobs.id}
      and ${jobPartRequests.status} = 'requested'
    order by ${jobPartRequests.createdAt} asc, ${jobPartRequests.id} asc
    limit 1
  )`
  const nextPartRequestPreference = sql<string | null>`(
    select ${jobPartRequests.preference}
    from ${jobPartRequests}
    where ${jobPartRequests.shopId} = ${ticketJobs.shopId}
      and ${jobPartRequests.ticketId} = ${tickets.id}
      and ${jobPartRequests.jobId} = ${ticketJobs.id}
      and ${jobPartRequests.status} = 'requested'
    order by ${jobPartRequests.createdAt} asc, ${jobPartRequests.id} asc
    limit 1
  )`
  const nextPartRequestQuantity = sql<number | null>`(
    select ${jobPartRequests.quantity}
    from ${jobPartRequests}
    where ${jobPartRequests.shopId} = ${ticketJobs.shopId}
      and ${jobPartRequests.ticketId} = ${tickets.id}
      and ${jobPartRequests.jobId} = ${ticketJobs.id}
      and ${jobPartRequests.status} = 'requested'
    order by ${jobPartRequests.createdAt} asc, ${jobPartRequests.id} asc
    limit 1
  )`
  const visiblePartsWork = actor.role === 'parts' ? hasRequestedParts : undefined

  const rows = await db
    .select({
      id: ticketJobs.id,
      ticketId: tickets.id,
      ticketNumber: tickets.ticketNumber,
      concern: tickets.concern,
      customerName: customers.name,
      vehicleYear: vehicles.year,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
      title: ticketJobs.title,
      kind: ticketJobs.kind,
      requiredSkillTier: ticketJobs.requiredSkillTier,
      assignedTechId: ticketJobs.assignedTechId,
      persistedSessionId: ticketJobs.sessionId,
      accessibleSessionId: sessions.id,
      workStatus: ticketJobs.workStatus,
      approvalState: ticketJobs.approvalState,
      createdByProfileId: tickets.createdByProfileId,
      assignedTechFullName: profiles.fullName,
      diagnosticStartState: ticketJobs.diagnosticStartState,
      diagnosticStartErrorCode: ticketJobs.diagnosticStartErrorCode,
      attentionAt: ticketJobs.updatedAt,
      hasRequestedParts,
      nextPartRequestId,
      nextPartRequestDescription,
      nextPartRequestPreference,
      nextPartRequestQuantity,
    })
    .from(ticketJobs)
    .innerJoin(
      tickets,
      and(
        eq(tickets.shopId, ticketJobs.shopId),
        eq(tickets.id, ticketJobs.ticketId),
      ),
    )
    .leftJoin(customers, eq(tickets.customerId, customers.id))
    .leftJoin(vehicles, eq(tickets.vehicleId, vehicles.id))
    .leftJoin(
      profiles,
      and(
        eq(profiles.shopId, ticketJobs.shopId),
        eq(profiles.id, ticketJobs.assignedTechId),
      ),
    )
    .leftJoin(
      sessions,
      and(
        eq(sessions.shopId, ticketJobs.shopId),
        eq(sessions.id, ticketJobs.sessionId),
        eq(sessions.techId, actor.profileId),
      ),
    )
    .where(
      and(
        eq(ticketJobs.shopId, actor.shopId),
        eq(tickets.status, 'open'),
        or(
          and(
            eq(ticketJobs.assignedTechId, actor.profileId),
            inArray(ticketJobs.workStatus, ['open', 'in_progress', 'blocked']),
          ),
          visibleOpenWork,
          createdActiveWork,
          visibleTeamWork,
          visiblePartsWork,
        ),
      ),
    )
    .orderBy(
      sql`CASE
        WHEN ${ticketJobs.assignedTechId} = ${actor.profileId} THEN 0
        WHEN ${tickets.createdByProfileId} = ${actor.profileId} THEN 1
        WHEN ${ticketJobs.assignedTechId} IS NOT NULL THEN 2
        ELSE 3
      END`,
      asc(tickets.ticketNumber),
      asc(ticketJobs.createdAt),
      asc(ticketJobs.id),
    )
    .limit(TODAY_JOB_LIMIT + 1)

  // Finished-but-open repair orders are ticket-level and role-gated, so they
  // are selected separately rather than squeezed through the job lanes.
  const readyToCollect = await listReadyToCollectTickets(db, { actor })

  const myJobs: TodayTicketJob[] = []
  const openJobs: TodayTicketJob[] = []
  const createdJobs: TodayTicketJob[] = []
  const teamJobs: TodayTicketJob[] = []
  const partsJobs: TodayTicketJob[] = []
  const linkedSessionIds: string[] = []

  const hasMore = rows.length > TODAY_JOB_LIMIT
  for (const row of rows.slice(0, TODAY_JOB_LIMIT)) {
    const job: TodayTicketJob = {
      id: row.id,
      ticketId: row.ticketId,
      ticketNumber: row.ticketNumber,
      concern: row.concern,
      customerName: row.customerName,
      vehicle:
        row.vehicleYear !== null && row.vehicleMake !== null && row.vehicleModel !== null
          ? { year: row.vehicleYear, make: row.vehicleMake, model: row.vehicleModel }
          : null,
      title: row.title,
      kind: row.kind,
      requiredSkillTier: row.requiredSkillTier,
      sessionId: row.accessibleSessionId,
      workStatus: row.workStatus as TodayTicketJob['workStatus'],
      approvalState: row.approvalState,
      canClaim:
        row.assignedTechId === null &&
        row.workStatus === 'open' &&
        actor.skillTier !== null &&
        [1, 2, 3].includes(actor.skillTier) &&
        row.requiredSkillTier <= actor.skillTier,
      assignmentState:
        row.assignedTechId === actor.profileId
          ? 'mine'
          : row.assignedTechId === null
            ? 'unassigned'
            : 'team',
      assignedTechName: row.assignedTechFullName,
      createdByMe: row.createdByProfileId === actor.profileId,
      attentionAt: row.attentionAt.toISOString(),
      ...(actor.role === 'parts' ? {
        partRequest: row.nextPartRequestId !== null
          && row.nextPartRequestDescription !== null
          && row.nextPartRequestQuantity !== null
          ? {
              id: row.nextPartRequestId,
              description: row.nextPartRequestDescription,
              preference: row.nextPartRequestPreference,
              quantity: Number(row.nextPartRequestQuantity),
            }
          : null,
      } : {}),
      diagnosticStartState: row.diagnosticStartState,
      diagnosticStartErrorCode: safeDiagnosticStartErrorCode(row.diagnosticStartErrorCode),
    }

    if (actor.role === 'parts' && row.hasRequestedParts) partsJobs.push(job)
    else if (row.assignedTechId === actor.profileId) myJobs.push(job)
    else if (row.assignedTechId === null && row.workStatus === 'open') openJobs.push(job)
    else if (canDispatch && row.assignedTechId !== null) teamJobs.push(job)
    else if (row.createdByProfileId === actor.profileId) createdJobs.push(job)
    if (row.persistedSessionId) linkedSessionIds.push(row.persistedSessionId)
  }

  return {
    myJobs,
    openJobs,
    createdJobs,
    teamJobs,
    partsJobs,
    readyToCollect,
    linkedSessionIds,
    ...(hasMore ? { hasMore: true } : {}),
  }
}

export function ticketDomainStatus(
  result: { ok: true } | { ok: false; error: TicketDomainError },
  successStatus: number,
): number {
  if (result.ok) return successStatus

  switch (result.error) {
    case 'invalid_input':
    case 'invalid_assignee':
    case 'overpayment':
      return 422
    case 'forbidden':
    case 'no_shop':
    case 'inactive_profile':
      return 403
    case 'not_found':
      return 404
    case 'tier_confirmation_required':
    case 'conflict':
    case 'ticket_not_open':
    case 'job_not_open':
    case 'assignment_conflict':
    case 'balance_outstanding':
    case 'unfinished_work':
    case 'job_limit_reached':
      return 409
  }
}

const optionalTrimmedText = (max: number) =>
  z.string().trim().max(max).nullable().optional()

const ticketJobBodySchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    kind: z.enum(['diagnostic', 'repair', 'maintenance']),
    requiredSkillTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    assignedTechId: z.uuid().nullable().optional(),
    confirmBelowTier: z.boolean().optional(),
    customerSuppliedPartsNote: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.kind === 'diagnostic' && job.customerSuppliedPartsNote != null) {
      context.addIssue({ code: 'custom', message: 'diagnostic jobs cannot carry supplied-part truth' })
    }
  })

const assignmentBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim'), requestKey: z.uuid() }).strict(),
  z.object({ action: z.literal('unclaim'), requestKey: z.uuid() }).strict(),
  z
    .object({
      action: z.literal('reassign'),
      requestKey: z.uuid(),
      assignedTechId: z.uuid(),
      confirmBelowTier: z.boolean().optional(),
    })
    .strict(),
])

const createTicketBodySchema = z
  .object({
    source: z.enum(['counter', 'tech_quick', 'quick_quote']),
    customerId: z.uuid().nullable(),
    vehicleId: z.uuid().nullable(),
    concern: z.string().trim().min(1).max(5_000),
    whenStarted: optionalTrimmedText(1_000),
    howOften: optionalTrimmedText(1_000),
    diagnosticAuthorizedCents: z.number().int().safe().nonnegative().nullable().optional(),
    diagnosticAuthorizationNote: optionalTrimmedText(2_000),
    jobs: z
      .array(ticketJobBodySchema)
      .min(1)
      .max(25),
  })
  .strict()

type TicketJobBody = z.infer<typeof ticketJobBodySchema>

type TransactionTicketJob = {
  title: string
  kind: 'diagnostic' | 'repair' | 'maintenance'
  requiredSkillTier: 1 | 2 | 3
  assignedTechId: string | null
  customerSuppliedPartsNote?: string | null
  sessionId?: string | null
}

type TransactionTicketInput = {
  ticketId?: string
  shopId: string
  source: 'counter' | 'tech_quick' | 'quick_quote'
  customerId: string | null
  vehicleId: string | null
  concern: string
  whenStarted?: string | null
  howOften?: string | null
  diagnosticAuthorizedCents?: number | null
  diagnosticAuthorizationNote?: string | null
  createdByProfileId: string
  jobs: TransactionTicketJob[]
}

async function insertTicketInTransaction(db: AppDb, input: TransactionTicketInput) {
  const [sequence] = await db
    .update(shops)
    .set({ nextTicketNumber: sql`${shops.nextTicketNumber} + 1` })
    .where(eq(shops.id, input.shopId))
    .returning()
  if (!sequence) return null

  const [ticket] = await db
    .insert(tickets)
    .values({
      id: input.ticketId,
      shopId: input.shopId,
      ticketNumber: sequence.nextTicketNumber - 1,
      source: input.source,
      customerId: input.customerId,
      vehicleId: input.vehicleId,
      concern: input.concern,
      whenStarted: input.whenStarted,
      howOften: input.howOften,
      diagnosticAuthorizedCents: input.diagnosticAuthorizedCents,
      diagnosticAuthorizationNote: input.diagnosticAuthorizationNote,
      createdByProfileId: input.createdByProfileId,
    })
    .returning()

  const jobs = await db
    .insert(ticketJobs)
    .values(
      input.jobs.map((job) => ({
        shopId: input.shopId,
        ticketId: ticket.id,
        title: job.title,
        kind: job.kind,
        requiredSkillTier: job.requiredSkillTier,
        assignedTechId: job.assignedTechId,
        customerSuppliedPartsNote: job.customerSuppliedPartsNote,
        sessionId: job.sessionId,
      })),
    )
    .returning()

  return { ticketId: ticket.id, jobIds: jobs.map((job) => job.id) }
}

export type CreateTechQuickTicketInput = {
  shopId: string
  profileId: string
  skillTier: 1 | 2 | 3
  sessionId: string
  concern: string
}

/** Internal orchestration seam. The caller must supply an open transaction. */
export async function createTechQuickTicketInTransaction(
  tx: AppDb,
  input: CreateTechQuickTicketInput,
): Promise<{ ticketId: string; jobId: string }> {
  const created = await insertTicketInTransaction(tx, {
    shopId: input.shopId,
    source: 'tech_quick',
    customerId: null,
    vehicleId: null,
    concern: input.concern,
    createdByProfileId: input.profileId,
    jobs: [
      {
        title: input.concern,
        kind: 'diagnostic',
        requiredSkillTier: input.skillTier,
        assignedTechId: input.profileId,
        sessionId: input.sessionId,
      },
    ],
  })
  if (!created) throw new Error('tech_quick_shop_not_found')
  return { ticketId: created.ticketId, jobId: created.jobIds[0] }
}

function actorGate(actor: TicketActor): { ok: false; error: TicketDomainError } | null {
  if (!actor.shopId) return { ok: false, error: 'no_shop' }
  if (actor.membershipStatus !== 'active' || actor.deactivatedAt) {
    return { ok: false, error: 'inactive_profile' }
  }
  if (!canCreateTickets(actor.role)) return { ok: false, error: 'forbidden' }
  return null
}

async function loadTicketDetail(
  db: AppDb,
  shopId: string,
  ticketId: string,
): Promise<TicketDetail | null> {
  const [row] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      source: tickets.source,
      status: tickets.status,
      concern: tickets.concern,
      whenStarted: tickets.whenStarted,
      howOften: tickets.howOften,
      diagnosticAuthorizedCents: tickets.diagnosticAuthorizedCents,
      diagnosticAuthorizationNote: tickets.diagnosticAuthorizationNote,
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerEmail: customers.email,
      vehicleId: vehicles.id,
      vehicleYear: vehicles.year,
      vehicleMake: vehicles.make,
      vehicleModel: vehicles.model,
      vehicleEngine: vehicles.engine,
      vehicleVin: vehicles.vin,
      vehicleMileage: vehicles.mileage,
      vehiclePlate: vehicles.plate,
      createdAt: tickets.createdAt,
      updatedAt: tickets.updatedAt,
    })
    .from(tickets)
    .leftJoin(customers, eq(tickets.customerId, customers.id))
    .leftJoin(vehicles, eq(tickets.vehicleId, vehicles.id))
    .where(and(eq(tickets.shopId, shopId), eq(tickets.id, ticketId)))
    .limit(1)

  if (!row) return null

  const jobs = await db
    .select({
      id: ticketJobs.id,
      title: ticketJobs.title,
      kind: ticketJobs.kind,
      requiredSkillTier: ticketJobs.requiredSkillTier,
      assignedTechId: ticketJobs.assignedTechId,
      assignedTechFullName: profiles.fullName,
      assignedTechRole: profiles.role,
      assignedTechSkillTier: profiles.skillTier,
      sessionId: ticketJobs.sessionId,
      workStatus: ticketJobs.workStatus,
      approvalState: ticketJobs.approvalState,
      customerSuppliedPartsNote: ticketJobs.customerSuppliedPartsNote,
      workNotes: ticketJobs.workNotes,
      diagnosticStartState: ticketJobs.diagnosticStartState,
      diagnosticStartErrorCode: ticketJobs.diagnosticStartErrorCode,
      createdAt: ticketJobs.createdAt,
      updatedAt: ticketJobs.updatedAt,
    })
    .from(ticketJobs)
    .leftJoin(profiles, eq(ticketJobs.assignedTechId, profiles.id))
    .where(and(eq(ticketJobs.shopId, shopId), eq(ticketJobs.ticketId, ticketId)))
    .orderBy(asc(ticketJobs.createdAt), asc(ticketJobs.id))

  const activityRows = await db
    .select({
      id: ticketActivity.id,
      jobId: ticketActivity.jobId,
      kind: ticketActivity.kind,
      payload: ticketActivity.payload,
      actorName: profiles.fullName,
      createdAt: ticketActivity.createdAt,
    })
    .from(ticketActivity)
    .leftJoin(profiles, and(
      eq(ticketActivity.shopId, profiles.shopId),
      eq(ticketActivity.actorProfileId, profiles.id),
    ))
    .where(and(eq(ticketActivity.shopId, shopId), eq(ticketActivity.ticketId, ticketId)))
    .orderBy(desc(ticketActivity.createdAt), desc(ticketActivity.id))
    .limit(20)
  const jobTitles = new Map(jobs.map((job) => [job.id, job.title]))

  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    source: row.source,
    status: row.status,
    concern: row.concern,
    whenStarted: row.whenStarted,
    howOften: row.howOften,
    diagnosticAuthorizedCents: row.diagnosticAuthorizedCents,
    diagnosticAuthorizationNote: row.diagnosticAuthorizationNote,
    customer:
      row.customerId
        ? {
            id: row.customerId,
            name: row.customerName as string,
            phone: row.customerPhone as string,
            email: row.customerEmail,
          }
        : null,
    vehicle:
      row.vehicleId
        ? {
            id: row.vehicleId,
            year: row.vehicleYear as number,
            make: row.vehicleMake as string,
            model: row.vehicleModel as string,
            engine: row.vehicleEngine,
            vin: row.vehicleVin,
            mileage: row.vehicleMileage,
            plate: row.vehiclePlate,
          }
        : null,
    jobs: jobs.map((job) => ({
      id: job.id,
      title: job.title,
      kind: job.kind,
      requiredSkillTier: job.requiredSkillTier,
      assignedTechId: job.assignedTechId,
      assignedTech:
        job.assignedTechId && job.assignedTechRole
          ? {
              id: job.assignedTechId,
              fullName: job.assignedTechFullName,
              role: job.assignedTechRole,
              skillTier: job.assignedTechSkillTier,
            }
          : null,
      sessionId: job.sessionId,
      workStatus: job.workStatus,
      approvalState: job.approvalState,
      customerSuppliedPartsNote: job.customerSuppliedPartsNote,
      workNotes: job.workNotes,
      diagnosticStartState: job.diagnosticStartState,
      diagnosticStartErrorCode: job.diagnosticStartErrorCode,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    })),
    activities: activityRows.map((activity) => ({
      id: activity.id,
      jobId: activity.jobId,
      kind: activity.kind,
      actorName: activity.actorName,
      summary: ticketActivitySummary(activity.kind, activity.payload, activity.jobId ? jobTitles.get(activity.jobId) ?? null : null),
      createdAt: activity.createdAt,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function ticketActivitySummary(
  kind: TicketActivityView['kind'],
  payload: Record<string, unknown>,
  jobTitle: string | null,
): string {
  const subject = jobTitle ? `${jobTitle}: ` : ''
  const bounded = (value: unknown, max = 500): string | null => (
    typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
      ? value.trim()
      : null
  )
  switch (kind) {
    case 'work_paused': return `${subject}Clock paused.`
    case 'work_resumed': return `${subject}Clock resumed.`
    case 'job_blocked': return `${subject}Put on hold${bounded(payload.holdNote) ? ` — ${bounded(payload.holdNote)}` : '.'}`
    case 'job_hold_resolved': return `${subject}Hold resolved.`
    case 'job_reassigned': return `${subject}Assignment changed.`
    case 'job_handed_off': return `${subject}Handed off.`
    // A job-scoped cancellation is one retired line, not the whole repair order.
    case 'ticket_canceled': return jobTitle
      ? `${subject}Retired — the customer declined this work.`
      : `Repair order canceled${bounded(payload.reason) ? ` — ${bounded(payload.reason)}` : '.'}`
    case 'ticket_reopened': return 'Repair order reopened.'
  }
}

async function validateAssignment(
  db: AppDb,
  actor: TicketActor,
  job: TicketJobBody,
): Promise<
  | { ok: true; assignedTechId: string | null }
  | { ok: false; error: 'invalid_assignee' | 'not_found' }
  | {
      ok: false
      error: 'tier_confirmation_required'
      warning: AssignmentTierWarning
    }
> {
  if (!job.assignedTechId) return { ok: true, assignedTechId: null }

  const [assignee] = await db
    .select({
      id: profiles.id,
      role: profiles.role,
      skillTier: profiles.skillTier,
      membershipStatus: profiles.membershipStatus,
      deactivatedAt: profiles.deactivatedAt,
    })
    .from(profiles)
    .where(
      and(
        eq(profiles.id, job.assignedTechId),
        eq(profiles.shopId, actor.shopId as string),
      ),
    )
    .limit(1)

  if (!assignee) {
    return { ok: false, error: 'not_found' }
  }

  if (
    assignee.membershipStatus !== 'active' ||
    assignee.deactivatedAt ||
    !canCreateTickets(assignee.role) ||
    assignee.skillTier === null ||
    ![1, 2, 3].includes(assignee.skillTier)
  ) {
    return { ok: false, error: 'invalid_assignee' }
  }

  const assignedSkillTier = assignee.skillTier as 1 | 2 | 3
  if (assignee.id === actor.profileId) {
    return assignedSkillTier >= job.requiredSkillTier
      ? { ok: true, assignedTechId: assignee.id }
      : { ok: false, error: 'invalid_assignee' }
  }

  if (!canAssignWork(actor.role)) return { ok: false, error: 'invalid_assignee' }
  if (assignedSkillTier < job.requiredSkillTier && !job.confirmBelowTier) {
    return {
      ok: false,
      error: 'tier_confirmation_required',
      warning: {
        code: 'below_required_tier',
        assignedTechId: assignee.id,
        assignedSkillTier,
        requiredSkillTier: job.requiredSkillTier,
      },
    }
  }
  return { ok: true, assignedTechId: assignee.id }
}

export async function createTicket(
  db: AppDb,
  input: { actor: TicketActor; body: unknown; internal?: { ticketId: string } },
): Promise<CreateTicketResult> {
  const denied = actorGate(input.actor)
  if (denied) return denied

  const parsed = createTicketBodySchema.safeParse(input.body)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const body = parsed.data
  const internalTicketId = input.internal
    ? z.uuid().safeParse(input.internal.ticketId)
    : null
  if (input.internal && !internalTicketId?.success) return { ok: false, error: 'invalid_input' }
  const shopId = input.actor.shopId as string

  if (body.source === 'tech_quick') {
    if (body.customerId !== null || body.vehicleId !== null) {
      return { ok: false, error: 'invalid_input' }
    }
  } else if (!body.customerId || !body.vehicleId) {
    return { ok: false, error: 'invalid_input' }
  }

  return db.transaction(async (tx) => {
    if (body.source !== 'tech_quick') {
      const [context] = await tx
        .select({ vehicleId: vehicles.id })
        .from(customers)
        .innerJoin(
          vehicles,
          and(eq(vehicles.id, body.vehicleId as string), eq(vehicles.customerId, customers.id)),
        )
        .where(
          and(eq(customers.id, body.customerId as string), eq(customers.shopId, shopId)),
        )
        .limit(1)
      if (!context) return { ok: false, error: 'not_found' as const }
    }

    const assignments: Array<string | null> = []
    for (const job of body.jobs) {
      const assignment = await validateAssignment(tx as AppDb, input.actor, job)
      if (!assignment.ok) return assignment
      assignments.push(assignment.assignedTechId)
    }

    const created = await insertTicketInTransaction(tx as AppDb, {
      ticketId: internalTicketId?.success ? internalTicketId.data : undefined,
      shopId,
      source: body.source,
      customerId: body.customerId,
      vehicleId: body.vehicleId,
      concern: body.concern,
      whenStarted: body.whenStarted,
      howOften: body.howOften,
      diagnosticAuthorizedCents: body.diagnosticAuthorizedCents,
      diagnosticAuthorizationNote: body.diagnosticAuthorizationNote,
      createdByProfileId: input.actor.profileId,
      jobs: body.jobs.map((job, index) => ({
        title: job.title,
        kind: job.kind,
        requiredSkillTier: job.requiredSkillTier,
        assignedTechId: assignments[index],
        customerSuppliedPartsNote: job.customerSuppliedPartsNote,
      })),
    })
    if (!created) return { ok: false, error: 'not_found' as const }

    const detail = await loadTicketDetail(tx as AppDb, shopId, created.ticketId)
    if (!detail) throw new Error('created_ticket_not_found')
    return { ok: true, ticket: detail }
  })
}

export async function getTicketDetail(
  db: AppDb,
  input: { actor: TicketActor; ticketId: unknown },
): Promise<
  { ok: true; ticket: TicketDetail } | { ok: false; error: TicketDomainError }
> {
  const denied = actorGate(input.actor)
  if (denied) return denied

  const parsedTicketId = z.uuid().safeParse(input.ticketId)
  if (!parsedTicketId.success) return { ok: false, error: 'invalid_input' }

  const ticket = await loadTicketDetail(
    db,
    input.actor.shopId as string,
    parsedTicketId.data,
  )
  return ticket ? { ok: true, ticket } : { ok: false, error: 'not_found' }
}

export async function addTicketJob(
  db: AppDb,
  input: { actor: TicketActor; ticketId: unknown; body: unknown },
): Promise<
  | { ok: true; ticket: TicketDetail }
  | {
      ok: false
      error: TicketDomainError
      warning?: AssignmentTierWarning
    }
> {
  const denied = actorGate(input.actor)
  if (denied) return denied

  const parsedTicketId = z.uuid().safeParse(input.ticketId)
  const parsedBody = ticketJobBodySchema.safeParse(input.body)
  if (!parsedTicketId.success || !parsedBody.success) {
    return { ok: false, error: 'invalid_input' }
  }

  const shopId = input.actor.shopId as string
  return db.transaction(async (tx) => {
    const [lockedTicket] = await tx
      .select({ id: tickets.id, status: tickets.status })
      .from(tickets)
      .where(and(eq(tickets.shopId, shopId), eq(tickets.id, parsedTicketId.data)))
      .limit(1)
      .for('update')
    if (!lockedTicket) return { ok: false, error: 'not_found' as const }
    if (lockedTicket.status !== 'open') {
      return { ok: false, error: 'ticket_not_open' as const }
    }
    if (await ticketAtJobLimit(tx as AppDb, { shopId, ticketId: parsedTicketId.data })) {
      return { ok: false, error: 'job_limit_reached' as const }
    }
    const assignment = await validateAssignment(tx as AppDb, input.actor, parsedBody.data)
    if (!assignment.ok) return assignment

    await tx.insert(ticketJobs).values({
      shopId,
      ticketId: parsedTicketId.data,
      title: parsedBody.data.title,
      kind: parsedBody.data.kind,
      requiredSkillTier: parsedBody.data.requiredSkillTier,
      assignedTechId: assignment.assignedTechId,
    })

    const detail = await loadTicketDetail(tx as AppDb, shopId, parsedTicketId.data)
    if (!detail) throw new Error('updated_ticket_not_found')
    return { ok: true, ticket: detail }
  })
}

export const SUPPLEMENTAL_DIAGNOSTIC_TITLE = 'Additional diagnostic time'
const SUPPLEMENTAL_DIAGNOSTIC_TIER = 2

function canonicalSupplementalLaborHours(value: number): number {
  return Number(formatScaledDecimal(parseScaledDecimal(String(value), 2), 2))
}

const supplementalLaborHoursSchema = z
  .number()
  .positive()
  .max(9999)
  .refine((value) => {
    try {
      canonicalSupplementalLaborHours(value)
      return true
    } catch {
      return false
    }
  })
  .transform(canonicalSupplementalLaborHours)

const normalizedSupplementalUuidSchema = z.uuid().transform((value) => value.toLowerCase())

const supplementalDiagnosticBodySchema = z
  .object({
    clientKey: normalizedSupplementalUuidSchema,
    description: z.string().trim().min(1).max(200).optional(),
    laborHours: supplementalLaborHoursSchema,
    priceCents: z.number().int().nonnegative().max(99_999_999),
    confirmBelowTier: z.boolean().optional(),
  })
  .strict()

function supplementalUuid(label: string, parts: string[]): string {
  const hash = createHash('sha256').update(label)
  for (const part of parts) hash.update('\0').update(part)
  const bytes = hash.digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function supplementalJobId(
  shopId: string,
  ticketId: string,
  profileId: string,
  clientKey: string,
): string {
  return supplementalUuid('shop-os-supplemental-diagnostic-job-v1', [
    shopId,
    ticketId,
    profileId,
    clientKey,
  ])
}

function supplementalLineId(jobId: string): string {
  return supplementalUuid('shop-os-supplemental-diagnostic-line-v1', [jobId])
}

export type SupplementalDiagnosticDependencies = {
  afterTicketLock?: (db: AppDb) => Promise<void>
  afterLinkLock?: () => Promise<void>
  captureLockSql?: (statement: string) => void
}

export type SupplementalDiagnosticResult =
  | {
      ok: true
      confirmation: SupplementalDiagnosticConfirmation
      ticket: TicketDetail
    }
  | {
      ok: false
      error: TicketDomainError
      warning?: AssignmentTierWarning
      retryable?: boolean
    }

function supplementalConflict(retryable = false): SupplementalDiagnosticResult {
  return { ok: false, error: 'conflict', retryable }
}

export type SupplementalDiagnosticConfirmation = {
  clientKey: string
  jobId: string
  title: string
  laborHours: number
  priceCents: number
}

function supplementalConfirmation(
  clientKey: string,
  job: typeof ticketJobs.$inferSelect,
  line: typeof jobLines.$inferSelect,
): SupplementalDiagnosticConfirmation {
  if (line.laborHours === null) throw new Error('supplemental_labor_hours_missing')
  return {
    clientKey,
    jobId: job.id,
    title: job.title,
    laborHours: Number(line.laborHours),
    priceCents: line.priceCents,
  }
}

function coherentSupplementalReplayLine(
  job: typeof ticketJobs.$inferSelect,
  lines: Array<typeof jobLines.$inferSelect>,
  expected: {
    jobId: string
    lineId: string
    shopId: string
    ticketId: string
    title: string
    assignedTechId: string | null
    laborHours: number
    priceCents: number
  },
): typeof jobLines.$inferSelect | null {
  if (
    job.id !== expected.jobId
    || job.shopId !== expected.shopId
    || job.ticketId !== expected.ticketId
    || job.title !== expected.title
    || job.kind !== 'diagnostic'
    || job.requiredSkillTier !== SUPPLEMENTAL_DIAGNOSTIC_TIER
    || job.assignedTechId !== expected.assignedTechId
  ) return null
  if (lines.length !== 1) return null
  const [line] = lines
  return line.id === expected.lineId
    && line.shopId === expected.shopId
    && line.jobId === expected.jobId
    && line.kind === 'labor'
    && line.description === expected.title
    && line.sort === 0
    && Number(line.quantity) === 1
    && line.priceCents === expected.priceCents
    && line.taxable === false
    && Number(line.laborHours) === expected.laborHours
    && line.laborRateCents === null
    && line.source === 'manual'
    && line.partNumber === null
    && line.brand === null
    && line.unitCostCents === null
    && line.coreChargeCents === null
    && line.fitment === null
    && line.vendorAccountId === null
    && line.externalOfferId === null
    && line.vendorSnapshot === null
    && line.partStatus === 'proposed'
    && line.orderedAt === null
    && line.orderedByProfileId === null
    && line.receivedAt === null
    && line.receivedByProfileId === null
    ? line
    : null
}

/**
 * Records customer-approved diagnostic overage as a brand-new open job on an
 * OPEN ticket, so it flows through the normal quote → approval → authorization
 * path without touching any in-progress job's frozen scope. The supplemental
 * job carries one writer-typed labor line and defaults its assignment to the
 * technician already on the ticket's diagnostic job, keeping that tech
 * authorized for the extra time.
 */
export async function addSupplementalDiagnosticTime(
  db: AppDb,
  input: { actor: TicketActor; ticketId: unknown; body: unknown },
  dependencies: SupplementalDiagnosticDependencies = {},
): Promise<SupplementalDiagnosticResult> {
  const denied = actorGate(input.actor)
  if (denied) return denied

  const parsedTicketId = normalizedSupplementalUuidSchema.safeParse(input.ticketId)
  const parsedProfileId = normalizedSupplementalUuidSchema.safeParse(input.actor.profileId)
  const parsedShopId = normalizedSupplementalUuidSchema.safeParse(input.actor.shopId)
  const parsedBody = supplementalDiagnosticBodySchema.safeParse(input.body)
  if (!parsedTicketId.success || !parsedProfileId.success || !parsedShopId.success || !parsedBody.success) {
    return { ok: false, error: 'invalid_input' }
  }

  const title = parsedBody.data.description ?? SUPPLEMENTAL_DIAGNOSTIC_TITLE
  const shopId = parsedShopId.data
  try {
    return await db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      const ticketLockQuery = transactionDb
        .select({
          id: tickets.id,
          ticketNumber: tickets.ticketNumber,
          customerId: tickets.customerId,
          vehicleId: tickets.vehicleId,
          status: tickets.status,
        })
        .from(tickets)
        .where(and(eq(tickets.shopId, shopId), eq(tickets.id, parsedTicketId.data)))
        .limit(1)
        .for('update', { noWait: true })
      dependencies.captureLockSql?.(ticketLockQuery.toSQL().sql)
      const [lockedTicket] = await ticketLockQuery
      if (!lockedTicket) return { ok: false, error: 'not_found' as const }
      if (lockedTicket.status !== 'open') {
        return { ok: false, error: 'ticket_not_open' as const }
      }
      await dependencies.afterTicketLock?.(transactionDb)

      const jobLockQuery = transactionDb
        .select()
        .from(ticketJobs)
        .where(and(eq(ticketJobs.shopId, shopId), eq(ticketJobs.ticketId, parsedTicketId.data)))
        .orderBy(ticketJobs.id)
        .for('update', { noWait: true })
      dependencies.captureLockSql?.(jobLockQuery.toSQL().sql)
      const jobRows = await jobLockQuery
      let lineRows: Array<typeof jobLines.$inferSelect> = []
      if (jobRows.length > 0) {
        const lineLockQuery = transactionDb
          .select()
          .from(jobLines)
          .where(and(
            eq(jobLines.shopId, shopId),
            inArray(jobLines.jobId, jobRows.map((job) => job.id)),
          ))
          .orderBy(jobLines.id)
          .for('update', { noWait: true })
        dependencies.captureLockSql?.(lineLockQuery.toSQL().sql)
        lineRows = await lineLockQuery
      }
      const versionLockQuery = transactionDb
        .select()
        .from(quoteVersions)
        .where(and(
          eq(quoteVersions.shopId, shopId),
          eq(quoteVersions.ticketId, parsedTicketId.data),
          isNull(quoteVersions.supersededAt),
        ))
        .orderBy(quoteVersions.id)
        .for('update', { noWait: true })
      dependencies.captureLockSql?.(versionLockQuery.toSQL().sql)
      const activeVersions = await versionLockQuery

      const jobId = supplementalJobId(
        shopId,
        parsedTicketId.data,
        parsedProfileId.data,
        parsedBody.data.clientKey,
      )
      const lineId = supplementalLineId(jobId)
      const existing = jobRows.find((job) => job.id === jobId)
      const inheritedAssigneeId = [...jobRows]
        .filter((job) => job.kind === 'diagnostic' && job.assignedTechId !== null)
        .sort((left, right) => (
          left.createdAt.getTime() - right.createdAt.getTime()
          || left.id.localeCompare(right.id)
        ))[0]?.assignedTechId ?? null
      const assigneeIdToValidate = existing ? existing.assignedTechId : inheritedAssigneeId
      const profileIds = [...new Set([
        parsedProfileId.data,
        ...(assigneeIdToValidate ? [assigneeIdToValidate] : []),
      ])].sort()
      const profileLockQuery = transactionDb
        .select({
          id: profiles.id,
          shopId: profiles.shopId,
          role: profiles.role,
          skillTier: profiles.skillTier,
          membershipStatus: profiles.membershipStatus,
          deactivatedAt: profiles.deactivatedAt,
        })
        .from(profiles)
        .where(and(eq(profiles.shopId, shopId), inArray(profiles.id, profileIds)))
        .orderBy(profiles.id)
        .for('update', { noWait: true })
      dependencies.captureLockSql?.(profileLockQuery.toSQL().sql)
      const lockedProfiles = await profileLockQuery
      const currentActor = lockedProfiles.find((profile) => profile.id === parsedProfileId.data)
      if (!currentActor) return { ok: false, error: 'not_found' as const }
      if (currentActor.membershipStatus !== 'active' || currentActor.deactivatedAt) {
        return { ok: false, error: 'inactive_profile' as const }
      }
      if (!canAssignWork(currentActor.role)) {
        return { ok: false, error: 'forbidden' as const }
      }

      let assignedTechId: string | null = null
      if (assigneeIdToValidate) {
        const assignee = lockedProfiles.find((profile) => profile.id === assigneeIdToValidate)
        if (!assignee
          || assignee.shopId !== shopId
          || assignee.membershipStatus !== 'active'
          || assignee.deactivatedAt
          || !canCreateTickets(assignee.role)
          || assignee.skillTier === null
          || ![1, 2, 3].includes(assignee.skillTier)) {
          return { ok: false, error: 'invalid_assignee' as const }
        }
        const assignedSkillTier = assignee.skillTier as 1 | 2 | 3
        if (assignee.id === currentActor.id && assignedSkillTier < SUPPLEMENTAL_DIAGNOSTIC_TIER) {
          return { ok: false, error: 'invalid_assignee' as const }
        }
        if (assignedSkillTier < SUPPLEMENTAL_DIAGNOSTIC_TIER
          && !parsedBody.data.confirmBelowTier) {
          return {
            ok: false,
            error: 'tier_confirmation_required' as const,
            warning: {
              code: 'below_required_tier' as const,
              assignedTechId: assignee.id,
              assignedSkillTier,
              requiredSkillTier: SUPPLEMENTAL_DIAGNOSTIC_TIER,
            },
          }
        }
        assignedTechId = assignee.id
      }

      if (existing) {
        const replayLine = coherentSupplementalReplayLine(
          existing,
          lineRows.filter((line) => line.jobId === jobId),
          {
            jobId,
            lineId,
            shopId,
            ticketId: parsedTicketId.data,
            title,
            assignedTechId,
            laborHours: parsedBody.data.laborHours,
            priceCents: parsedBody.data.priceCents,
          },
        )
        if (!replayLine) return supplementalConflict()
        const detail = await loadTicketDetail(transactionDb, shopId, parsedTicketId.data)
        if (!detail) throw new Error('updated_ticket_not_found')
        return {
          ok: true as const,
          confirmation: supplementalConfirmation(parsedBody.data.clientKey, existing, replayLine),
          ticket: detail,
        }
      }

      if (jobRows.length >= MAX_TICKET_JOBS_PER_TICKET) {
        return { ok: false, error: 'job_limit_reached' as const }
      }
      if (activeVersions.length > 1) return supplementalConflict()
      if (activeVersions[0]) {
        try {
          const snapshot = validatedQuoteSnapshot(activeVersions[0].snapshot, lockedTicket)
          const lockedJobIds = new Set(jobRows.map((job) => job.id))
          if (snapshot.jobs.some((job) => !lockedJobIds.has(job.id))) {
            return supplementalConflict()
          }
        } catch (error) {
          if (error instanceof TypeError || error instanceof RangeError) {
            return supplementalConflict()
          }
          throw error
        }
      }

      const invalidationFailure = await invalidateActiveQuoteVersion(transactionDb, {
        shopId,
        ticketId: parsedTicketId.data,
        jobIds: jobRows.map((job) => job.id),
        activeVersions,
      }, { afterLinkLock: dependencies.afterLinkLock })
      if (invalidationFailure) {
        return supplementalConflict(invalidationFailure.retryable === true)
      }

      const [createdJob] = await transactionDb
        .insert(ticketJobs)
        .values({
          id: jobId,
          shopId,
          ticketId: parsedTicketId.data,
          title,
          kind: 'diagnostic',
          requiredSkillTier: SUPPLEMENTAL_DIAGNOSTIC_TIER,
          assignedTechId,
        })
        .returning()
      if (!createdJob) throw new Error('supplemental_job_not_created')

      const supplementalLine: SafeCannedJobLine = {
        kind: 'labor',
        description: title,
        sort: 0,
        priceCents: parsedBody.data.priceCents,
        taxable: false,
        hours: String(parsedBody.data.laborHours),
      }
      const [lineValue] = cannedJobLineInsertValues(shopId, createdJob.id, [supplementalLine])
      const [createdLine] = await transactionDb
        .insert(jobLines)
        .values({ ...lineValue, id: lineId })
        .returning()
      if (!createdLine) throw new Error('supplemental_line_not_created')

      const detail = await loadTicketDetail(transactionDb, shopId, parsedTicketId.data)
      if (!detail) throw new Error('updated_ticket_not_found')
      return {
        ok: true as const,
        confirmation: supplementalConfirmation(parsedBody.data.clientKey, createdJob, createdLine),
        ticket: detail,
      }
    })
  } catch (error) {
    if (isLockUnavailable(error)) return supplementalConflict(true)
    throw error
  }
}

export type SafeTicketAssignee = NonNullable<TicketDetail['jobs'][number]['assignedTech']>

export type TicketJobAssignmentResult =
  | { ok: true; changed: boolean; ticket: TicketDetail }
  | {
      ok: false
      error: TicketDomainError
      warning?: AssignmentTierWarning
      currentAssignee?: SafeTicketAssignee
    }

export type TicketJobAssignmentDependencies = {
  beforeReassignUpdate?: (db: AppDb) => Promise<void>
}

type AssignmentContext = {
  ticketStatus: string
  workStatus: string
  hasLiveDiagnosticStartLease: boolean
  requiredSkillTier: number
  assignedTechId: string | null
  assignedTechFullName: string | null
  assignedTechRole: string | null
  assignedTechSkillTier: number | null
}

async function loadAssignmentContext(
  db: AppDb,
  shopId: string,
  ticketId: string,
  jobId: string,
): Promise<AssignmentContext | null> {
  const [context] = await db
    .select({
      ticketStatus: tickets.status,
      workStatus: ticketJobs.workStatus,
      hasLiveDiagnosticStartLease: sql<boolean>`
        ${ticketJobs.diagnosticStartState} = 'initializing'
        and ${ticketJobs.diagnosticStartLeaseUntil} > now()
      `,
      requiredSkillTier: ticketJobs.requiredSkillTier,
      assignedTechId: ticketJobs.assignedTechId,
      assignedTechFullName: profiles.fullName,
      assignedTechRole: profiles.role,
      assignedTechSkillTier: profiles.skillTier,
    })
    .from(ticketJobs)
    .innerJoin(
      tickets,
      and(
        eq(tickets.shopId, ticketJobs.shopId),
        eq(tickets.id, ticketJobs.ticketId),
      ),
    )
    .leftJoin(profiles, eq(profiles.id, ticketJobs.assignedTechId))
    .where(
      and(
        eq(ticketJobs.shopId, shopId),
        eq(ticketJobs.ticketId, ticketId),
        eq(ticketJobs.id, jobId),
      ),
    )
    .limit(1)
  return context ?? null
}

function safeCurrentAssignee(
  context: AssignmentContext,
): SafeTicketAssignee | null {
  if (!context.assignedTechId || !context.assignedTechRole) return null
  return {
    id: context.assignedTechId,
    fullName: context.assignedTechFullName,
    role: context.assignedTechRole,
    skillTier: context.assignedTechSkillTier,
  }
}

async function persistedActorError(
  db: AppDb,
  actor: TicketActor,
): Promise<{ ok: false; error: TicketDomainError } | null> {
  const [profile] = await db
    .select({
      role: profiles.role,
      membershipStatus: profiles.membershipStatus,
      deactivatedAt: profiles.deactivatedAt,
    })
    .from(profiles)
    .where(
      and(
        eq(profiles.shopId, actor.shopId as string),
        eq(profiles.id, actor.profileId),
      ),
    )
    .limit(1)
  if (!profile || !canCreateTickets(profile.role)) return { ok: false, error: 'forbidden' }
  if (profile.membershipStatus !== 'active' || profile.deactivatedAt) {
    return { ok: false, error: 'inactive_profile' }
  }
  return null
}

async function persistedClaimActorError(
  db: AppDb,
  actor: TicketActor,
  requiredSkillTier: number,
): Promise<{ ok: false; error: TicketDomainError } | null> {
  const [profile] = await db
    .select({
      role: profiles.role,
      skillTier: profiles.skillTier,
      membershipStatus: profiles.membershipStatus,
      deactivatedAt: profiles.deactivatedAt,
    })
    .from(profiles)
    .where(
      and(
        eq(profiles.shopId, actor.shopId as string),
        eq(profiles.id, actor.profileId),
      ),
    )
    .limit(1)
  if (!profile || !canCreateTickets(profile.role)) return { ok: false, error: 'forbidden' }
  if (profile.membershipStatus !== 'active' || profile.deactivatedAt) {
    return { ok: false, error: 'inactive_profile' }
  }
  if (
    profile.skillTier === null ||
    ![1, 2, 3].includes(profile.skillTier) ||
    profile.skillTier < requiredSkillTier
  ) {
    return { ok: false, error: 'invalid_assignee' }
  }
  return null
}

function assignmentStateError(
  context: AssignmentContext | null,
): { ok: false; error: TicketDomainError } | null {
  if (!context) return { ok: false, error: 'not_found' }
  if (context.ticketStatus !== 'open') return { ok: false, error: 'ticket_not_open' }
  if (context.workStatus !== 'open') return { ok: false, error: 'job_not_open' }
  if (context.hasLiveDiagnosticStartLease) {
    return { ok: false, error: 'job_not_open' }
  }
  return null
}

async function updatedAssignmentTicket(
  db: AppDb,
  shopId: string,
  ticketId: string,
  changed = true,
): Promise<TicketJobAssignmentResult> {
  const ticket = await loadTicketDetail(db, shopId, ticketId)
  if (!ticket) throw new Error('updated_ticket_not_found')
  return { ok: true, changed, ticket }
}

type AssignmentBody = z.infer<typeof assignmentBodySchema>

type AssignmentReceiptIntent = {
  action: AssignmentBody['action']
  requestedAssignedTechId: string | null
  confirmBelowTier: boolean
}

function assignmentReceiptIntent(
  body: AssignmentBody,
  actorProfileId: string,
): AssignmentReceiptIntent {
  if (body.action === 'claim') {
    return { action: body.action, requestedAssignedTechId: actorProfileId, confirmBelowTier: false }
  }
  if (body.action === 'unclaim') {
    return { action: body.action, requestedAssignedTechId: null, confirmBelowTier: false }
  }
  return {
    action: body.action,
    requestedAssignedTechId: body.assignedTechId,
    confirmBelowTier: body.confirmBelowTier === true,
  }
}

function receiptMatchesAssignmentIntent(
  payload: unknown,
  intent: AssignmentReceiptIntent,
): boolean {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return false
  const record = payload as Record<string, unknown>
  return record.action === intent.action
    && record.requestedAssignedTechId === intent.requestedAssignedTechId
    && record.confirmBelowTier === intent.confirmBelowTier
}

async function claimTicketJob(
  db: AppDb,
  actor: TicketActor,
  shopId: string,
  ticketId: string,
  jobId: string,
): Promise<TicketJobAssignmentResult> {
  const [claimed] = await db
    .update(ticketJobs)
    .set({
      assignedTechId: actor.profileId,
      claimedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(ticketJobs.shopId, shopId),
        eq(ticketJobs.ticketId, ticketId),
        eq(ticketJobs.id, jobId),
        eq(ticketJobs.workStatus, 'open'),
        isNull(ticketJobs.assignedTechId),
        sql`exists (
          select 1 from ${tickets}
          where ${tickets.shopId} = ${ticketJobs.shopId}
            and ${tickets.id} = ${ticketJobs.ticketId}
            and ${tickets.status} = 'open'
        )`,
        sql`exists (
          select 1 from ${profiles}
          where ${profiles.shopId} = ${ticketJobs.shopId}
            and ${profiles.id} = ${actor.profileId}
            and ${profiles.membershipStatus} = 'active'
            and ${profiles.deactivatedAt} is null
            and ${profiles.role} in ('tech', 'advisor', 'parts', 'owner')
            and ${profiles.skillTier} between 1 and 3
            and ${profiles.skillTier} >= ${ticketJobs.requiredSkillTier}
        )`,
      ),
    )
    .returning()

  if (claimed) return updatedAssignmentTicket(db, shopId, ticketId)

  const context = await loadAssignmentContext(db, shopId, ticketId, jobId)
  const stateError = assignmentStateError(context)
  if (stateError) return stateError
  const actorError = await persistedClaimActorError(
    db,
    actor,
    (context as AssignmentContext).requiredSkillTier,
  )
  if (actorError) return actorError
  const assignee = safeCurrentAssignee(context as AssignmentContext)
  if (assignee) {
    return { ok: false, error: 'assignment_conflict', currentAssignee: assignee }
  }
  return { ok: false, error: 'invalid_assignee' }
}

async function unclaimTicketJob(
  db: AppDb,
  actor: TicketActor,
  shopId: string,
  ticketId: string,
  jobId: string,
): Promise<TicketJobAssignmentResult> {
  const [unclaimed] = await db
    .update(ticketJobs)
    .set({ assignedTechId: null, claimedAt: null, updatedAt: sql`now()` })
    .where(
      and(
        eq(ticketJobs.shopId, shopId),
        eq(ticketJobs.ticketId, ticketId),
        eq(ticketJobs.id, jobId),
        eq(ticketJobs.workStatus, 'open'),
        or(
          ne(ticketJobs.diagnosticStartState, 'initializing'),
          isNull(ticketJobs.diagnosticStartLeaseUntil),
          lte(ticketJobs.diagnosticStartLeaseUntil, sql`now()`),
        ),
        sql`exists (
          select 1 from ${tickets}
          where ${tickets.shopId} = ${ticketJobs.shopId}
            and ${tickets.id} = ${ticketJobs.ticketId}
            and ${tickets.status} = 'open'
        )`,
        sql`exists (
          select 1 from ${profiles}
          where ${profiles.shopId} = ${ticketJobs.shopId}
            and ${profiles.id} = ${actor.profileId}
            and ${profiles.membershipStatus} = 'active'
            and ${profiles.deactivatedAt} is null
            and ${profiles.role} in ('tech', 'advisor', 'parts', 'owner')
        )`,
        or(
          eq(ticketJobs.assignedTechId, actor.profileId),
          sql`exists (
            select 1 from ${profiles}
            where ${profiles.shopId} = ${ticketJobs.shopId}
              and ${profiles.id} = ${actor.profileId}
              and ${profiles.role} in ('advisor', 'owner')
          )`,
        ),
      ),
    )
    .returning()

  if (unclaimed) return updatedAssignmentTicket(db, shopId, ticketId)
  const context = await loadAssignmentContext(db, shopId, ticketId, jobId)
  const stateError = assignmentStateError(context)
  if (stateError) return stateError
  const actorError = await persistedActorError(db, actor)
  if (actorError) return actorError
  return { ok: false, error: 'forbidden' }
}

async function reassignTicketJob(
  db: AppDb,
  actor: TicketActor,
  shopId: string,
  ticketId: string,
  jobId: string,
  body: { assignedTechId: string; confirmBelowTier?: boolean },
  dependencies: TicketJobAssignmentDependencies,
): Promise<TicketJobAssignmentResult> {
  const actorError = await persistedActorError(db, actor)
  if (actorError) return actorError

  const [persistedActor] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(and(eq(profiles.shopId, shopId), eq(profiles.id, actor.profileId)))
    .limit(1)
  if (!persistedActor || !canAssignWork(persistedActor.role)) {
    return { ok: false, error: 'forbidden' }
  }

  const context = await loadAssignmentContext(db, shopId, ticketId, jobId)
  const stateError = assignmentStateError(context)
  if (stateError) return stateError

  const assignment = await validateAssignment(db, { ...actor, role: persistedActor.role }, {
    title: 'assignment',
    kind: 'repair',
    requiredSkillTier: (context as AssignmentContext).requiredSkillTier as 1 | 2 | 3,
    assignedTechId: body.assignedTechId,
    confirmBelowTier: body.confirmBelowTier,
  })
  if (!assignment.ok) return assignment

  await dependencies.beforeReassignUpdate?.(db)

  const [reassigned] = await db
    .update(ticketJobs)
    .set({
      assignedTechId: assignment.assignedTechId,
      claimedAt: null,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(ticketJobs.shopId, shopId),
        eq(ticketJobs.ticketId, ticketId),
        eq(ticketJobs.id, jobId),
        eq(ticketJobs.workStatus, 'open'),
        or(
          ne(ticketJobs.diagnosticStartState, 'initializing'),
          isNull(ticketJobs.diagnosticStartLeaseUntil),
          lte(ticketJobs.diagnosticStartLeaseUntil, sql`now()`),
        ),
        sql`exists (
          select 1 from ${tickets}
          where ${tickets.shopId} = ${ticketJobs.shopId}
            and ${tickets.id} = ${ticketJobs.ticketId}
            and ${tickets.status} = 'open'
        )`,
        sql`exists (
          select 1 from ${profiles}
          where ${profiles.shopId} = ${ticketJobs.shopId}
            and ${profiles.id} = ${actor.profileId}
            and ${profiles.membershipStatus} = 'active'
            and ${profiles.deactivatedAt} is null
            and ${profiles.role} in ('advisor', 'owner')
        )`,
        sql`exists (
          select 1 from ${profiles}
          where ${profiles.shopId} = ${ticketJobs.shopId}
            and ${profiles.id} = ${assignment.assignedTechId as string}
            and ${profiles.membershipStatus} = 'active'
            and ${profiles.deactivatedAt} is null
            and ${profiles.role} in ('tech', 'advisor', 'parts', 'owner')
            and ${profiles.skillTier} between 1 and 3
            and (
              ${body.confirmBelowTier === true}
              or ${profiles.skillTier} >= ${ticketJobs.requiredSkillTier}
            )
        )`,
      ),
    )
    .returning()
  if (reassigned) return updatedAssignmentTicket(db, shopId, ticketId)

  const currentContext = await loadAssignmentContext(db, shopId, ticketId, jobId)
  const currentStateError = assignmentStateError(currentContext)
  if (currentStateError) return currentStateError

  const currentActorError = await persistedActorError(db, actor)
  if (currentActorError) return currentActorError
  const [currentActor] = await db
    .select({ role: profiles.role })
    .from(profiles)
    .where(and(eq(profiles.shopId, shopId), eq(profiles.id, actor.profileId)))
    .limit(1)
  if (!currentActor || !canAssignWork(currentActor.role)) {
    return { ok: false, error: 'forbidden' }
  }

  const currentAssignment = await validateAssignment(
    db,
    { ...actor, role: currentActor.role },
    {
      title: 'assignment',
      kind: 'repair',
      requiredSkillTier: (currentContext as AssignmentContext).requiredSkillTier as 1 | 2 | 3,
      assignedTechId: body.assignedTechId,
      confirmBelowTier: body.confirmBelowTier,
    },
  )
  if (!currentAssignment.ok) return currentAssignment
  return { ok: false, error: 'not_found' }
}

export async function mutateTicketJobAssignment(
  db: AppDb,
  input: { actor: TicketActor; ticketId: unknown; jobId: unknown; body: unknown },
  dependencies: TicketJobAssignmentDependencies = {},
): Promise<TicketJobAssignmentResult> {
  const denied = actorGate(input.actor)
  if (denied) return denied

  const parsedTicketId = z.uuid().safeParse(input.ticketId)
  const parsedJobId = z.uuid().safeParse(input.jobId)
  const parsedBody = assignmentBodySchema.safeParse(input.body)
  if (!parsedTicketId.success || !parsedJobId.success || !parsedBody.success) {
    return { ok: false, error: 'invalid_input' }
  }

  const shopId = input.actor.shopId as string
  const body = parsedBody.data
  const intent = assignmentReceiptIntent(body, input.actor.profileId)

  return db.transaction(async (txRaw) => {
    const tx = txRaw as AppDb
    const actorError = await persistedActorError(tx, input.actor)
    if (actorError) return actorError

    const [receipt] = await tx
      .select({
        ticketId: ticketActivity.ticketId,
        jobId: ticketActivity.jobId,
        actorProfileId: ticketActivity.actorProfileId,
        kind: ticketActivity.kind,
        payload: ticketActivity.payload,
      })
      .from(ticketActivity)
      .where(and(
        eq(ticketActivity.shopId, shopId),
        eq(ticketActivity.requestKey, body.requestKey),
      ))
      .limit(1)
    if (receipt) {
      if (receipt.ticketId !== parsedTicketId.data
        || receipt.jobId !== parsedJobId.data
        || receipt.actorProfileId !== input.actor.profileId
        || receipt.kind !== 'job_reassigned'
        || !receiptMatchesAssignmentIntent(receipt.payload, intent)) {
        return { ok: false, error: 'conflict' }
      }
      return updatedAssignmentTicket(tx, shopId, parsedTicketId.data, false)
    }

    const before = await loadAssignmentContext(tx, shopId, parsedTicketId.data, parsedJobId.data)
    const result = body.action === 'claim'
      ? await claimTicketJob(tx, input.actor, shopId, parsedTicketId.data, parsedJobId.data)
      : body.action === 'unclaim'
        ? await unclaimTicketJob(tx, input.actor, shopId, parsedTicketId.data, parsedJobId.data)
        : await reassignTicketJob(
            tx,
            input.actor,
            shopId,
            parsedTicketId.data,
            parsedJobId.data,
            body,
            dependencies,
          )
    if (!result.ok) return result

    const assigned = result.ticket.jobs.find((job) => job.id === parsedJobId.data)?.assignedTechId
    if (!before || assigned === undefined) throw new Error('assignment_projection_missing')
    const activity = await appendTicketActivity(tx, {
      shopId,
      ticketId: parsedTicketId.data,
      jobId: parsedJobId.data,
      actorProfileId: input.actor.profileId,
      kind: 'job_reassigned',
      requestKey: body.requestKey,
      payload: {
        action: intent.action,
        requestedAssignedTechId: intent.requestedAssignedTechId,
        confirmBelowTier: intent.confirmBelowTier,
        fromAssignedTechId: before.assignedTechId,
        toAssignedTechId: assigned,
      },
    })
    if (!activity.ok) throw new Error('ticket_activity_conflict')
    return result
  })
}
