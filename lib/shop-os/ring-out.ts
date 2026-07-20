import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  quoteVersions,
  shops,
  ticketJobs,
  ticketPayments,
  tickets,
} from '@/lib/db/schema'
import { canCloseTickets } from '@/lib/shop-os/capabilities'
import { calculateTicketTotals } from '@/lib/shop-os/quote-math'
import { isLockUnavailable, readApprovedJobBreakdown } from '@/lib/shop-os/quotes'
import type { TicketActor, TicketDomainError } from '@/lib/tickets'

// ---- Ring-out: turning approved work into a bill, collecting it, closing ----
//
// "Getting paid" sits on top of the quote spine. The amount owed is derived,
// never stored: it is the sum of each approved job's pre-tax subtotal (from the
// exact version the customer approved), taxed once at the shop's rate. Payments
// are append-only rows; the balance is owed minus what has been collected. A
// ticket closes only when the balance is cleared. Recording money and closing
// are advisor/owner actions (canCloseTickets) — techs never touch this surface.

export type TicketPaymentMethod = 'cash' | 'card' | 'check' | 'other'

export type TicketRingOutPayment = {
  id: string
  amountCents: number
  method: TicketPaymentMethod
  note: string | null
  recordedAt: string
}

export type TicketRingOut = {
  ticketId: string
  status: 'open' | 'closed' | 'canceled'
  owed: {
    subtotalCents: number
    taxCents: number
    totalCents: number
    jobs: Array<{ jobId: string; title: string; subtotalCents: number }>
  }
  paidCents: number
  balanceCents: number
  payments: TicketRingOutPayment[]
  canRecordPayment: boolean
  canClose: boolean
  closedAt: string | null
}

export type TicketRingOutResult =
  | { ok: true; ringOut: TicketRingOut }
  | { ok: false; error: TicketDomainError }

const paymentBodySchema = z
  .object({
    requestKey: z.uuid(),
    amountCents: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    method: z.enum(['cash', 'card', 'check', 'other']),
    note: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict()

type RingOutTicketRow = {
  id: string
  status: 'open' | 'closed' | 'canceled'
  closedAt: Date | null
}

function ringOutGate(
  actor: TicketActor,
): { ok: false; error: TicketDomainError } | null {
  if (!actor.shopId) return { ok: false, error: 'no_shop' }
  if (actor.membershipStatus !== 'active' || actor.deactivatedAt) {
    return { ok: false, error: 'inactive_profile' }
  }
  if (!canCloseTickets(actor.role)) return { ok: false, error: 'forbidden' }
  return null
}

// The bill: sum of approved jobs' subtotals, taxed once. Per-job snapshot
// totals carry no tax, so we recombine taxable and non-taxable portions and let
// the audited quote math apply the shop rate exactly as the quote builder does.
async function computeOwed(
  db: AppDb,
  shopId: string,
  ticketId: string,
  taxRateBps: number | null,
): Promise<TicketRingOut['owed']> {
  const jobs = await db
    .select({
      id: ticketJobs.id,
      title: ticketJobs.title,
      approvedQuoteVersionId: ticketJobs.approvedQuoteVersionId,
    })
    .from(ticketJobs)
    .where(and(
      eq(ticketJobs.shopId, shopId),
      eq(ticketJobs.ticketId, ticketId),
      eq(ticketJobs.approvalState, 'approved'),
    ))
    .orderBy(ticketJobs.createdAt, ticketJobs.id)

  const versionIds = [
    ...new Set(
      jobs
        .map((job) => job.approvedQuoteVersionId)
        .filter((id): id is string => id !== null),
    ),
  ]
  const versions = versionIds.length
    ? await db
        .select({ id: quoteVersions.id, snapshot: quoteVersions.snapshot })
        .from(quoteVersions)
        .where(and(
          eq(quoteVersions.shopId, shopId),
          eq(quoteVersions.ticketId, ticketId),
          inArray(quoteVersions.id, versionIds),
        ))
    : []
  const snapshotById = new Map(versions.map((version) => [version.id, version.snapshot]))

  const lines: Array<{ extendedCents: number; taxable: boolean }> = []
  const jobBreakdown: TicketRingOut['owed']['jobs'] = []
  for (const job of jobs) {
    if (!job.approvedQuoteVersionId) continue
    const snapshot = snapshotById.get(job.approvedQuoteVersionId)
    if (snapshot === undefined) continue
    const breakdown = readApprovedJobBreakdown(snapshot, job.id)
    if (!breakdown) continue
    lines.push({ extendedCents: breakdown.taxableSubtotalCents, taxable: true })
    lines.push({
      extendedCents: breakdown.subtotalCents - breakdown.taxableSubtotalCents,
      taxable: false,
    })
    jobBreakdown.push({
      jobId: job.id,
      title: job.title,
      subtotalCents: breakdown.subtotalCents,
    })
  }

  const totals = calculateTicketTotals(lines, taxRateBps ?? 0)
  return {
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    jobs: jobBreakdown,
  }
}

async function loadPayments(
  db: AppDb,
  shopId: string,
  ticketId: string,
): Promise<TicketRingOutPayment[]> {
  const rows = await db
    .select({
      id: ticketPayments.id,
      amountCents: ticketPayments.amountCents,
      method: ticketPayments.method,
      note: ticketPayments.note,
      recordedAt: ticketPayments.recordedAt,
    })
    .from(ticketPayments)
    .where(and(
      eq(ticketPayments.shopId, shopId),
      eq(ticketPayments.ticketId, ticketId),
    ))
    .orderBy(ticketPayments.recordedAt, ticketPayments.id)
  return rows.map((row) => ({
    id: row.id,
    amountCents: row.amountCents,
    method: row.method,
    note: row.note,
    recordedAt: row.recordedAt.toISOString(),
  }))
}

async function assembleRingOut(
  db: AppDb,
  shopId: string,
  ticket: RingOutTicketRow,
  taxRateBps: number | null,
): Promise<TicketRingOut> {
  const owed = await computeOwed(db, shopId, ticket.id, taxRateBps)
  const payments = await loadPayments(db, shopId, ticket.id)
  const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0)
  const balanceCents = owed.totalCents - paidCents
  return {
    ticketId: ticket.id,
    status: ticket.status,
    owed,
    paidCents,
    balanceCents,
    payments,
    canRecordPayment: ticket.status === 'open' && balanceCents > 0,
    canClose: ticket.status === 'open' && balanceCents <= 0,
    closedAt: ticket.closedAt ? ticket.closedAt.toISOString() : null,
  }
}

export async function getTicketRingOut(
  db: AppDb,
  input: { actor: TicketActor; ticketId: unknown },
): Promise<TicketRingOutResult> {
  const denied = ringOutGate(input.actor)
  if (denied) return denied
  const parsedTicket = z.uuid().safeParse(input.ticketId)
  if (!parsedTicket.success) return { ok: false, error: 'invalid_input' }
  const shopId = input.actor.shopId as string

  const [row] = await db
    .select({
      id: tickets.id,
      status: tickets.status,
      closedAt: tickets.closedAt,
      taxRateBps: shops.taxRateBps,
    })
    .from(tickets)
    .innerJoin(shops, eq(shops.id, tickets.shopId))
    .where(and(eq(tickets.shopId, shopId), eq(tickets.id, parsedTicket.data)))
    .limit(1)
  if (!row) return { ok: false, error: 'not_found' }

  const ringOut = await assembleRingOut(
    db,
    shopId,
    { id: row.id, status: row.status, closedAt: row.closedAt },
    row.taxRateBps,
  )
  return { ok: true, ringOut }
}

export async function recordTicketPayment(
  db: AppDb,
  input: { actor: TicketActor; ticketId: unknown; body: unknown },
): Promise<TicketRingOutResult> {
  const denied = ringOutGate(input.actor)
  if (denied) return denied
  const parsedTicket = z.uuid().safeParse(input.ticketId)
  const parsedBody = paymentBodySchema.safeParse(input.body)
  if (!parsedTicket.success || !parsedBody.success) {
    return { ok: false, error: 'invalid_input' }
  }
  const shopId = input.actor.shopId as string

  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as AppDb
      const [ticket] = await tx
        .select({ id: tickets.id, status: tickets.status, closedAt: tickets.closedAt })
        .from(tickets)
        .where(and(eq(tickets.shopId, shopId), eq(tickets.id, parsedTicket.data)))
        .limit(1)
        .for('update')
      if (!ticket) return { ok: false as const, error: 'not_found' }

      const [shop] = await tx
        .select({ taxRateBps: shops.taxRateBps })
        .from(shops)
        .where(eq(shops.id, shopId))
        .limit(1)
      const taxRateBps = shop?.taxRateBps ?? null

      // Idempotent retry: the same requestKey has already been recorded.
      const [existing] = await tx
        .select({
          ticketId: ticketPayments.ticketId,
          amountCents: ticketPayments.amountCents,
          method: ticketPayments.method,
          note: ticketPayments.note,
          recordedByProfileId: ticketPayments.recordedByProfileId,
        })
        .from(ticketPayments)
        .where(and(
          eq(ticketPayments.shopId, shopId),
          eq(ticketPayments.requestKey, parsedBody.data.requestKey),
        ))
        .limit(1)
      if (existing) {
        if (existing.ticketId !== ticket.id
          || existing.amountCents !== parsedBody.data.amountCents
          || existing.method !== parsedBody.data.method
          || existing.note !== (parsedBody.data.note ?? null)
          || existing.recordedByProfileId !== input.actor.profileId) {
          return { ok: false as const, error: 'conflict' }
        }
        const ringOut = await assembleRingOut(tx, shopId, ticket, taxRateBps)
        return { ok: true as const, ringOut }
      }

      if (ticket.status !== 'open') return { ok: false as const, error: 'ticket_not_open' }

      const owed = await computeOwed(tx, shopId, ticket.id, taxRateBps)
      const payments = await loadPayments(tx, shopId, ticket.id)
      const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0)
      const balanceCents = owed.totalCents - paidCents
      if (parsedBody.data.amountCents > balanceCents) {
        return { ok: false as const, error: 'overpayment' }
      }

      await tx.insert(ticketPayments).values({
        shopId,
        ticketId: ticket.id,
        amountCents: parsedBody.data.amountCents,
        method: parsedBody.data.method,
        note: parsedBody.data.note ?? null,
        recordedByProfileId: input.actor.profileId,
        requestKey: parsedBody.data.requestKey,
      })

      const ringOut = await assembleRingOut(tx, shopId, ticket, taxRateBps)
      return { ok: true as const, ringOut }
    })
  } catch (error) {
    // A concurrent request with the same requestKey lost the unique race; the
    // winning row is authoritative only when it represents the same intent.
    if (isUniqueViolation(error)) {
      const [existing] = await db
        .select({
          ticketId: ticketPayments.ticketId,
          amountCents: ticketPayments.amountCents,
          method: ticketPayments.method,
          note: ticketPayments.note,
          recordedByProfileId: ticketPayments.recordedByProfileId,
        })
        .from(ticketPayments)
        .where(and(
          eq(ticketPayments.shopId, shopId),
          eq(ticketPayments.requestKey, parsedBody.data.requestKey),
        ))
        .limit(1)
      if (!existing
        || existing.ticketId !== parsedTicket.data
        || existing.amountCents !== parsedBody.data.amountCents
        || existing.method !== parsedBody.data.method
        || existing.note !== (parsedBody.data.note ?? null)
        || existing.recordedByProfileId !== input.actor.profileId) {
        return { ok: false, error: 'conflict' }
      }
      return getTicketRingOut(db, { actor: input.actor, ticketId: input.ticketId })
    }
    if (isLockUnavailable(error)) return { ok: false, error: 'conflict' }
    throw error
  }
}

export async function closeTicket(
  db: AppDb,
  input: { actor: TicketActor; ticketId: unknown },
): Promise<TicketRingOutResult> {
  const denied = ringOutGate(input.actor)
  if (denied) return denied
  const parsedTicket = z.uuid().safeParse(input.ticketId)
  if (!parsedTicket.success) return { ok: false, error: 'invalid_input' }
  const shopId = input.actor.shopId as string

  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as AppDb
      const [ticket] = await tx
        .select({ id: tickets.id, status: tickets.status, closedAt: tickets.closedAt })
        .from(tickets)
        .where(and(eq(tickets.shopId, shopId), eq(tickets.id, parsedTicket.data)))
        .limit(1)
        .for('update')
      if (!ticket) return { ok: false as const, error: 'not_found' }
      if (ticket.status !== 'open') return { ok: false as const, error: 'ticket_not_open' }

      const [unfinishedJob] = await tx
        .select({ id: ticketJobs.id })
        .from(ticketJobs)
        .where(and(
          eq(ticketJobs.shopId, shopId),
          eq(ticketJobs.ticketId, ticket.id),
          inArray(ticketJobs.workStatus, ['open', 'in_progress', 'blocked']),
        ))
        .limit(1)
      if (unfinishedJob) return { ok: false as const, error: 'unfinished_work' }

      const [shop] = await tx
        .select({ taxRateBps: shops.taxRateBps })
        .from(shops)
        .where(eq(shops.id, shopId))
        .limit(1)
      const taxRateBps = shop?.taxRateBps ?? null

      const owed = await computeOwed(tx, shopId, ticket.id, taxRateBps)
      const payments = await loadPayments(tx, shopId, ticket.id)
      const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0)
      if (owed.totalCents - paidCents > 0) {
        return { ok: false as const, error: 'balance_outstanding' }
      }

      const now = new Date()
      const [updated] = await tx
        .update(tickets)
        .set({
          status: 'closed',
          closedAt: now,
          closedByProfileId: input.actor.profileId,
          deliveredAt: now,
          deliveredByProfileId: input.actor.profileId,
          updatedAt: now,
        })
        .where(and(
          eq(tickets.shopId, shopId),
          eq(tickets.id, ticket.id),
          eq(tickets.status, 'open'),
        ))
        .returning()
      if (!updated) return { ok: false as const, error: 'conflict' }

      const ringOut = await assembleRingOut(
        tx,
        shopId,
        { id: updated.id, status: updated.status, closedAt: updated.closedAt },
        taxRateBps,
      )
      return { ok: true as const, ringOut }
    })
  } catch (error) {
    if (isLockUnavailable(error)) return { ok: false, error: 'conflict' }
    throw error
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'code' in current && current.code === '23505') return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}
