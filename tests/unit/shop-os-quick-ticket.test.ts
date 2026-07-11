import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tickets')>()
  return { ...actual, createTicket: vi.fn(actual.createTicket) }
})

import { createQuickTicket } from '@/lib/intake/quick-ticket'
import {
  cannedJobs,
  customers,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  sessions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { createTicket, ticketDomainStatus, type TicketActor } from '@/lib/tickets'
import { createCannedJob, replaceCannedJob, retireCannedJob } from '@/lib/shop-os/canned-jobs'
import { calculateTicketTotals } from '@/lib/shop-os/quote-math'
import { getQuoteBuilder } from '@/lib/shop-os/quotes'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('createQuickTicket', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopA: typeof shops.$inferSelect
  let actor: TicketActor
  let existingCustomer: typeof customers.$inferSelect
  let existingVehicle: typeof vehicles.$inferSelect
  let crossShopVehicle: typeof vehicles.$inferSelect
  let cannedJob: Awaited<ReturnType<typeof createCannedJob>> & { ok: true }
  let crossShopCannedJob: Awaited<ReturnType<typeof createCannedJob>> & { ok: true }

  beforeEach(async () => {
    vi.mocked(createTicket).mockImplementation(
      (await vi.importActual<typeof import('@/lib/tickets')>('@/lib/tickets')).createTicket,
    )
    const created = await createTestDb()
    db = created.db
    close = created.close

    const [firstShop, secondShop] = await db
      .insert(shops)
      .values([
        { name: 'North Shop', taxRateBps: 825 },
        { name: 'South Shop', taxRateBps: 700 },
      ])
      .returning()
    shopA = firstShop

    const [profile] = await db
      .insert(profiles)
      .values({
        userId: uuid(1),
        shopId: firstShop.id,
        role: 'owner',
        skillTier: 3,
        fullName: 'Owen Owner',
      })
      .returning()
    const [crossShopProfile] = await db.insert(profiles).values({
      userId: uuid(3), shopId: secondShop.id, role: 'owner', skillTier: 3, fullName: 'South Owner',
    }).returning()
    actor = {
      profileId: profile.id,
      shopId: profile.shopId,
      role: profile.role,
      skillTier: profile.skillTier,
      membershipStatus: profile.membershipStatus,
      deactivatedAt: profile.deactivatedAt,
    }

    const [customerA, customerB] = await db
      .insert(customers)
      .values([
        { shopId: firstShop.id, name: 'Ada Driver', phone: '555-0101' },
        { shopId: secondShop.id, name: 'Cross Shop', phone: '555-0201' },
      ])
      .returning()
    existingCustomer = customerA
    ;[existingVehicle, crossShopVehicle] = await db
      .insert(vehicles)
      .values([
        {
          customerId: customerA.id,
          year: 2020,
          make: 'Honda',
          model: 'Civic',
          mileage: 42_000,
        },
        { customerId: customerB.id, year: 2021, make: 'Toyota', model: 'Camry' },
      ])
      .returning()

    const template = await createCannedJob(db, {
      actor: { profileId: profile.id },
      clientKey: uuid(700),
      body: {
        title: 'Brake service',
        kind: 'repair',
        defaultRequiredSkillTier: 2,
        sort: 10,
        lines: [
          { kind: 'part', description: 'Brake pads', sort: 10, quantity: '1.000', priceCents: 12_500, taxable: true, partNumber: 'PAD-1', brand: 'ACME' },
          { kind: 'labor', description: 'Install pads', sort: 20, hours: '1.25', priceCents: 18_750, taxable: false, laborRateCents: 15_000 },
          { kind: 'fee', description: 'Shop supplies', sort: 30, priceCents: 500, taxable: true },
        ],
      },
    })
    if (!template.ok) throw new Error('fixture template failed')
    cannedJob = template
    const crossTemplate = await createCannedJob(db, {
      actor: { profileId: crossShopProfile.id },
      clientKey: uuid(701),
      body: {
        title: 'South service', kind: 'repair', defaultRequiredSkillTier: 2, sort: 1,
        lines: [{ kind: 'fee', description: 'South fee', sort: 1, priceCents: 100, taxable: true }],
      },
    })
    if (!crossTemplate.ok) throw new Error('cross-shop fixture template failed')
    crossShopCannedJob = crossTemplate
  })

  afterEach(async () => {
    await close()
  })

  function newBody(overrides: Record<string, unknown> = {}) {
    return {
      vehicleMode: 'new',
      customer: {
        name: '  Maria Lopez  ',
        phone: '  555-1234  ',
        email: '  maria@example.com  ',
      },
      vehicle: {
        year: 2018,
        make: '  Ford  ',
        model: '  F-150  ',
        engine: '  3.5L EcoBoost  ',
        vin: '  1FTEW1EP5JFC10001  ',
        mileage: 84_000,
        plate: '  ABC123  ',
      },
      clientKey: uuid(800),
      quote: { mode: 'manual', kind: 'repair', description: '  Replace boost hose  ' },
      ...overrides,
    }
  }

  function existingBody(overrides: Record<string, unknown> = {}) {
    return {
      vehicleMode: 'existing',
      existingVehicleId: existingVehicle.id,
      clientKey: uuid(801),
      quote: { mode: 'manual', kind: 'maintenance', description: '  Rotate tires  ' },
      ...overrides,
    }
  }

  function cannedExistingBody(overrides: Record<string, unknown> = {}) {
    return existingBody({
      clientKey: uuid(802),
      quote: {
        mode: 'canned',
        cannedJobId: cannedJob.cannedJob.id,
        expectedFingerprint: cannedJob.cannedJob.fingerprint,
        expectedTaxRateBps: 825,
      },
      ...overrides,
    })
  }

  it('creates a new-customer quick ticket with one true-open repair job and no session', async () => {
    const result = await createQuickTicket(db, { actor, body: newBody() })

    expect(result).toMatchObject({
      ok: true,
      ticket: {
        source: 'quick_quote',
        concern: 'Replace boost hose',
        customer: {
          name: 'Maria Lopez',
          phone: '555-1234',
          email: 'maria@example.com',
        },
        vehicle: {
          year: 2018,
          make: 'Ford',
          model: 'F-150',
          engine: '3.5L EcoBoost',
          vin: '1FTEW1EP5JFC10001',
          mileage: 84_000,
          plate: 'ABC123',
        },
        jobs: [
          {
            title: 'Replace boost hose',
            kind: 'repair',
            requiredSkillTier: 2,
            assignedTechId: null,
            assignedTech: null,
            sessionId: null,
          },
        ],
      },
    })
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
    expect(await db.select().from(sessions)).toEqual([])
  })

  it('resolves a same-shop vehicle, updates supplied mileage, and creates one C-tier maintenance job', async () => {
    const result = await createQuickTicket(db, {
      actor,
      body: existingBody({ mileage: 43_210 }),
    })

    expect(result).toMatchObject({
      ok: true,
      ticket: {
        customer: { id: existingCustomer.id },
        vehicle: { id: existingVehicle.id, mileage: 43_210 },
        concern: 'Rotate tires',
        jobs: [
          {
            title: 'Rotate tires',
            kind: 'maintenance',
            requiredSkillTier: 1,
            assignedTechId: null,
            sessionId: null,
          },
        ],
      },
    })
    expect(await db.select().from(sessions)).toEqual([])
  })

  it.each(['tech', 'advisor', 'parts', 'owner'])('allows active %s actors to create', async (role) => {
    const result = await createQuickTicket(db, { actor: { ...actor, role }, body: existingBody() })
    expect(result.ok).toBe(true)
  })

  it.each([
    ['no shop', { shopId: null }, 'no_shop'],
    ['pending', { membershipStatus: 'pending' }, 'inactive_profile'],
    ['deactivated', { deactivatedAt: new Date('2026-07-10T12:00:00Z') }, 'inactive_profile'],
    ['unknown role', { role: 'curator' }, 'forbidden'],
  ] as const)('fails closed for a %s actor', async (_label, actorPatch, error) => {
    const result = await createQuickTicket(db, {
      actor: { ...actor, ...actorPatch },
      body: existingBody(),
    })
    expect(result).toEqual({ ok: false, error })
    expect(await db.select().from(tickets)).toEqual([])
  })

  it.each([
    ['cross-shop', () => existingBody({ existingVehicleId: crossShopVehicle.id })],
    [
      'missing',
      () =>
        existingBody({
          existingVehicleId: '00000000-0000-4000-8000-000000000999',
        }),
    ],
  ])('fails closed for a %s existing vehicle', async (_label, makeBody) => {
    const result = await createQuickTicket(db, { actor, body: makeBody() })
    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('strictly rejects malformed, mixed, and out-of-bounds bodies before writes', async () => {
    const vehicle = newBody().vehicle as Record<string, unknown>
    const invalidBodies = [
      null,
      newBody({ vehicleMode: 'other' }),
      { ...newBody(), existingVehicleId: existingVehicle.id },
      { ...existingBody(), customer: newBody().customer, vehicle },
      newBody({ quote: { mode: 'manual', kind: 'diagnostic', description: 'Inspect' } }),
      newBody({ quote: { mode: 'manual', kind: 'repair', description: ' ' } }),
      newBody({ quote: { mode: 'manual', kind: 'repair', description: 'x'.repeat(201) } }),
      newBody({ clientKey: 'bad' }),
      newBody({ quote: { mode: 'canned', cannedJobId: cannedJob.cannedJob.id, expectedFingerprint: 'bad', expectedTaxRateBps: 825 } }),
      existingBody({ mileage: -1 }),
      existingBody({ mileage: 2_147_483_648 }),
      newBody({ vehicle: { ...vehicle, mileage: 2_147_483_648 } }),
      { ...newBody(), assignedTechId: null },
    ]

    for (const body of invalidBodies) {
      await expect(createQuickTicket(db, { actor, body })).resolves.toEqual({
        ok: false,
        error: 'invalid_input',
      })
    }
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })

  it('does not change existing mileage when mileage is omitted', async () => {
    await createQuickTicket(db, { actor, body: existingBody() })
    const [persisted] = await db
      .select({ mileage: vehicles.mileage })
      .from(vehicles)
      .where(eq(vehicles.id, existingVehicle.id))
    expect(persisted.mileage).toBe(42_000)
  })

  it('rolls back new customer and vehicle rows when canonical ticket creation rejects', async () => {
    const beforeCustomers = await db.select().from(customers)
    const beforeVehicles = await db.select().from(vehicles)
    vi.mocked(createTicket).mockResolvedValueOnce({ ok: false, error: 'not_found' })

    const result = await createQuickTicket(db, { actor, body: newBody() })

    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(customers)).toEqual(beforeCustomers)
    expect(await db.select().from(vehicles)).toEqual(beforeVehicles)
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect(await db.select().from(sessions)).toEqual([])
  })

  it('rolls back an existing mileage update when canonical ticket creation rejects', async () => {
    vi.mocked(createTicket).mockResolvedValueOnce({ ok: false, error: 'not_found' })

    const result = await createQuickTicket(db, {
      actor,
      body: existingBody({ mileage: 99_999 }),
    })

    expect(result).toEqual({ ok: false, error: 'not_found' })
    const [persisted] = await db
      .select({ mileage: vehicles.mileage })
      .from(vehicles)
      .where(eq(vehicles.id, existingVehicle.id))
    expect(persisted.mileage).toBe(42_000)
  })

  it('copies an exact canned job into a new quick quote and exposes exact builder totals', async () => {
    const result = await createQuickTicket(db, { actor, body: cannedExistingBody() })
    expect(result).toMatchObject({
      ok: true,
      ticket: {
        source: 'quick_quote',
        concern: 'Brake service',
        jobs: [{ title: 'Brake service', kind: 'repair', requiredSkillTier: 2, assignedTechId: null, sessionId: null }],
      },
    })
    if (!result.ok) throw new Error('quick quote failed')
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, result.ticket.id))
    const lines = await db.select().from(jobLines).where(eq(jobLines.jobId, job.id)).orderBy(jobLines.sort)
    expect(lines.map((line) => ({
      kind: line.kind, description: line.description, sort: line.sort,
      quantity: Number(line.quantity), priceCents: line.priceCents, taxable: line.taxable,
      partNumber: line.partNumber, brand: line.brand,
      laborHours: line.laborHours === null ? null : Number(line.laborHours),
      laborRateCents: line.laborRateCents, source: line.source, partStatus: line.partStatus,
    }))).toEqual([
      { kind: 'part', description: 'Brake pads', sort: 10, quantity: 1, priceCents: 12_500, taxable: true, partNumber: 'PAD-1', brand: 'ACME', laborHours: null, laborRateCents: null, source: 'manual', partStatus: 'proposed' },
      { kind: 'labor', description: 'Install pads', sort: 20, quantity: 1, priceCents: 18_750, taxable: false, partNumber: null, brand: null, laborHours: 1.25, laborRateCents: 15_000, source: 'manual', partStatus: 'proposed' },
      { kind: 'fee', description: 'Shop supplies', sort: 30, quantity: 1, priceCents: 500, taxable: true, partNumber: null, brand: null, laborHours: null, laborRateCents: null, source: 'manual', partStatus: 'proposed' },
    ])
    for (const line of lines) {
      expect(line).toMatchObject({
        unitCostCents: null, coreChargeCents: null, fitment: null, vendorAccountId: null,
        externalOfferId: null, vendorSnapshot: null, orderedAt: null, orderedByProfileId: null,
        receivedAt: null, receivedByProfileId: null,
      })
    }
    const builder = await getQuoteBuilder(db, { actor, ticketId: result.ticket.id })
    expect(builder).toMatchObject({ ok: true, builder: { configuration: { taxRateBps: 825 } } })
    if (!builder.ok) throw new Error('builder failed')
    expect(calculateTicketTotals(
      builder.builder.jobs.flatMap((builderJob) => builderJob.lines.map((line) => ({
        extendedCents: line.priceCents,
        taxable: line.taxable,
      }))),
      builder.builder.configuration.taxRateBps ?? 0,
    )).toEqual({ subtotalCents: 31_750, taxableSubtotalCents: 13_000, taxCents: 1_073, totalCents: 32_823 })
  })

  it('copies the same exact canned truth for a newly resolved customer and vehicle', async () => {
    const cannedQuote = cannedExistingBody().quote
    const result = await createQuickTicket(db, {
      actor,
      body: newBody({ clientKey: uuid(805), quote: cannedQuote }),
    })
    expect(result).toMatchObject({
      ok: true,
      ticket: {
        customer: { name: 'Maria Lopez' },
        vehicle: { make: 'Ford', model: 'F-150', mileage: 84_000 },
        concern: 'Brake service',
        jobs: [{ title: 'Brake service', assignedTechId: null, sessionId: null }],
      },
    })
    if (!result.ok) throw new Error('quick quote failed')
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, result.ticket.id))
    const lines = await db.select().from(jobLines).where(eq(jobLines.jobId, job.id))
    expect(lines.map((line) => line.priceCents)).toEqual([12_500, 18_750, 500])
  })

  it('returns first success for the same key after template retirement and tax change', async () => {
    const body = cannedExistingBody()
    const first = await createQuickTicket(db, { actor, body })
    if (!first.ok) throw new Error('quick quote failed')
    const replaced = await replaceCannedJob(db, {
      actor: { profileId: actor.profileId }, cannedJobId: cannedJob.cannedJob.id,
      expectedFingerprint: cannedJob.cannedJob.fingerprint,
      body: { title: 'Changed', kind: 'repair', defaultRequiredSkillTier: 2, sort: 10, lines: [{ kind: 'fee', description: 'Changed', sort: 1, priceCents: 1, taxable: true }] },
    })
    if (!replaced.ok) throw new Error('replace failed')
    await retireCannedJob(db, { actor: { profileId: actor.profileId }, cannedJobId: replaced.cannedJob.id, expectedFingerprint: replaced.cannedJob.fingerprint })
    await db.update(shops).set({ taxRateBps: null }).where(eq(shops.id, shopA.id))
    const replay = await createQuickTicket(db, {
      actor,
      body: cannedExistingBody({ quote: { mode: 'canned', cannedJobId: cannedJob.cannedJob.id, expectedFingerprint: '0'.repeat(64), expectedTaxRateBps: null } }),
    })
    expect(replay).toEqual(first)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
    expect(await db.select().from(jobLines)).toHaveLength(3)
  })

  it('binds request identity to actor and rotates changed keys', async () => {
    const first = await createQuickTicket(db, { actor, body: existingBody() })
    const changed = await createQuickTicket(db, { actor, body: existingBody({ clientKey: uuid(803) }) })
    const [otherProfile] = await db.insert(profiles).values({
      userId: uuid(2), shopId: shopA.id, role: 'advisor', skillTier: 2, fullName: 'Avery Advisor',
    }).returning()
    const otherActor: TicketActor = {
      profileId: otherProfile.id, shopId: otherProfile.shopId, role: otherProfile.role,
      skillTier: otherProfile.skillTier, membershipStatus: otherProfile.membershipStatus,
      deactivatedAt: otherProfile.deactivatedAt,
    }
    const other = await createQuickTicket(db, { actor: otherActor, body: existingBody() })
    expect(first).toMatchObject({ ok: true })
    expect(changed).toMatchObject({ ok: true })
    expect(other).toMatchObject({ ok: true })
    expect(new Set([first, changed, other].filter((x) => x.ok).map((x) => x.ticket.id))).toHaveLength(3)
  })

  it('reauthorizes the persisted actor and hides deterministic collisions', async () => {
    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null }).where(eq(profiles.id, actor.profileId))
    await expect(createQuickTicket(db, { actor, body: existingBody() })).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('does not disclose or reuse a deterministic identity collision with incompatible persisted truth', async () => {
    const body = existingBody({ clientKey: uuid(806) })
    const first = await createQuickTicket(db, { actor, body })
    if (!first.ok) throw new Error('quick quote failed')
    await db.update(tickets).set({ source: 'counter' }).where(eq(tickets.id, first.ticket.id))
    await expect(createQuickTicket(db, { actor, body })).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(tickets)).toHaveLength(1)
  })

  it('rejects stale, cross-shop, retired, and corrupt canned state with no writes', async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ mode: 'canned', cannedJobId: cannedJob.cannedJob.id, expectedFingerprint: '0'.repeat(64), expectedTaxRateBps: 825 }, { ok: false, error: 'conflict', retryable: false }],
      [{ mode: 'canned', cannedJobId: cannedJob.cannedJob.id, expectedFingerprint: cannedJob.cannedJob.fingerprint, expectedTaxRateBps: null }, { ok: false, error: 'conflict', retryable: false }],
      [{ mode: 'canned', cannedJobId: uuid(999), expectedFingerprint: cannedJob.cannedJob.fingerprint, expectedTaxRateBps: 825 }, { ok: false, error: 'not_found' }],
      [{ mode: 'canned', cannedJobId: crossShopCannedJob.cannedJob.id, expectedFingerprint: crossShopCannedJob.cannedJob.fingerprint, expectedTaxRateBps: 825 }, { ok: false, error: 'not_found' }],
    ]
    for (const [quote, expected] of cases) {
      const result = await createQuickTicket(db, { actor, body: cannedExistingBody({ clientKey: crypto.randomUUID(), quote }) })
      expect(result).toEqual(expected)
      if (expected.error === 'conflict') expect(ticketDomainStatus(result, 201)).toBe(409)
    }
    await db.update(cannedJobs).set({ defaultLines: [{ bad: true }] as never }).where(eq(cannedJobs.id, cannedJob.cannedJob.id))
    await expect(createQuickTicket(db, { actor, body: cannedExistingBody({ clientKey: uuid(804) }) })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(jobLines)).toEqual([])
  })

  it.each([
    ['VIN', { vin: '1FTEW1EP5JFC10001', plate: 'OLD123' }, { vin: '1FTEW1EP5JFC10001', plate: 'NEW123' }],
    ['plate', { vin: null, plate: 'ABC123' }, { vin: null, plate: 'ABC123' }],
  ] as const)('updates submitted mileage when new-mode upsert reuses an existing %s vehicle', async (_label, persistedIdentity, submittedIdentity) => {
    await db.update(vehicles).set({
      year: 2018, make: 'Ford', model: 'F-150', mileage: 40_000,
      vin: persistedIdentity.vin, plate: persistedIdentity.plate,
    }).where(eq(vehicles.id, existingVehicle.id))
    const body = newBody({
      clientKey: crypto.randomUUID(),
      customer: { name: 'Ada Driver', phone: '555-0101', email: null },
      vehicle: {
        year: 2018, make: 'Ford', model: 'F-150', engine: null,
        vin: submittedIdentity.vin, plate: submittedIdentity.plate, mileage: 88_888,
      },
    })
    const result = await createQuickTicket(db, { actor, body })
    expect(result).toMatchObject({ ok: true, ticket: { vehicle: { id: existingVehicle.id, mileage: 88_888 } } })
    const [persisted] = await db.select().from(vehicles).where(eq(vehicles.id, existingVehicle.id))
    expect(persisted.mileage).toBe(88_888)
    expect(await db.select().from(vehicles).where(eq(vehicles.customerId, existingCustomer.id))).toHaveLength(1)
  })

  it('rolls back a matched new-mode vehicle mileage update when a later stage fails', async () => {
    await db.update(vehicles).set({
      year: 2018, make: 'Ford', model: 'F-150', mileage: 40_000,
      vin: '1FTEW1EP5JFC10001', plate: 'OLD123',
    }).where(eq(vehicles.id, existingVehicle.id))
    const body = newBody({
      clientKey: uuid(815),
      customer: { name: 'Ada Driver', phone: '555-0101', email: null },
      vehicle: {
        year: 2018, make: 'Ford', model: 'F-150', engine: null,
        vin: '1FTEW1EP5JFC10001', plate: 'NEW123', mileage: 88_888,
      },
    })
    await expect(createQuickTicket(db, { actor, body }, {
      afterMileage: async () => { throw new Error('after_new_mileage') },
    })).rejects.toThrow('after_new_mileage')
    const [persisted] = await db.select().from(vehicles).where(eq(vehicles.id, existingVehicle.id))
    expect(persisted.mileage).toBe(40_000)
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('creates no session, assignment, quote version, approval event, or hidden workflow state', async () => {
    const result = await createQuickTicket(db, { actor, body: cannedExistingBody() })
    expect(result.ok).toBe(true)
    const [job] = await db.select().from(ticketJobs)
    expect(job).toMatchObject({ assignedTechId: null, sessionId: null, workStatus: 'open', approvalState: 'pending_quote' })
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(quoteVersions)).toEqual([])
    expect(await db.select().from(quoteEvents)).toEqual([])
  })

  it('rolls back customer, vehicle, mileage, ticket, and canned-line stage failures', async () => {
    const baselineCustomers = await db.select().from(customers)
    const baselineVehicles = await db.select().from(vehicles)
    const fail = async () => { throw new Error('injected_stage_failure') }

    await expect(createQuickTicket(db, { actor, body: newBody({ clientKey: uuid(810) }) }, { afterCustomer: fail })).rejects.toThrow('injected_stage_failure')
    await expect(createQuickTicket(db, { actor, body: newBody({ clientKey: uuid(811) }) }, { afterVehicle: fail })).rejects.toThrow('injected_stage_failure')
    await expect(createQuickTicket(db, { actor, body: existingBody({ clientKey: uuid(812), mileage: 99_999 }) }, { afterMileage: fail })).rejects.toThrow('injected_stage_failure')
    await expect(createQuickTicket(db, { actor, body: existingBody({ clientKey: uuid(813), mileage: 99_999 }) }, { afterTicket: fail })).rejects.toThrow('injected_stage_failure')
    await expect(createQuickTicket(db, { actor, body: cannedExistingBody({ clientKey: uuid(814) }) }, { afterLines: fail })).rejects.toThrow('injected_stage_failure')

    expect(await db.select().from(customers)).toEqual(baselineCustomers)
    expect(await db.select().from(vehicles)).toEqual(baselineVehicles)
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect(await db.select().from(jobLines)).toEqual([])
  })
})
