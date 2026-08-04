import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveTicketJobAsCannedJob, type CannedJobActor } from '@/lib/shop-os/canned-jobs'
import { createQuoteVersion, getQuoteBuilder } from '@/lib/shop-os/quotes'
import {
  cannedJobs, customers, jobLines, profiles, quoteVersions, shops, ticketJobs, tickets, vehicles,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) => `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const JOB_ID = uuid(30)

describe('Shop OS save a worked job as a canned job', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let ticketId: string
  let owner: CannedJobActor

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North', laborRateCents: 15_000, taxRateBps: 825 },
      { name: 'South', laborRateCents: 20_000, taxRateBps: 700 },
    ]).returning()
    shopId = shop.id
    otherShopId = otherShop.id
    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(101), shopId, role: 'owner' },
      { id: uuid(2), userId: uuid(102), shopId, role: 'tech' },
      { id: uuid(3), userId: uuid(103), shopId: otherShopId, role: 'owner' },
      { id: uuid(4), userId: uuid(104), shopId, role: 'founder' },
    ])
    await db.insert(customers).values({ id: uuid(10), shopId, name: 'Customer', phone: '5551234567' })
    await db.insert(vehicles).values({
      id: uuid(11), customerId: uuid(10), year: 2020, make: 'Ford', model: 'F-150',
    })
    ticketId = uuid(20)
    await db.insert(tickets).values({
      id: ticketId, shopId, ticketNumber: 7, source: 'counter', customerId: uuid(10),
      vehicleId: uuid(11), concern: 'Brake noise', createdByProfileId: uuid(1),
    })
    await db.insert(ticketJobs).values({
      id: JOB_ID, shopId, ticketId, title: 'Brake service', kind: 'repair', requiredSkillTier: 2,
    })
    await db.insert(jobLines).values([
      {
        id: uuid(31), shopId, jobId: JOB_ID, kind: 'part', description: 'Brake pads', sort: 10,
        quantity: 1, priceCents: 12_500, taxable: true, partNumber: 'PAD-1', brand: 'ACME',
        source: 'manual',
      },
      {
        id: uuid(32), shopId, jobId: JOB_ID, kind: 'labor', description: 'Install pads', sort: 20,
        priceCents: 18_750, taxable: false, laborHours: 1.25, laborRateCents: 15_000,
        source: 'manual',
      },
      {
        id: uuid(33), shopId, jobId: JOB_ID, kind: 'fee', description: 'Shop supplies', sort: 30,
        priceCents: 500, taxable: true, source: 'manual',
      },
    ])
    owner = { profileId: uuid(1) }
  })

  afterEach(async () => close())

  // Pins the job to the version the customer approved, the way a counter
  // approval does, so every test below reads the authorized money.
  const approve = async () => {
    const quoteActor = { profileId: uuid(2) }
    const builder = await getQuoteBuilder(db, { actor: quoteActor, ticketId })
    if (!builder.ok || !builder.builder.draftCommitment) throw new Error('quote commitment fixture failed')
    const version = await createQuoteVersion(db, {
      actor: quoteActor, ticketId,
      expectedDraftFingerprint: builder.builder.draftCommitment.fingerprint,
    })
    if (!version.ok) throw new Error('quote version fixture failed')
    await db.update(ticketJobs)
      .set({ approvalState: 'approved', approvedQuoteVersionId: version.version.id })
      .where(eq(ticketJobs.id, JOB_ID))
    return version.version.id
  }

  const save = (overrides: Record<string, unknown> = {}) =>
    saveTicketJobAsCannedJob(db, { actor: owner, jobId: JOB_ID, clientKey: uuid(50), ...overrides })

  const authorizedLines = [
    { kind: 'part', description: 'Brake pads', sort: 0, quantity: '1', priceCents: 12_500, taxable: true, partNumber: 'PAD-1', brand: 'ACME' },
    { kind: 'labor', description: 'Install pads', sort: 10, hours: '1.25', priceCents: 18_750, taxable: false, laborRateCents: 15_000 },
    { kind: 'fee', description: 'Shop supplies', sort: 20, priceCents: 500, taxable: true },
  ]

  it('carries the approved parts, hours and fees across exactly and titles it after the job', async () => {
    await approve()
    const result = await save()
    expect(result).toEqual({
      ok: true,
      changed: true,
      cannedJob: {
        id: expect.any(String),
        title: 'Brake service',
        kind: 'repair',
        defaultRequiredSkillTier: 2,
        sort: 0,
        lines: authorizedLines,
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        // Tax is the existing projection's, at the shop's current 8.25%.
        summary: {
          subtotalCents: 31_750,
          taxableSubtotalCents: 13_000,
          taxCents: 1_073,
          totalCents: 32_823,
        },
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/shopId|jobId|ticketId|unitCost|core|vendor|offer|approval|workStatus/)
    const [stored] = await db.select().from(cannedJobs)
    expect(stored).toMatchObject({ shopId, retiredAt: null, defaultLines: authorizedLines })
  })

  it('saves the price the customer approved, not the price the live lines drifted to', async () => {
    await approve()
    await db.update(jobLines).set({ priceCents: 99_900 }).where(eq(jobLines.id, uuid(31)))
    await db.update(jobLines).set({ laborHours: 4, priceCents: 60_000 }).where(eq(jobLines.id, uuid(32)))
    const result = await save()
    expect(result).toMatchObject({ ok: true, changed: true, cannedJob: { lines: authorizedLines } })
  })

  it('lets the caller name the template instead of inheriting the job title', async () => {
    await approve()
    await expect(save({ title: 'Front brake service' })).resolves.toMatchObject({
      ok: true, changed: true, cannedJob: { title: 'Front brake service', lines: authorizedLines },
    })
  })

  it('returns changed:false on a double tap instead of a duplicate template', async () => {
    await approve()
    const first = await save()
    if (!first.ok) throw new Error('first save failed')
    await expect(save()).resolves.toEqual({ ...first, changed: false })
    const [left, right] = await Promise.all([save({ clientKey: uuid(51) }), save({ clientKey: uuid(51) })])
    expect([left, right].filter((result) => result.ok && result.changed)).toHaveLength(1)
    expect([left, right].filter((result) => result.ok && !result.changed)).toHaveLength(1)
    await expect(save({ clientKey: uuid(52) })).resolves.toMatchObject({ ok: true, changed: true })
    expect(await db.select().from(cannedJobs)).toHaveLength(3)
  })

  it('refuses every actor who may not manage the library, and writes nothing', async () => {
    await approve()
    await expect(save({ actor: { profileId: uuid(2) } })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(save({ actor: { profileId: uuid(4) } })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null })
      .where(eq(profiles.id, uuid(1)))
    await expect(save()).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles)
      .set({ membershipStatus: 'active', membershipActivatedAt: new Date(), deactivatedAt: new Date() })
      .where(eq(profiles.id, uuid(1)))
    await expect(save()).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(cannedJobs)).toHaveLength(0)
    await db.update(profiles).set({ deactivatedAt: null }).where(eq(profiles.id, uuid(1)))
    await expect(save({ actor: { profileId: uuid(4), founderOverride: true } })).resolves.toMatchObject({ ok: true })
  })

  it('refuses a job on another tenant\'s ticket in both directions', async () => {
    await approve()
    await expect(save({ actor: { profileId: uuid(3) } })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.insert(customers).values({ id: uuid(12), shopId: otherShopId, name: 'Other', phone: '5559876543' })
    await db.insert(vehicles).values({
      id: uuid(13), customerId: uuid(12), year: 2019, make: 'Ram', model: '3500',
    })
    await db.insert(tickets).values({
      id: uuid(21), shopId: otherShopId, ticketNumber: 4, source: 'counter', customerId: uuid(12),
      vehicleId: uuid(13), concern: 'Trans temp', createdByProfileId: uuid(3),
    })
    await db.insert(ticketJobs).values({
      id: uuid(34), shopId: otherShopId, ticketId: uuid(21), title: 'Trans service',
      kind: 'repair', requiredSkillTier: 2, approvalState: 'approved',
    })
    await expect(save({ jobId: uuid(34) })).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(cannedJobs)).toHaveLength(0)
  })

  it('refuses a job with nothing the customer authorized, and never throws', async () => {
    await expect(save({ jobId: 'not-a-uuid' })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(save({ jobId: uuid(99) })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(save()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    const versionId = await approve()
    await db.update(ticketJobs).set({ approvalState: 'declined', approvedQuoteVersionId: null })
      .where(eq(ticketJobs.id, JOB_ID))
    await expect(save()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.insert(quoteVersions).values({
      id: uuid(84), shopId, ticketId, versionNumber: 9, snapshot: { bad: true },
      createdByProfileId: uuid(1),
    })
    await db.update(ticketJobs).set({ approvalState: 'approved', approvedQuoteVersionId: uuid(84) })
      .where(eq(ticketJobs.id, JOB_ID))
    await expect(save()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(cannedJobs)).toHaveLength(0)
  })

  it('refuses authorized lines that cannot form a valid canned body, and takes a title instead', async () => {
    await db.update(ticketJobs).set({ title: 'B'.repeat(201) }).where(eq(ticketJobs.id, JOB_ID))
    await approve()
    await expect(save()).resolves.toEqual({ ok: false, error: 'invalid_input' })
    expect(await db.select().from(cannedJobs)).toHaveLength(0)
    await expect(save({ title: 'Brake service' })).resolves.toMatchObject({
      ok: true, changed: true, cannedJob: { title: 'Brake service', lines: authorizedLines },
    })
  })
})
