import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { customers, vehicles } from '@/lib/db/schema'
import { canCreateTickets } from '@/lib/shop-os/capabilities'
import {
  addTicketJob,
  createTicket,
  type CreateTicketResult,
  type TicketActor,
} from '@/lib/tickets'
import { upsertCustomer } from './customers'
import { upsertVehicle } from './vehicles'

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
  assignedTechId: z.uuid().nullable(),
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

function ticketBody(
  body: CounterBody,
  customerId: string,
  vehicleId: string,
): Record<string, unknown> {
  const amount = body.diagnosticAuthorization?.amountDollars
  const diagnosticAuthorizedCents = amount ? dollarsToCents(amount) : null
  return {
    source: 'counter',
    customerId,
    vehicleId,
    concern: body.concern,
    whenStarted: body.whenStarted ?? null,
    howOften: body.howOften ?? null,
    diagnosticAuthorizedCents,
    diagnosticAuthorizationNote: body.diagnosticAuthorization?.note ?? null,
    jobs: [
      {
        title: `Diagnose: ${body.concern}`.slice(0, 200),
        kind: 'diagnostic',
        requiredSkillTier: 3,
        assignedTechId: body.assignedTechId,
        confirmBelowTier: body.confirmBelowTier,
      },
    ],
  }
}

export async function createCounterTicket(
  db: AppDb,
  input: { actor: TicketActor; body: unknown },
): Promise<CreateTicketResult> {
  const denied = actorDenied(input.actor)
  if (denied) return denied

  const parsed = counterBodySchema.safeParse(input.body)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const body = parsed.data
  const shopId = input.actor.shopId as string

  try {
    return await db.transaction(async (tx) => {
      let customerId: string
      let vehicleId: string

      if (body.vehicleMode === 'existing') {
        const [context] = await tx
          .select({ customerId: customers.id, vehicleId: vehicles.id })
          .from(customers)
          .innerJoin(
            vehicles,
            and(eq(vehicles.id, body.existingVehicleId), eq(vehicles.customerId, customers.id)),
          )
          .where(eq(customers.shopId, shopId))
          .limit(1)
        if (!context) return { ok: false, error: 'not_found' as const }

        customerId = context.customerId
        vehicleId = context.vehicleId
        if (body.mileage !== undefined && body.mileage !== null) {
          await tx
            .update(vehicles)
            .set({ mileage: body.mileage, updatedAt: new Date() })
            .where(eq(vehicles.id, vehicleId))
        }
      } else {
        const customer = await upsertCustomer(tx as AppDb, {
          shopId,
          name: body.customer.name,
          phone: body.customer.phone,
          email: body.customer.email ?? null,
        })
        const vehicle = await upsertVehicle(tx as AppDb, {
          customerId: customer.id,
          year: body.vehicle.year,
          make: body.vehicle.make,
          model: body.vehicle.model,
          engine: body.vehicle.engine ?? null,
          vin: body.vehicle.vin ?? null,
          mileage: body.vehicle.mileage ?? null,
          plate: body.vehicle.plate ?? null,
        })
        customerId = customer.id
        vehicleId = vehicle.id
      }

      let result = await createTicket(tx as AppDb, {
        actor: input.actor,
        body: ticketBody(body, customerId, vehicleId),
      })
      if (!result.ok) throw new CounterTicketRollback(result)

      if (body.requestedService) {
        result = await addTicketJob(tx as AppDb, {
          actor: input.actor,
          ticketId: result.ticket.id,
          body: {
            title: body.requestedService.description,
            kind: body.requestedService.kind,
            requiredSkillTier: body.requestedService.kind === 'repair' ? 2 : 1,
            assignedTechId: body.assignedTechId,
            confirmBelowTier: body.confirmBelowTier,
          },
        })
        if (!result.ok) throw new CounterTicketRollback(result)
      }
      return result
    })
  } catch (error) {
    if (error instanceof CounterTicketRollback) return error.result
    throw error
  }
}
