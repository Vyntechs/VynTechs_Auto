import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  customers, profiles, quoteVersions, shops, ticketJobs, tickets, vehicles,
} from '@/lib/db/schema'
import { listReadyToCollectTickets } from '@/lib/shop-os/ready-to-collect'
import { closeTicket, getTicketRingOut, recordTicketPayment } from '@/lib/shop-os/ring-out'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { listTodayTicketJobs, type TicketActor } from '@/lib/tickets'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const DONE_TICKET = uuid(20)
const ACTIVE_TICKET = uuid(21)
const JOBLESS_TICKET = uuid(22)
const CANCELED_WORK_TICKET = uuid(23)
const VERSION = uuid(50)
const JOB_BRAKES = uuid(30)
const JOB_OIL = uuid(31)

function partLine(id: string, priceCents: number) {
  return {
    id, kind: 'part', description: 'Part', quantity: '1', priceCents, taxable: true,
    partNumber: null, brand: null, coreChargeCents: null, fitment: null,
    laborHours: null, laborRateCents: null, source: 'manual', vendorContext: null,
  }
}

// $100 taxable part on JOB_BRAKES at an 8% shop rate: $108.00 owed.
const SNAPSHOT = {
  schemaVersion: 1,
  ticket: {
    id: DONE_TICKET, number: 7, customerId: uuid(10), vehicleId: uuid(11),
    laborRateCents: 10_000, taxRateBps: 800,
  },
  jobs: [
    {
      id: JOB_BRAKES, title: 'Front brakes', kind: 'repair', customerStory: null, storyMeta: null,
      lines: [partLine(uuid(40), 10_000)], attachments: [],
      totals: { subtotalCents: 10_000, taxableSubtotalCents: 10_000 },
    },
  ],
  totals: { subtotalCents: 10_000, taxableSubtotalCents: 10_000, taxCents: 800, totalCents: 10_800 },
}

const advisorActor: TicketActor = {
  profileId: uuid(1), shopId: '', role: 'advisor', skillTier: null,
  membershipStatus: 'active', deactivatedAt: null,
}
const techActor: TicketActor = {
  profileId: uuid(2), shopId: '', role: 'tech', skillTier: 3,
  membershipStatus: 'active', deactivatedAt: null,
}
const otherShopOwner: TicketActor = {
  profileId: uuid(3), shopId: '', role: 'owner', skillTier: null,
  membershipStatus: 'active', deactivatedAt: null,
}

describe('Today “Ready to collect” projection', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North', laborRateCents: 10_000, taxRateBps: 800 },
      { name: 'South', laborRateCents: 10_000, taxRateBps: 800 },
    ]).returning()
    shopId = shop.id
    advisorActor.shopId = shop.id
    techActor.shopId = shop.id
    otherShopOwner.shopId = otherShop.id

    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(101), shopId: shop.id, fullName: 'Avery Advisor', role: 'advisor' },
      { id: uuid(2), userId: uuid(102), shopId: shop.id, fullName: 'Taylor Tech', role: 'tech', skillTier: 3 },
      { id: uuid(3), userId: uuid(103), shopId: otherShop.id, fullName: 'Other Owner', role: 'owner' },
    ])
    await db.insert(customers).values({ id: uuid(10), shopId: shop.id, name: 'Ada Driver', phone: '5551234567' })
    await db.insert(vehicles).values({
      id: uuid(11), customerId: uuid(10), year: 2020, make: 'Ford', model: 'F-150',
    })
    await db.insert(tickets).values([
      { id: DONE_TICKET, shopId: shop.id, ticketNumber: 7, source: 'counter', customerId: uuid(10),
        vehicleId: uuid(11), concern: 'Brake noise', createdByProfileId: uuid(1) },
      { id: ACTIVE_TICKET, shopId: shop.id, ticketNumber: 8, source: 'counter', customerId: uuid(10),
        vehicleId: uuid(11), concern: 'Still on the lift', createdByProfileId: uuid(1) },
      { id: JOBLESS_TICKET, shopId: shop.id, ticketNumber: 9, source: 'counter', customerId: uuid(10),
        vehicleId: uuid(11), concern: 'Intake still being written', createdByProfileId: uuid(1) },
      { id: CANCELED_WORK_TICKET, shopId: shop.id, ticketNumber: 10, source: 'counter', customerId: uuid(10),
        vehicleId: uuid(11), concern: 'Customer changed their mind', createdByProfileId: uuid(1) },
    ])
    await db.insert(quoteVersions).values({
      id: VERSION, shopId: shop.id, ticketId: DONE_TICKET, versionNumber: 1,
      snapshot: SNAPSHOT, createdByProfileId: uuid(1),
    })
    await db.insert(ticketJobs).values([
      { id: JOB_BRAKES, shopId: shop.id, ticketId: DONE_TICKET, title: 'Front brakes', kind: 'repair',
        requiredSkillTier: 1, workStatus: 'done', approvalState: 'approved', approvedQuoteVersionId: VERSION,
        updatedAt: new Date('2026-08-01T14:00:00Z') },
      { id: JOB_OIL, shopId: shop.id, ticketId: ACTIVE_TICKET, title: 'Oil change', kind: 'maintenance',
        requiredSkillTier: 1, workStatus: 'in_progress' },
      { id: uuid(32), shopId: shop.id, ticketId: CANCELED_WORK_TICKET, title: 'Replace alternator',
        kind: 'repair', requiredSkillTier: 1, workStatus: 'canceled' },
    ])
  })

  afterEach(async () => close())

  it('keeps a finished-but-open repair order findable with its exact balance', async () => {
    const cards = await listReadyToCollectTickets(db, { actor: advisorActor })

    expect(cards.map((card) => card.ticketId)).toEqual([DONE_TICKET, CANCELED_WORK_TICKET])
    const [brakes] = cards
    expect(brakes.ticketNumber).toBe(7)
    expect(brakes.concern).toBe('Brake noise')
    expect(brakes.customerName).toBe('Ada Driver')
    expect(brakes.vehicle).toEqual({ year: 2020, make: 'Ford', model: 'F-150' })
    expect(brakes.attentionAt).toBe('2026-08-01T14:00:00.000Z')

    // The money is the audited ring-out, not a second computation.
    const authoritative = await getTicketRingOut(db, { actor: advisorActor, ticketId: DONE_TICKET })
    expect(authoritative.ok).toBe(true)
    if (!authoritative.ok) return
    expect(brakes.ringOut).toEqual(authoritative.ringOut)
    expect(brakes.ringOut.balanceCents).toBe(10_800)
    expect(brakes.ringOut.canRecordPayment).toBe(true)
  })

  it('uses the newest terminal job change for a finished repair order', async () => {
    await db.insert(ticketJobs).values({
      id: uuid(33),
      shopId,
      ticketId: DONE_TICKET,
      title: 'Declined alignment',
      kind: 'maintenance',
      requiredSkillTier: 1,
      workStatus: 'canceled',
      updatedAt: new Date('2026-08-02T17:18:00Z'),
    })

    const cards = await listReadyToCollectTickets(db, { actor: advisorActor })
    const brakes = cards.find((card) => card.ticketId === DONE_TICKET)

    expect(brakes?.attentionAt).toBe('2026-08-02T17:18:00.000Z')
  })

  it.each([
    ['open' as const],
    ['in_progress' as const],
    ['blocked' as const],
  ])('withholds a repair order while any job is still %s', async (workStatus) => {
    await db.update(ticketJobs).set({ workStatus }).where(eq(ticketJobs.id, JOB_BRAKES))

    const cards = await listReadyToCollectTickets(db, { actor: advisorActor })
    expect(cards.map((card) => card.ticketId)).not.toContain(DONE_TICKET)
  })

  it('treats canceled work as terminal so an all-canceled order still reaches closure', async () => {
    const cards = await listReadyToCollectTickets(db, { actor: advisorActor })
    const canceled = cards.find((card) => card.ticketId === CANCELED_WORK_TICKET)

    expect(canceled).toBeDefined()
    // Nothing approved, so nothing owed — the tool still offers closure.
    expect(canceled?.ringOut.owed.totalCents).toBe(0)
    expect(canceled?.ringOut.canClose).toBe(true)
    expect(canceled?.ringOut.canRecordPayment).toBe(false)
  })

  it('ignores a repair order that has no jobs at all', async () => {
    const cards = await listReadyToCollectTickets(db, { actor: advisorActor })
    expect(cards.map((card) => card.ticketId)).not.toContain(JOBLESS_TICKET)
  })

  it('shows no repair order and no money to a technician', async () => {
    expect(await listReadyToCollectTickets(db, { actor: techActor })).toEqual([])

    const today = await listTodayTicketJobs(db, { actor: techActor })
    expect(today.readyToCollect).toEqual([])
    expect(JSON.stringify(today)).not.toContain('balanceCents')
  })

  it.each([
    [{ membershipStatus: 'invited' }],
    [{ deactivatedAt: new Date('2026-07-01T00:00:00Z') }],
    [{ shopId: null }],
  ])('refuses a caller who is not an active member of the shop: %o', async (patch) => {
    expect(await listReadyToCollectTickets(db, {
      actor: { ...advisorActor, ...patch },
    })).toEqual([])
  })

  it('never leaks another shop’s finished repair order', async () => {
    expect(await listReadyToCollectTickets(db, { actor: otherShopOwner })).toEqual([])
  })

  it('drops the card only once the repair order is verifiably closed', async () => {
    const paid = await recordTicketPayment(db, {
      actor: advisorActor,
      ticketId: DONE_TICKET,
      body: { requestKey: uuid(70), amountCents: 10_800, method: 'cash' },
    })
    expect(paid.ok).toBe(true)

    // Paid in full but still open: the advisor still needs to find it to close.
    const afterPayment = await listReadyToCollectTickets(db, { actor: advisorActor })
    const stillListed = afterPayment.find((card) => card.ticketId === DONE_TICKET)
    expect(stillListed?.ringOut.balanceCents).toBe(0)
    expect(stillListed?.ringOut.canClose).toBe(true)

    const closed = await closeTicket(db, { actor: advisorActor, ticketId: DONE_TICKET })
    expect(closed.ok).toBe(true)

    const afterClose = await listReadyToCollectTickets(db, { actor: advisorActor })
    expect(afterClose.map((card) => card.ticketId)).not.toContain(DONE_TICKET)
  })

  it('carries the lane through the Today projection an advisor actually loads', async () => {
    const today = await listTodayTicketJobs(db, { actor: advisorActor })

    expect(today.readyToCollect.map((card) => card.ticketNumber)).toEqual([7, 10])
    // The finished job never reappears as active work.
    const activeIds = [
      ...today.myJobs, ...today.openJobs, ...today.teamJobs,
      ...today.createdJobs, ...today.partsJobs,
    ].map((job) => job.id)
    expect(activeIds).not.toContain(JOB_BRAKES)
  })

  it('leaves a canceled repair order off the lane entirely', async () => {
    await db.update(tickets).set({ status: 'canceled' }).where(eq(tickets.id, CANCELED_WORK_TICKET))

    const cards = await listReadyToCollectTickets(db, { actor: advisorActor })
    expect(cards.map((card) => card.ticketId)).toEqual([DONE_TICKET])
  })
})
