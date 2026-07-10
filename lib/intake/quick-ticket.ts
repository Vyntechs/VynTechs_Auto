import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { customers, vehicles } from '@/lib/db/schema'
import { canCreateTickets } from '@/lib/shop-os/capabilities'
import { createTicket, type CreateTicketResult, type TicketActor } from '@/lib/tickets'
import { upsertCustomer } from './customers'
import { upsertVehicle } from './vehicles'

const optionalTrimmedText = (max: number) =>
  z.string().trim().max(max).nullable().optional()

const mileageSchema = z.number().int().nonnegative().max(2_147_483_647)

const requestedWorkSchema = z
  .object({
    kind: z.enum(['repair', 'maintenance']),
    description: z.string().trim().min(1).max(200),
  })
  .strict()

const existingQuickTicketBodySchema = z
  .object({
    vehicleMode: z.literal('existing'),
    existingVehicleId: z.uuid(),
    mileage: mileageSchema.nullable().optional(),
    requestedWork: requestedWorkSchema,
  })
  .strict()

const newQuickTicketBodySchema = z
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
    requestedWork: requestedWorkSchema,
  })
  .strict()

const quickTicketBodySchema = z.discriminatedUnion('vehicleMode', [
  existingQuickTicketBodySchema,
  newQuickTicketBodySchema,
])

type QuickTicketBody = z.infer<typeof quickTicketBodySchema>

class QuickTicketRollback extends Error {
  constructor(readonly result: Exclude<CreateTicketResult, { ok: true }>) {
    super('quick_ticket_rollback')
  }
}

function actorDenied(actor: TicketActor): Exclude<CreateTicketResult, { ok: true }> | null {
  if (!actor.shopId) return { ok: false, error: 'no_shop' }
  if (actor.membershipStatus !== 'active' || actor.deactivatedAt) {
    return { ok: false, error: 'inactive_profile' }
  }
  if (!canCreateTickets(actor.role)) return { ok: false, error: 'forbidden' }
  return null
}

function ticketBody(body: QuickTicketBody, customerId: string, vehicleId: string) {
  return {
    source: 'quick_quote',
    customerId,
    vehicleId,
    concern: body.requestedWork.description,
    jobs: [
      {
        title: body.requestedWork.description,
        kind: body.requestedWork.kind,
        requiredSkillTier: body.requestedWork.kind === 'repair' ? 2 : 1,
        assignedTechId: null,
      },
    ],
  }
}

export async function createQuickTicket(
  db: AppDb,
  input: { actor: TicketActor; body: unknown },
): Promise<CreateTicketResult> {
  const denied = actorDenied(input.actor)
  if (denied) return denied

  const parsed = quickTicketBodySchema.safeParse(input.body)
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

      const result = await createTicket(tx as AppDb, {
        actor: input.actor,
        body: ticketBody(body, customerId, vehicleId),
      })
      if (!result.ok) throw new QuickTicketRollback(result)
      return result
    })
  } catch (error) {
    if (error instanceof QuickTicketRollback) return error.result
    throw error
  }
}
