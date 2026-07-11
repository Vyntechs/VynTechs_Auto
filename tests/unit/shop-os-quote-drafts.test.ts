import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createDraftLine,
  deleteDraftLine,
  replaceDraftLine,
  type QuoteActor,
} from '@/lib/shop-os/quotes'
import {
  jobLines,
  profiles,
  quoteVersions,
  shops,
  ticketJobs,
  tickets,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS quote draft mutations', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let ticketId: string
  let jobId: string
  let excludedJobId: string
  let otherTicketId: string
  let otherJobId: string
  let actor: QuoteActor

  const partBody = (overrides: Record<string, unknown> = {}) => ({
    kind: 'part',
    description: 'Front brake pads',
    quantity: '1',
    priceCents: 12_500,
    taxable: true,
    partNumber: 'PAD-1',
    brand: 'ACME',
    unitCostCents: 7_000,
    coreChargeCents: 0,
    fitment: 'Front axle',
    ...overrides,
  })

  const create = (clientKey = uuid(100), body: unknown = partBody(), overrides = {}) =>
    createDraftLine(db, { actor, ticketId, jobId, clientKey, body, ...overrides })

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North Shop', laborRateCents: 15_000, taxRateBps: 825 },
      { name: 'South Shop', laborRateCents: 20_000, taxRateBps: 700 },
    ]).returning()
    shopId = shop.id
    otherShopId = otherShop.id
    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(11), shopId, role: 'tech' },
      { id: uuid(2), userId: uuid(12), shopId: otherShopId, role: 'owner' },
      { id: uuid(3), userId: uuid(13), shopId, role: 'founder' },
    ])
    actor = { profileId: uuid(1) }
    await db.insert(tickets).values({
      id: uuid(20), shopId, ticketNumber: 1, source: 'tech_quick',
      customerId: null, vehicleId: null, concern: 'Brake noise', createdByProfileId: uuid(1),
    })
    ticketId = uuid(20)
    await db.insert(tickets).values({
      id: uuid(21), shopId: otherShopId, ticketNumber: 1, source: 'tech_quick',
      customerId: null, vehicleId: null, concern: 'Other concern', createdByProfileId: uuid(2),
    })
    otherTicketId = uuid(21)
    await db.insert(ticketJobs).values([
      { id: uuid(30), shopId, ticketId, title: 'Front brakes', kind: 'repair', requiredSkillTier: 1 },
      { id: uuid(31), shopId, ticketId, title: 'Rear brakes', kind: 'repair', requiredSkillTier: 1 },
    ])
    jobId = uuid(30)
    excludedJobId = uuid(31)
    await db.insert(ticketJobs).values({
      id: uuid(32), shopId: otherShopId, ticketId: otherTicketId,
      title: 'Other work', kind: 'repair', requiredSkillTier: 1,
    })
    otherJobId = uuid(32)
  })

  afterEach(async () => close())

  it('captures the ticket-first stable NOWAIT lock contract', () => {
    const source = readFileSync(join(process.cwd(), 'lib/shop-os/quotes.ts'), 'utf8')
    const helper = source.slice(source.indexOf('async function lockDraftContext'), source.indexOf('async function invalidateActiveVersion'))
    expect(helper).toMatch(/\.from\(tickets\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(ticketJobs\)[\s\S]*?orderBy\(ticketJobs\.id\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(jobLines\)[\s\S]*?orderBy\(jobLines\.id\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(quoteVersions\)[\s\S]*?orderBy\(quoteVersions\.id\)[\s\S]*?\.for\('update', \{ noWait: true \}\)/)
  })

  it('allows an active tech to create a manual part on an open provisional ticket', async () => {
    const result = await create()
    expect(result).toMatchObject({ ok: true, changed: true, line: { kind: 'part' } })
    if (!result.ok || !result.line) throw new Error('missing safe draft projection')
    expect(result.line.id).not.toBe(uuid(100))
    expect(result.line.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(result.line).not.toHaveProperty('shopId')
    expect(result.line).not.toHaveProperty('jobId')
    expect(result.line).not.toHaveProperty('unitCostCents')
    expect(result.line).not.toHaveProperty('source')
    expect(result.line).not.toHaveProperty('partStatus')
    expect(result.line).not.toHaveProperty('vendorAccountId')
    expect(result.line).not.toHaveProperty('vendorSnapshot')
    expect(result.line).not.toHaveProperty('orderedAt')
  })

  it('never returns internal cost or vendor lifecycle fields from create or replace', async () => {
    const created = await create(uuid(109))
    if (!created.ok || !created.line) throw new Error('missing created line')
    const replaced = await replaceDraftLine(db, {
      actor, ticketId, jobId, lineId: created.line.id,
      body: partBody({ description: 'Updated pads', unitCostCents: 8_000 }),
    })
    for (const result of [created, replaced]) {
      const serialized = JSON.stringify(result)
      expect(serialized).not.toContain('unitCostCents')
      expect(serialized).not.toContain('vendorAccountId')
      expect(serialized).not.toContain('externalOfferId')
      expect(serialized).not.toContain('vendorSnapshot')
      expect(serialized).not.toContain('partStatus')
      expect(serialized).not.toContain('orderedAt')
      expect(serialized).not.toContain('receivedAt')
    }
  })

  it('reauthorizes the persisted actor and hides role, tenant, ticket, and job boundaries', async () => {
    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null }).where(eq(profiles.id, uuid(1)))
    await expect(create()).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ membershipStatus: 'active', membershipActivatedAt: new Date(), deactivatedAt: new Date() }).where(eq(profiles.id, uuid(1)))
    await expect(create()).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(create(uuid(101), partBody(), { actor: { profileId: uuid(3) } })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(create(uuid(102), partBody(), { actor: { profileId: uuid(2) } })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(create(uuid(103), partBody(), { ticketId: uuid(999) })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(create(uuid(104), partBody(), { jobId: uuid(999) })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('rejects closed tickets and canceled or done jobs while allowing provisional work', async () => {
    await db.update(ticketJobs).set({ workStatus: 'done' }).where(eq(ticketJobs.id, jobId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(ticketJobs).set({ workStatus: 'canceled' }).where(eq(ticketJobs.id, jobId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(ticketJobs).set({ workStatus: 'open' }).where(eq(ticketJobs.id, jobId))
    await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticketId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('accepts strict discriminated manual-only line inputs and rejects lifecycle or projection smuggling', async () => {
    await expect(create(uuid(101), { ...partBody(), laborHours: '1' })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(create(uuid(102), { ...partBody(), source: 'vendor_offer' })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(create(uuid(103), { ...partBody(), partStatus: 'ordered' })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(create(uuid(104), { ...partBody(), approvedQuoteVersionId: uuid(900) })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(create(uuid(105), { kind: 'labor', description: 'Install pads', laborHours: '1.25', taxable: false })).resolves.toMatchObject({ ok: true, line: { priceCents: 18_750, laborRateCents: 15_000, quantity: 1 } })
    await expect(create(uuid(106), { kind: 'labor', description: 'Install pads', quantity: '2', laborHours: '1.25', taxable: false })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(create(uuid(107), { kind: 'fee', description: 'Shop supplies', priceCents: 500, taxable: true })).resolves.toMatchObject({ ok: true, line: { quantity: 1, priceCents: 500 } })
    await expect(create(uuid(108), { kind: 'fee', description: 'Shop supplies', quantity: '2', priceCents: 500, taxable: true })).resolves.toEqual({ ok: false, error: 'invalid_input' })
  })

  it('returns an exact client-ID retry and pins omitted labor pricing across a shop-rate change', async () => {
    const body = { kind: 'labor', description: 'Install pads', laborHours: '1.25', taxable: false }
    const first = await create(uuid(110), body)
    await db.update(shops).set({ laborRateCents: 30_000 }).where(eq(shops.id, shopId))
    const retry = await create(uuid(110), body)
    expect(first).toMatchObject({ ok: true, changed: true, line: { priceCents: 18_750, laborRateCents: 15_000 } })
    expect(retry).toMatchObject({ ok: true, changed: false, line: { priceCents: 18_750, laborRateCents: 15_000 } })
  })

  it('canonicalizes UUID case for client-key retries', async () => {
    const key = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    const first = await create(key)
    const retry = await create(key.toUpperCase())
    expect(first).toMatchObject({ ok: true, changed: true })
    expect(retry).toMatchObject({ ok: true, changed: false })
    if (!first.ok || !first.line || !retry.ok || !retry.line) throw new Error('missing line')
    expect(retry.line.id).toBe(first.line.id)
  })

  it('canonicalizes uppercase actor, ticket, job, client, and line IDs across create, replace, invalidation, and delete', async () => {
    const profileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
    const upperTicketId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
    const upperJobId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3'
    const clientKey = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4'
    await db.insert(profiles).values({ id: profileId, userId: uuid(19), shopId, role: 'tech' })
    await db.insert(tickets).values({
      id: upperTicketId, shopId, ticketNumber: 2, source: 'tech_quick', customerId: null,
      vehicleId: null, concern: 'Uppercase seam', createdByProfileId: profileId,
    })
    await db.insert(ticketJobs).values({
      id: upperJobId, shopId, ticketId: upperTicketId,
      title: 'Uppercase work', kind: 'repair', requiredSkillTier: 1,
    })
    const upper = (value: string) => value.toUpperCase()
    const created = await createDraftLine(db, {
      actor: { profileId: upper(profileId) }, ticketId: upper(upperTicketId),
      jobId: upper(upperJobId), clientKey: upper(clientKey), body: partBody(),
    })
    expect(created).toMatchObject({ ok: true, changed: true })
    if (!created.ok || !created.line) throw new Error('missing uppercase-created line')
    const [version] = await db.insert(quoteVersions).values({
      shopId, ticketId: upperTicketId, versionNumber: 1,
      snapshot: snapshotForTicket(upperTicketId, [upperJobId]), createdByProfileId: profileId,
    }).returning()
    const replaced = await replaceDraftLine(db, {
      actor: { profileId: upper(profileId) }, ticketId: upper(upperTicketId),
      jobId: upper(upperJobId), lineId: upper(created.line.id),
      body: partBody({ description: 'Updated uppercase work' }),
    })
    expect(replaced).toMatchObject({ ok: true, changed: true, line: { description: 'Updated uppercase work' } })
    const [invalidated] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, version.id))
    expect(invalidated.supersededAt).not.toBeNull()
    await expect(deleteDraftLine(db, {
      actor: { profileId: upper(profileId) }, ticketId: upper(upperTicketId),
      jobId: upper(upperJobId), lineId: upper(created.line.id),
    })).resolves.toEqual({ ok: true, changed: true })
  })

  it('enforces the PostgreSQL numeric bounds before persistence', async () => {
    await expect(create(uuid(111), partBody({ quantity: '999999999.999' }))).resolves.toMatchObject({ ok: true })
    await expect(create(uuid(112), partBody({ quantity: '1000000000' }))).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(create(uuid(113), partBody({ quantity: '1'.repeat(33) }))).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(create(uuid(114), { kind: 'labor', description: 'Long labor', laborHours: '999999.99', taxable: false })).resolves.toMatchObject({ ok: true })
    await expect(create(uuid(115), { kind: 'labor', description: 'Too long', laborHours: '1000000', taxable: false })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(create(uuid(116), { kind: 'labor', description: 'Absurd', laborHours: '1'.repeat(33), taxable: false })).resolves.toEqual({ ok: false, error: 'invalid_input' })
  })

  it('conflicts on changed or cross-context client-ID reuse without leaking the collision', async () => {
    await create(uuid(120))
    await expect(create(uuid(120), partBody({ description: 'Changed' }))).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await expect(create(uuid(120), partBody(), { jobId: excludedJobId })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await expect(create(uuid(120), partBody(), { actor: { profileId: uuid(2) }, ticketId: uuid(999), jobId: uuid(999) })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('derives persisted IDs per tenant so a different shop actual ID cannot be a global collision oracle', async () => {
    const other = await createDraftLine(db, {
      actor: { profileId: uuid(2) }, ticketId: otherTicketId, jobId: otherJobId,
      clientKey: uuid(121), body: partBody(),
    })
    if (!other.ok || !other.line) throw new Error('missing other-shop line')
    const local = await create(other.line.id)
    expect(local).toMatchObject({ ok: true, changed: true })
    if (!local.ok || !local.line) throw new Error('missing local line')
    expect(local.line.id).not.toBe(other.line.id)
  })

  it('does not invalidate a later version for an exact current-state replace no-op', async () => {
    const created = await create(uuid(130))
    if (!created.ok || !created.line) throw new Error('missing created line')
    const [version] = await db.insert(quoteVersions).values({
      shopId, ticketId, versionNumber: 1, snapshot: snapshot([jobId]), createdByProfileId: uuid(1),
    }).returning()
    await expect(replaceDraftLine(db, { actor, ticketId, jobId, lineId: created.line.id, body: partBody() })).resolves.toMatchObject({ ok: true, changed: false })
    const [stored] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, version.id))
    expect(stored.supersededAt).toBeNull()
  })

  it('makes delete idempotent only under an authorized existing ticket and job', async () => {
    await expect(deleteDraftLine(db, { actor, ticketId, jobId, lineId: uuid(140) })).resolves.toEqual({ ok: true, changed: false })
    const created = await create(uuid(140))
    if (!created.ok || !created.line) throw new Error('missing created line')
    await expect(deleteDraftLine(db, { actor, ticketId, jobId, lineId: created.line.id })).resolves.toEqual({ ok: true, changed: true })
    await expect(deleteDraftLine(db, { actor, ticketId, jobId, lineId: created.line.id })).resolves.toEqual({ ok: true, changed: false })
    await expect(deleteDraftLine(db, { actor, ticketId: uuid(999), jobId, lineId: created.line.id })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('cannot replace or delete non-manual provider lifecycle rows', async () => {
    await db.insert(jobLines).values({
      id: uuid(145), shopId, jobId, kind: 'part', description: 'Provider part', quantity: 1,
      priceCents: 10_000, taxable: true, source: 'vendor_offer', vendorAccountId: uuid(500),
      externalOfferId: 'offer-1', vendorSnapshot: { provider: 'catalog' }, partStatus: 'needs_order',
    })
    await expect(replaceDraftLine(db, { actor, ticketId, jobId, lineId: uuid(145), body: partBody() })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(deleteDraftLine(db, { actor, ticketId, jobId, lineId: uuid(145) })).resolves.toEqual({ ok: false, error: 'not_found' })
    const [stored] = await db.select().from(jobLines).where(eq(jobLines.id, uuid(145)))
    expect(stored).toMatchObject({ source: 'vendor_offer', partStatus: 'needs_order', externalOfferId: 'offer-1' })
  })

  it('conflicts without returning a row when hidden lifecycle metadata appears before an exact create retry', async () => {
    const created = await create(uuid(146))
    if (!created.ok || !created.line) throw new Error('missing created line')
    await db.update(jobLines).set({
      vendorAccountId: uuid(501), vendorSnapshot: { hidden: true },
    }).where(eq(jobLines.id, created.line.id))
    const retry = await create(uuid(146))
    expect(retry).toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(retry).not.toHaveProperty('line')
  })

  it('invalidates the sole active version and resets every included job but leaves excluded jobs unchanged', async () => {
    await db.update(ticketJobs).set({ approvalState: 'approved' }).where(eq(ticketJobs.id, jobId))
    await db.update(ticketJobs).set({ approvalState: 'quote_ready' }).where(eq(ticketJobs.id, excludedJobId))
    const [version] = await db.insert(quoteVersions).values({ shopId, ticketId, versionNumber: 1, snapshot: snapshot([jobId]), createdByProfileId: uuid(1) }).returning()
    await db.update(ticketJobs).set({ approvedQuoteVersionId: version.id }).where(eq(ticketJobs.id, jobId))
    await expect(create(uuid(150))).resolves.toMatchObject({ ok: true, changed: true })
    const jobs = await db.select().from(ticketJobs)
    expect(jobs.find((job) => job.id === jobId)).toMatchObject({ approvalState: 'pending_quote', approvedQuoteVersionId: null })
    expect(jobs.find((job) => job.id === excludedJobId)).toMatchObject({ approvalState: 'quote_ready' })
    const [stored] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, version.id))
    expect(stored.supersededAt).not.toBeNull()
  })

  it('fails closed on malformed or duplicate active snapshots and rolls back the line mutation', async () => {
    await db.insert(quoteVersions).values({ shopId, ticketId, versionNumber: 1, snapshot: { broken: true }, createdByProfileId: uuid(1) })
    await expect(create(uuid(160))).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(jobLines)).toHaveLength(0)
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.ticketId, ticketId))
    await db.insert(quoteVersions).values([
      { shopId, ticketId, versionNumber: 2, snapshot: snapshot([jobId]), createdByProfileId: uuid(1) },
      { shopId, ticketId, versionNumber: 3, snapshot: snapshot([jobId]), createdByProfileId: uuid(1) },
    ])
    await expect(create(uuid(161))).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(jobLines)).toHaveLength(0)
  })

  it.each([
    ['incomplete', () => ({ ...snapshot([jobId]), totals: undefined })],
    ['empty', () => snapshot([])],
    ['wrong-ticket', () => ({ ...snapshot([jobId]), ticket: { ...snapshot([jobId]).ticket, id: uuid(998) } })],
  ])('rolls back when the active snapshot is %s', async (_label, makeSnapshot) => {
    await db.insert(quoteVersions).values({
      shopId, ticketId, versionNumber: 1,
      snapshot: makeSnapshot() as Record<string, unknown>, createdByProfileId: uuid(1),
    })
    await expect(create(uuid(163))).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(jobLines)).toHaveLength(0)
    const [version] = await db.select().from(quoteVersions)
    expect(version.supersededAt).toBeNull()
  })

  it('fails closed when the active snapshot names a job outside the locked ticket', async () => {
    await db.insert(quoteVersions).values({
      shopId, ticketId, versionNumber: 1, snapshot: snapshot([uuid(999)]), createdByProfileId: uuid(1),
    })
    await expect(create(uuid(162))).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(jobLines)).toHaveLength(0)
  })

  it('classifies a deterministic 55P03 inside the transaction as retryable and rolls back', async () => {
    const [version] = await db.insert(quoteVersions).values({
      shopId, ticketId, versionNumber: 1, snapshot: snapshot([jobId]), createdByProfileId: uuid(1),
    }).returning()
    const result = await createDraftLine(
      db,
      { actor, ticketId, jobId, clientKey: uuid(164), body: partBody() },
      { beforeMutation: async () => { throw Object.assign(new Error('held row'), { code: '55P03' }) } },
    )
    expect(result).toEqual({ ok: false, error: 'conflict', retryable: true })
    expect(await db.select().from(jobLines)).toHaveLength(0)
    const [stored] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, version.id))
    expect(stored.supersededAt).toBeNull()
  })

  function snapshot(includedJobIds: string[]) {
    return snapshotForTicket(ticketId, includedJobIds)
  }

  function snapshotForTicket(snapshotTicketId: string, includedJobIds: string[]) {
    return {
      schemaVersion: 1,
      ticket: { id: snapshotTicketId, number: 1, customerId: uuid(300), vehicleId: uuid(301), laborRateCents: 15_000, taxRateBps: 825 },
      jobs: includedJobIds.map((id) => ({ id, title: 'Job', kind: 'repair', customerStory: null, storyMeta: null, lines: [], attachments: [], totals: { subtotalCents: 0, taxableSubtotalCents: 0 } })),
      totals: { subtotalCents: 0, taxableSubtotalCents: 0, taxCents: 0, totalCents: 0 },
    }
  }
})
