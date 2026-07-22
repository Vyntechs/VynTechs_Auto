import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { customers, jobLines, profiles, vehicles } from '@/lib/db/schema'
import { canAssignWork } from '@/lib/shop-os/capabilities'
import {
  cannedJobLineInsertValues,
  loadStrictCannedJobCopy,
  type SafeCannedJobLine,
} from '@/lib/shop-os/canned-jobs'
import {
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

const cannedSelection = {
  cannedJobId: z.uuid(),
  expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  expectedTaxRateBps: z.number().int().min(0).max(10_000).nullable(),
}
const suppliedNote = z.string().trim().min(1).max(500).nullable().optional()
const workSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('diagnosis'), ...cannedSelection }),
  z.strictObject({ mode: z.literal('canned'), ...cannedSelection, customerSuppliedPartsNote: suppliedNote }),
  z.strictObject({
    mode: z.literal('manual'),
    kind: z.enum(['repair', 'maintenance']),
    description: z.string().trim().min(1).max(200),
    customerSuppliedPartsNote: suppliedNote,
  }),
])

const commonShape = {
  concern: z.string().trim().min(1).max(5_000),
  whenStarted: optionalTrimmedText(1_000),
  howOften: optionalTrimmedText(1_000),
  work: workSchema,
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

function actorDenied(actor: TicketActor): Exclude<CreateTicketResult, { ok: true }> | null {
  if (!actor.shopId) return { ok: false, error: 'no_shop' }
  if (actor.membershipStatus !== 'active' || actor.deactivatedAt) {
    return { ok: false, error: 'inactive_profile' }
  }
  if (!canAssignWork(actor.role)) return { ok: false, error: 'forbidden' }
  return null
}

function ticketBody(
  body: CounterBody,
  customerId: string,
  vehicleId: string,
  work: {
    title: string
    kind: 'diagnostic' | 'repair' | 'maintenance'
    requiredSkillTier: 1 | 2 | 3
    customerSuppliedPartsNote: string | null
  },
): Record<string, unknown> {
  return {
    source: 'counter',
    customerId,
    vehicleId,
    concern: body.concern,
    whenStarted: body.whenStarted ?? null,
    howOften: body.howOften ?? null,
    jobs: [
      {
        title: work.title,
        kind: work.kind,
        requiredSkillTier: work.requiredSkillTier,
        customerSuppliedPartsNote: work.customerSuppliedPartsNote,
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

  try {
    return await db.transaction(async (tx) => {
      const [profile] = await tx.select({
        id: profiles.id,
        shopId: profiles.shopId,
        role: profiles.role,
        skillTier: profiles.skillTier,
        membershipStatus: profiles.membershipStatus,
        deactivatedAt: profiles.deactivatedAt,
      }).from(profiles).where(eq(profiles.id, input.actor.profileId)).limit(1).for('update')
      if (!profile) return { ok: false, error: 'inactive_profile' as const }
      const persistedActor: TicketActor = {
        profileId: profile.id,
        shopId: profile.shopId,
        role: profile.role,
        skillTier: profile.skillTier,
        membershipStatus: profile.membershipStatus,
        deactivatedAt: profile.deactivatedAt,
      }
      const persistedDenied = actorDenied(persistedActor)
      if (persistedDenied) return persistedDenied
      const shopId = persistedActor.shopId as string

      let work: {
        title: string
        kind: 'diagnostic' | 'repair' | 'maintenance'
        requiredSkillTier: 1 | 2 | 3
        customerSuppliedPartsNote: string | null
      }
      let cannedLines: SafeCannedJobLine[] = []
      if (body.work.mode === 'manual') {
        work = {
          title: body.work.description,
          kind: body.work.kind,
          requiredSkillTier: body.work.kind === 'repair' ? 2 : 1,
          customerSuppliedPartsNote: body.work.customerSuppliedPartsNote ?? null,
        }
      } else {
        const copy = await loadStrictCannedJobCopy(tx, {
          shopId,
          cannedJobId: body.work.cannedJobId,
          expectedFingerprint: body.work.expectedFingerprint,
          expectedTaxRateBps: body.work.expectedTaxRateBps,
        })
        if (!copy.ok) return {
          ok: false,
          error: copy.error === 'not_found' ? 'not_found' as const : 'conflict' as const,
          ...(copy.retryable === undefined ? {} : { retryable: copy.retryable }),
        }
        const expectsDiagnosis = body.work.mode === 'diagnosis'
        if ((copy.cannedJob.kind === 'diagnostic') !== expectsDiagnosis) {
          return { ok: false, error: 'not_found' as const }
        }
        work = {
          title: copy.cannedJob.title,
          kind: copy.cannedJob.kind,
          requiredSkillTier: copy.cannedJob.defaultRequiredSkillTier,
          customerSuppliedPartsNote: body.work.mode === 'canned'
            ? body.work.customerSuppliedPartsNote ?? null
            : null,
        }
        cannedLines = copy.cannedJob.lines
      }

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
        actor: persistedActor,
        body: ticketBody(body, customerId, vehicleId, work),
      })
      if (!result.ok) throw new CounterTicketRollback(result)

      if (cannedLines.length > 0) {
        await tx.insert(jobLines).values(cannedJobLineInsertValues(
          shopId,
          result.ticket.jobs[0].id,
          cannedLines,
        ))
      }

      return result
    })
  } catch (error) {
    if (error instanceof CounterTicketRollback) return error.result
    throw error
  }
}
