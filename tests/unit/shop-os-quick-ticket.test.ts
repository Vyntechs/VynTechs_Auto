import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tickets')>()
  return { ...actual, createTicket: vi.fn(actual.createTicket) }
})

import { createQuickTicket } from '@/lib/intake/quick-ticket'
import {
  customers,
  profiles,
  sessions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { createTicket, type TicketActor } from '@/lib/tickets'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-0000-0000-${suffix.toString().padStart(12, '0')}`

describe('createQuickTicket', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopA: typeof shops.$inferSelect
  let actor: TicketActor
  let existingCustomer: typeof customers.$inferSelect
  let existingVehicle: typeof vehicles.$inferSelect
  let crossShopVehicle: typeof vehicles.$inferSelect

  beforeEach(async () => {
    vi.mocked(createTicket).mockImplementation(
      (await vi.importActual<typeof import('@/lib/tickets')>('@/lib/tickets')).createTicket,
    )
    const created = await createTestDb()
    db = created.db
    close = created.close

    const [firstShop, secondShop] = await db
      .insert(shops)
      .values([{ name: 'North Shop' }, { name: 'South Shop' }])
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
      requestedWork: { kind: 'repair', description: '  Replace boost hose  ' },
      ...overrides,
    }
  }

  function existingBody(overrides: Record<string, unknown> = {}) {
    return {
      vehicleMode: 'existing',
      existingVehicleId: existingVehicle.id,
      requestedWork: { kind: 'maintenance', description: '  Rotate tires  ' },
      ...overrides,
    }
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
      newBody({ requestedWork: { kind: 'diagnostic', description: 'Inspect' } }),
      newBody({ requestedWork: { kind: 'repair', description: ' ' } }),
      newBody({ requestedWork: { kind: 'repair', description: 'x'.repeat(201) } }),
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
})
