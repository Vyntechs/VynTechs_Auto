import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  closeTicket,
  getTicketRingOut,
  recordTicketPayment,
} from '@/lib/shop-os/ring-out'
import {
  customers, profiles, quoteVersions, shops, ticketJobs, tickets, ticketPayments, vehicles,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import type { TicketActor } from '@/lib/tickets'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const TICKET = uuid(20)
const EMPTY_TICKET = uuid(21)
const VERSION = uuid(50)
const JOB_A = uuid(30)
const JOB_B = uuid(31)
const JOB_DECLINED = uuid(32)

function partLine(id: string, priceCents: number, taxable: boolean) {
  return {
    id, kind: 'part', description: 'Part', quantity: '1', priceCents, taxable,
    partNumber: null, brand: null, coreChargeCents: null, fitment: null,
    laborHours: null, laborRateCents: null, source: 'manual', vendorContext: null,
  }
}

function laborLine(id: string, priceCents: number) {
  return {
    id, kind: 'labor', description: 'Labor', quantity: '1', priceCents, taxable: false,
    partNumber: null, brand: null, coreChargeCents: null, fitment: null,
    laborHours: '1', laborRateCents: priceCents, source: 'manual', vendorContext: null,
  }
}

// A valid quote snapshot: JOB_A is a $100 taxable part, JOB_B is $50 labor.
const SNAPSHOT = {
  schemaVersion: 1,
  ticket: {
    id: TICKET, number: 7, customerId: uuid(10), vehicleId: uuid(11),
    laborRateCents: 10_000, taxRateBps: 800,
  },
  jobs: [
    {
      id: JOB_A, title: 'Front brakes', kind: 'repair', customerStory: null, storyMeta: null,
      lines: [partLine(uuid(40), 10_000, true)], attachments: [],
      totals: { subtotalCents: 10_000, taxableSubtotalCents: 10_000 },
    },
    {
      id: JOB_B, title: 'Oil change', kind: 'maintenance', customerStory: null, storyMeta: null,
      lines: [laborLine(uuid(41), 5_000)], attachments: [],
      totals: { subtotalCents: 5_000, taxableSubtotalCents: 0 },
    },
  ],
  totals: { subtotalCents: 15_000, taxableSubtotalCents: 10_000, taxCents: 800, totalCents: 15_800 },
}

const ownerActor: TicketActor = {
  profileId: uuid(1), shopId: '', role: 'owner', skillTier: null,
  membershipStatus: 'active', deactivatedAt: null,
}
const techActor: TicketActor = {
  profileId: uuid(2), shopId: '', role: 'tech', skillTier: 1,
  membershipStatus: 'active', deactivatedAt: null,
}

describe('Shop OS ring-out (getting paid)', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop] = await db.insert(shops).values({
      name: 'North', laborRateCents: 10_000, taxRateBps: 800,
    }).returning()
    ownerActor.shopId = shop.id
    techActor.shopId = shop.id
    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(101), shopId: shop.id, role: 'owner' },
      { id: uuid(2), userId: uuid(102), shopId: shop.id, role: 'tech' },
    ])
    await db.insert(customers).values({ id: uuid(10), shopId: shop.id, name: 'Customer', phone: '5551234567' })
    await db.insert(vehicles).values({ id: uuid(11), customerId: uuid(10), year: 2020, make: 'Ford', model: 'F-150' })
    await db.insert(tickets).values([
      { id: TICKET, shopId: shop.id, ticketNumber: 7, source: 'counter', customerId: uuid(10),
        vehicleId: uuid(11), concern: 'Brake noise', createdByProfileId: uuid(1) },
      { id: EMPTY_TICKET, shopId: shop.id, ticketNumber: 8, source: 'counter', customerId: uuid(10),
        vehicleId: uuid(11), concern: 'Looked over, nothing to do', createdByProfileId: uuid(1) },
    ])
    await db.insert(quoteVersions).values({
      id: VERSION, shopId: shop.id, ticketId: TICKET, versionNumber: 1,
      snapshot: SNAPSHOT, createdByProfileId: uuid(1),
    })
    await db.insert(ticketJobs).values([
      { id: JOB_A, shopId: shop.id, ticketId: TICKET, title: 'Front brakes', kind: 'repair',
        requiredSkillTier: 1, approvalState: 'approved', approvedQuoteVersionId: VERSION },
      { id: JOB_B, shopId: shop.id, ticketId: TICKET, title: 'Oil change', kind: 'maintenance',
        requiredSkillTier: 1, approvalState: 'approved', approvedQuoteVersionId: VERSION },
      { id: JOB_DECLINED, shopId: shop.id, ticketId: TICKET, title: 'Wipers', kind: 'maintenance',
        requiredSkillTier: 1, approvalState: 'declined' },
    ])
  })

  afterEach(async () => close())

  it('bills only approved jobs, taxes the total once, and starts unpaid', async () => {
    const result = await getTicketRingOut(db, { actor: ownerActor, ticketId: TICKET })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ringOut.owed).toEqual({
      subtotalCents: 15_000,
      taxCents: 800,
      totalCents: 15_800,
      jobs: [
        { jobId: JOB_A, title: 'Front brakes', subtotalCents: 10_000 },
        { jobId: JOB_B, title: 'Oil change', subtotalCents: 5_000 },
      ],
    })
    expect(result.ringOut.paidCents).toBe(0)
    expect(result.ringOut.balanceCents).toBe(15_800)
    expect(result.ringOut.canRecordPayment).toBe(true)
    expect(result.ringOut.canClose).toBe(false)
    expect(result.ringOut.status).toBe('open')
  })

  it('keeps money out of a technician’s hands', async () => {
    expect(await getTicketRingOut(db, { actor: techActor, ticketId: TICKET }))
      .toEqual({ ok: false, error: 'forbidden' })
    expect(await recordTicketPayment(db, {
      actor: techActor, ticketId: TICKET,
      body: { requestKey: uuid(70), amountCents: 100, method: 'cash' },
    })).toEqual({ ok: false, error: 'forbidden' })
    expect(await closeTicket(db, { actor: techActor, ticketId: TICKET }))
      .toEqual({ ok: false, error: 'forbidden' })
  })

  it('records a deposit then the balance, and clears to payable', async () => {
    const deposit = await recordTicketPayment(db, {
      actor: ownerActor, ticketId: TICKET,
      body: { requestKey: uuid(71), amountCents: 5_000, method: 'card', note: 'Parts deposit' },
    })
    expect(deposit.ok).toBe(true)
    if (!deposit.ok) return
    expect(deposit.ringOut.paidCents).toBe(5_000)
    expect(deposit.ringOut.balanceCents).toBe(10_800)
    expect(deposit.ringOut.canClose).toBe(false)
    expect(deposit.ringOut.payments).toHaveLength(1)
    expect(deposit.ringOut.payments[0]).toMatchObject({
      amountCents: 5_000, method: 'card', note: 'Parts deposit',
    })

    const settle = await recordTicketPayment(db, {
      actor: ownerActor, ticketId: TICKET,
      body: { requestKey: uuid(72), amountCents: 10_800, method: 'cash' },
    })
    expect(settle.ok).toBe(true)
    if (!settle.ok) return
    expect(settle.ringOut.paidCents).toBe(15_800)
    expect(settle.ringOut.balanceCents).toBe(0)
    expect(settle.ringOut.canRecordPayment).toBe(false)
    expect(settle.ringOut.canClose).toBe(true)
  })

  it('refuses a payment larger than the balance owed', async () => {
    expect(await recordTicketPayment(db, {
      actor: ownerActor, ticketId: TICKET,
      body: { requestKey: uuid(73), amountCents: 20_000, method: 'cash' },
    })).toEqual({ ok: false, error: 'overpayment' })
    expect(await recordTicketPayment(db, {
      actor: ownerActor, ticketId: TICKET,
      body: { requestKey: uuid(74), amountCents: 0, method: 'cash' },
    })).toEqual({ ok: false, error: 'invalid_input' })
  })

  it('is idempotent on a retried payment request', async () => {
    const body = { requestKey: uuid(75), amountCents: 5_000, method: 'cash' as const }
    const first = await recordTicketPayment(db, { actor: ownerActor, ticketId: TICKET, body })
    const second = await recordTicketPayment(db, { actor: ownerActor, ticketId: TICKET, body })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.ringOut.paidCents).toBe(5_000)
    expect(second.ringOut.payments).toHaveLength(1)
    const rows = await db.select().from(ticketPayments)
      .where(eq(ticketPayments.ticketId, TICKET))
    expect(rows).toHaveLength(1)
  })

  it('rejects the same payment key when any normalized payment truth differs', async () => {
    const requestKey = uuid(175)
    expect((await recordTicketPayment(db, {
      actor: ownerActor,
      ticketId: TICKET,
      body: { requestKey, amountCents: 5_000, method: 'cash', note: 'Deposit' },
    })).ok).toBe(true)

    await expect(recordTicketPayment(db, {
      actor: ownerActor,
      ticketId: TICKET,
      body: { requestKey, amountCents: 5_001, method: 'card', note: 'Changed' },
    })).resolves.toEqual({ ok: false, error: 'conflict' })

    const rows = await db.select().from(ticketPayments)
      .where(eq(ticketPayments.ticketId, TICKET))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ amountCents: 5_000, method: 'cash', note: 'Deposit' })
  })

  it('allows exactly one winner for concurrent different intents sharing a key', async () => {
    const requestKey = uuid(176)
    const results = await Promise.all([
      recordTicketPayment(db, {
        actor: ownerActor,
        ticketId: TICKET,
        body: { requestKey, amountCents: 4_000, method: 'cash' },
      }),
      recordTicketPayment(db, {
        actor: ownerActor,
        ticketId: TICKET,
        body: { requestKey, amountCents: 5_000, method: 'card' },
      }),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: 'conflict' }])
    expect(await db.select().from(ticketPayments)).toHaveLength(1)
  })

  it('will not close a ticket with an outstanding balance', async () => {
    await db.update(ticketJobs).set({ workStatus: 'done' })
      .where(and(eq(ticketJobs.shopId, ownerActor.shopId as string), eq(ticketJobs.ticketId, TICKET)))
    expect(await closeTicket(db, { actor: ownerActor, ticketId: TICKET }))
      .toEqual({ ok: false, error: 'balance_outstanding' })
  })

  it.each(['open', 'in_progress', 'blocked'] as const)(
    'refuses to close while a job is %s',
    async (workStatus) => {
      await db.insert(ticketJobs).values({
        id: uuid(workStatus === 'open' ? 201 : workStatus === 'in_progress' ? 202 : 203),
        shopId: ownerActor.shopId as string,
        ticketId: EMPTY_TICKET,
        title: `Still ${workStatus}`,
        kind: 'repair',
        requiredSkillTier: 1,
        workStatus,
      })

      await expect(closeTicket(db, { actor: ownerActor, ticketId: EMPTY_TICKET }))
        .resolves.toEqual({ ok: false, error: 'unfinished_work' })
    },
  )

  it('closes and stamps delivery once the balance is cleared', async () => {
    await db.update(ticketJobs).set({ workStatus: 'done' })
      .where(and(eq(ticketJobs.shopId, ownerActor.shopId as string), eq(ticketJobs.ticketId, TICKET)))
    await recordTicketPayment(db, {
      actor: ownerActor, ticketId: TICKET,
      body: { requestKey: uuid(76), amountCents: 15_800, method: 'cash' },
    })
    const closed = await closeTicket(db, { actor: ownerActor, ticketId: TICKET })
    expect(closed.ok).toBe(true)
    if (!closed.ok) return
    expect(closed.ringOut.status).toBe('closed')
    expect(closed.ringOut.balanceCents).toBe(0)
    expect(closed.ringOut.canRecordPayment).toBe(false)
    expect(closed.ringOut.canClose).toBe(false)
    expect(closed.ringOut.closedAt).not.toBeNull()

    const [row] = await db.select().from(tickets)
      .where(and(eq(tickets.id, TICKET), eq(tickets.shopId, ownerActor.shopId as string)))
    expect(row.status).toBe('closed')
    expect(row.closedAt).not.toBeNull()
    expect(row.deliveredAt).not.toBeNull()
    expect(row.closedByProfileId).toBe(uuid(1))
    expect(row.deliveredByProfileId).toBe(uuid(1))

    // A closed ticket takes no more payments.
    expect(await recordTicketPayment(db, {
      actor: ownerActor, ticketId: TICKET,
      body: { requestKey: uuid(77), amountCents: 100, method: 'cash' },
    })).toEqual({ ok: false, error: 'ticket_not_open' })
  })

  it('closes a ticket with nothing to collect at a zero balance', async () => {
    await db.insert(ticketJobs).values([
      { id: uuid(204), shopId: ownerActor.shopId as string, ticketId: EMPTY_TICKET,
        title: 'Completed inspection', kind: 'maintenance', requiredSkillTier: 1, workStatus: 'done' },
      { id: uuid(205), shopId: ownerActor.shopId as string, ticketId: EMPTY_TICKET,
        title: 'Declined service', kind: 'repair', requiredSkillTier: 1, workStatus: 'canceled' },
    ])
    const ringOut = await getTicketRingOut(db, { actor: ownerActor, ticketId: EMPTY_TICKET })
    expect(ringOut.ok).toBe(true)
    if (!ringOut.ok) return
    expect(ringOut.ringOut.owed.totalCents).toBe(0)
    expect(ringOut.ringOut.canClose).toBe(true)
    expect(ringOut.ringOut.canRecordPayment).toBe(false)

    const closed = await closeTicket(db, { actor: ownerActor, ticketId: EMPTY_TICKET })
    expect(closed.ok).toBe(true)
    if (!closed.ok) return
    expect(closed.ringOut.status).toBe('closed')
  })
})
