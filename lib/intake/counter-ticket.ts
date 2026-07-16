import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { canAssignWork, canCreateTickets } from '@/lib/shop-os/capabilities'
import {
  finalizeResolvedTicketCreationInTransactionV1,
  getTicketDetail,
  insertResolvedTicketBatchInTransactionV1,
  readFinalizedTicketCreationResultV1,
  resolveTicketCreationInLockedScopeV1,
  type CreateTicketResult,
  type TicketActor,
} from '@/lib/tickets'
import {
  materializeTicketIntakeIdentityInLockedScopeV1,
  preflightTicketIntakeIdentityV1,
  type TicketIntakeIdentityInputV1,
  type TicketIntakeIdentityLockPlanV1,
  type TicketIntakeIdentitySeamsV1,
} from './ticket-identity'
import {
  ShopOsMutationConflict,
  ShopOsMutationNotFound,
  runBoundedShopOsMutationV1,
  type LockedMutationScopeV1,
  type MutationLockRequestV1,
  type NormalizedTicketJobCreateV1,
  type ResolvedTicketIntakeIdentityV1,
} from '@/lib/shop-os/continuity/mutation-foundation'
import {
  createCounterTicketOriginV1,
} from '@/lib/shop-os/continuity/mutation-foundation/ticket-origin.server'

const optionalTrimmedText = (max: number) =>
  z.string().trim().max(max).nullable().optional()

const PG_INTEGER_MAX = 2_147_483_647
const mileageSchema = z.number().int().nonnegative().max(PG_INTEGER_MAX)

const dollarAmountSchema = z
  .string()
  .regex(/^\d+(?:\.\d{1,2})?$/)
  .refine((value) => dollarsToCents(value) !== null)

const diagnosticAuthorizationSchema = z
  .object({
    amountDollars: dollarAmountSchema.nullable().optional(),
    note: optionalTrimmedText(2_000),
  })
  .strict()
  .optional()

const requestedServiceSchema = z
  .object({
    kind: z.enum(['repair', 'maintenance']),
    description: z.string().trim().min(1).max(200),
  })
  .strict()
  .optional()

const commonShape = {
  concern: z.string().trim().min(1).max(5_000),
  whenStarted: optionalTrimmedText(1_000),
  howOften: optionalTrimmedText(1_000),
  diagnosticAuthorization: diagnosticAuthorizationSchema,
  requestedService: requestedServiceSchema,
  assignedTechId: z.uuid().transform((value) => value.toLowerCase()).nullable(),
  confirmBelowTier: z.boolean().optional(),
}

const existingCounterBodySchema = z
  .object({
    vehicleMode: z.literal('existing'),
    existingVehicleId: z.uuid(),
    mileage: mileageSchema.nullable().optional(),
    ...commonShape,
  })
  .strict()

const newCounterBodySchema = z
  .object({
    vehicleMode: z.literal('new'),
    customer: z
      .object({
        name: z.string().trim().min(1).max(200),
        phone: z.string().trim().min(1).max(100),
        email: z.string().trim().email().max(320).nullable().optional(),
      })
      .strict(),
    vehicle: z
      .object({
        year: z.number().int().min(1886).max(new Date().getFullYear() + 1),
        make: z.string().trim().min(1).max(100),
        model: z.string().trim().min(1).max(100),
        engine: optionalTrimmedText(200),
        vin: z.string().trim().length(17).nullable().optional(),
        mileage: mileageSchema.nullable().optional(),
        plate: optionalTrimmedText(32),
      })
      .strict(),
    ...commonShape,
  })
  .strict()

const counterBodySchema = z.discriminatedUnion('vehicleMode', [
  existingCounterBodySchema,
  newCounterBodySchema,
])

type CounterBody = z.infer<typeof counterBodySchema>

export type CounterTicketDependencies = TicketIntakeIdentitySeamsV1 & Readonly<{
  afterIdentityPreflight?: () => Promise<void>
}>

type CounterDiscovery = Readonly<{
  identity: ResolvedTicketIntakeIdentityV1
  ticketId: string
  jobIds: readonly string[]
}>

class CounterTicketRollback extends Error {
  constructor(readonly result: Exclude<CreateTicketResult, { ok: true }>) {
    super('counter_ticket_rollback')
  }
}

function dollarsToCents(value: string): number | null {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(cents) : null
}

function actorDenied(actor: TicketActor): Exclude<CreateTicketResult, { ok: true }> | null {
  if (!actor.shopId) return { ok: false, error: 'no_shop' }
  if (actor.membershipStatus !== 'active' || actor.deactivatedAt) {
    return { ok: false, error: 'inactive_profile' }
  }
  if (!canCreateTickets(actor.role)) return { ok: false, error: 'forbidden' }
  return null
}

function identityInput(
  body: CounterBody,
  shopId: string,
): TicketIntakeIdentityInputV1 {
  if (body.vehicleMode === 'existing') {
    return {
      mode: 'existing_vehicle',
      shopId,
      existingVehicleId: body.existingVehicleId,
      ...(body.mileage === undefined ? {} : { mileage: body.mileage }),
    }
  }
  return {
    mode: 'new_vehicle',
    shopId,
    customer: {
      name: body.customer.name,
      phone: body.customer.phone,
      email: body.customer.email ?? null,
    },
    vehicle: {
      year: body.vehicle.year,
      make: body.vehicle.make,
      model: body.vehicle.model,
      engine: body.vehicle.engine ?? null,
      vin: body.vehicle.vin ?? null,
      mileage: body.vehicle.mileage ?? null,
      plate: body.vehicle.plate ?? null,
    },
  }
}

function lockRequest(
  actor: TicketActor,
  body: CounterBody,
  plan: TicketIntakeIdentityLockPlanV1,
  ticketId: string,
  jobIds: readonly string[],
): MutationLockRequestV1 {
  const profileIds = [...new Set([
    actor.profileId,
    ...(body.assignedTechId === null ? [] : [body.assignedTechId]),
  ])].sort()
  return {
    shopId: actor.shopId as string,
    actorProfileId: actor.profileId,
    profileIds,
    lockShop: true,
    customerIds: [...plan.customerIds],
    vehicleIds: [...plan.vehicleIds],
    ticketIds: [],
    jobIds: [],
    includeAllJobsForTickets: true,
    includeAllLinesForJobs: true,
    includeAllQuoteVersionsForTickets: false,
    includeAllQuoteEventsForTickets: false,
    sessionIds: [],
    sessionEventIds: [],
    vendorAccountIds: [],
    cannedJobIds: [],
    receiptRequestKey: null,
    receiptConditionalInsert: null,
    insertionIntents: {
      sessions: [],
      customers: plan.insertionIntents.customers.map((intent) => ({ ...intent })),
      vehicles: plan.insertionIntents.vehicles.map((intent) => ({ ...intent })),
      tickets: [ticketId],
      jobs: jobIds.map((id) => ({ id, ticketId })),
    },
  }
}

function lockedAssignment(
  scope: LockedMutationScopeV1,
  body: CounterBody,
):
  | Readonly<{ ok: true; assignedTechId: string | null }>
  | Exclude<CreateTicketResult, { ok: true }> {
  if (body.assignedTechId === null) {
    return { ok: true, assignedTechId: null }
  }
  const assignee = scope.profiles.find(({ id }) => id === body.assignedTechId)
  if (!assignee || assignee.shopId !== scope.actor.shopId) {
    return { ok: false, error: 'not_found' }
  }
  const tier = assignee.skillTier
  if (
    assignee.membershipStatus !== 'active' || assignee.deactivatedAt !== null ||
    !canCreateTickets(assignee.role) ||
    (tier !== 1 && tier !== 2 && tier !== 3)
  ) {
    return { ok: false, error: 'invalid_assignee' }
  }
  if (assignee.id === scope.actor.id) {
    return tier >= 3
      ? { ok: true, assignedTechId: assignee.id }
      : { ok: false, error: 'invalid_assignee' }
  }
  if (!canAssignWork(scope.actor.role)) {
    return { ok: false, error: 'invalid_assignee' }
  }
  if (tier < 3 && !body.confirmBelowTier) {
    return {
      ok: false,
      error: 'tier_confirmation_required',
      warning: {
        code: 'below_required_tier',
        assignedTechId: assignee.id,
        assignedSkillTier: tier,
        requiredSkillTier: 3,
      },
    }
  }
  return { ok: true, assignedTechId: assignee.id }
}

function ownedAuthorizationCents(body: CounterBody): number | null {
  const amount = body.diagnosticAuthorization?.amountDollars
  if (amount === undefined || amount === null) return null
  const cents = dollarsToCents(amount)
  if (cents === null) throw new Error('counter_ticket_amount_invalid')
  return cents
}

function creationJobs(
  body: CounterBody,
  jobIds: readonly string[],
  assignedTechId: string | null,
): readonly NormalizedTicketJobCreateV1[] {
  const jobs: NormalizedTicketJobCreateV1[] = [{
    id: jobIds[0]!,
    title: `Diagnose: ${body.concern}`.slice(0, 200),
    kind: 'diagnostic',
    requiredSkillTier: 3,
    assignedTechId,
    sessionId: null,
    createdFromJobId: null,
  }]
  if (body.requestedService) {
    jobs.push({
      id: jobIds[1]!,
      title: body.requestedService.description,
      kind: body.requestedService.kind,
      requiredSkillTier: body.requestedService.kind === 'repair' ? 2 : 1,
      assignedTechId,
      sessionId: null,
      createdFromJobId: null,
    })
  }
  return jobs
}

export async function createCounterTicket(
  db: AppDb,
  input: { actor: TicketActor; body: unknown },
  dependencies: CounterTicketDependencies = {},
): Promise<CreateTicketResult> {
  const denied = actorDenied(input.actor)
  if (denied) return denied

  const parsed = counterBodySchema.safeParse(input.body)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const body = parsed.data
  const shopId = input.actor.shopId as string
  const origin = createCounterTicketOriginV1()

  try {
    return await runBoundedShopOsMutationV1<CreateTicketResult, CounterDiscovery>(db, {
      discover: async (tx, attempt) => {
        const preflight = await preflightTicketIntakeIdentityV1(
          tx,
          attempt.capability,
          identityInput(body, shopId),
        )
        if (!preflight.ok) {
          throw new CounterTicketRollback({
            ok: false,
            error: preflight.error === 'not_found' ? 'not_found' : 'conflict',
          })
        }
        await dependencies.afterIdentityPreflight?.()
        const ticketId = randomUUID()
        const jobIds = [
          randomUUID(),
          ...(body.requestedService ? [randomUUID()] : []),
        ]
        return {
          lockRequest: lockRequest(
            input.actor,
            body,
            preflight.lockPlan,
            ticketId,
            jobIds,
          ),
          payload: {
            identity: preflight.identity,
            ticketId,
            jobIds,
          },
        }
      },
      executeLocked: async (tx, scope, discovery) => {
        const assignment = lockedAssignment(scope, body)
        if (!assignment.ok) throw new CounterTicketRollback(assignment)

        const materialized = await materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          discovery.identity,
          dependencies,
        )
        if (!materialized.ok) {
          if (materialized.error === 'identity_drift') {
            throw new ShopOsMutationConflict()
          }
          throw new CounterTicketRollback({ ok: false, error: 'conflict' })
        }

        const jobs = creationJobs(body, discovery.jobIds, assignment.assignedTechId)
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'intake_insert',
          origin,
          ticket: {
            id: discovery.ticketId,
            concern: body.concern,
            whenStarted: body.whenStarted ?? null,
            howOften: body.howOften ?? null,
            diagnosticAuthorizedCents: ownedAuthorizationCents(body),
            diagnosticAuthorizationNote: body.diagnosticAuthorization?.note ?? null,
          },
          identity: materialized.materialized,
          jobs,
          seededLinesByJobIndex: new Map(),
        })
        await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
        const finalized = await finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          [{
            ticketId: discovery.ticketId,
            createdTicket: true,
            createdJobIds: [...discovery.jobIds],
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )
        const safe = readFinalizedTicketCreationResultV1(tx, scope, finalized)
        if (
          safe.ticketId !== discovery.ticketId ||
          safe.jobIds.length !== discovery.jobIds.length ||
          safe.jobIds.some((id, index) => id !== discovery.jobIds[index])
        ) {
          throw new Error('counter_ticket_creation_result_mismatch')
        }

        const detail = await getTicketDetail(tx, {
          actor: {
            profileId: scope.actor.id,
            shopId: scope.actor.shopId,
            role: scope.actor.role,
            skillTier: scope.actor.skillTier,
            membershipStatus: 'active',
            deactivatedAt: null,
          },
          ticketId: safe.ticketId,
        })
        if (!detail.ok) throw new CounterTicketRollback(detail)
        return detail
      },
    })
  } catch (error) {
    if (error instanceof CounterTicketRollback) return error.result
    if (error instanceof ShopOsMutationNotFound) {
      return { ok: false, error: 'not_found' }
    }
    if (error instanceof ShopOsMutationConflict) {
      return { ok: false, error: 'conflict', retryable: true }
    }
    throw error
  }
}
