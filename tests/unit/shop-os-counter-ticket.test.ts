import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCounterTicket } from '@/lib/intake/counter-ticket'
import { customers, jobLines, profiles, shops, ticketJobs, tickets, vehicles } from '@/lib/db/schema'
import { cannedJobActorFromProfile, createCannedJob } from '@/lib/shop-os/canned-jobs'
import type { TicketActor } from '@/lib/tickets'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-0000-0000-${suffix.toString().padStart(12, '0')}`

describe('createCounterTicket', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopA: typeof shops.$inferSelect
  let shopB: typeof shops.$inferSelect
  let actor: TicketActor
  let tierOneTechId: string
  let tierTwoTechId: string
  let existingCustomer: typeof customers.$inferSelect
  let existingVehicle: typeof vehicles.$inferSelect
  let crossShopVehicle: typeof vehicles.$inferSelect
  let diagnosticTemplate: { id: string; fingerprint: string }
  let maintenanceTemplate: { id: string; fingerprint: string }

  beforeEach(async () => {
    const created = await createTestDb()
    db = created.db
    close = created.close

    ;[shopA, shopB] = await db
      .insert(shops)
      .values([{ name: 'North Shop' }, { name: 'South Shop' }])
      .returning()

    const [owner, tierOneTech, tierTwoTech] = await db
      .insert(profiles)
      .values([
        {
          userId: uuid(1),
          shopId: shopA.id,
          role: 'owner',
          skillTier: 3,
          fullName: 'Owen Owner',
        },
        {
          userId: uuid(2),
          shopId: shopA.id,
          role: 'tech',
          skillTier: 1,
          fullName: 'Jordan Tech',
        },
        {
          userId: uuid(3),
          shopId: shopA.id,
          role: 'tech',
          skillTier: 2,
          fullName: 'Taylor Tech',
        },
      ])
      .returning()
    actor = {
      profileId: owner.id,
      shopId: owner.shopId,
      role: owner.role,
      skillTier: owner.skillTier,
      membershipStatus: owner.membershipStatus,
      deactivatedAt: owner.deactivatedAt,
    }
    const diagnostic = await createCannedJob(db, {
      actor: cannedJobActorFromProfile(owner),
      clientKey: crypto.randomUUID(),
      body: {
        title: 'Initial diagnosis', kind: 'diagnostic', defaultRequiredSkillTier: 3, sort: 10,
        lines: [{ kind: 'labor', description: 'Test and isolate concern', sort: 10, hours: '1', priceCents: 18_750, taxable: false, laborRateCents: 18_750 }],
      },
    })
    const maintenance = await createCannedJob(db, {
      actor: cannedJobActorFromProfile(owner),
      clientKey: crypto.randomUUID(),
      body: {
        title: 'Oil service', kind: 'maintenance', defaultRequiredSkillTier: 1, sort: 20,
        lines: [{ kind: 'labor', description: 'Change engine oil', sort: 10, hours: '0.5', priceCents: 5_000, taxable: false, laborRateCents: 10_000 }],
      },
    })
    if (!diagnostic.ok || !maintenance.ok) throw new Error('fixture setup failed')
    diagnosticTemplate = diagnostic.cannedJob
    maintenanceTemplate = maintenance.cannedJob
    tierOneTechId = tierOneTech.id
    tierTwoTechId = tierTwoTech.id

    const [customerA, customerB] = await db
      .insert(customers)
      .values([
        { shopId: shopA.id, name: 'Ada Driver', phone: '555-0101' },
        { shopId: shopB.id, name: 'Cross Shop', phone: '555-0201' },
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
          engine: '2.0L',
          mileage: 42_000,
        },
        { customerId: customerB.id, year: 2021, make: 'Toyota', model: 'Camry' },
      ])
      .returning()
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
        vin: '  1FTEW1EP5JFC10001  ',
        year: 2018,
        make: '  Ford  ',
        model: '  F-150  ',
        engine: '  3.5L EcoBoost  ',
        mileage: 84_000,
        plate: '  ABC123  ',
      },
      concern: '  Loss of power on hills  ',
      whenStarted: '  two weeks ago  ',
      howOften: '  daily  ',
      assignedTechId: null,
      work: {
        mode: 'manual',
        kind: 'repair',
        description: 'Inspect loss of power concern',
      },
      ...overrides,
    }
  }

  function existingBody(overrides: Record<string, unknown> = {}) {
    return {
      vehicleMode: 'existing',
      existingVehicleId: existingVehicle.id,
      concern: 'Brake vibration at highway speed',
      assignedTechId: null,
      work: {
        mode: 'manual',
        kind: 'repair',
        description: 'Inspect brake vibration concern',
      },
      ...overrides,
    }
  }

  it('creates one explicit known-work job from a new customer concern', async () => {
    const result = await createCounterTicket(db, { actor, body: newBody() })

    expect(result).toMatchObject({
      ok: true,
      ticket: {
        source: 'counter',
        status: 'open',
        concern: 'Loss of power on hills',
        whenStarted: 'two weeks ago',
        howOften: 'daily',
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
            title: 'Inspect loss of power concern',
            kind: 'repair',
            requiredSkillTier: 2,
            assignedTechId: null,
            assignedTech: null,
            sessionId: null,
          },
        ],
      },
    })
  })

  it('reauthorizes the persisted advisor role before any counter-intake write', async () => {
    await db.update(profiles).set({ role: 'tech' }).where(eq(profiles.id, actor.profileId))

    await expect(createCounterTicket(db, { actor, body: newBody() })).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    })
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })

  it('reauthorizes active membership before any counter-intake write', async () => {
    await db.update(profiles).set({
      deactivatedAt: new Date('2026-07-21T12:00:00.000Z'),
    }).where(eq(profiles.id, actor.profileId))

    await expect(createCounterTicket(db, { actor, body: newBody() })).resolves.toEqual({
      ok: false,
      error: 'inactive_profile',
    })
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })

  it('uses manual maintenance as the one work item instead of creating duplicate work', async () => {
    const result = await createCounterTicket(db, {
      actor,
      body: newBody({
        work: { mode: 'manual', kind: 'maintenance', description: 'Rotate tires' },
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ticket.jobs).toEqual([
      expect.objectContaining({
        title: 'Rotate tires',
        kind: 'maintenance',
        requiredSkillTier: 1,
        assignedTechId: null,
      }),
    ])
  })

  it('assigns every created job to the selected technician', async () => {
    const result = await createCounterTicket(db, {
      actor,
      body: newBody({
        assignedTechId: tierTwoTechId,
        confirmBelowTier: true,
        work: { mode: 'manual', kind: 'repair', description: 'Replace boost hose' },
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ticket.jobs).toEqual([
      expect.objectContaining({
        title: 'Replace boost hose',
        requiredSkillTier: 2,
        assignedTechId: tierTwoTechId,
      }),
    ])
  })

  it('atomically creates a diagnostic job with the shop diagnostic labor line before technician assignment', async () => {
    const result = await createCounterTicket(db, {
      actor,
      body: existingBody({
        assignedTechId: tierTwoTechId,
        confirmBelowTier: true,
        work: {
          mode: 'diagnosis',
          cannedJobId: diagnosticTemplate.id,
          expectedFingerprint: diagnosticTemplate.fingerprint,
          expectedTaxRateBps: null,
        },
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ticket.jobs).toEqual([
      expect.objectContaining({
        title: 'Initial diagnosis',
        kind: 'diagnostic',
        requiredSkillTier: 3,
        assignedTechId: tierTwoTechId,
      }),
    ])
    expect(await db.select().from(jobLines)).toEqual([
      expect.objectContaining({
        jobId: result.ticket.jobs[0].id,
        kind: 'labor',
        description: 'Test and isolate concern',
        priceCents: 18_750,
        laborHours: 1,
      }),
    ])
  })

  it('copies a selected known-work template and preserves customer-supplied-part truth on the job', async () => {
    const result = await createCounterTicket(db, {
      actor,
      body: existingBody({
        work: {
          mode: 'canned',
          cannedJobId: maintenanceTemplate.id,
          expectedFingerprint: maintenanceTemplate.fingerprint,
          expectedTaxRateBps: null,
          customerSuppliedPartsNote: 'Customer supplied sealed oil filter.',
        },
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ticket.jobs[0]).toMatchObject({
      title: 'Oil service',
      kind: 'maintenance',
      customerSuppliedPartsNote: 'Customer supplied sealed oil filter.',
    })
    expect(await db.select().from(jobLines)).toEqual([
      expect.objectContaining({ jobId: result.ticket.jobs[0].id, description: 'Change engine oil' }),
    ])
  })

  it('preserves row-8 below-tier warning and rolls back the new customer and vehicle', async () => {
    const beforeCustomers = await db.select().from(customers)
    const beforeVehicles = await db.select().from(vehicles)

    const result = await createCounterTicket(db, {
      actor,
      body: newBody({ assignedTechId: tierOneTechId }),
    })

    expect(result).toEqual({
      ok: false,
      error: 'tier_confirmation_required',
      warning: {
        code: 'below_required_tier',
        assignedTechId: tierOneTechId,
        assignedSkillTier: 1,
        requiredSkillTier: 2,
      },
    })
    expect(await db.select().from(customers)).toEqual(beforeCustomers)
    expect(await db.select().from(vehicles)).toEqual(beforeVehicles)
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })

  it('resolves a same-shop existing vehicle and updates only its supplied mileage', async () => {
    const result = await createCounterTicket(db, {
      actor,
      body: existingBody({ mileage: 43_210 }),
    })

    expect(result).toMatchObject({
      ok: true,
      ticket: {
        customer: { id: existingCustomer.id },
        vehicle: { id: existingVehicle.id, mileage: 43_210 },
      },
    })
    const [persisted] = await db
      .select()
      .from(vehicles)
      .where(eq(vehicles.id, existingVehicle.id))
    expect(persisted).toMatchObject({
      mileage: 43_210,
      year: existingVehicle.year,
      make: existingVehicle.make,
      model: existingVehicle.model,
    })
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
    await expect(createCounterTicket(db, { actor, body: makeBody() })).resolves.toEqual({
      ok: false,
      error: 'not_found',
    })
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('rejects malformed and mixed new-vs-existing bodies before writes', async () => {
    const invalidBodies = [
      null,
      newBody({ vehicleMode: 'other' }),
      { ...newBody(), existingVehicleId: existingVehicle.id },
      { ...existingBody(), customer: newBody().customer, vehicle: newBody().vehicle },
      newBody({ concern: ' ' }),
      newBody({ assignedTechId: undefined }),
      newBody({ diagnosticAuthorization: { amountDollars: '120', note: 'legacy field' } }),
      newBody({ work: { mode: 'manual', kind: 'diagnostic', description: 'extra' } }),
      newBody({ work: { mode: 'manual', kind: 'repair', description: 'Install lift kit', customerSuppliedPartsNote: ' ' } }),
      existingBody({ mileage: -1 }),
      { ...newBody(), status: 'closed' },
    ]

    for (const body of invalidBodies) {
      await expect(createCounterTicket(db, { actor, body })).resolves.toEqual({
        ok: false,
        error: 'invalid_input',
      })
    }
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('rejects mileage above the PostgreSQL integer maximum before any write', async () => {
    const beforeCustomers = await db.select().from(customers)
    const beforeVehicles = await db.select().from(vehicles)
    const overflowMileage = 2_147_483_648
    const newVehicle = newBody().vehicle as Record<string, unknown>

    for (const body of [
      newBody({ vehicle: { ...newVehicle, mileage: overflowMileage } }),
      existingBody({ mileage: overflowMileage }),
    ]) {
      await expect(createCounterTicket(db, { actor, body })).resolves.toEqual({
        ok: false,
        error: 'invalid_input',
      })
    }

    expect(await db.select().from(customers)).toEqual(beforeCustomers)
    expect(await db.select().from(vehicles)).toEqual(beforeVehicles)
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })

  it('fails closed when diagnosis points at a non-diagnostic template', async () => {
    await expect(createCounterTicket(db, {
      actor,
      body: newBody({ work: { mode: 'diagnosis', cannedJobId: maintenanceTemplate.id, expectedFingerprint: maintenanceTemplate.fingerprint, expectedTaxRateBps: null } }),
    })).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('rolls back an existing mileage change when nested ticket creation fails', async () => {
    const result = await createCounterTicket(db, {
      actor,
      body: existingBody({
        mileage: 99_999,
        assignedTechId: tierOneTechId,
      }),
    })

    expect(result).toMatchObject({ ok: false, error: 'tier_confirmation_required' })
    const [persisted] = await db
      .select({ mileage: vehicles.mileage })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.id, existingVehicle.id),
          eq(vehicles.customerId, existingCustomer.id),
        ),
      )
    expect(persisted.mileage).toBe(42_000)
  })
})
