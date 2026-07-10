import { and, asc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  profiles,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { canAssignWork, canCreateTickets } from '@/lib/shop-os/capabilities'

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

const optionalTrimmedText = (max: number) =>
  z.string().trim().max(max).nullable().optional()

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
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(200),
            kind: z.enum(['diagnostic', 'repair', 'maintenance']),
            requiredSkillTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
            assignedTechId: z.uuid().nullable().optional(),
            confirmBelowTier: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(25),
  })
  .strict()

type CreateTicketBody = z.infer<typeof createTicketBodySchema>

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
  job: CreateTicketBody['jobs'][number],
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
    const [outsideShop] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.id, job.assignedTechId))
      .limit(1)
    return outsideShop
      ? { ok: false, error: 'not_found' }
      : { ok: false, error: 'invalid_assignee' }
  }

  if (
    assignee.membershipStatus !== 'active' ||
    assignee.deactivatedAt ||
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

    const [sequence] = await tx
      .update(shops)
      .set({ nextTicketNumber: sql`${shops.nextTicketNumber} + 1` })
      .where(eq(shops.id, shopId))
      .returning()
    if (!sequence) return { ok: false, error: 'not_found' as const }
    const ticketNumber = sequence.nextTicketNumber - 1

    const [ticket] = await tx
      .insert(tickets)
      .values({
        shopId,
        ticketNumber,
        source: body.source,
        customerId: body.customerId,
        vehicleId: body.vehicleId,
        concern: body.concern,
        whenStarted: body.whenStarted,
        howOften: body.howOften,
        diagnosticAuthorizedCents: body.diagnosticAuthorizedCents,
        diagnosticAuthorizationNote: body.diagnosticAuthorizationNote,
        createdByProfileId: input.actor.profileId,
      })
      .returning()

    await tx.insert(ticketJobs).values(
      body.jobs.map((job, index) => ({
        shopId,
        ticketId: ticket.id,
        title: job.title,
        kind: job.kind,
        requiredSkillTier: job.requiredSkillTier,
        assignedTechId: assignments[index],
      })),
    )

    const detail = await loadTicketDetail(tx as AppDb, shopId, ticket.id)
    if (!detail) throw new Error('created_ticket_not_found')
    return { ok: true, ticket: detail }
  })
}
