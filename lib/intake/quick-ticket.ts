import { createHash } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { customers, jobLines, profiles, tickets, vehicles } from '@/lib/db/schema'
import { canCreateTickets } from '@/lib/shop-os/capabilities'
import {
  cannedJobLineInsertValues,
  loadStrictCannedJobCopy,
  type SafeCannedJobLine,
} from '@/lib/shop-os/canned-jobs'
import {
  createTicket,
  getTicketDetail,
  type CreateTicketResult,
  type TicketActor,
} from '@/lib/tickets'
import { upsertCustomer } from './customers'
import { upsertVehicle } from './vehicles'

const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase())
const optionalTrimmedText = (max: number) => z.string().trim().max(max).nullable().optional()
const mileageSchema = z.number().int().nonnegative().max(2_147_483_647)
const manualQuoteSchema = z.strictObject({
  mode: z.literal('manual'),
  kind: z.enum(['repair', 'maintenance']),
  description: z.string().trim().min(1).max(200),
})
const cannedQuoteSchema = z.strictObject({
  mode: z.literal('canned'),
  cannedJobId: uuidSchema,
  expectedFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  expectedTaxRateBps: z.union([z.literal(null), z.number().int().min(0).max(10_000)]),
})
const quoteSchema = z.discriminatedUnion('mode', [manualQuoteSchema, cannedQuoteSchema])
const common = { clientKey: uuidSchema, quote: quoteSchema }
const existingQuickTicketBodySchema = z.strictObject({
  vehicleMode: z.literal('existing'),
  existingVehicleId: uuidSchema,
  mileage: mileageSchema.nullable().optional(),
  ...common,
})
const newQuickTicketBodySchema = z.strictObject({
  vehicleMode: z.literal('new'),
  customer: z.strictObject({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(1).max(100),
    email: z.string().trim().email().max(320).nullable().optional(),
  }),
  vehicle: z.strictObject({
    year: z.number().int().min(1886).max(new Date().getFullYear() + 1),
    make: z.string().trim().min(1).max(100),
    model: z.string().trim().min(1).max(100),
    engine: optionalTrimmedText(200),
    vin: z.string().trim().length(17).nullable().optional(),
    mileage: mileageSchema.nullable().optional(),
    plate: optionalTrimmedText(32),
  }),
  ...common,
})
const quickTicketBodySchema = z.discriminatedUnion('vehicleMode', [
  existingQuickTicketBodySchema,
  newQuickTicketBodySchema,
])
type QuickTicketBody = z.output<typeof quickTicketBodySchema>

export type QuickTicketDependencies = {
  afterCustomer?: () => Promise<void>
  afterVehicle?: () => Promise<void>
  afterMileage?: () => Promise<void>
  afterTicket?: () => Promise<void>
  afterLines?: () => Promise<void>
}

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

function deterministicTicketId(shopId: string, profileId: string, clientKey: string): string {
  const bytes = createHash('sha256')
    .update('shop-os-quick-quote-ticket-v2\0')
    .update(shopId).update('\0')
    .update(profileId).update('\0')
    .update(clientKey)
    .digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function persistedActor(db: AppDb, boundary: TicketActor): Promise<TicketActor | null> {
  const profileId = uuidSchema.safeParse(boundary.profileId)
  if (!profileId.success || !boundary.shopId) return null
  const [profile] = await db.select({
    profileId: profiles.id,
    shopId: profiles.shopId,
    role: profiles.role,
    skillTier: profiles.skillTier,
    membershipStatus: profiles.membershipStatus,
    deactivatedAt: profiles.deactivatedAt,
  }).from(profiles).where(and(
    eq(profiles.id, profileId.data),
    eq(profiles.shopId, boundary.shopId),
    eq(profiles.membershipStatus, 'active'),
    isNull(profiles.deactivatedAt),
  )).limit(1).for('update')
  if (!profile?.shopId || !canCreateTickets(profile.role)) return null
  return profile
}

async function existingFirstSuccess(
  db: AppDb,
  actor: TicketActor,
  ticketId: string,
): Promise<CreateTicketResult | null> {
  const [row] = await db.select({
    id: tickets.id,
    source: tickets.source,
    createdByProfileId: tickets.createdByProfileId,
  }).from(tickets).where(and(
    eq(tickets.shopId, actor.shopId as string),
    eq(tickets.id, ticketId),
  )).limit(1)
  if (!row) return null
  if (row.source !== 'quick_quote' || row.createdByProfileId !== actor.profileId) {
    return { ok: false, error: 'not_found' }
  }
  return getTicketDetail(db, { actor, ticketId })
}

export async function createQuickTicket(
  db: AppDb,
  input: { actor: TicketActor; body: unknown },
  dependencies: QuickTicketDependencies = {},
): Promise<CreateTicketResult> {
  const denied = actorDenied(input.actor)
  if (denied) return denied
  const parsed = quickTicketBodySchema.safeParse(input.body)
  if (!parsed.success) return { ok: false, error: 'invalid_input' }
  const body = parsed.data

  try {
    return await db.transaction(async (tx) => {
      const actor = await persistedActor(tx, input.actor)
      if (!actor) return { ok: false, error: 'not_found' as const }
      const shopId = actor.shopId as string
      const ticketId = deterministicTicketId(shopId, actor.profileId, body.clientKey)
      const existing = await existingFirstSuccess(tx, actor, ticketId)
      if (existing) return existing

      let title: string
      let kind: 'repair' | 'maintenance'
      let requiredSkillTier: 1 | 2 | 3
      let cannedLines: SafeCannedJobLine[] = []
      if (body.quote.mode === 'manual') {
        title = body.quote.description
        kind = body.quote.kind
        requiredSkillTier = kind === 'repair' ? 2 : 1
      } else {
        const copy = await loadStrictCannedJobCopy(tx, {
          shopId,
          cannedJobId: body.quote.cannedJobId,
          expectedFingerprint: body.quote.expectedFingerprint,
          expectedTaxRateBps: body.quote.expectedTaxRateBps,
        })
        if (!copy.ok) {
          if (copy.error === 'not_found') return { ok: false, error: 'not_found' as const }
          return {
            ok: false,
            error: 'conflict' as const,
            ...(copy.retryable === undefined ? {} : { retryable: copy.retryable }),
          }
        }
        title = copy.cannedJob.title
        kind = copy.cannedJob.kind
        requiredSkillTier = copy.cannedJob.defaultRequiredSkillTier
        cannedLines = copy.cannedJob.lines
      }

      let customerId: string
      let vehicleId: string
      if (body.vehicleMode === 'existing') {
        const [context] = await tx.select({ customerId: customers.id, vehicleId: vehicles.id })
          .from(customers)
          .innerJoin(vehicles, and(
            eq(vehicles.id, body.existingVehicleId),
            eq(vehicles.customerId, customers.id),
          ))
          .where(eq(customers.shopId, shopId)).limit(1)
        if (!context) return { ok: false, error: 'not_found' as const }
        customerId = context.customerId
        vehicleId = context.vehicleId
        if (body.mileage !== undefined && body.mileage !== null) {
          await tx.update(vehicles).set({ mileage: body.mileage, updatedAt: new Date() })
            .where(eq(vehicles.id, vehicleId))
          await dependencies.afterMileage?.()
        }
      } else {
        const customer = await upsertCustomer(tx as AppDb, {
          shopId,
          name: body.customer.name,
          phone: body.customer.phone,
          email: body.customer.email ?? null,
        })
        customerId = customer.id
        await dependencies.afterCustomer?.()
        const vehicle = await upsertVehicle(tx as AppDb, {
          customerId,
          year: body.vehicle.year,
          make: body.vehicle.make,
          model: body.vehicle.model,
          engine: body.vehicle.engine ?? null,
          vin: body.vehicle.vin ?? null,
          mileage: body.vehicle.mileage ?? null,
          plate: body.vehicle.plate ?? null,
        })
        vehicleId = vehicle.id
        await dependencies.afterVehicle?.()
        if (
          body.vehicle.mileage !== undefined
          && body.vehicle.mileage !== null
          && vehicle.mileage !== body.vehicle.mileage
        ) {
          await tx.update(vehicles).set({
            mileage: body.vehicle.mileage,
            updatedAt: new Date(),
          }).where(eq(vehicles.id, vehicleId))
          await dependencies.afterMileage?.()
        }
      }

      const result = await createTicket(tx as AppDb, {
        actor,
        internal: { ticketId },
        body: {
          source: 'quick_quote',
          customerId,
          vehicleId,
          concern: title,
          jobs: [{
            title,
            kind,
            requiredSkillTier,
            assignedTechId: null,
          }],
        },
      })
      if (!result.ok) throw new QuickTicketRollback(result)
      await dependencies.afterTicket?.()
      if (cannedLines.length > 0) {
        await tx.insert(jobLines).values(cannedJobLineInsertValues(
          shopId,
          result.ticket.jobs[0].id,
          cannedLines,
        ))
        await dependencies.afterLines?.()
      }
      return result
    })
  } catch (error) {
    if (error instanceof QuickTicketRollback) return error.result
    throw error
  }
}
