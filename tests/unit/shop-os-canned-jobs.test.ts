import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  cannedJobActorFromProfile,
  cannedJobDomainStatus,
  cannedJobErrorBody,
  applyCannedJobToTicket,
  createCannedJob,
  listCannedJobs,
  publicCannedJob,
  replaceCannedJob,
  retireCannedJob,
  type CannedJobActor,
} from '@/lib/shop-os/canned-jobs'
import { cannedJobs, customers, profiles, shops, ticketJobs, tickets, vehicles } from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const lines = () => [
  {
    kind: 'part' as const,
    description: 'Oil filter',
    sort: 10,
    quantity: '1.000',
    priceCents: 1_250,
    taxable: true,
    partNumber: 'OF-1',
    brand: 'ACME',
  },
  {
    kind: 'labor' as const,
    description: 'Oil service labor',
    sort: 20,
    hours: '0.50',
    priceCents: 5_000,
    taxable: false,
    laborRateCents: 10_000,
  },
  {
    kind: 'fee' as const,
    description: 'Disposal',
    sort: 30,
    priceCents: 500,
    taxable: true,
  },
]

const body = (overrides: Record<string, unknown> = {}) => ({
  title: 'Oil service',
  kind: 'maintenance',
  defaultRequiredSkillTier: 1,
  sort: 10,
  lines: lines(),
  ...overrides,
})

describe('Shop OS canned jobs domain', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let actor: CannedJobActor

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North', taxRateBps: 825 },
      { name: 'South', taxRateBps: 700 },
    ]).returning()
    shopId = shop.id
    otherShopId = otherShop.id
    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(101), shopId, role: 'owner' },
      { id: uuid(2), userId: uuid(102), shopId, role: 'tech' },
      { id: uuid(3), userId: uuid(103), shopId: otherShopId, role: 'owner' },
      { id: uuid(4), userId: uuid(104), shopId, role: 'founder' },
      { id: uuid(5), userId: uuid(105), shopId, role: 'owner' },
    ])
    actor = cannedJobActorFromProfile({ id: uuid(1) })
  })

  afterEach(async () => close())

  it('lists active templates as strict safe projections with exact totals and current tax', async () => {
    const created = await createCannedJob(db, { actor, clientKey: uuid(50), body: body() })
    expect(created).toMatchObject({ ok: true, changed: true })

    const result = await listCannedJobs(db, { actor: { profileId: uuid(2) } })
    expect(result).toEqual({
      ok: true,
      taxRateBps: 825,
      cannedJobs: [{
        id: expect.any(String),
        title: 'Oil service',
        kind: 'maintenance',
        defaultRequiredSkillTier: 1,
        sort: 10,
        lines: [
          { kind: 'part', description: 'Oil filter', sort: 10, quantity: '1', priceCents: 1_250, taxable: true, partNumber: 'OF-1', brand: 'ACME' },
          { kind: 'labor', description: 'Oil service labor', sort: 20, hours: '0.5', priceCents: 5_000, taxable: false, laborRateCents: 10_000 },
          { kind: 'fee', description: 'Disposal', sort: 30, priceCents: 500, taxable: true },
        ],
        fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
        summary: { subtotalCents: 6_750, taxableSubtotalCents: 1_750, taxCents: 144, totalCents: 6_894 },
      }],
    })
    expect(JSON.stringify(result)).not.toMatch(/shopId|unitCost|core|vendor|offer|order|approval|workState/)
  })

  it('returns null tax with exact before-tax summary and no invented total', async () => {
    await db.update(shops).set({ taxRateBps: null }).where(eq(shops.id, shopId))
    await createCannedJob(db, { actor, clientKey: uuid(51), body: body() })
    const result = await listCannedJobs(db, { actor })
    expect(result).toMatchObject({
      ok: true,
      taxRateBps: null,
      cannedJobs: [{ summary: {
        subtotalCents: 6_750,
        taxableSubtotalCents: 1_750,
        taxCents: null,
        totalCents: null,
      } }],
    })
  })

  it('allows every active builder role to list but only an owner or trusted founder override to manage', async () => {
    await expect(listCannedJobs(db, { actor: { profileId: uuid(2) } })).resolves.toMatchObject({ ok: true })
    await expect(createCannedJob(db, { actor: { profileId: uuid(2) }, clientKey: uuid(52), body: body() })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(createCannedJob(db, { actor: { profileId: uuid(4), founderOverride: true }, clientKey: uuid(53), body: body({ title: 'Founder job' }) })).resolves.toMatchObject({ ok: true })
    await expect(createCannedJob(db, { actor: { profileId: uuid(4), founderOverride: false }, clientKey: uuid(54), body: body() })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('reauthorizes persisted membership and tenant for every operation', async () => {
    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null }).where(eq(profiles.id, uuid(1)))
    await expect(listCannedJobs(db, { actor })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(createCannedJob(db, { actor, clientKey: uuid(55), body: body() })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ membershipStatus: 'active', membershipActivatedAt: new Date(), deactivatedAt: new Date() }).where(eq(profiles.id, uuid(1)))
    await expect(listCannedJobs(db, { actor })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('validates strict bounded customer-safe line JSON and rejects internal or extra fields', async () => {
    const rejected = [
      body({ surprise: true }),
      body({ title: '' }),
      body({ defaultRequiredSkillTier: 4 }),
      body({ sort: 1_000_001 }),
      body({ lines: [] }),
      body({ lines: Array.from({ length: 26 }, () => lines()[2]) }),
      body({ lines: [{ ...lines()[0], unitCostCents: 1 }] }),
      body({ lines: [{ ...lines()[0], coreChargeCents: 1 }] }),
      body({ lines: [{ ...lines()[0], vendorAccountId: uuid(90) }] }),
      body({ lines: [{ ...lines()[0], quantity: '01.0' }] }),
      body({ lines: [{ ...lines()[1], hours: '0.500' }] }),
      body({ lines: [{ ...lines()[1], laborRateCents: -1 }] }),
      body({ lines: [{ ...lines()[2], priceCents: Number.MAX_SAFE_INTEGER + 1 }] }),
    ]
    for (const [index, invalidBody] of rejected.entries()) {
      await expect(createCannedJob(db, {
        actor, clientKey: uuid(100 + index), body: invalidBody,
      })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    }
    await expect(createCannedJob(db, {
      actor,
      clientKey: uuid(150),
      body: body({ lines: Array.from({ length: 25 }, (_, index) => ({
        kind: 'part', description: 'x'.repeat(500), sort: index,
        quantity: '1', priceCents: 1, taxable: true,
        partNumber: 'p'.repeat(200), brand: 'b'.repeat(200),
      })) }),
    })).resolves.toEqual({ ok: false, error: 'invalid_input' })
  })

  it('rejects aggregate money that cannot produce a safe exact total before writing', async () => {
    const priceCents = Math.ceil(Number.MAX_SAFE_INTEGER / 2)
    await expect(createCannedJob(db, {
      actor,
      clientKey: uuid(151),
      body: body({ lines: [
        { kind: 'fee', description: 'First', sort: 0, priceCents, taxable: true },
        { kind: 'fee', description: 'Second', sort: 1, priceCents, taxable: true },
      ] }),
    })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    expect(await db.select().from(cannedJobs)).toHaveLength(0)
  })

  it('makes create deterministic by client key with normalized exact retry and mismatch conflict', async () => {
    const key = 'AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE'
    const first = await createCannedJob(db, { actor, clientKey: key, body: body() })
    const retry = await createCannedJob(db, { actor, clientKey: key.toLowerCase(), body: body({ lines: lines() }) })
    const mismatch = await createCannedJob(db, { actor, clientKey: key, body: body({ title: 'Different' }) })
    expect(first).toMatchObject({ ok: true, changed: true })
    expect(retry).toMatchObject({ ok: true, changed: false, cannedJob: { id: first.ok ? first.cannedJob.id : '' } })
    expect(mismatch).toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('makes concurrent same-key owner creation one write and one exact retry', async () => {
    const clientKey = uuid(56)
    const [left, right] = await Promise.all([
      createCannedJob(db, { actor, clientKey, body: body() }),
      createCannedJob(db, { actor: { profileId: uuid(5) }, clientKey, body: body() }),
    ])
    expect([left, right].filter((result) => result.ok && result.changed)).toHaveLength(1)
    expect([left, right].filter((result) => result.ok && !result.changed)).toHaveLength(1)
    await expect(createCannedJob(db, {
      actor: { profileId: uuid(5) }, clientKey, body: body({ title: 'Different' }),
    })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(cannedJobs)).toHaveLength(1)
  })

  it('fingerprint-guards a full replacement and preserves identity', async () => {
    const created = await createCannedJob(db, { actor, clientKey: uuid(60), body: body() })
    if (!created.ok) throw new Error('create failed')
    await expect(replaceCannedJob(db, {
      actor, cannedJobId: created.cannedJob.id, expectedFingerprint: '0'.repeat(64),
      body: body({ title: 'Stale write' }),
    })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    const replaced = await replaceCannedJob(db, {
      actor, cannedJobId: created.cannedJob.id,
      expectedFingerprint: created.cannedJob.fingerprint,
      body: body({ title: 'Synthetic service', sort: 20 }),
    })
    expect(replaced).toMatchObject({ ok: true, changed: true, cannedJob: { id: created.cannedJob.id, title: 'Synthetic service', sort: 20 } })
    if (!replaced.ok) throw new Error('replace failed')
    expect(replaced.cannedJob.fingerprint).not.toBe(created.cannedJob.fingerprint)
  })

  it('retires idempotently without deleting the physical row and excludes it from lists', async () => {
    const created = await createCannedJob(db, { actor, clientKey: uuid(61), body: body() })
    if (!created.ok) throw new Error('create failed')
    const retired = await retireCannedJob(db, {
      actor, cannedJobId: created.cannedJob.id, expectedFingerprint: created.cannedJob.fingerprint,
    })
    expect(retired).toMatchObject({ ok: true, changed: true })
    await expect(retireCannedJob(db, {
      actor, cannedJobId: created.cannedJob.id, expectedFingerprint: created.cannedJob.fingerprint,
    })).resolves.toMatchObject({ ok: true, changed: false })
    const [stored] = await db.select().from(cannedJobs).where(eq(cannedJobs.id, created.cannedJob.id))
    expect(stored.retiredAt).toBeInstanceOf(Date)
    await expect(listCannedJobs(db, { actor })).resolves.toMatchObject({ ok: true, cannedJobs: [] })
  })

  it('preserves a canned-job replay at capacity and rejects a fresh add without exceeding 25 jobs', async () => {
    const customerId = uuid(301)
    const vehicleId = uuid(302)
    const ticketId = uuid(303)
    await db.insert(customers).values({ id: customerId, shopId, name: 'Capacity customer', phone: '5550303' })
    await db.insert(vehicles).values({ id: vehicleId, customerId, year: 2022, make: 'Ford', model: 'Maverick' })
    await db.insert(tickets).values({
      id: ticketId, shopId, ticketNumber: 1, source: 'counter', customerId, vehicleId,
      concern: 'Capacity regression', createdByProfileId: uuid(1),
    })
    await db.insert(ticketJobs).values(Array.from({ length: 24 }, (_, index) => ({
      id: uuid(320 + index), shopId, ticketId, title: `Existing ${index + 1}`,
      kind: 'repair' as const, requiredSkillTier: 1,
    })))
    const canned = await createCannedJob(db, { actor, clientKey: uuid(350), body: body() })
    if (!canned.ok) throw new Error('canned job creation failed')
    const input = {
      actor, ticketId, clientKey: uuid(351), cannedJobId: canned.cannedJob.id,
      expectedFingerprint: canned.cannedJob.fingerprint, expectedTaxRateBps: 825,
    }

    await expect(applyCannedJobToTicket(db, input)).resolves.toMatchObject({ ok: true, changed: true })
    await expect(applyCannedJobToTicket(db, input)).resolves.toMatchObject({ ok: true, changed: false })
    await expect(applyCannedJobToTicket(db, { ...input, clientKey: uuid(352) }))
      .resolves.toEqual({ ok: false, error: 'job_limit_reached', retryable: false })
    expect(await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId))).toHaveLength(25)
  })

  it('uses privacy-safe not found for malformed, missing, and cross-shop identities', async () => {
    const other = await createCannedJob(db, { actor: { profileId: uuid(3) }, clientKey: uuid(62), body: body() })
    if (!other.ok) throw new Error('other create failed')
    for (const cannedJobId of ['bad', uuid(999), other.cannedJob.id]) {
      await expect(replaceCannedJob(db, {
        actor, cannedJobId, expectedFingerprint: '0'.repeat(64), body: body(),
      })).resolves.toEqual({ ok: false, error: cannedJobId === 'bad' ? 'invalid_input' : 'not_found' })
      await expect(retireCannedJob(db, {
        actor, cannedJobId, expectedFingerprint: '0'.repeat(64),
      })).resolves.toEqual({ ok: false, error: cannedJobId === 'bad' ? 'invalid_input' : 'not_found' })
    }
  })

  it('fails closed when persisted JSON or row bounds are corrupt', async () => {
    const [row] = await db.insert(cannedJobs).values({
      shopId, title: 'Corrupt', kind: 'repair', defaultRequiredSkillTier: 1,
      defaultLines: [{ kind: 'part', description: 'Leak', sort: 0, quantity: 1,
        priceCents: 100, taxable: true, unitCostCents: 50 }],
    }).returning()
    await expect(listCannedJobs(db, { actor })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await expect(replaceCannedJob(db, {
      actor, cannedJobId: row.id, expectedFingerprint: '0'.repeat(64), body: body(),
    })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('public serializer and route mappings expose only the explicit contract', () => {
    const safe = {
      id: uuid(70), title: 'Safe', kind: 'repair' as const,
      defaultRequiredSkillTier: 2 as const, sort: 0, lines: [lines()[2]],
      fingerprint: 'a'.repeat(64),
      summary: { subtotalCents: 500, taxableSubtotalCents: 500, taxCents: 41, totalCents: 541 },
    }
    expect(publicCannedJob({ ...safe, shopId: shopId } as never)).toEqual(safe)
    expect(cannedJobDomainStatus({ ok: true, changed: true, cannedJob: safe }, 201)).toBe(201)
    expect(cannedJobDomainStatus({ ok: false, error: 'invalid_input' })).toBe(422)
    expect(cannedJobDomainStatus({ ok: false, error: 'not_found' })).toBe(404)
    expect(cannedJobDomainStatus({ ok: false, error: 'conflict', retryable: true })).toBe(409)
    expect(cannedJobErrorBody({ ok: false, error: 'conflict', retryable: true })).toEqual({ error: 'conflict', retryable: true })
    expect(cannedJobErrorBody({ ok: false, error: 'conflict', retryable: false })).toEqual({ error: 'conflict' })
  })
})
