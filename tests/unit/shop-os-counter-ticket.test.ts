import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCounterTicket } from '@/lib/intake/counter-ticket'
import { customers, profiles, shops, ticketJobs, tickets, vehicles } from '@/lib/db/schema'
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
      ...overrides,
    }
  }

  function existingBody(overrides: Record<string, unknown> = {}) {
    return {
      vehicleMode: 'existing',
      existingVehicleId: existingVehicle.id,
      concern: 'Brake vibration at highway speed',
      assignedTechId: null,
      ...overrides,
    }
  }

  it('creates one ordinary repair job from a new customer concern while diagnostics are dark', async () => {
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
            title: 'Customer request: Loss of power on hills',
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

  it('uses requested maintenance as the one work item instead of creating duplicate work', async () => {
    const result = await createCounterTicket(db, {
      actor,
      body: newBody({
        requestedService: { kind: 'maintenance', description: 'Rotate tires' },
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
        requestedService: { kind: 'repair', description: 'Replace boost hose' },
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
      newBody({ requestedService: { kind: 'diagnostic', description: 'extra' } }),
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
