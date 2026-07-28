import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { customers, profiles, shops, tickets, vehicles } from '@/lib/db/schema'
import { lookupTickets, TICKET_LOOKUP_LIMIT } from '@/lib/shop-os/ticket-lookup'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import type { TicketActor } from '@/lib/tickets'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const CLOSED_TICKET = uuid(20)
const OPEN_TICKET = uuid(21)
const OTHER_CUSTOMER_TICKET = uuid(22)
const FOREIGN_TICKET = uuid(23)

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

describe('Repair order lookup', () => {
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
    await db.insert(customers).values([
      { id: uuid(10), shopId: shop.id, name: 'Ada Driver', phone: '5551234567' },
      { id: uuid(12), shopId: shop.id, name: 'Bo Hauler', phone: '5559998888' },
      { id: uuid(14), shopId: otherShop.id, name: 'Ada Driver', phone: '5551234567' },
    ])
    await db.insert(vehicles).values([
      { id: uuid(11), customerId: uuid(10), year: 2020, make: 'Ford', model: 'F-150', plate: 'ABC123', vin: '1FTFW1E50LFA00001' },
      { id: uuid(13), customerId: uuid(12), year: 2019, make: 'Ram', model: '3500' },
      { id: uuid(15), customerId: uuid(14), year: 2020, make: 'Ford', model: 'F-150' },
    ])
    await db.insert(tickets).values([
      {
        id: CLOSED_TICKET, shopId: shop.id, ticketNumber: 7, source: 'counter', customerId: uuid(10),
        vehicleId: uuid(11), concern: 'Brake noise', createdByProfileId: uuid(1),
        status: 'closed', closedAt: new Date('2026-07-20T15:00:00.000Z'), closedByProfileId: uuid(1),
      },
      {
        id: OPEN_TICKET, shopId: shop.id, ticketNumber: 8, source: 'counter', customerId: uuid(10),
        vehicleId: uuid(11), concern: 'Still on the lift', createdByProfileId: uuid(1),
      },
      {
        id: OTHER_CUSTOMER_TICKET, shopId: shop.id, ticketNumber: 9, source: 'counter', customerId: uuid(12),
        vehicleId: uuid(13), concern: 'Transmission over temp', createdByProfileId: uuid(1),
      },
      {
        id: FOREIGN_TICKET, shopId: otherShop.id, ticketNumber: 7, source: 'counter', customerId: uuid(14),
        vehicleId: uuid(15), concern: 'Not this shop', createdByProfileId: uuid(3),
      },
    ])
  })

  afterEach(async () => close())

  it('finds a closed repair order the board no longer carries', async () => {
    const hits = await lookupTickets(db, { actor: advisorActor, q: 'Ada' })

    expect(hits.map((hit) => hit.ticketId)).toEqual([OPEN_TICKET, CLOSED_TICKET])
    const closed = hits[1]
    expect(closed.ticketNumber).toBe(7)
    expect(closed.status).toBe('closed')
    expect(closed.concern).toBe('Brake noise')
    expect(closed.customerName).toBe('Ada Driver')
    expect(closed.vehicle).toEqual({ year: 2020, make: 'Ford', model: 'F-150' })
    expect(closed.closedAt).toEqual(new Date('2026-07-20T15:00:00.000Z'))
  })

  it('never carries money, so a technician can find work without seeing a balance', async () => {
    const hits = await lookupTickets(db, { actor: techActor, q: 'Ada' })

    expect(hits.map((hit) => hit.ticketId)).toEqual([OPEN_TICKET, CLOSED_TICKET])
    for (const hit of hits) {
      expect(Object.keys(hit).sort()).toEqual([
        'closedAt', 'concern', 'customerName', 'openedAt', 'status', 'ticketId',
        'ticketNumber', 'vehicle',
      ])
    }
  })

  it.each([
    ['a bare number as the exact repair order number', '7', [CLOSED_TICKET]],
    ['a hash-prefixed number', '#7', [CLOSED_TICKET]],
    ['an RO-prefixed number', 'RO 7', [CLOSED_TICKET]],
    ['a plate', 'abc123', [OPEN_TICKET, CLOSED_TICKET]],
    ['a VIN', '1FTFW1E50LFA00001', [OPEN_TICKET, CLOSED_TICKET]],
    ['a phone number', '5559998888', [OTHER_CUSTOMER_TICKET]],
    ['a vehicle make and model', 'Ram 3500', [OTHER_CUSTOMER_TICKET]],
  ])('matches %s', async (_label, q, expected) => {
    const hits = await lookupTickets(db, { actor: advisorActor, q })
    expect(hits.map((hit) => hit.ticketId)).toEqual(expected)
  })

  it('narrows rather than widens as tokens are added', async () => {
    const broad = await lookupTickets(db, { actor: advisorActor, q: 'Ford' })
    const narrow = await lookupTickets(db, { actor: advisorActor, q: 'Ford 7' })

    expect(broad.map((hit) => hit.ticketId)).toEqual([OPEN_TICKET, CLOSED_TICKET])
    expect(narrow.map((hit) => hit.ticketId)).toEqual([CLOSED_TICKET])
  })

  it('never reaches another shop, even on an identical customer and number', async () => {
    const hits = await lookupTickets(db, { actor: advisorActor, q: 'Ada' })
    expect(hits.map((hit) => hit.ticketId)).not.toContain(FOREIGN_TICKET)

    const foreign = await lookupTickets(db, { actor: otherShopOwner, q: 'Ada' })
    expect(foreign.map((hit) => hit.ticketId)).toEqual([FOREIGN_TICKET])
  })

  it.each([
    ['no shop', { ...advisorActor, shopId: null }],
    ['an inactive membership', { ...advisorActor, membershipStatus: 'invited' }],
    ['a deactivated profile', { ...advisorActor, deactivatedAt: new Date() }],
    ['an unrecognized role', { ...advisorActor, role: 'curator' }],
  ])('returns nothing for %s', async (_label, actor) => {
    expect(await lookupTickets(db, { actor: actor as TicketActor, q: 'Ada' })).toEqual([])
  })

  it('treats an empty or whitespace query as no query at all', async () => {
    expect(await lookupTickets(db, { actor: advisorActor, q: '' })).toEqual([])
    expect(await lookupTickets(db, { actor: advisorActor, q: '   ' })).toEqual([])
  })

  it('treats LIKE wildcards as literal text rather than a match-everything query', async () => {
    expect(await lookupTickets(db, { actor: advisorActor, q: '%' })).toEqual([])
    expect(await lookupTickets(db, { actor: advisorActor, q: '_' })).toEqual([])
  })

  it('bounds the result set', async () => {
    await db.insert(tickets).values(
      Array.from({ length: TICKET_LOOKUP_LIMIT + 5 }, (_, index) => ({
        shopId,
        ticketNumber: 100 + index,
        source: 'counter' as const,
        customerId: uuid(10),
        vehicleId: uuid(11),
        concern: 'Bulk history',
        createdByProfileId: uuid(1),
      })),
    )

    const hits = await lookupTickets(db, { actor: advisorActor, q: 'Ada' })
    expect(hits).toHaveLength(TICKET_LOOKUP_LIMIT)
    // Newest first: the counter is almost always asking about recent work.
    expect(hits[0].ticketNumber).toBe(100 + TICKET_LOOKUP_LIMIT + 4)
  })
})
