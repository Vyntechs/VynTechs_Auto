import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getQuoteBuilder, type QuoteActor } from '@/lib/shop-os/quotes'
import { jobLines, profiles, quoteVersions, shops, ticketJobs, tickets } from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS quote builder read model', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let ticketId: string
  let actor: QuoteActor

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North', laborRateCents: 15_000, taxRateBps: 825 },
      { name: 'South', laborRateCents: 20_000, taxRateBps: 700 },
    ]).returning()
    shopId = shop.id
    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(101), shopId, role: 'tech' },
      { id: uuid(2), userId: uuid(102), shopId: otherShop.id, role: 'owner' },
      { id: uuid(3), userId: uuid(103), shopId, role: 'founder' },
    ])
    actor = { profileId: uuid(1) }
    ticketId = uuid(20)
    await db.insert(tickets).values([
      { id: ticketId, shopId, ticketNumber: 7, source: 'tech_quick', customerId: null,
        vehicleId: null, concern: 'Brake noise', createdByProfileId: uuid(1) },
      { id: uuid(21), shopId: otherShop.id, ticketNumber: 1, source: 'tech_quick',
        customerId: null, vehicleId: null, concern: 'Other', createdByProfileId: uuid(2) },
    ])
    await db.insert(ticketJobs).values([
      { id: uuid(30), shopId, ticketId, title: 'Front brakes', kind: 'repair', requiredSkillTier: 1 },
      { id: uuid(31), shopId, ticketId, title: 'Canceled', kind: 'maintenance', requiredSkillTier: 1,
        workStatus: 'canceled' },
    ])
    await db.insert(jobLines).values([
      { id: uuid(40), shopId, jobId: uuid(30), kind: 'part', description: 'Pads', quantity: 2,
        priceCents: 12_500, taxable: true, partNumber: 'PAD', brand: 'ACME', unitCostCents: 7_000,
        coreChargeCents: 100, fitment: 'Front', source: 'manual' },
      { id: uuid(41), shopId, jobId: uuid(30), kind: 'part', description: 'Vendor pads', quantity: 2,
        priceCents: 14_000, taxable: true, source: 'vendor_offer', vendorAccountId: uuid(90),
        externalOfferId: 'secret-offer', vendorSnapshot: { token: 'secret' } },
    ])
  })

  afterEach(async () => close())

  it('reauthorizes the persisted actor inside the read transaction', () => {
    const source = readFileSync(join(process.cwd(), 'lib/shop-os/quotes.ts'), 'utf8')
    const handler = source.slice(
      source.indexOf('export async function getQuoteBuilder'),
      source.indexOf('function isLockUnavailable'),
    )
    expect(handler).toMatch(/db\.transaction[\s\S]*loadActiveActor\(transactionDb/)
    expect(handler).toMatch(/\.from\(tickets\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(ticketJobs\)[\s\S]*?\.from\(jobLines\)[\s\S]*?\.from\(quoteVersions\)/)
  })

  it('classifies ticket-lock contention as retryable without masking unexpected errors', async () => {
    const lockError = Object.assign(new Error('held ticket'), { code: '55P03' })
    await expect(getQuoteBuilder(db, { actor, ticketId }, {
      afterTicketLock: async () => { throw lockError },
    })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })

    await expect(getQuoteBuilder(db, { actor, ticketId }, {
      afterTicketLock: async () => { throw new TypeError('programmer error') },
    })).rejects.toThrow('programmer error')
  })

  it('returns only row-18-safe configuration, eligible jobs, and manual line fields', async () => {
    const result = await getQuoteBuilder(db, { actor, ticketId })
    expect(result).toEqual({
      ok: true,
      builder: {
        ticket: { id: ticketId, status: 'open', reconciled: false },
        configuration: {
          laborRateCents: 15_000, taxRateBps: 825,
          laborRateConfigured: true, taxRateConfigured: true,
        },
        jobs: [{
          id: uuid(30), title: 'Front brakes', kind: 'repair', workStatus: 'open',
          lines: [{
            id: uuid(40), kind: 'part', description: 'Pads', sort: 0, quantity: '2',
            priceCents: 12_500, taxable: true, partNumber: 'PAD', brand: 'ACME',
            coreChargeCents: 100, fitment: 'Front', laborHours: null, laborRateCents: null,
          }],
        }],
        activeVersion: null,
      },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(shopId)
    expect(serialized).not.toContain('unitCost')
    expect(serialized).not.toContain('vendor')
    expect(serialized).not.toContain('approvalState')
    expect(serialized).not.toContain('customerId')
  })

  it('returns only the active version summary and fails closed on duplicate active versions', async () => {
    await db.insert(quoteVersions).values({
      id: uuid(50), shopId, ticketId, versionNumber: 3, snapshot: {}, createdByProfileId: uuid(1),
    })
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toMatchObject({
      ok: true, builder: { activeVersion: { id: uuid(50), versionNumber: 3 } },
    })
    await db.insert(quoteVersions).values({
      id: uuid(51), shopId, ticketId, versionNumber: 4, snapshot: {}, createdByProfileId: uuid(1),
    })
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({
      ok: false, error: 'conflict', retryable: false,
    })
  })

  it('exposes configured-null state without inventing rates', async () => {
    await db.update(shops).set({ laborRateCents: null, taxRateBps: null }).where(eq(shops.id, shopId))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toMatchObject({
      ok: true,
      builder: { configuration: {
        laborRateCents: null, taxRateBps: null,
        laborRateConfigured: false, taxRateConfigured: false,
      } },
    })
  })

  it('derives the tenant from a current persisted builder role and canonicalizes UUIDs', async () => {
    await expect(getQuoteBuilder(db, {
      actor: { profileId: uuid(1).toUpperCase() }, ticketId: ticketId.toUpperCase(),
    })).resolves.toMatchObject({ ok: true })
    await expect(getQuoteBuilder(db, { actor: { profileId: uuid(2) }, ticketId })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(getQuoteBuilder(db, { actor: { profileId: uuid(3) }, ticketId })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null }).where(eq(profiles.id, uuid(1)))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('uses privacy-safe not-found for malformed, missing, cross-shop, and non-open tickets', async () => {
    await expect(getQuoteBuilder(db, { actor, ticketId: 'bad' })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(getQuoteBuilder(db, { actor, ticketId: uuid(999) })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(getQuoteBuilder(db, { actor, ticketId: uuid(21) })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticketId))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({ ok: false, error: 'not_found' })
  })
})
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
