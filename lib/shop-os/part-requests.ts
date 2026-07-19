import { and, asc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { jobPartRequests, profiles, ticketJobs, tickets } from '@/lib/db/schema'
import { canPlacePartsOrders, isShopRole } from '@/lib/shop-os/capabilities'

// A tech's "I need this part" relay to the parts person. Deliberately money-free
// and separate from the quote: a request never carries cost or price and never
// touches the approved quote. The tech flags what they need; the parts person
// sources it (RepairLink / First Call today, live pricing later) and marks it
// handled.

export type PartRequestActor = { profileId: string; shopId: string }
export type PartRequestError = 'invalid_input' | 'not_found' | 'not_authorized' | 'conflict'
export type PartRequestFailure = { ok: false; error: PartRequestError; retryable?: true }

export type SafePartRequest = {
  id: string
  jobId: string
  description: string
  preference: string | null
  quantity: number
  status: 'requested' | 'sourced' | 'dismissed'
  requestedAt: string
  resolvedAt: string | null
}

// The parts-person view on a ticket adds who asked and which job it is for.
export type TicketPartRequest = SafePartRequest & {
  jobTitle: string
  requestedByName: string | null
}

const uuidSchema = z.uuid().transform((value) => value.toLowerCase())

const createBodySchema = z.strictObject({
  requestKey: uuidSchema,
  description: z.string().trim().min(1).max(200),
  // Preference is optional; a blank one normalizes to null below rather than
  // failing the whole request, so "just get me a water pump" works.
  preference: z.string().trim().max(200).nullable().optional(),
  quantity: z.number().int().min(1).max(99),
})

const resolveBodySchema = z.strictObject({
  status: z.enum(['sourced', 'dismissed']),
})

function failure(error: PartRequestError, retryable = false): PartRequestFailure {
  return retryable ? { ok: false, error, retryable: true } : { ok: false, error }
}

// Drizzle/pglite wrap the driver error, so the Postgres code lives on the cause
// chain — walk it, mirroring lib/shop-os/quotes.ts.
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  while (current) {
    if (typeof current === 'object' && 'code' in current && (current as { code?: string }).code === '23505') return true
    current = typeof current === 'object' && current !== null && 'cause' in current
      ? (current as { cause?: unknown }).cause
      : null
  }
  return false
}

type RequestRow = typeof jobPartRequests.$inferSelect

function safeRequest(row: RequestRow): SafePartRequest {
  return {
    id: row.id,
    jobId: row.jobId,
    description: row.description,
    preference: row.preference,
    quantity: row.quantity,
    status: row.status as SafePartRequest['status'],
    requestedAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  }
}

async function loadActiveActor(db: AppDb, actor: { profileId: string; shopId: string }) {
  const [row] = await db
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(and(
      eq(profiles.id, actor.profileId),
      eq(profiles.shopId, actor.shopId),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
  return row ?? null
}

export async function createPartRequest(
  db: AppDb,
  input: { actor: PartRequestActor; ticketId: unknown; jobId: unknown; body: unknown },
): Promise<{ ok: true; request: SafePartRequest } | PartRequestFailure> {
  const parsedActor = z.strictObject({ profileId: uuidSchema, shopId: uuidSchema }).safeParse(input.actor)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedJob = uuidSchema.safeParse(input.jobId)
  const parsedBody = createBodySchema.safeParse(input.body)
  if (!parsedActor.success || !parsedTicket.success || !parsedJob.success || !parsedBody.success) {
    return failure('invalid_input')
  }
  const shopId = parsedActor.data.shopId

  const actor = await loadActiveActor(db, parsedActor.data)
  if (!actor || !isShopRole(actor.role)) return failure('not_authorized')

  const [ticket] = await db
    .select({ id: tickets.id, status: tickets.status })
    .from(tickets)
    .where(and(eq(tickets.shopId, shopId), eq(tickets.id, parsedTicket.data)))
    .limit(1)
  if (!ticket || ticket.status !== 'open') return failure('not_found')

  const [job] = await db
    .select({ id: ticketJobs.id, assignedTechId: ticketJobs.assignedTechId, kind: ticketJobs.kind })
    .from(ticketJobs)
    .where(and(
      eq(ticketJobs.shopId, shopId),
      eq(ticketJobs.ticketId, parsedTicket.data),
      eq(ticketJobs.id, parsedJob.data),
    ))
    .limit(1)
  // Only the tech the job is assigned to flags its parts, and only on real
  // repair/maintenance work (never a diagnostic session job).
  if (!job || job.assignedTechId !== actor.id || (job.kind !== 'repair' && job.kind !== 'maintenance')) {
    return failure('not_found')
  }

  const preference = parsedBody.data.preference?.trim() ? parsedBody.data.preference.trim() : null
  try {
    const [created] = await db
      .insert(jobPartRequests)
      .values({
        shopId,
        ticketId: parsedTicket.data,
        jobId: parsedJob.data,
        requestedByProfileId: actor.id,
        description: parsedBody.data.description,
        preference,
        quantity: parsedBody.data.quantity,
        requestKey: parsedBody.data.requestKey,
      })
      .returning()
    return { ok: true, request: safeRequest(created) }
  } catch (error) {
    if (isUniqueViolation(error)) {
      const [existing] = await db
        .select()
        .from(jobPartRequests)
        .where(and(eq(jobPartRequests.shopId, shopId), eq(jobPartRequests.requestKey, parsedBody.data.requestKey)))
        .limit(1)
      if (existing && existing.jobId === parsedJob.data) return { ok: true, request: safeRequest(existing) }
      return failure('conflict', true)
    }
    throw error
  }
}

export async function resolvePartRequest(
  db: AppDb,
  input: { actor: PartRequestActor; ticketId: unknown; requestId: unknown; body: unknown },
): Promise<{ ok: true; request: SafePartRequest } | PartRequestFailure> {
  const parsedActor = z.strictObject({ profileId: uuidSchema, shopId: uuidSchema }).safeParse(input.actor)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedRequest = uuidSchema.safeParse(input.requestId)
  const parsedBody = resolveBodySchema.safeParse(input.body)
  if (!parsedActor.success || !parsedTicket.success || !parsedRequest.success || !parsedBody.success) {
    return failure('invalid_input')
  }
  const shopId = parsedActor.data.shopId

  const actor = await loadActiveActor(db, parsedActor.data)
  if (!actor || !canPlacePartsOrders(actor.role)) return failure('not_authorized')

  const [existing] = await db
    .select()
    .from(jobPartRequests)
    .where(and(
      eq(jobPartRequests.shopId, shopId),
      eq(jobPartRequests.id, parsedRequest.data),
      eq(jobPartRequests.ticketId, parsedTicket.data),
    ))
    .limit(1)
  if (!existing) return failure('not_found')
  if (existing.status !== 'requested') {
    // Already handled: an exact repeat is idempotent, a different verdict conflicts.
    return existing.status === parsedBody.data.status
      ? { ok: true, request: safeRequest(existing) }
      : failure('conflict')
  }

  const [updated] = await db
    .update(jobPartRequests)
    .set({
      status: parsedBody.data.status,
      resolvedByProfileId: actor.id,
      resolvedAt: sql`now()`,
    })
    .where(and(
      eq(jobPartRequests.shopId, shopId),
      eq(jobPartRequests.id, parsedRequest.data),
      eq(jobPartRequests.status, 'requested'),
    ))
    .returning()
  return updated ? { ok: true, request: safeRequest(updated) } : failure('conflict', true)
}

// The tech's own list for one job (no names — they know the job). Read-only;
// the caller (the work page) is already gated to the assigned tech.
export async function listPartRequestsForJob(
  db: AppDb,
  input: { shopId: string; jobId: string },
): Promise<SafePartRequest[]> {
  const rows = await db
    .select()
    .from(jobPartRequests)
    .where(and(eq(jobPartRequests.shopId, input.shopId), eq(jobPartRequests.jobId, input.jobId)))
    .orderBy(asc(jobPartRequests.createdAt), asc(jobPartRequests.id))
  return rows.map(safeRequest)
}

// The parts-person view for a whole ticket: every request, with who asked and
// which job. Read-only; the caller (ticket detail) gates by role.
export async function listPartRequestsForTicket(
  db: AppDb,
  input: { shopId: string; ticketId: string },
): Promise<TicketPartRequest[]> {
  const rows = await db
    .select({
      request: jobPartRequests,
      jobTitle: ticketJobs.title,
      requestedByName: profiles.fullName,
    })
    .from(jobPartRequests)
    .innerJoin(ticketJobs, and(
      eq(ticketJobs.shopId, jobPartRequests.shopId),
      eq(ticketJobs.id, jobPartRequests.jobId),
    ))
    .innerJoin(profiles, and(
      eq(profiles.shopId, jobPartRequests.shopId),
      eq(profiles.id, jobPartRequests.requestedByProfileId),
    ))
    .where(and(eq(jobPartRequests.shopId, input.shopId), eq(jobPartRequests.ticketId, input.ticketId)))
    .orderBy(asc(jobPartRequests.createdAt), asc(jobPartRequests.id))
  return rows.map((row) => ({
    ...safeRequest(row.request),
    jobTitle: row.jobTitle,
    requestedByName: row.requestedByName,
  }))
}
