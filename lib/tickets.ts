import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  jobLines,
  profiles,
  sessions,
  shops,
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
import type {
  CanonicalMutationEnvelopeV1,
  CanonicalQuickReceiptRequestV1,
  CreatedTicketBatchV1,
  FinalizedTicketCreationV1,
  MaterializedTicketIntakeIdentityV1,
  MutationFingerprintKeyringV1,
  NormalizedJobLineCreateV1,
  NormalizedTicketCreateV1,
  NormalizedTicketJobCreateV1,
  ResolvedLockedQuickTemplateV1,
  ResolvedTicketCreationV1,
  TrustedTicketOriginV1,
  MutationAttemptCapabilityV1,
  TicketOperationOriginV1,
  TicketCreatingEnvelopeBaseV1,
} from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import type { LockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import {
  insertMutationReceiptPrimitiveV1,
  lockAndClassifyMutationReceiptV1,
  type MutationReceiptExpectationV1,
} from '@/lib/shop-os/continuity/mutation-foundation/receipts'
import {
  finalizeMutationRevisionsV1,
  reserveJobSequencesForInsertionV1,
  type CreatedMutationRowsV1,
  type FinalizedMutationRevisionsV1,
  type TicketRevisionDeltaV1,
} from '@/lib/shop-os/continuity/mutation-foundation/revisions'
import { assertLiveLockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import { consumeCanonicalQuickReceiptRequestForCreationV1 } from '@/lib/intake/quick-ticket-contracts'
import { consumeMaterializedTicketIntakeIdentityForCreationV1 } from '@/lib/intake/ticket-identity'
import { consumeResolvedLockedQuickTemplateForCreationV1 } from '@/lib/shop-os/canned-jobs'
import { parseScaledDecimal } from '@/lib/shop-os/quote-math'
import { resolveTrustedTicketOriginInLockedScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/ticket-origin.server'

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

export type AssignmentTierWarning = {
  code: 'below_required_tier'
  assignedTechId: string
  assignedSkillTier: 1 | 2 | 3
  requiredSkillTier: 1 | 2 | 3
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
    workNotes: string | null
    diagnosticStartState: string
    diagnosticStartErrorCode: string | null
    createdAt: Date
    updatedAt: Date
  }>
  createdAt: Date
  updatedAt: Date
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
  customerName: string | null
  vehicle: { year: number; make: string; model: string } | null
  title: string
  kind: 'diagnostic' | 'repair' | 'maintenance'
  requiredSkillTier: number
  sessionId: string | null
  workStatus: 'open' | 'in_progress' | 'blocked'
  canClaim: boolean
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
  linkedSessionIds: string[]
}

const emptyTodayTicketJobs = (): TodayTicketJobs => ({
  myJobs: [],
  openJobs: [],
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

  const rows = await db
    .select({
      id: ticketJobs.id,
      ticketId: tickets.id,
      ticketNumber: tickets.ticketNumber,
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
      diagnosticStartState: ticketJobs.diagnosticStartState,
      diagnosticStartErrorCode: ticketJobs.diagnosticStartErrorCode,
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
        ),
      ),
    )
    .orderBy(asc(tickets.ticketNumber), asc(ticketJobs.createdAt), asc(ticketJobs.id))

  const myJobs: TodayTicketJob[] = []
  const openJobs: TodayTicketJob[] = []
  const linkedSessionIds: string[] = []

  for (const row of rows) {
    const job: TodayTicketJob = {
      id: row.id,
      ticketId: row.ticketId,
      ticketNumber: row.ticketNumber,
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
      canClaim:
        row.assignedTechId === null &&
        actor.skillTier !== null &&
        [1, 2, 3].includes(actor.skillTier) &&
        row.requiredSkillTier <= actor.skillTier,
      diagnosticStartState: row.diagnosticStartState,
      diagnosticStartErrorCode: safeDiagnosticStartErrorCode(row.diagnosticStartErrorCode),
    }

    if (row.assignedTechId === actor.profileId) myJobs.push(job)
    else openJobs.push(job)
    if (row.persistedSessionId) linkedSessionIds.push(row.persistedSessionId)
  }

  return { myJobs, openJobs, linkedSessionIds }
}

export function ticketDomainStatus(
  result: { ok: true } | { ok: false; error: TicketDomainError },
  successStatus: number,
): number {
  if (result.ok) return successStatus

  switch (result.error) {
    case 'invalid_input':
    case 'invalid_assignee':
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
  })
  .strict()

const assignmentBodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('claim') }).strict(),
  z.object({ action: z.literal('unclaim') }).strict(),
  z
    .object({
      action: z.literal('reassign'),
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
      workNotes: job.workNotes,
      diagnosticStartState: job.diagnosticStartState,
      diagnosticStartErrorCode: job.diagnosticStartErrorCode,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

export type SafeTicketAssignee = NonNullable<TicketDetail['jobs'][number]['assignedTech']>

export type TicketJobAssignmentResult =
  | { ok: true; ticket: TicketDetail }
  | {
      ok: false
      error: TicketDomainError
      warning?: AssignmentTierWarning
      currentAssignee?: SafeTicketAssignee
    }

export type TicketJobAssignmentDependencies = {
  beforeReassignUpdate?: () => Promise<void>
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
): Promise<TicketJobAssignmentResult> {
  const ticket = await loadTicketDetail(db, shopId, ticketId)
  if (!ticket) throw new Error('updated_ticket_not_found')
  return { ok: true, ticket }
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

  await dependencies.beforeReassignUpdate?.()

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
  if (parsedBody.data.action === 'claim') {
    return claimTicketJob(
      db,
      input.actor,
      shopId,
      parsedTicketId.data,
      parsedJobId.data,
    )
  }
  if (parsedBody.data.action === 'unclaim') {
    return unclaimTicketJob(
      db,
      input.actor,
      shopId,
      parsedTicketId.data,
      parsedJobId.data,
    )
  }
  return reassignTicketJob(
    db,
    input.actor,
    shopId,
    parsedTicketId.data,
    parsedJobId.data,
    parsedBody.data,
    dependencies,
  )
}

export type ResolveTicketCreationInputV1 =
  | Readonly<{
      mode: 'insert'
      origin: TrustedTicketOriginV1
      ticket: NormalizedTicketCreateV1
      jobs: readonly NormalizedTicketJobCreateV1[]
      seededLinesByJobIndex: ReadonlyMap<number, readonly NormalizedJobLineCreateV1[]>
    }>
  | Readonly<{
      mode: 'intake_insert'
      origin: TrustedTicketOriginV1
      ticket: Omit<NormalizedTicketCreateV1, 'customerId' | 'vehicleId'>
      identity: MaterializedTicketIntakeIdentityV1
      jobs: readonly NormalizedTicketJobCreateV1[]
      seededLinesByJobIndex: ReadonlyMap<number, readonly NormalizedJobLineCreateV1[]>
    }>
  | Readonly<{
      mode: 'quick_insert'
      origin: TrustedTicketOriginV1
      identity: MaterializedTicketIntakeIdentityV1
      receipt: CanonicalQuickReceiptRequestV1
      template: ResolvedLockedQuickTemplateV1 | null
    }>
  | Readonly<{
      mode: 'replay'
      origin: TrustedTicketOriginV1
      resultTicketId: string
      receipt: CanonicalQuickReceiptRequestV1
    }>

type OwnedQuickReceiptV1 = ReturnType<
  typeof consumeCanonicalQuickReceiptRequestForCreationV1
>

type OwnedSeedLinesV1 = readonly Readonly<{
  jobIndex: number
  lines: readonly NormalizedJobLineCreateV1[]
}>[]

type ResolvedTicketCreationStateV1 = {
  tx: AppDb
  scope: LockedMutationScopeV1
  capability: MutationAttemptCapabilityV1
  mode: ResolveTicketCreationInputV1['mode']
  origin: TicketOperationOriginV1
  ticket: NormalizedTicketCreateV1 | null
  jobs: readonly NormalizedTicketJobCreateV1[]
  seededLines: OwnedSeedLinesV1
  createdRows: CreatedMutationRowsV1
  receipt: OwnedQuickReceiptV1 | null
  replayTicketId: string | null
  phase: 'resolved' | 'inserting' | 'inserted' | 'finalizing' | 'finalized'
  batch?: CreatedTicketBatchV1
  insertedLineIds?: readonly string[]
  expectedTicketFingerprint?: string
  expectedJobFingerprints?: ReadonlyMap<string, string>
  expectedLineFingerprints?: ReadonlyMap<string, string>
  revisionResult?: FinalizedMutationRevisionsV1
}

type FinalizedTicketCreationStateV1 = Readonly<{
  tx: AppDb
  scope: LockedMutationScopeV1
  capability: MutationAttemptCapabilityV1
  resolved: ResolvedTicketCreationV1
  batch: CreatedTicketBatchV1
  revisionResult: FinalizedMutationRevisionsV1
}> & {
  receiptInserted: boolean
}

const resolvedTicketCreationStates = new WeakMap<
  ResolvedTicketCreationV1,
  ResolvedTicketCreationStateV1
>()
const finalizedTicketCreationStates = new WeakMap<
  FinalizedTicketCreationV1,
  FinalizedTicketCreationStateV1
>()

const KERNEL_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KERNEL_JOB_KINDS = new Set(['diagnostic', 'repair', 'maintenance'])
const KERNEL_LINE_KINDS = new Set(['part', 'labor', 'fee'])

function invalidTicketCreationKernel(): never {
  throw new Error('ticket_creation_kernel_invalid')
}

function kernelUuid(value: unknown): string {
  if (typeof value !== 'string' || !KERNEL_UUID_PATTERN.test(value)) {
    return invalidTicketCreationKernel()
  }
  return value.toLowerCase()
}

function exactOwnRecord(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return invalidTicketCreationKernel()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidTicketCreationKernel()
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string') ||
    expectedKeys.some((key) => !keys.includes(key))
  ) return invalidTicketCreationKernel()
  const result: Record<string, unknown> = Object.create(null)
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return invalidTicketCreationKernel()
    }
    result[key] = descriptor.value
  }
  return result
}

function denseArray(value: unknown, minimum: number, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return invalidTicketCreationKernel()
  }
  if (value.length < minimum || value.length > maximum) {
    return invalidTicketCreationKernel()
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.some((key) => typeof key === 'symbol') ||
    keys.length !== value.length + 1 ||
    !keys.includes('length')
  ) return invalidTicketCreationKernel()
  const result: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (!descriptor?.enumerable || !('value' in descriptor)) {
      return invalidTicketCreationKernel()
    }
    result.push(descriptor.value)
  }
  return result
}

function kernelText(value: unknown, minimum: number, maximum: number): string {
  if (
    typeof value !== 'string' || value !== value.trim() ||
    value.length < minimum || value.length > maximum
  ) {
    return invalidTicketCreationKernel()
  }
  return value
}

function kernelNullableText(
  value: unknown,
  maximum: number,
  minimum = 0,
): string | null {
  if (value === null) return null
  return kernelText(value, minimum, maximum)
}

function kernelInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    return invalidTicketCreationKernel()
  }
  return value as number
}

function kernelNullableMoney(value: unknown): number | null {
  return value === null ? null : kernelInteger(value, 0, Number.MAX_SAFE_INTEGER)
}

function normalizeKernelTicket(
  value: unknown,
  includeIdentity: boolean,
): NormalizedTicketCreateV1 {
  const keys = [
    'id',
    ...(includeIdentity ? ['customerId', 'vehicleId'] : []),
    'concern',
    'whenStarted',
    'howOften',
    'diagnosticAuthorizedCents',
    'diagnosticAuthorizationNote',
  ]
  const record = exactOwnRecord(value, keys)
  const customerId = includeIdentity
    ? record.customerId === null ? null : kernelUuid(record.customerId)
    : null
  const vehicleId = includeIdentity
    ? record.vehicleId === null ? null : kernelUuid(record.vehicleId)
    : null
  if ((customerId === null) !== (vehicleId === null)) return invalidTicketCreationKernel()
  return Object.freeze({
    id: kernelUuid(record.id),
    customerId,
    vehicleId,
    concern: kernelText(record.concern, 1, 5_000),
    whenStarted: kernelNullableText(record.whenStarted, 1_000),
    howOften: kernelNullableText(record.howOften, 1_000),
    diagnosticAuthorizedCents: kernelNullableMoney(record.diagnosticAuthorizedCents),
    diagnosticAuthorizationNote: kernelNullableText(
      record.diagnosticAuthorizationNote,
      2_000,
    ),
  })
}

function normalizeKernelJob(value: unknown): NormalizedTicketJobCreateV1 {
  const record = exactOwnRecord(value, [
    'id',
    'title',
    'kind',
    'requiredSkillTier',
    'assignedTechId',
    'sessionId',
    'createdFromJobId',
  ])
  if (typeof record.kind !== 'string' || !KERNEL_JOB_KINDS.has(record.kind)) {
    return invalidTicketCreationKernel()
  }
  return Object.freeze({
    id: kernelUuid(record.id),
    title: kernelText(record.title, 1, 200),
    kind: record.kind as NormalizedTicketJobCreateV1['kind'],
    requiredSkillTier: kernelInteger(record.requiredSkillTier, 1, 3) as 1 | 2 | 3,
    assignedTechId: record.assignedTechId === null
      ? null
      : kernelUuid(record.assignedTechId),
    sessionId: record.sessionId === null ? null : kernelUuid(record.sessionId),
    createdFromJobId: record.createdFromJobId === null
      ? null
      : kernelUuid(record.createdFromJobId),
  })
}

function normalizeKernelJobs(value: unknown): readonly NormalizedTicketJobCreateV1[] {
  const jobs = denseArray(value, 1, 25).map(normalizeKernelJob)
  if (new Set(jobs.map(({ id }) => id)).size !== jobs.length) {
    return invalidTicketCreationKernel()
  }
  return Object.freeze(jobs)
}

function kernelScaledPositive(
  value: unknown,
  scale: number,
  maximumScaled: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return invalidTicketCreationKernel()
  }
  const scaleDigits = scale === 1_000 ? 3 : scale === 100 ? 2 : null
  if (scaleDigits === null) return invalidTicketCreationKernel()
  let scaled: bigint
  try {
    scaled = parseScaledDecimal(String(value), scaleDigits)
  } catch {
    return invalidTicketCreationKernel()
  }
  if (scaled <= 0n || scaled > BigInt(maximumScaled)) {
    return invalidTicketCreationKernel()
  }
  return Number(scaled) / scale
}

function kernelCanonicalScaledDecimal(
  value: string,
  scale: number,
  maximumScaled: bigint,
): number {
  let scaled: bigint
  try {
    scaled = parseScaledDecimal(value, scale)
  } catch {
    return invalidTicketCreationKernel()
  }
  if (scaled <= 0n || scaled > maximumScaled) return invalidTicketCreationKernel()
  return Number(scaled) / 10 ** scale
}

function normalizeKernelSeedLine(value: unknown): NormalizedJobLineCreateV1 {
  if (typeof value !== 'object' || value === null) return invalidTicketCreationKernel()
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, 'kind')
  if (!kindDescriptor?.enumerable || !('value' in kindDescriptor)) {
    return invalidTicketCreationKernel()
  }
  const kind = kindDescriptor.value
  if (typeof kind !== 'string' || !KERNEL_LINE_KINDS.has(kind)) {
    return invalidTicketCreationKernel()
  }
  const extraKeys = kind === 'part'
    ? ['quantity', 'partNumber', 'brand']
    : kind === 'labor'
      ? ['laborHours', 'laborRateCents']
      : []
  const record = exactOwnRecord(value, [
    'kind',
    'description',
    'sort',
    'priceCents',
    'taxable',
    ...extraKeys,
  ])
  if (typeof record.taxable !== 'boolean') return invalidTicketCreationKernel()
  const base = {
    description: kernelText(record.description, 1, 500),
    sort: kernelInteger(record.sort, 0, 1_000_000),
    priceCents: kernelInteger(record.priceCents, 0, Number.MAX_SAFE_INTEGER),
    taxable: record.taxable,
  }
  if (kind === 'part') {
    return Object.freeze({
      kind: 'part' as const,
      ...base,
      quantity: kernelScaledPositive(record.quantity, 1_000, 999_999_999_999),
      partNumber: kernelNullableText(record.partNumber, 200, 1),
      brand: kernelNullableText(record.brand, 200, 1),
    })
  }
  if (kind === 'labor') {
    return Object.freeze({
      kind: 'labor' as const,
      ...base,
      laborHours: kernelScaledPositive(record.laborHours, 100, 99_999_999),
      laborRateCents: kernelNullableMoney(record.laborRateCents),
    })
  }
  return Object.freeze({ kind: 'fee' as const, ...base })
}

function normalizeKernelSeedMap(
  value: unknown,
  jobCount: number,
): OwnedSeedLinesV1 {
  if (
    typeof value !== 'object' || value === null ||
    Object.getPrototypeOf(value) !== Map.prototype ||
    Reflect.ownKeys(value).length !== 0
  ) return invalidTicketCreationKernel()
  let entries: IterableIterator<[unknown, unknown]>
  try {
    entries = Map.prototype.entries.call(value) as IterableIterator<[unknown, unknown]>
  } catch {
    return invalidTicketCreationKernel()
  }
  const normalized: Array<{ jobIndex: number; lines: readonly NormalizedJobLineCreateV1[] }> = []
  const seen = new Set<number>()
  try {
    for (const [rawIndex, rawLines] of entries) {
      const jobIndex = kernelInteger(rawIndex, 0, jobCount - 1)
      if (seen.has(jobIndex)) return invalidTicketCreationKernel()
      seen.add(jobIndex)
      const lines = Object.freeze(denseArray(rawLines, 1, 25).map(normalizeKernelSeedLine))
      normalized.push(Object.freeze({ jobIndex, lines }))
    }
  } catch {
    return invalidTicketCreationKernel()
  }
  normalized.sort((left, right) => left.jobIndex - right.jobIndex)
  return Object.freeze(normalized)
}

function cloneCreatedRows(value: CreatedMutationRowsV1): CreatedMutationRowsV1 {
  return Object.freeze({
    sessionIds: Object.freeze([...value.sessionIds]),
    customerIds: Object.freeze([...value.customerIds]),
    vehicleIds: Object.freeze([...value.vehicleIds]),
  })
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function persistedValueFingerprint(value: unknown): string {
  const normalize = (member: unknown): unknown => {
    if (member instanceof Date) return { $date: member.toISOString() }
    if (typeof member === 'bigint') return { $bigint: member.toString() }
    if (
      member === null || typeof member === 'string' ||
      typeof member === 'number' || typeof member === 'boolean'
    ) return member
    if (Array.isArray(member)) return member.map(normalize)
    if (typeof member !== 'object') return invalidTicketCreationKernel()
    const result: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(member).sort()) {
      result[key] = normalize((member as Record<string, unknown>)[key])
    }
    return result
  }
  return JSON.stringify(normalize(value))
}

function persistedDomainProjection(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const projection: Record<string, unknown> = Object.create(null)
  for (const key of Object.keys(value)) {
    if (key !== 'createdAt' && key !== 'updatedAt') projection[key] = value[key]
  }
  return projection
}

async function assertExactPersistedTicketCreation(
  tx: AppDb,
  state: ResolvedTicketCreationStateV1,
): Promise<void> {
  if (
    state.ticket === null || state.expectedTicketFingerprint === undefined ||
    state.expectedJobFingerprints === undefined ||
    state.expectedLineFingerprints === undefined
  ) return invalidTicketCreationKernel()
  const persistedTickets = await tx.select().from(tickets).where(and(
    eq(tickets.shopId, state.scope.actor.shopId),
    eq(tickets.id, state.ticket.id),
  )).limit(2)
  if (
    persistedTickets.length !== 1 ||
    persistedValueFingerprint(persistedDomainProjection(persistedTickets[0])) !==
      state.expectedTicketFingerprint
  ) return invalidTicketCreationKernel()

  const persistedJobs = await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, state.scope.actor.shopId),
    eq(ticketJobs.ticketId, state.ticket.id),
  )).orderBy(ticketJobs.id)
  if (
    persistedJobs.length !== state.expectedJobFingerprints.size ||
    persistedJobs.some((job) =>
      state.expectedJobFingerprints!.get(job.id) !==
        persistedValueFingerprint(persistedDomainProjection(job)))
  ) return invalidTicketCreationKernel()

  const persistedLines = state.jobs.length === 0
    ? []
    : await tx.select().from(jobLines).where(and(
        eq(jobLines.shopId, state.scope.actor.shopId),
        inArray(jobLines.jobId, state.jobs.map(({ id }) => id)),
      )).orderBy(jobLines.id)
  if (
    persistedLines.length !== state.expectedLineFingerprints.size ||
    persistedLines.some((line) =>
      state.expectedLineFingerprints!.get(line.id) !==
        persistedValueFingerprint(persistedDomainProjection(line)))
  ) return invalidTicketCreationKernel()
  assertLiveLockedMutationScopeV1(tx, state.scope)
}

function exactInsertIntents(
  scope: LockedMutationScopeV1,
  ticket: NormalizedTicketCreateV1,
  jobs: readonly NormalizedTicketJobCreateV1[],
): void {
  if (
    scope.request.lockShop !== true || scope.shop?.id !== scope.actor.shopId ||
    scope.request.includeAllJobsForTickets !== true ||
    scope.request.includeAllLinesForJobs !== true ||
    scope.request.ticketIds.length !== 0 || scope.request.jobIds.length !== 0 ||
    scope.tickets.length !== 0 ||
    !sameIds(scope.insertionIntents.tickets, [ticket.id]) ||
    scope.insertionIntents.jobs.length !== jobs.length ||
    jobs.some((job, index) =>
      scope.insertionIntents.jobs[index]?.id !== job.id ||
      scope.insertionIntents.jobs[index]?.ticketId !== ticket.id)
  ) return invalidTicketCreationKernel()
}

function exactTicketCreationLockFootprint(
  scope: LockedMutationScopeV1,
  mode: 'plain_insert' | 'quick_insert' | 'replay',
  expectedCannedJobIds: readonly string[] = [],
): void {
  if (
    scope.request.includeAllQuoteVersionsForTickets !== false ||
    scope.request.includeAllQuoteEventsForTickets !== false ||
    scope.request.sessionEventIds.length !== 0 || scope.sessionEvents.length !== 0 ||
    scope.request.vendorAccountIds.length !== 0 || scope.vendorAccounts.length !== 0 ||
    !sameIds(scope.request.cannedJobIds, expectedCannedJobIds) ||
    !sameIds(scope.cannedJobs.map(({ id }) => id), expectedCannedJobIds) ||
    scope.tickets.some(({ versions, events }) => versions.length !== 0 || events.length !== 0)
  ) return invalidTicketCreationKernel()

  if (mode === 'replay') {
    if (
      scope.request.receiptRequestKey === null || scope.receiptPeek.kind !== 'owned' ||
      scope.request.lockShop !== false || scope.shop !== null ||
      scope.request.includeAllJobsForTickets !== true ||
      scope.request.includeAllLinesForJobs !== true ||
      !sameIds(scope.request.profileIds, [scope.actor.id]) ||
      !sameIds(scope.profiles.map(({ id }) => id), [scope.actor.id]) ||
      (scope.receiptConditionalInsertState !== 'not_applicable' &&
        scope.receiptConditionalInsertState !== 'suppressed_by_owned_receipt')
    ) return invalidTicketCreationKernel()
    return
  }

  if (scope.request.sessionIds.length !== 0 || scope.sessions.length !== 0) {
    return invalidTicketCreationKernel()
  }
  if (mode === 'quick_insert') {
    if (
      scope.request.receiptRequestKey === null ||
      scope.request.receiptConditionalInsert?.kind !== 'prepared' ||
      scope.receiptPeek.kind !== 'none' ||
      scope.receiptConditionalInsertState !== 'activated'
    ) return invalidTicketCreationKernel()
    return
  }
  if (
    scope.request.receiptRequestKey !== null ||
    scope.request.receiptConditionalInsert !== null ||
    scope.receiptPeek.kind !== 'none' ||
    scope.receiptConditionalInsertState !== 'not_applicable'
  ) return invalidTicketCreationKernel()
}

function assertActivatedQuickInsertScope(scope: LockedMutationScopeV1): void {
  if (
    scope.request.receiptRequestKey === null ||
    scope.request.receiptConditionalInsert?.kind !== 'prepared' ||
    scope.receiptPeek.kind !== 'none' ||
    scope.receiptConditionalInsertState !== 'activated'
  ) return invalidTicketCreationKernel()
}

function exactTicketIdentity(
  scope: LockedMutationScopeV1,
  ticket: NormalizedTicketCreateV1,
): void {
  if (ticket.customerId === null || ticket.vehicleId === null) {
    if (
      ticket.customerId !== null || ticket.vehicleId !== null ||
      scope.request.customerIds.length !== 0 || scope.request.vehicleIds.length !== 0 ||
      scope.customers.length !== 0 || scope.vehicles.length !== 0
    ) return invalidTicketCreationKernel()
    return
  }
  if (
    !sameIds(scope.request.customerIds, [ticket.customerId]) ||
    !sameIds(scope.request.vehicleIds, [ticket.vehicleId]) ||
    scope.customers.length !== 1 || scope.customers[0]?.id !== ticket.customerId ||
    scope.customers[0]?.shopId !== scope.actor.shopId ||
    scope.vehicles.length !== 1 || scope.vehicles[0]?.id !== ticket.vehicleId ||
    scope.vehicles[0]?.customerId !== ticket.customerId
  ) return invalidTicketCreationKernel()
}

function exactMaterializedTicketIdentity(
  scope: LockedMutationScopeV1,
  ticket: NormalizedTicketCreateV1,
  createdRows: CreatedMutationRowsV1,
): void {
  if (
    ticket.customerId === null || ticket.vehicleId === null ||
    createdRows.sessionIds.length !== 0 ||
    createdRows.customerIds.length > 1 || createdRows.vehicleIds.length > 1
  ) return invalidTicketCreationKernel()
  const customerCreated = createdRows.customerIds.length === 1
  const vehicleCreated = createdRows.vehicleIds.length === 1
  if (
    (customerCreated && createdRows.customerIds[0] !== ticket.customerId) ||
    (vehicleCreated && createdRows.vehicleIds[0] !== ticket.vehicleId) ||
    scope.insertionIntents.customers.length !== createdRows.customerIds.length ||
    scope.insertionIntents.vehicles.length !== createdRows.vehicleIds.length ||
    scope.insertionIntents.customers.some((intent, index) =>
      intent.id !== createdRows.customerIds[index] ||
      intent.shopId !== scope.actor.shopId) ||
    scope.insertionIntents.vehicles.some((intent, index) =>
      intent.id !== createdRows.vehicleIds[index] ||
      intent.customerId !== ticket.customerId)
  ) return invalidTicketCreationKernel()

  const expectedLockedCustomerIds = customerCreated ? [] : [ticket.customerId]
  const expectedLockedVehicleIds = vehicleCreated ? [] : [ticket.vehicleId]
  if (
    !sameIds(scope.request.customerIds, expectedLockedCustomerIds) ||
    !sameIds(scope.request.vehicleIds, expectedLockedVehicleIds) ||
    !sameIds(scope.customers.map(({ id }) => id), expectedLockedCustomerIds) ||
    !sameIds(scope.vehicles.map(({ id }) => id), expectedLockedVehicleIds)
  ) return invalidTicketCreationKernel()
  if (!customerCreated) {
    const customer = scope.customers[0]
    if (!customer || customer.shopId !== scope.actor.shopId) {
      return invalidTicketCreationKernel()
    }
  }
  if (!vehicleCreated) {
    const vehicle = scope.vehicles[0]
    if (!vehicle || vehicle.customerId !== ticket.customerId) {
      return invalidTicketCreationKernel()
    }
  }
  if (customerCreated && !vehicleCreated) return invalidTicketCreationKernel()
}

function validateKernelProfiles(
  scope: LockedMutationScopeV1,
  jobs: readonly NormalizedTicketJobCreateV1[],
): void {
  const expectedIds = [...new Set([
    scope.actor.id,
    ...jobs.flatMap(({ assignedTechId }) => assignedTechId === null ? [] : [assignedTechId]),
  ])].sort()
  if (
    !sameIds(scope.request.profileIds, expectedIds) ||
    !sameIds(scope.profiles.map(({ id }) => id), expectedIds)
  ) return invalidTicketCreationKernel()
  const jobIds = new Set(jobs.map(({ id }) => id))
  for (const job of jobs) {
    if (
      job.createdFromJobId === job.id ||
      (job.createdFromJobId !== null && !jobIds.has(job.createdFromJobId))
    ) return invalidTicketCreationKernel()
    if (job.assignedTechId === null) continue
    const assignee = scope.profiles.find(({ id }) => id === job.assignedTechId)
    if (
      !assignee || assignee.shopId !== scope.actor.shopId ||
      assignee.membershipStatus !== 'active' || assignee.deactivatedAt !== null ||
      !canCreateTickets(assignee.role) || assignee.skillTier === null ||
      ![1, 2, 3].includes(assignee.skillTier)
    ) return invalidTicketCreationKernel()
    if (
      assignee.id === scope.actor.id
        ? assignee.skillTier < job.requiredSkillTier
        : !canAssignWork(scope.actor.role)
    ) return invalidTicketCreationKernel()
  }
}

function sameQuickIdentity(
  body: OwnedQuickReceiptV1['body'],
  identity: ReturnType<typeof consumeMaterializedTicketIntakeIdentityForCreationV1>,
): boolean {
  if (body.vehicleMode === 'existing') {
    return identity.input.mode === 'existing_vehicle' &&
      identity.input.existingVehicleId === body.existingVehicleId &&
      identity.input.mileage === body.mileage
  }
  if (identity.input.mode !== 'new_vehicle') return false
  return identity.input.customer.name === body.customer.name &&
    identity.input.customer.phone === body.customer.phone &&
    identity.input.customer.email === (body.customer.email ?? null) &&
    identity.input.vehicle.year === body.vehicle.year &&
    identity.input.vehicle.make === body.vehicle.make &&
    identity.input.vehicle.model === body.vehicle.model &&
    identity.input.vehicle.engine === (body.vehicle.engine ?? null) &&
    identity.input.vehicle.vin === (body.vehicle.vin ?? null) &&
    identity.input.vehicle.mileage === (body.vehicle.mileage ?? null) &&
    identity.input.vehicle.plate === (body.vehicle.plate ?? null)
}

function createResolvedTicketCreationHandle(
  state: ResolvedTicketCreationStateV1,
): ResolvedTicketCreationV1 {
  const resolved = Object.freeze(Object.create(null) as ResolvedTicketCreationV1)
  resolvedTicketCreationStates.set(resolved, state)
  return resolved
}

function resolvedTicketCreationStateFor(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  resolved: ResolvedTicketCreationV1,
): ResolvedTicketCreationStateV1 {
  const capability = assertLiveLockedMutationScopeV1(tx, scope)
  if ((typeof resolved !== 'object' || resolved === null) && typeof resolved !== 'function') {
    return invalidTicketCreationKernel()
  }
  const state = resolvedTicketCreationStates.get(resolved)
  if (
    !state || state.tx !== tx || state.scope !== scope || state.capability !== capability
  ) return invalidTicketCreationKernel()
  return state
}

export function resolveTicketCreationInLockedScopeV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  input: ResolveTicketCreationInputV1,
): ResolvedTicketCreationV1 {
  const capability = assertLiveLockedMutationScopeV1(tx, scope)
  if (typeof input !== 'object' || input === null) return invalidTicketCreationKernel()
  const modeDescriptor = Object.getOwnPropertyDescriptor(input, 'mode')
  if (
    !modeDescriptor?.enumerable || !('value' in modeDescriptor) ||
    !['insert', 'intake_insert', 'quick_insert', 'replay'].includes(
      modeDescriptor.value as string,
    )
  ) return invalidTicketCreationKernel()
  const mode = modeDescriptor.value as ResolveTicketCreationInputV1['mode']

  if (mode === 'replay') {
    const record = exactOwnRecord(input, ['mode', 'origin', 'resultTicketId', 'receipt'])
    if (record.mode !== 'replay') return invalidTicketCreationKernel()
    const replayTicketId = kernelUuid(record.resultTicketId)
    const receipt = consumeCanonicalQuickReceiptRequestForCreationV1(
      record.receipt as CanonicalQuickReceiptRequestV1,
    )
    const graph = scope.tickets.find(({ ticket }) => ticket.id === replayTicketId)
    exactTicketCreationLockFootprint(scope, 'replay')
    if (
      scope.receiptPeek.kind !== 'owned' ||
      scope.receiptPeek.resultTicketId !== replayTicketId ||
      scope.insertionIntents.sessions.length !== 0 ||
      scope.insertionIntents.customers.length !== 0 ||
      scope.insertionIntents.vehicles.length !== 0 ||
      scope.insertionIntents.tickets.length !== 0 ||
      scope.insertionIntents.jobs.length !== 0 ||
      !graph || graph.ticket.shopId !== scope.actor.shopId ||
      graph.ticket.source !== 'quick_quote' || scope.tickets.length !== 1 ||
      !sameIds(scope.request.ticketIds, [replayTicketId]) ||
      !sameIds(
        scope.request.jobIds,
        graph.jobs.map(({ id }) => id).sort(),
      ) ||
      !sameIds(
        scope.request.customerIds,
        graph.ticket.customerId === null ? [] : [graph.ticket.customerId],
      ) ||
      !sameIds(
        scope.request.vehicleIds,
        graph.ticket.vehicleId === null ? [] : [graph.ticket.vehicleId],
      ) ||
      !sameIds(scope.customers.map(({ id }) => id), scope.request.customerIds) ||
      !sameIds(scope.vehicles.map(({ id }) => id), scope.request.vehicleIds)
    ) return invalidTicketCreationKernel()
    const jobs = Object.freeze([]) as readonly NormalizedTicketJobCreateV1[]
    const origin = resolveTrustedTicketOriginInLockedScopeV1(
      tx,
      scope,
      record.origin as TrustedTicketOriginV1,
      {
        mode: 'replay',
        canonicalRequestKey: receipt.requestKey,
        ticketId: replayTicketId,
        jobs: [],
      },
    )
    return createResolvedTicketCreationHandle({
      tx,
      scope,
      capability,
      mode: 'replay',
      origin,
      ticket: null,
      jobs,
      seededLines: Object.freeze([]),
      createdRows: cloneCreatedRows({ sessionIds: [], customerIds: [], vehicleIds: [] }),
      receipt,
      replayTicketId,
      phase: 'resolved',
    })
  }

  if (mode === 'quick_insert') {
    const record = exactOwnRecord(input, ['mode', 'origin', 'identity', 'receipt', 'template'])
    if (record.mode !== 'quick_insert') return invalidTicketCreationKernel()
    const receipt = consumeCanonicalQuickReceiptRequestForCreationV1(
      record.receipt as CanonicalQuickReceiptRequestV1,
    )
    assertActivatedQuickInsertScope(scope)
    const identity = consumeMaterializedTicketIntakeIdentityForCreationV1(
      tx,
      scope,
      record.identity as MaterializedTicketIntakeIdentityV1,
    )
    if (
      identity.input.shopId !== scope.actor.shopId ||
      !sameQuickIdentity(receipt.body, identity) ||
      scope.insertionIntents.tickets.length !== 1 ||
      scope.insertionIntents.jobs.length !== 1
    ) return invalidTicketCreationKernel()
    const ticketId = scope.insertionIntents.tickets[0]!
    const jobId = scope.insertionIntents.jobs[0]!.id
    if (scope.insertionIntents.jobs[0]!.ticketId !== ticketId) {
      return invalidTicketCreationKernel()
    }
    let title: string
    let kind: 'repair' | 'maintenance'
    let requiredSkillTier: 1 | 2 | 3
    let seededLines: OwnedSeedLinesV1
    if (receipt.body.quote.mode === 'manual') {
      if (record.template !== null) return invalidTicketCreationKernel()
      exactTicketCreationLockFootprint(scope, 'quick_insert')
      title = receipt.body.quote.description
      kind = receipt.body.quote.kind
      requiredSkillTier = kind === 'repair' ? 2 : 1
      seededLines = Object.freeze([])
    } else {
      if (record.template === null) return invalidTicketCreationKernel()
      const template = consumeResolvedLockedQuickTemplateForCreationV1(
        tx,
        scope,
        record.template as ResolvedLockedQuickTemplateV1,
      )
      if (
        template.cannedJobId !== receipt.body.quote.cannedJobId ||
        template.fingerprint !== receipt.body.quote.expectedFingerprint ||
        template.taxRateBps !== receipt.body.quote.expectedTaxRateBps
      ) return invalidTicketCreationKernel()
      exactTicketCreationLockFootprint(scope, 'quick_insert', [template.cannedJobId])
      title = template.title
      kind = template.kind
      requiredSkillTier = template.defaultRequiredSkillTier
      const lines = template.lines.map((line): NormalizedJobLineCreateV1 => {
        if (line.kind === 'part') return {
          kind: 'part',
          description: line.description,
          sort: line.sort,
          priceCents: line.priceCents,
          taxable: line.taxable,
          quantity: kernelCanonicalScaledDecimal(
            line.quantity,
            3,
            999_999_999_999n,
          ),
          partNumber: line.partNumber ?? null,
          brand: line.brand ?? null,
        }
        if (line.kind === 'labor') return {
          kind: 'labor',
          description: line.description,
          sort: line.sort,
          priceCents: line.priceCents,
          taxable: line.taxable,
          laborHours: kernelCanonicalScaledDecimal(
            line.hours,
            2,
            99_999_999n,
          ),
          laborRateCents: line.laborRateCents ?? null,
        }
        return {
          kind: 'fee',
          description: line.description,
          sort: line.sort,
          priceCents: line.priceCents,
          taxable: line.taxable,
        }
      })
      seededLines = normalizeKernelSeedMap(new Map([[0, lines]]), 1)
    }
    const ticket = normalizeKernelTicket({
      id: ticketId,
      customerId: identity.customerId,
      vehicleId: identity.vehicleId,
      concern: title,
      whenStarted: null,
      howOften: null,
      diagnosticAuthorizedCents: null,
      diagnosticAuthorizationNote: null,
    }, true)
    const jobs = normalizeKernelJobs([{
      id: jobId,
      title,
      kind,
      requiredSkillTier,
      assignedTechId: null,
      sessionId: null,
      createdFromJobId: null,
    }])
    exactInsertIntents(scope, ticket, jobs)
    exactMaterializedTicketIdentity(scope, ticket, identity.createdRows)
    validateKernelProfiles(scope, jobs)
    if (scope.insertionIntents.sessions.length !== 0) return invalidTicketCreationKernel()
    const origin = resolveTrustedTicketOriginInLockedScopeV1(
      tx,
      scope,
      record.origin as TrustedTicketOriginV1,
      {
        mode: 'quick_insert',
        canonicalRequestKey: receipt.requestKey,
        ticketId,
        jobs: [{ id: jobId, ticketId, sessionId: null }],
      },
    )
    return createResolvedTicketCreationHandle({
      tx,
      scope,
      capability,
      mode: 'quick_insert',
      origin,
      ticket,
      jobs,
      seededLines,
      createdRows: cloneCreatedRows(identity.createdRows),
      receipt,
      replayTicketId: null,
      phase: 'resolved',
    })
  }

  if (mode === 'insert') {
    const record = exactOwnRecord(input, [
      'mode', 'origin', 'ticket', 'jobs', 'seededLinesByJobIndex',
    ])
    if (record.mode !== 'insert') return invalidTicketCreationKernel()
    const ticket = normalizeKernelTicket(record.ticket, true)
    const jobs = normalizeKernelJobs(record.jobs)
    const seededLines = normalizeKernelSeedMap(record.seededLinesByJobIndex, jobs.length)
    exactTicketCreationLockFootprint(scope, 'plain_insert')
    exactInsertIntents(scope, ticket, jobs)
    exactTicketIdentity(scope, ticket)
    validateKernelProfiles(scope, jobs)
    if (
      scope.insertionIntents.customers.length !== 0 ||
      scope.insertionIntents.vehicles.length !== 0
    ) return invalidTicketCreationKernel()
    const origin = resolveTrustedTicketOriginInLockedScopeV1(
      tx,
      scope,
      record.origin as TrustedTicketOriginV1,
      {
        mode: 'insert',
        canonicalRequestKey: null,
        ticketId: ticket.id,
        jobs: jobs.map((job) => ({
          id: job.id,
          ticketId: ticket.id,
          sessionId: job.sessionId,
        })),
      },
    )
    if (
      (origin === 'tech_quick') !== (ticket.customerId === null) ||
      (origin === 'counter' && ticket.customerId === null)
    ) return invalidTicketCreationKernel()
    return createResolvedTicketCreationHandle({
      tx,
      scope,
      capability,
      mode: 'insert',
      origin,
      ticket,
      jobs,
      seededLines,
      createdRows: cloneCreatedRows({
        sessionIds: scope.insertionIntents.sessions.map(({ id }) => id),
        customerIds: [],
        vehicleIds: [],
      }),
      receipt: null,
      replayTicketId: null,
      phase: 'resolved',
    })
  }

  const record = exactOwnRecord(input, [
    'mode', 'origin', 'ticket', 'identity', 'jobs', 'seededLinesByJobIndex',
  ])
  if (record.mode !== 'intake_insert') return invalidTicketCreationKernel()
  const identity = consumeMaterializedTicketIntakeIdentityForCreationV1(
    tx,
    scope,
    record.identity as MaterializedTicketIntakeIdentityV1,
  )
  const ticketRecord = exactOwnRecord(record.ticket, [
    'id', 'concern', 'whenStarted', 'howOften',
    'diagnosticAuthorizedCents', 'diagnosticAuthorizationNote',
  ])
  const ticket = normalizeKernelTicket({
    ...ticketRecord,
    customerId: identity.customerId,
    vehicleId: identity.vehicleId,
  }, true)
  const jobs = normalizeKernelJobs(record.jobs)
  const seededLines = normalizeKernelSeedMap(record.seededLinesByJobIndex, jobs.length)
  exactTicketCreationLockFootprint(scope, 'plain_insert')
  exactInsertIntents(scope, ticket, jobs)
  exactMaterializedTicketIdentity(scope, ticket, identity.createdRows)
  validateKernelProfiles(scope, jobs)
  if (scope.insertionIntents.sessions.length !== 0) return invalidTicketCreationKernel()
  const origin = resolveTrustedTicketOriginInLockedScopeV1(
    tx,
    scope,
    record.origin as TrustedTicketOriginV1,
    {
      mode: 'intake_insert',
      canonicalRequestKey: null,
      ticketId: ticket.id,
      jobs: jobs.map((job) => ({
        id: job.id,
        ticketId: ticket.id,
        sessionId: job.sessionId,
      })),
    },
  )
  return createResolvedTicketCreationHandle({
    tx,
    scope,
    capability,
    mode: 'intake_insert',
    origin,
    ticket,
    jobs,
    seededLines,
    createdRows: cloneCreatedRows(identity.createdRows),
    receipt: null,
    replayTicketId: null,
    phase: 'resolved',
  })
}

export async function insertResolvedTicketBatchInTransactionV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  resolved: ResolvedTicketCreationV1,
): Promise<CreatedTicketBatchV1> {
  const state = resolvedTicketCreationStateFor(tx, scope, resolved)
  if (
    state.mode === 'replay' || state.ticket === null || state.phase !== 'resolved'
  ) return invalidTicketCreationKernel()
  state.phase = 'inserting'

  const reservations = reserveJobSequencesForInsertionV1(
    tx,
    scope,
    state.ticket.id,
    state.jobs.map(({ id }) => id),
  )
  if (
    reservations.length !== state.jobs.length ||
    reservations.some((reservation, index) =>
      reservation.jobId !== state.jobs[index]?.id ||
      reservation.sequenceNumber !== index + 1)
  ) return invalidTicketCreationKernel()

  const lockedNextTicketNumber = scope.shop?.nextTicketNumber
  if (
    !Number.isSafeInteger(lockedNextTicketNumber) ||
    (lockedNextTicketNumber as number) < 1 ||
    (lockedNextTicketNumber as number) >= Number.MAX_SAFE_INTEGER
  ) return invalidTicketCreationKernel()
  const [advancedShop] = await tx.update(shops).set({
    nextTicketNumber: sql`${shops.nextTicketNumber} + 1`,
  }).where(and(
    eq(shops.id, scope.actor.shopId),
    eq(shops.nextTicketNumber, lockedNextTicketNumber as number),
  )).returning()
  if (
    !advancedShop || advancedShop.id !== scope.actor.shopId ||
    advancedShop.nextTicketNumber !== (lockedNextTicketNumber as number) + 1
  ) return invalidTicketCreationKernel()

  const [insertedTicket] = await tx.insert(tickets).values({
    id: state.ticket.id,
    shopId: scope.actor.shopId,
    ticketNumber: lockedNextTicketNumber as number,
    source: state.origin,
    customerId: state.ticket.customerId,
    vehicleId: state.ticket.vehicleId,
    concern: state.ticket.concern,
    whenStarted: state.ticket.whenStarted,
    howOften: state.ticket.howOften,
    diagnosticAuthorizedCents: state.ticket.diagnosticAuthorizedCents,
    diagnosticAuthorizationNote: state.ticket.diagnosticAuthorizationNote,
    projectionRevision: 1n,
    continuityRevision: 1n,
    createdByProfileId: scope.actor.id,
  }).returning()
  const expectedTicketProjection = Object.freeze({
    id: state.ticket.id,
    shopId: scope.actor.shopId,
    ticketNumber: lockedNextTicketNumber as number,
    source: state.origin,
    customerId: state.ticket.customerId,
    vehicleId: state.ticket.vehicleId,
    concern: state.ticket.concern,
    whenStarted: state.ticket.whenStarted,
    howOften: state.ticket.howOften,
    diagnosticAuthorizedCents: state.ticket.diagnosticAuthorizedCents,
    diagnosticAuthorizationNote: state.ticket.diagnosticAuthorizationNote,
    projectionRevision: 1n,
    continuityRevision: 1n,
    separateFromTicketId: null,
    separateReason: null,
    separateReasonNote: null,
    closeDisposition: null,
    closeNote: null,
    cancelReasonCode: null,
    status: 'open',
    createdByProfileId: scope.actor.id,
    canceledAt: null,
    canceledByProfileId: null,
    canceledReason: null,
    deliveredAt: null,
    deliveredByProfileId: null,
    closedAt: null,
    closedByProfileId: null,
  })
  const expectedTicketFingerprint = persistedValueFingerprint(
    expectedTicketProjection,
  )
  if (
    !insertedTicket || insertedTicket.id !== state.ticket.id ||
    insertedTicket.shopId !== scope.actor.shopId ||
    insertedTicket.source !== state.origin ||
    insertedTicket.projectionRevision !== 1n ||
    insertedTicket.continuityRevision !== 1n ||
    persistedValueFingerprint(persistedDomainProjection(insertedTicket)) !==
      expectedTicketFingerprint
  ) return invalidTicketCreationKernel()

  const jobInsertRows = state.jobs.map((job, index) => ({
    id: job.id,
    shopId: scope.actor.shopId,
    ticketId: state.ticket!.id,
    title: job.title,
    kind: job.kind,
    requiredSkillTier: job.requiredSkillTier,
    assignedTechId: job.assignedTechId,
    sessionId: job.sessionId,
    sequenceNumber: reservations[index]!.sequenceNumber,
    createdByProfileId: scope.actor.id,
    creatorProvenance: 'direct' as const,
    createdFromJobId: job.createdFromJobId,
    revision: 1n,
  }))
  const expectedJobProjections = state.jobs.map((job, index) => Object.freeze({
      id: job.id,
      shopId: scope.actor.shopId,
      ticketId: state.ticket!.id,
      title: job.title,
      kind: job.kind,
      requiredSkillTier: job.requiredSkillTier,
      assignedTechId: job.assignedTechId,
      sessionId: job.sessionId,
      sequenceNumber: reservations[index]!.sequenceNumber,
      createdByProfileId: scope.actor.id,
      creatorProvenance: 'direct' as const,
      createdFromJobId: job.createdFromJobId,
      revision: 1n,
      claimedAt: null,
      workStatus: 'open',
      approvalState: 'pending_quote',
      customerStory: null,
      storyMeta: null,
      workNotes: null,
      approvedQuoteVersionId: null,
      workStatement: null,
      statementSource: null,
      statementReviewState: null,
      statementConfirmedByProfileId: null,
      statementConfirmedAt: null,
      whenStarted: null,
      howOften: null,
      diagnosticAuthorizedCents: null,
      diagnosticAuthorizationNote: null,
      approvedAuthorizationFingerprint: null,
      approvedApprovalEventId: null,
      diagnosticStartState: 'idle',
      diagnosticStartAttemptKey: null,
      diagnosticStartLeaseUntil: null,
      diagnosticStartErrorCode: null,
    }))
  const insertedJobs = await tx.insert(ticketJobs).values(
    jobInsertRows,
  ).returning()
  const expectedJobIds = state.jobs.map(({ id }) => id)
  const expectedJobFingerprints = new Map(expectedJobProjections.map((job) =>
    [job.id, persistedValueFingerprint(job)] as const))
  if (
    insertedJobs.length !== expectedJobIds.length ||
    insertedJobs.some((job) =>
      job.shopId !== scope.actor.shopId || job.ticketId !== state.ticket!.id ||
      !expectedJobIds.includes(job.id) || job.revision !== 1n ||
      job.createdByProfileId !== scope.actor.id || job.creatorProvenance !== 'direct' ||
      expectedJobFingerprints.get(job.id) !==
        persistedValueFingerprint(persistedDomainProjection(job)))
  ) return invalidTicketCreationKernel()

  const ownedSeedLines = state.seededLines.flatMap(({ jobIndex, lines }) =>
    lines.map((line) => Object.freeze({
      id: randomUUID(),
      jobId: state.jobs[jobIndex]!.id,
      line,
    })),
  )
  const lineRows = ownedSeedLines.map(({ id, jobId, line }) => ({
      id,
      shopId: scope.actor.shopId,
      jobId,
      kind: line.kind,
      description: line.description,
      sort: line.sort,
      quantity: line.kind === 'part' ? line.quantity : 1,
      priceCents: line.priceCents,
      taxable: line.taxable,
      partNumber: line.kind === 'part' ? line.partNumber : null,
      brand: line.kind === 'part' ? line.brand : null,
      unitCostCents: null,
      coreChargeCents: null,
      fitment: null,
      vendorAccountId: null,
      externalOfferId: null,
      vendorSnapshot: null,
      partStatus: 'proposed' as const,
      orderedAt: null,
      orderedByProfileId: null,
      receivedAt: null,
      receivedByProfileId: null,
      laborHours: line.kind === 'labor' ? line.laborHours : null,
      laborRateCents: line.kind === 'labor' ? line.laborRateCents : null,
      source: 'manual' as const,
    }))
  const expectedLineProjections = ownedSeedLines.map(({ id, jobId, line }) =>
    Object.freeze({
      id,
      shopId: scope.actor.shopId,
      jobId,
      kind: line.kind,
      description: line.description,
      sort: line.sort,
      quantity: line.kind === 'part' ? line.quantity : 1,
      priceCents: line.priceCents,
      taxable: line.taxable,
      partNumber: line.kind === 'part' ? line.partNumber : null,
      brand: line.kind === 'part' ? line.brand : null,
      unitCostCents: null,
      coreChargeCents: null,
      fitment: null,
      vendorAccountId: null,
      externalOfferId: null,
      vendorSnapshot: null,
      partStatus: 'proposed' as const,
      orderedAt: null,
      orderedByProfileId: null,
      receivedAt: null,
      receivedByProfileId: null,
      laborHours: line.kind === 'labor' ? line.laborHours : null,
      laborRateCents: line.kind === 'labor' ? line.laborRateCents : null,
      source: 'manual' as const,
    }))
  const insertedLines = lineRows.length === 0
    ? []
    : await tx.insert(jobLines).values(lineRows).returning()
  const expectedLineFingerprints = new Map<string, string>(
    expectedLineProjections.map((line) =>
    [line.id, persistedValueFingerprint(line)] as const))
  if (
    insertedLines.length !== lineRows.length ||
    insertedLines.some((line) =>
      line.shopId !== scope.actor.shopId ||
      !lineRows.some((expected) =>
        expected.id === line.id && expected.jobId === line.jobId) ||
      expectedLineFingerprints.get(line.id) !==
        persistedValueFingerprint(persistedDomainProjection(line)))
  ) return invalidTicketCreationKernel()

  const batch = Object.freeze({
    ticketId: state.ticket.id,
    jobIds: Object.freeze([...expectedJobIds]),
  })
  state.batch = batch
  state.insertedLineIds = Object.freeze(lineRows.map(({ id }) => id))
  state.expectedTicketFingerprint = expectedTicketFingerprint
  state.expectedJobFingerprints = expectedJobFingerprints
  state.expectedLineFingerprints = expectedLineFingerprints
  state.phase = 'inserted'
  return batch
}

export async function finalizeResolvedTicketCreationInTransactionV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  resolved: ResolvedTicketCreationV1,
  deltas: readonly TicketRevisionDeltaV1[],
): Promise<FinalizedTicketCreationV1> {
  const state = resolvedTicketCreationStateFor(tx, scope, resolved)
  if (
    state.mode === 'replay' || state.ticket === null ||
    state.phase !== 'inserted' || !state.batch
  ) return invalidTicketCreationKernel()
  const [rawDelta] = denseArray(deltas, 1, 1)
  const delta = exactOwnRecord(rawDelta, [
    'ticketId',
    'createdTicket',
    'createdJobIds',
    'existingChangedJobIds',
    'actorVisibleTicketFieldsChanged',
  ])
  const createdJobIds = denseArray(
    delta.createdJobIds,
    state.jobs.length,
    state.jobs.length,
  ).map(kernelUuid)
  const existingChangedJobIds = denseArray(delta.existingChangedJobIds, 0, 0)
  if (
    kernelUuid(delta.ticketId) !== state.ticket.id ||
    delta.createdTicket !== true ||
    delta.actorVisibleTicketFieldsChanged !== true ||
    !sameIds(createdJobIds, state.jobs.map(({ id }) => id)) ||
    existingChangedJobIds.length !== 0
  ) return invalidTicketCreationKernel()
  const ownedDelta: TicketRevisionDeltaV1 = Object.freeze({
    ticketId: state.ticket.id,
    createdTicket: true,
    createdJobIds: Object.freeze(createdJobIds),
    existingChangedJobIds: Object.freeze([]),
    actorVisibleTicketFieldsChanged: true,
  })
  state.phase = 'finalizing'
  await assertExactPersistedTicketCreation(tx, state)
  const revisionResult = await finalizeMutationRevisionsV1(
    tx,
    scope,
    state.createdRows,
    Object.freeze([ownedDelta]),
  )
  if (
    revisionResult.tickets.length !== 1 ||
    revisionResult.tickets[0]?.id !== state.ticket.id ||
    revisionResult.tickets[0]?.projectionRevision !== '1' ||
    revisionResult.tickets[0]?.continuityRevision !== '1' ||
    revisionResult.tickets[0]?.continuityChanged !== true ||
    revisionResult.jobs.length !== state.jobs.length ||
    revisionResult.jobs.some((job, index) =>
      job.id !== state.jobs[index]?.id || job.revision !== '1')
  ) return invalidTicketCreationKernel()

  const insertedLineIds = state.insertedLineIds ?? Object.freeze([])
  const persistedLines = insertedLineIds.length === 0
    ? []
    : await tx.select({
        id: jobLines.id,
        shopId: jobLines.shopId,
        jobId: jobLines.jobId,
      }).from(jobLines).where(and(
        eq(jobLines.shopId, scope.actor.shopId),
        inArray(jobLines.id, insertedLineIds),
      )).orderBy(jobLines.id)
  if (
    persistedLines.length !== insertedLineIds.length ||
    persistedLines.some((line) =>
      !insertedLineIds.includes(line.id) ||
      !state.jobs.some(({ id }) => id === line.jobId))
  ) return invalidTicketCreationKernel()

  const finalized = Object.freeze(
    Object.create(null) as FinalizedTicketCreationV1,
  )
  finalizedTicketCreationStates.set(finalized, {
    tx,
    scope,
    capability: state.capability,
    resolved,
    batch: state.batch,
    revisionResult,
    receiptInserted: false,
  })
  state.revisionResult = revisionResult
  state.phase = 'finalized'
  return finalized
}

export async function insertResolvedTicketCreationReceiptInTransactionV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  finalized: FinalizedTicketCreationV1,
  keyring: MutationFingerprintKeyringV1,
): Promise<Readonly<{ ticketId: string; jobIds: readonly string[] }>> {
  const capability = assertLiveLockedMutationScopeV1(tx, scope)
  if ((typeof finalized !== 'object' || finalized === null) && typeof finalized !== 'function') {
    return invalidTicketCreationKernel()
  }
  const finalizedState = finalizedTicketCreationStates.get(finalized)
  if (
    !finalizedState || finalizedState.tx !== tx || finalizedState.scope !== scope ||
    finalizedState.capability !== capability || finalizedState.receiptInserted
  ) return invalidTicketCreationKernel()
  const resolvedState = resolvedTicketCreationStates.get(finalizedState.resolved)
  if (
    !resolvedState || resolvedState.phase !== 'finalized' ||
    resolvedState.origin !== 'quick_quote' || resolvedState.receipt === null ||
    resolvedState.mode !== 'quick_insert'
  ) return invalidTicketCreationKernel()
  finalizedState.receiptInserted = true
  const expectation = ticketCreationReceiptExpectation(
    tx,
    scope,
    finalizedState.resolved,
    resolvedState,
  )
  const result = await insertMutationReceiptPrimitiveV1(tx, scope, {
    ...expectation,
    keyring,
    resultTicketId: finalizedState.batch.ticketId,
    resultJobIds: finalizedState.batch.jobIds,
  })
  if (
    result.ticketId !== finalizedState.batch.ticketId ||
    !sameIds(result.jobIds, finalizedState.batch.jobIds)
  ) return invalidTicketCreationKernel()
  return Object.freeze({
    ticketId: result.ticketId,
    jobIds: Object.freeze([...result.jobIds]),
  })
}

export async function classifyResolvedTicketCreationReceiptInTransactionV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  resolved: ResolvedTicketCreationV1,
  keyring: MutationFingerprintKeyringV1,
): ReturnType<typeof lockAndClassifyMutationReceiptV1> {
  const state = resolvedTicketCreationStateFor(tx, scope, resolved)
  if (
    state.origin !== 'quick_quote' || state.receipt === null ||
    state.phase !== 'resolved'
  ) return invalidTicketCreationKernel()
  return lockAndClassifyMutationReceiptV1(
    tx,
    scope,
    ticketCreationReceiptExpectation(tx, scope, resolved, state),
    keyring,
  )
}

function ticketCreationReceiptExpectation(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  resolved: ResolvedTicketCreationV1,
  state: ResolvedTicketCreationStateV1,
): MutationReceiptExpectationV1 {
  if (state.receipt === null || state.origin !== 'quick_quote') {
    return invalidTicketCreationKernel()
  }
  return Object.freeze({
    requestKey: state.receipt.requestKey,
    mutationKind: state.receipt.base.mutationKind,
    mutationSchemaVersion: 1 as const,
    targetTicketId: null,
    envelope: buildResolvedTicketCreationEnvelopeV1(tx, scope, resolved),
  })
}

export function readFinalizedTicketCreationResultV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  finalized: FinalizedTicketCreationV1,
): Readonly<{ ticketId: string; jobIds: readonly string[] }> {
  const capability = assertLiveLockedMutationScopeV1(tx, scope)
  if ((typeof finalized !== 'object' || finalized === null) && typeof finalized !== 'function') {
    return invalidTicketCreationKernel()
  }
  const finalizedState = finalizedTicketCreationStates.get(finalized)
  if (
    !finalizedState || finalizedState.tx !== tx || finalizedState.scope !== scope ||
    finalizedState.capability !== capability
  ) return invalidTicketCreationKernel()
  const resolvedState = resolvedTicketCreationStates.get(finalizedState.resolved)
  if (
    !resolvedState || resolvedState.phase !== 'finalized' ||
    resolvedState.origin === 'quick_quote' || resolvedState.receipt !== null
  ) return invalidTicketCreationKernel()
  return Object.freeze({
    ticketId: finalizedState.batch.ticketId,
    jobIds: Object.freeze([...finalizedState.batch.jobIds]),
  })
}

export function buildResolvedTicketCreationEnvelopeV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  resolved: ResolvedTicketCreationV1,
): CanonicalMutationEnvelopeV1 {
  const state = resolvedTicketCreationStateFor(tx, scope, resolved)
  if (state.origin !== 'quick_quote' || state.receipt === null) {
    return invalidTicketCreationKernel()
  }
  const base: TicketCreatingEnvelopeBaseV1 = state.receipt.base
  return Object.freeze({
    schemaVersion: base.schemaVersion,
    mutationKind: base.mutationKind,
    operationOrigin: state.origin,
    actorProfileId: scope.actor.id,
    target: base.target,
    candidates: base.candidates,
    payload: base.payload,
  })
}
