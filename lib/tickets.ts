import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  profiles,
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
  | { ok: false; error: TicketDomainError; warning?: AssignmentTierWarning }

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
      sessionId: ticketJobs.sessionId,
      workStatus: ticketJobs.workStatus,
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
    .where(
      and(
        eq(ticketJobs.shopId, actor.shopId),
        eq(tickets.status, 'open'),
        or(
          and(
            eq(ticketJobs.assignedTechId, actor.profileId),
            inArray(ticketJobs.workStatus, ['open', 'in_progress', 'blocked']),
          ),
          claimable,
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
      sessionId: row.sessionId,
      workStatus: row.workStatus as TodayTicketJob['workStatus'],
    }

    if (row.assignedTechId === actor.profileId) myJobs.push(job)
    else openJobs.push(job)
    if (row.sessionId) linkedSessionIds.push(row.sessionId)
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
  input: { actor: TicketActor; body: unknown },
): Promise<CreateTicketResult> {
  const denied = actorGate(input.actor)
  if (denied) return denied

  const parsed = createTicketBodySchema.safeParse(input.body)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const body = parsed.data
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
