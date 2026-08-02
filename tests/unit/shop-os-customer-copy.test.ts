import { eq } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  customers,
  profiles,
  quoteEvents,
  quoteVersions,
  shops,
  ticketJobs,
  ticketPayments,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import {
  getCustomerCopy,
  getCustomerCopyBundle,
  type CustomerCopyActor,
} from '@/lib/shop-os/customer-copy'
import { readPreparedCustomerPricing } from '@/lib/shop-os/quotes'
import { getTicketRingOut } from '@/lib/shop-os/ring-out'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const TICKET = uuid(20)
const CUSTOMER = uuid(10)
const VEHICLE = uuid(11)
const APPROVED_JOB = uuid(30)
const DECLINED_JOB = uuid(31)
const PINNED_VERSION = uuid(50)
const ACTIVE_VERSION = uuid(51)
const INTERNAL_SENTINEL = 'INTERNAL-DIAGNOSTIC-EVIDENCE-SENTINEL'

function partLine(id: string, description: string, priceCents: number) {
  return {
    id,
    kind: 'part',
    description,
    quantity: '2',
    priceCents,
    taxable: true,
    partNumber: 'PAD-42',
    brand: 'Northstar',
    coreChargeCents: 9_999,
    fitment: 'INTERNAL-FITMENT-SENTINEL',
    laborHours: null,
    laborRateCents: null,
    source: 'manual',
    vendorContext: null,
  }
}

function laborLine(id: string, description: string, priceCents: number) {
  return {
    id,
    kind: 'labor',
    description,
    quantity: '1',
    priceCents,
    taxable: false,
    partNumber: null,
    brand: null,
    coreChargeCents: null,
    fitment: null,
    laborHours: '1.25',
    laborRateCents: 15_000,
    source: 'manual',
    vendorContext: null,
  }
}

function snapshot(input: {
  version: 'pinned' | 'active'
  approvedPriceCents: number
  includeDeclined: boolean
}) {
  const jobs = [
    {
      id: APPROVED_JOB,
      title: 'Front brake service',
      kind: 'repair',
      customerStory: {
        whatYouToldUs: 'Noise while braking',
        whatWeFound: INTERNAL_SENTINEL,
        howWeKnow: [{ claim: INTERNAL_SENTINEL, sourceEventIds: [uuid(91)], sourceArtifactIds: [] }],
        whatItMeansIfWaived: INTERNAL_SENTINEL,
        whatWeRecommend: INTERNAL_SENTINEL,
      },
      storyMeta: { source: 'manual' },
      lines: [partLine(uuid(input.version === 'pinned' ? 40 : 42), 'Brake pad set', input.approvedPriceCents)],
      attachments: [],
      totals: { subtotalCents: input.approvedPriceCents, taxableSubtotalCents: input.approvedPriceCents },
    },
    ...(input.includeDeclined ? [{
      id: DECLINED_JOB,
      title: 'Brake fluid service',
      kind: 'maintenance',
      customerStory: null,
      storyMeta: null,
      lines: [laborLine(uuid(43), 'Brake fluid service labor', 5_000)],
      attachments: [],
      totals: { subtotalCents: 5_000, taxableSubtotalCents: 0 },
    }] : []),
  ]
  const subtotalCents = jobs.reduce((total, job) => total + job.totals.subtotalCents, 0)
  const taxableSubtotalCents = jobs.reduce((total, job) => total + job.totals.taxableSubtotalCents, 0)
  const taxCents = Math.round(taxableSubtotalCents * 0.08)
  return {
    schemaVersion: 1,
    ticket: {
      id: TICKET,
      number: 1042,
      customerId: CUSTOMER,
      vehicleId: VEHICLE,
      laborRateCents: 15_000,
      taxRateBps: 800,
    },
    jobs,
    totals: { subtotalCents, taxableSubtotalCents, taxCents, totalCents: subtotalCents + taxCents },
  }
}

const PINNED_SNAPSHOT = snapshot({ version: 'pinned', approvedPriceCents: 10_000, includeDeclined: false })
const ACTIVE_SNAPSHOT = snapshot({ version: 'active', approvedPriceCents: 20_000, includeDeclined: true })

const actor = (role: CustomerCopyActor['role'], shopId: string | null): CustomerCopyActor => ({
  profileId: uuid(role === 'owner' ? 1 : role === 'advisor' ? 2 : role === 'tech' ? 3 : 4),
  shopId,
  role,
  skillTier: role === 'tech' ? 2 : null,
  membershipStatus: 'active',
  deactivatedAt: null,
})

describe('customer-safe prepared quote reader', () => {
  it('returns customer price detail while excluding internal snapshot evidence', () => {
    const result = readPreparedCustomerPricing(ACTIVE_SNAPSHOT)

    expect(result).toMatchObject({
      jobs: [
        { title: 'Front brake service', lines: [{ kind: 'part', quantity: '2', priceCents: 20_000 }] },
        { title: 'Brake fluid service', lines: [{ kind: 'labor', hours: '1.25', priceCents: 5_000 }] },
      ],
      totals: { subtotalCents: 25_000, taxCents: 1_600, totalCents: 26_600 },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(INTERNAL_SENTINEL)
    expect(serialized).not.toMatch(/coreCharge|fitment|vendor|story|attachment|sourceEvent|sourceArtifact/i)
  })

  it('fails closed for a malformed prepared snapshot', () => {
    expect(readPreparedCustomerPricing({ ...ACTIVE_SNAPSHOT, schemaVersion: 99 })).toBeNull()
  })
})

describe('Shop OS Customer Copy projection', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      {
        name: 'Honest Auto', phone: '(214) 555-0197', addressLine1: '415 Industrial Way',
        addressLine2: 'Suite 2', city: 'Garland', region: 'TX', postalCode: '75040',
        laborRateCents: 15_000, taxRateBps: 800,
      },
      { name: 'Other Shop', laborRateCents: 15_000, taxRateBps: 800 },
    ]).returning()
    shopId = shop.id
    otherShopId = otherShop.id
    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(101), shopId, role: 'owner', fullName: 'Owner' },
      { id: uuid(2), userId: uuid(102), shopId, role: 'advisor', fullName: 'Advisor' },
      { id: uuid(3), userId: uuid(103), shopId, role: 'tech', fullName: 'Tech' },
      { id: uuid(4), userId: uuid(104), shopId, role: 'parts', fullName: 'Parts' },
      { id: uuid(5), userId: uuid(105), shopId: otherShopId, role: 'owner', fullName: 'Other Owner' },
    ])
    await db.insert(customers).values({
      id: CUSTOMER, shopId, name: 'Ada Driver', phone: '5551234567', email: 'PRIVATE@SENTINEL.test',
    })
    await db.insert(vehicles).values({
      id: VEHICLE, customerId: CUSTOMER, year: 2020, make: 'Ford', model: 'F-150',
      vin: '1FTFW1E50LFA00001', mileage: 91_240, engine: 'INTERNAL-ENGINE-SENTINEL',
    })
    await db.insert(tickets).values({
      id: TICKET, shopId, ticketNumber: 1042, source: 'counter', customerId: CUSTOMER,
      vehicleId: VEHICLE, concern: 'PRIVATE-CONCERN-SENTINEL', createdByProfileId: uuid(2),
    })
    await db.insert(quoteVersions).values([
      {
        id: PINNED_VERSION, shopId, ticketId: TICKET, versionNumber: 1,
        snapshot: PINNED_SNAPSHOT, createdByProfileId: uuid(2), supersededAt: new Date('2026-08-01T12:00:00Z'),
      },
      {
        id: ACTIVE_VERSION, shopId, ticketId: TICKET, versionNumber: 2,
        snapshot: ACTIVE_SNAPSHOT, createdByProfileId: uuid(2),
      },
    ])
    await db.insert(ticketJobs).values([
      {
        id: APPROVED_JOB, shopId, ticketId: TICKET, title: 'MUTABLE-TITLE-SENTINEL', kind: 'repair',
        requiredSkillTier: 1, approvalState: 'approved', approvedQuoteVersionId: PINNED_VERSION,
        assignedTechId: uuid(3), workNotes: 'PRIVATE-WORK-NOTES-SENTINEL',
      },
      {
        id: DECLINED_JOB, shopId, ticketId: TICKET, title: 'Brake fluid service', kind: 'maintenance',
        requiredSkillTier: 1, approvalState: 'declined', workNotes: 'PRIVATE-DECLINED-NOTES-SENTINEL',
      },
    ])
    await db.insert(quoteEvents).values([
      {
        id: uuid(60), shopId, ticketId: TICKET, jobId: APPROVED_JOB, quoteVersionId: PINNED_VERSION,
        kind: 'approved', actorProfileId: uuid(2), approvedVia: 'phone', requestKey: uuid(70),
        body: 'PRIVATE-EVENT-BODY-SENTINEL', createdAt: new Date('2026-08-01T13:00:00Z'),
      },
      {
        id: uuid(61), shopId, ticketId: TICKET, jobId: DECLINED_JOB, quoteVersionId: ACTIVE_VERSION,
        kind: 'declined', actorProfileId: uuid(2), requestKey: uuid(71),
        body: 'PRIVATE-DECLINE-BODY-SENTINEL', createdAt: new Date('2026-08-01T13:05:00Z'),
      },
    ])
  })

  afterEach(async () => close())

  it.each(['owner', 'advisor'] as const)('returns an invoice to an active %s from pinned prices and exact ring-out money', async (role) => {
    const result = await getCustomerCopy(db, { actor: actor(role, shopId), ticketId: TICKET })
    const ringOut = await getTicketRingOut(db, { actor: actor(role, shopId), ticketId: TICKET })

    expect(result.ok).toBe(true)
    expect(ringOut.ok).toBe(true)
    if (!result.ok || !ringOut.ok) return
    expect(result.copy.documentKind).toBe('invoice')
    expect(result.copy.jobs).toEqual([expect.objectContaining({
      title: 'Front brake service',
      lines: [expect.objectContaining({ description: 'Brake pad set', quantity: '2', priceCents: 10_000 })],
    })])
    expect(result.copy.totals).toMatchObject({
      subtotalCents: ringOut.ringOut.owed.subtotalCents,
      taxCents: ringOut.ringOut.owed.taxCents,
      totalCents: ringOut.ringOut.owed.totalCents,
      paidCents: ringOut.ringOut.paidCents,
      balanceCents: ringOut.ringOut.balanceCents,
    })
    expect(result.copy.decisions).toEqual([
      { jobTitle: 'Front brake service', decision: 'approved', method: 'phone', recordedAt: '2026-08-01T13:00:00.000Z' },
      { jobTitle: 'Brake fluid service', decision: 'declined', method: null, recordedAt: '2026-08-01T13:05:00.000Z' },
    ])
    expect(result.copy.readyToPrint).toBe(true)
  })

  it('returns the exact ring-out and safe copy from one read-only repeatable-read snapshot', async () => {
    const result = await getCustomerCopyBundle(db, {
      actor: actor('advisor', shopId),
      ticketId: TICKET,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.copy.totals).toMatchObject({
      subtotalCents: result.ringOut.owed.subtotalCents,
      taxCents: result.ringOut.owed.taxCents,
      totalCents: result.ringOut.owed.totalCents,
      paidCents: result.ringOut.paidCents,
      balanceCents: result.ringOut.balanceCents,
    })
    expect(result.copy.totals.payments).toEqual(
      result.ringOut.payments.map(({ amountCents, method, recordedAt }) => ({
        amountCents, method, recordedAt,
      })),
    )
  })

  it('pins bundle assembly to the repository repeatable-read transaction contract', () => {
    const source = readFileSync(resolve(process.cwd(), 'lib/shop-os/customer-copy.ts'), 'utf8')

    expect(source).toMatch(/db\.transaction\([\s\S]*isolationLevel:\s*['"]repeatable read['"]/)
    expect(source).toMatch(/accessMode:\s*['"]read only['"]/)
  })

  it('selects Estimate from the current prepared version when no work is approved', async () => {
    await db.update(ticketJobs).set({ approvalState: 'quote_ready', approvedQuoteVersionId: null })
      .where(eq(ticketJobs.id, APPROVED_JOB))
    const result = await getCustomerCopy(db, { actor: actor('advisor', shopId), ticketId: TICKET })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.copy.documentKind).toBe('estimate')
    expect(result.copy.jobs).toHaveLength(2)
    expect(result.copy.totals).toMatchObject({ subtotalCents: 25_000, taxCents: 1_600, totalCents: 26_600 })
  })

  it('selects Paid receipt only after the exact balance is zero and the repair order is closed', async () => {
    await db.insert(ticketPayments).values({
      id: uuid(80), shopId, ticketId: TICKET, amountCents: 10_800, method: 'card',
      note: 'PRIVATE-PAYMENT-NOTE-SENTINEL', recordedByProfileId: uuid(2), requestKey: uuid(81),
      recordedAt: new Date('2026-08-01T14:00:00Z'),
    })
    await db.update(tickets).set({
      status: 'closed', closedAt: new Date('2026-08-01T14:05:00Z'), closedByProfileId: uuid(2),
    }).where(eq(tickets.id, TICKET))

    const result = await getCustomerCopy(db, { actor: actor('owner', shopId), ticketId: TICKET })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.copy.documentKind).toBe('paid_receipt')
    expect(result.copy.totals.balanceCents).toBe(0)
    expect(result.copy.totals.payments).toEqual([{ amountCents: 10_800, method: 'card', recordedAt: '2026-08-01T14:00:00.000Z' }])
    expect(JSON.stringify(result.copy)).not.toContain('PRIVATE-PAYMENT-NOTE-SENTINEL')
    expect(result.copy.closedAt).toBe('2026-08-01T14:05:00.000Z')
  })

  it.each(['tech', 'parts'] as const)('refuses a %s before projecting any customer or money data', async (role) => {
    expect(await getCustomerCopy(db, { actor: actor(role, shopId), ticketId: TICKET }))
      .toEqual({ ok: false, error: 'forbidden' })
  })

  it('tenant-scopes every read', async () => {
    expect(await getCustomerCopy(db, { actor: actor('owner', otherShopId), ticketId: TICKET }))
      .toEqual({ ok: false, error: 'not_found' })
  })

  it('blocks printing when shop identity is incomplete', async () => {
    await db.update(shops).set({ phone: null }).where(eq(shops.id, shopId))
    const result = await getCustomerCopy(db, { actor: actor('owner', shopId), ticketId: TICKET })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.copy.readyToPrint).toBe(false)
    expect(result.copy.blockers).toContain('shop_phone')
  })

  it('fails closed when prepared or pinned pricing is corrupt', async () => {
    const corruptVersion = uuid(52)
    await db.insert(quoteVersions).values({
      id: corruptVersion, shopId, ticketId: TICKET, versionNumber: 3,
      snapshot: { schemaVersion: 99 }, createdByProfileId: uuid(2),
      supersededAt: new Date('2026-08-01T12:30:00Z'),
    })
    await db.update(ticketJobs).set({ approvedQuoteVersionId: corruptVersion })
      .where(eq(ticketJobs.id, APPROVED_JOB))
    const result = await getCustomerCopy(db, { actor: actor('owner', shopId), ticketId: TICKET })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.copy.readyToPrint).toBe(false)
    expect(result.copy.blockers).toContain('pricing_unavailable')
    expect(result.copy.jobs).toEqual([])
  })

  it('returns an allowlisted object with no staff-only keys, sentinels, raw IDs, or raw JSON', async () => {
    const result = await getCustomerCopy(db, { actor: actor('owner', shopId), ticketId: TICKET })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const serialized = JSON.stringify(result.copy)

    expect(serialized).not.toMatch(/unitCost|coreCharge|markup|fitment|diagnostic|workNotes|assigned|activity|profileId|snapshot|customerStory|storyMeta|raw/i)
    expect(serialized).not.toMatch(/00000000-0000-4000-8000-/)
    expect(serialized).not.toContain('SENTINEL')
    expect(result.copy).toMatchObject({
      shop: {
        name: 'Honest Auto', phone: '(214) 555-0197',
        address: ['415 Industrial Way', 'Suite 2', 'Garland, TX 75040'],
      },
      customer: { name: 'Ada Driver' },
      vehicle: { year: 2020, make: 'Ford', model: 'F-150', vin: '1FTFW1E50LFA00001', odometer: 91_240 },
      ticketNumber: 1042,
    })
  })
})
