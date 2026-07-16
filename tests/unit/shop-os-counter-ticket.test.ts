import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCounterTicket } from '@/lib/intake/counter-ticket'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  jobLines,
  profiles,
  shops,
  ticketJobs,
  ticketMutationReceipts,
  tickets,
  vehicles,
} from '@/lib/db/schema'
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

    const [owner, tierTwoTech] = await db
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
      diagnosticAuthorization: {
        amountDollars: '125.05',
        note: '  approved by phone  ',
      },
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

  async function mutationState() {
    const [{ nextTicketNumber }] = await db
      .select({ nextTicketNumber: shops.nextTicketNumber })
      .from(shops)
      .where(eq(shops.id, shopA.id))
    return {
      nextTicketNumber,
      customers: await db.select().from(customers).orderBy(customers.id),
      vehicles: await db.select().from(vehicles).orderBy(vehicles.id),
      tickets: await db.select().from(tickets).orderBy(tickets.id),
      jobs: await db.select().from(ticketJobs).orderBy(ticketJobs.id),
      lines: await db.select().from(jobLines).orderBy(jobLines.id),
      receipts: await db
        .select()
        .from(ticketMutationReceipts)
        .orderBy(ticketMutationReceipts.id),
    }
  }

  function captureActiveTransaction() {
    let active: AppDb | null = null
    const capturedDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property !== 'transaction') return Reflect.get(target, property, receiver)
        return async (callback: (tx: AppDb) => Promise<unknown>) =>
          db.transaction(async (tx) => {
            active = tx as AppDb
            try {
              return await callback(tx as AppDb)
            } finally {
              active = null
            }
          })
      },
    }) as TestDb
    return {
      db: capturedDb,
      tx: (): AppDb => {
        if (active === null) throw new Error('counter_test_transaction_not_active')
        return active
      },
    }
  }

  it('creates a full new-customer ticket with exact cents, full concern, and true-open diagnostic work', async () => {
    const result = await createCounterTicket(db, { actor, body: newBody() })

    expect(result).toMatchObject({
      ok: true,
      ticket: {
        source: 'counter',
        status: 'open',
        concern: 'Loss of power on hills',
        whenStarted: 'two weeks ago',
        howOften: 'daily',
        diagnosticAuthorizedCents: 12_505,
        diagnosticAuthorizationNote: 'approved by phone',
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
            title: 'Diagnose: Loss of power on hills',
            kind: 'diagnostic',
            requiredSkillTier: 3,
            assignedTechId: null,
            assignedTech: null,
            sessionId: null,
          },
        ],
      },
    })
  })

  it('creates one diagnostic A-tier job plus one maintenance C-tier job', async () => {
    const result = await createCounterTicket(db, {
      actor,
      body: newBody({
        requestedService: { kind: 'maintenance', description: 'Rotate tires' },
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ticket.jobs).toHaveLength(2)
    expect(result.ticket.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'diagnostic', requiredSkillTier: 3 }),
        expect.objectContaining({
          title: 'Rotate tires',
          kind: 'maintenance',
          requiredSkillTier: 1,
          assignedTechId: null,
        }),
      ]),
    )
  })

  it('atomically finalizes a two-job Counter batch once with ordered revision-one rows', async () => {
    const [{ nextTicketNumber: beforeNumber }] = await db
      .select({ nextTicketNumber: shops.nextTicketNumber })
      .from(shops)
      .where(eq(shops.id, shopA.id))

    const result = await createCounterTicket(db, {
      actor,
      body: newBody({
        requestedService: { kind: 'repair', description: 'Replace boost hose' },
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [persistedTicket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, result.ticket.id))
    const persistedJobs = await db
      .select()
      .from(ticketJobs)
      .where(eq(ticketJobs.ticketId, result.ticket.id))
      .orderBy(ticketJobs.sequenceNumber)
    const [{ nextTicketNumber: afterNumber }] = await db
      .select({ nextTicketNumber: shops.nextTicketNumber })
      .from(shops)
      .where(eq(shops.id, shopA.id))

    expect(afterNumber).toBe(beforeNumber + 1)
    expect(persistedTicket).toMatchObject({
      source: 'counter',
      projectionRevision: 1n,
      continuityRevision: 1n,
      createdByProfileId: actor.profileId,
    })
    expect(persistedJobs).toMatchObject([
      {
        kind: 'diagnostic',
        sequenceNumber: 1,
        revision: 1n,
        createdByProfileId: actor.profileId,
        creatorProvenance: 'direct',
        sessionId: null,
        createdFromJobId: null,
      },
      {
        kind: 'repair',
        sequenceNumber: 2,
        revision: 1n,
        createdByProfileId: actor.profileId,
        creatorProvenance: 'direct',
        sessionId: null,
        createdFromJobId: null,
      },
    ])
    expect(await db.select().from(ticketMutationReceipts)).toEqual([])
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
    expect(result.ticket.jobs).toHaveLength(2)
    expect(result.ticket.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ requiredSkillTier: 3, assignedTechId: tierTwoTechId }),
        expect.objectContaining({ requiredSkillTier: 2, assignedTechId: tierTwoTechId }),
      ]),
    )
  })

  it('canonicalizes an uppercase confirmed assignee across every created job', async () => {
    const result = await createCounterTicket(db, {
      actor,
      body: newBody({
        assignedTechId: tierTwoTechId.toUpperCase(),
        confirmBelowTier: true,
        requestedService: { kind: 'repair', description: 'Replace boost hose' },
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ticket.jobs).toHaveLength(2)
    expect(result.ticket.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Diagnose: Loss of power on hills',
        assignedTechId: tierTwoTechId,
      }),
      expect.objectContaining({
        title: 'Replace boost hose',
        assignedTechId: tierTwoTechId,
      }),
    ]))
  })

  it('uses the locked assignment tier for the exact warning and rolls back every write', async () => {
    const before = await mutationState()

    const result = await createCounterTicket(db, {
      actor,
      body: newBody({ assignedTechId: tierTwoTechId }),
    })

    expect(result).toEqual({
      ok: false,
      error: 'tier_confirmation_required',
      warning: {
        code: 'below_required_tier',
        assignedTechId: tierTwoTechId,
        assignedSkillTier: 2,
        requiredSkillTier: 3,
      },
    })
    expect(await mutationState()).toEqual(before)
  })

  it('returns the canonical assignee in an uppercase below-tier warning', async () => {
    const before = await mutationState()

    const result = await createCounterTicket(db, {
      actor,
      body: newBody({ assignedTechId: tierTwoTechId.toUpperCase() }),
    })

    expect(result).toEqual({
      ok: false,
      error: 'tier_confirmation_required',
      warning: {
        code: 'below_required_tier',
        assignedTechId: tierTwoTechId,
        assignedSkillTier: 2,
        requiredSkillTier: 3,
      },
    })
    expect(await mutationState()).toEqual(before)
  })

  it.each(['customer', 'vehicle', 'mileage'] as const)(
    'rolls back identity, number, and domain writes when the post-%s seam fails',
    async (stage) => {
      const before = await mutationState()
      const fail = async () => { throw new Error(`after_${stage}`) }
      const dependencies = stage === 'customer'
        ? { afterCustomerInsert: fail }
        : stage === 'vehicle'
          ? { afterVehicleInsert: fail }
          : { afterMileageWrite: fail }
      const body = stage === 'mileage'
        ? existingBody({ mileage: 99_999 })
        : newBody()

      await expect(createCounterTicket(db, { actor, body }, dependencies))
        .rejects.toThrow(`after_${stage}`)
      expect(await mutationState()).toEqual(before)
    },
  )

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
    ['omitted', undefined, 0, 42_000],
    ['null', null, 0, 42_000],
    ['unchanged', 42_000, 0, 42_000],
    ['changed', 43_210, 1, 43_210],
  ] as const)(
    'handles %s existing mileage with the expected locked write count',
    async (_label, mileage, expectedWrites, expectedMileage) => {
      let writes = 0
      const body = existingBody(
        mileage === undefined ? {} : { mileage },
      )
      const result = await createCounterTicket(db, { actor, body }, {
        afterMileageWrite: async () => { writes += 1 },
      })

      expect(result).toMatchObject({
        ok: true,
        ticket: { vehicle: { id: existingVehicle.id, mileage: expectedMileage } },
      })
      expect(writes).toBe(expectedWrites)
    },
  )

  it('reuses the exact-phone customer then VIN vehicle without overwriting metadata', async () => {
    const [originalCustomer] = await db
      .update(customers)
      .set({ name: 'Original Ada', email: 'original@example.com' })
      .where(eq(customers.id, existingCustomer.id))
      .returning()
    const [originalVehicle] = await db
      .update(vehicles)
      .set({ vin: '2HGFC2F59LH000001', plate: 'ADA123', mileage: 42_001 })
      .where(eq(vehicles.id, existingVehicle.id))
      .returning()

    const body = newBody({
      customer: {
        name: 'Replacement Name',
        phone: originalCustomer.phone,
        email: 'replacement@example.com',
      },
      vehicle: {
        year: 1999,
        make: 'Replacement Make',
        model: 'Replacement Model',
        engine: 'Replacement Engine',
        vin: originalVehicle.vin,
        mileage: originalVehicle.mileage,
        plate: 'REPLACE',
      },
    })
    const result = await createCounterTicket(db, { actor, body })

    expect(result).toMatchObject({
      ok: true,
      ticket: {
        customer: { id: originalCustomer.id, name: originalCustomer.name },
        vehicle: {
          id: originalVehicle.id,
          year: originalVehicle.year,
          make: originalVehicle.make,
          mileage: originalVehicle.mileage,
        },
      },
    })
    expect(await db.select().from(customers).where(eq(customers.id, originalCustomer.id)))
      .toEqual([originalCustomer])
    expect(await db.select().from(vehicles).where(eq(vehicles.id, originalVehicle.id)))
      .toEqual([originalVehicle])
  })

  it('reuses the exact-phone customer then plate-only vehicle without overwriting metadata', async () => {
    const [originalCustomer] = await db
      .update(customers)
      .set({ name: 'Original Plate Customer', email: 'plate-original@example.com' })
      .where(eq(customers.id, existingCustomer.id))
      .returning()
    const [originalVehicle] = await db
      .update(vehicles)
      .set({
        year: 2017,
        make: 'Mazda',
        model: 'CX-5',
        engine: '2.5L',
        vin: null,
        plate: 'PLATE17',
        mileage: 51_234,
      })
      .where(eq(vehicles.id, existingVehicle.id))
      .returning()

    const result = await createCounterTicket(db, {
      actor,
      body: newBody({
        customer: {
          name: 'Replacement Plate Customer',
          phone: originalCustomer.phone,
          email: 'plate-replacement@example.com',
        },
        vehicle: {
          year: originalVehicle.year,
          make: originalVehicle.make,
          model: originalVehicle.model,
          engine: 'Replacement Engine',
          vin: null,
          mileage: originalVehicle.mileage,
          plate: originalVehicle.plate,
        },
      }),
    })

    expect(result).toMatchObject({
      ok: true,
      ticket: {
        customer: { id: originalCustomer.id, name: originalCustomer.name },
        vehicle: {
          id: originalVehicle.id,
          year: originalVehicle.year,
          make: originalVehicle.make,
          model: originalVehicle.model,
          engine: originalVehicle.engine,
          vin: null,
          mileage: originalVehicle.mileage,
          plate: originalVehicle.plate,
        },
      },
    })
    expect(await db.select().from(customers).where(eq(customers.id, originalCustomer.id)))
      .toEqual([originalCustomer])
    expect(await db.select().from(vehicles).where(eq(vehicles.id, originalVehicle.id)))
      .toEqual([originalVehicle])
  })

  it('reuses the exact-phone customer and creates only its planned new VIN vehicle', async () => {
    const beforeCustomer = await db
      .select()
      .from(customers)
      .where(eq(customers.id, existingCustomer.id))
    const beforeVehicleCount = (await db.select().from(vehicles)).length
    const body = newBody({
      customer: {
        name: 'Replacement Name',
        phone: existingCustomer.phone,
        email: 'replacement@example.com',
      },
      vehicle: {
        year: 2022,
        make: 'Subaru',
        model: 'Outback',
        engine: '2.5L',
        vin: '4S4BTANC0N3100001',
        mileage: 12_345,
        plate: 'NEWVIN',
      },
    })
    const result = await createCounterTicket(db, { actor, body })

    expect(result).toMatchObject({
      ok: true,
      ticket: {
        customer: { id: existingCustomer.id },
        vehicle: {
          year: 2022,
          make: 'Subaru',
          model: 'Outback',
          vin: '4S4BTANC0N3100001',
        },
      },
    })
    expect(await db.select().from(customers).where(eq(customers.id, existingCustomer.id)))
      .toEqual(beforeCustomer)
    expect(await db.select().from(vehicles)).toHaveLength(beforeVehicleCount + 1)
  })

  it('returns stable non-retryable conflict for duplicate customer matches without writes', async () => {
    await db.insert(customers).values({
      shopId: shopA.id,
      name: 'Duplicate Ada',
      phone: existingCustomer.phone,
    })
    const before = await mutationState()
    let preflights = 0

    const result = await createCounterTicket(db, {
      actor,
      body: newBody({
        customer: {
          name: 'Ada Request',
          phone: existingCustomer.phone,
          email: null,
        },
      }),
    }, {
      afterIdentityPreflight: async () => { preflights += 1 },
    })

    expect(result).toEqual({ ok: false, error: 'conflict' })
    expect(preflights).toBe(0)
    expect(await mutationState()).toEqual(before)
  })

  it('returns stable non-retryable conflict for duplicate vehicle matches without writes', async () => {
    const vin = '2HGFC2F59LH000001'
    await db.update(vehicles).set({ vin }).where(eq(vehicles.id, existingVehicle.id))
    await db.insert(vehicles).values({
      customerId: existingCustomer.id,
      year: 2020,
      make: 'Honda',
      model: 'Civic duplicate',
      vin,
    })
    const before = await mutationState()
    let preflights = 0

    const result = await createCounterTicket(db, {
      actor,
      body: newBody({
        customer: {
          name: existingCustomer.name,
          phone: existingCustomer.phone,
          email: null,
        },
        vehicle: {
          ...newBody().vehicle,
          vin,
        },
      }),
    }, {
      afterIdentityPreflight: async () => { preflights += 1 },
    })

    expect(result).toEqual({ ok: false, error: 'conflict' })
    expect(preflights).toBe(0)
    expect(await mutationState()).toEqual(before)
  })

  it('retries identity drift with a fresh attempt and commits exactly one final batch', async () => {
    let preflights = 0
    const captured = captureActiveTransaction()
    const result = await createCounterTicket(captured.db, {
      actor,
      body: newBody(),
    }, {
      afterIdentityPreflight: async () => {
        preflights += 1
        if (preflights === 1) {
          await captured.tx().insert(customers).values({
            id: uuid(701),
            shopId: shopA.id,
            name: 'First-attempt drift',
            phone: '555-1234',
          })
        }
      },
    })

    expect(result).toMatchObject({ ok: true })
    expect(preflights).toBe(2)
    expect(await db.select().from(customers).where(eq(customers.phone, '555-1234')))
      .toHaveLength(1)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
  })

  it('exhausts two identity-drift attempts as retryable conflict with no partial rows', async () => {
    const before = await mutationState()
    let preflights = 0
    const captured = captureActiveTransaction()

    const result = await createCounterTicket(captured.db, {
      actor,
      body: newBody(),
    }, {
      afterIdentityPreflight: async () => {
        preflights += 1
        await captured.tx().insert(customers).values({
          id: uuid(710 + preflights),
          shopId: shopA.id,
          name: `Attempt ${preflights} drift`,
          phone: '555-1234',
        })
      },
    })

    expect(result).toEqual({ ok: false, error: 'conflict', retryable: true })
    expect(preflights).toBe(2)
    expect(await mutationState()).toEqual(before)
  })

  it('owns the parsed body before preflight and ignores every later caller mutation', async () => {
    const body = newBody({
      assignedTechId: tierTwoTechId,
      confirmBelowTier: true,
      requestedService: { kind: 'repair', description: 'Replace boost hose' },
    })
    let preflights = 0

    const result = await createCounterTicket(db, { actor, body }, {
      afterIdentityPreflight: async () => {
        preflights += 1
        const mutable = body as Record<string, unknown>
        const customer = mutable.customer as Record<string, unknown>
        const vehicle = mutable.vehicle as Record<string, unknown>
        customer.name = 'Mutated Customer'
        customer.phone = '555-MUTATED'
        vehicle.make = 'Mutated Make'
        vehicle.vin = '1M8GDM9AXKP042788'
        vehicle.mileage = 1
        mutable.concern = 'Mutated concern'
        mutable.requestedService = { kind: 'maintenance', description: 'Mutated service' }
        mutable.assignedTechId = null
      },
    })

    expect(preflights).toBe(1)
    expect(result).toMatchObject({
      ok: true,
      ticket: {
        concern: 'Loss of power on hills',
        customer: { name: 'Maria Lopez', phone: '555-1234' },
        vehicle: { make: 'Ford', vin: '1FTEW1EP5JFC10001', mileage: 84_000 },
      },
    })
    if (!result.ok) return
    expect(result.ticket.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Diagnose: Loss of power on hills',
        assignedTechId: tierTwoTechId,
      }),
      expect.objectContaining({
        title: 'Replace boost hose',
        kind: 'repair',
        assignedTechId: tierTwoTechId,
      }),
    ]))
  })

  it.each([
    ['inactive', { membershipStatus: 'pending', membershipActivatedAt: null }],
    ['deactivated', { deactivatedAt: new Date('2026-07-15T12:00:00Z') }],
    ['unsupported', { role: 'auditor' }],
    ['tierless', { skillTier: null }],
  ] as const)(
    'rejects a locked %s assignee as invalid with zero writes',
    async (_label, update) => {
      await db.update(profiles).set(update).where(eq(profiles.id, tierTwoTechId))
      const before = await mutationState()

      const result = await createCounterTicket(db, {
        actor,
        body: newBody({ assignedTechId: tierTwoTechId, confirmBelowTier: true }),
      })

      expect(result).toEqual({ ok: false, error: 'invalid_assignee' })
      expect(await mutationState()).toEqual(before)
    },
  )

  it('rejects self-assignment below the diagnostic tier even when confirmed', async () => {
    await db.update(profiles).set({ skillTier: 2 }).where(eq(profiles.id, actor.profileId))
    const before = await mutationState()

    const result = await createCounterTicket(db, {
      actor,
      body: newBody({ assignedTechId: actor.profileId, confirmBelowTier: true }),
    })

    expect(result).toEqual({ ok: false, error: 'invalid_assignee' })
    expect(await mutationState()).toEqual(before)
  })

  it('uses locked actor authority and rejects unauthorized assignment to another profile', async () => {
    await db.update(profiles).set({ role: 'tech' }).where(eq(profiles.id, actor.profileId))
    const before = await mutationState()

    const result = await createCounterTicket(db, {
      actor,
      body: newBody({ assignedTechId: tierTwoTechId, confirmBelowTier: true }),
    })

    expect(result).toEqual({ ok: false, error: 'invalid_assignee' })
    expect(await mutationState()).toEqual(before)
  })

  it('returns not_found for missing and cross-shop assignees with zero writes', async () => {
    const [crossShopTech] = await db.insert(profiles).values({
      userId: uuid(800),
      shopId: shopB.id,
      role: 'tech',
      skillTier: 3,
      fullName: 'Cross Shop Tech',
    }).returning()
    const before = await mutationState()

    for (const assignedTechId of [
      '00000000-0000-4000-8000-000000000801',
      crossShopTech.id,
    ]) {
      await expect(createCounterTicket(db, {
        actor,
        body: newBody({ assignedTechId, confirmBelowTier: true }),
      })).resolves.toEqual({ ok: false, error: 'not_found' })
      expect(await mutationState()).toEqual(before)
    }
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
      newBody({ diagnosticAuthorization: { amountDollars: '1.999', note: null } }),
      newBody({ diagnosticAuthorization: { amountDollars: '-1.00', note: null } }),
      newBody({ diagnosticAuthorization: { amountDollars: '1e3', note: null } }),
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

  it('parses decimal dollars without binary floating-point rounding', async () => {
    const expected = [
      ['0', 0],
      ['0.01', 1],
      ['10.10', 1_010],
      ['90071992547409.91', Number.MAX_SAFE_INTEGER],
    ] as const

    for (const [amountDollars, cents] of expected) {
      const phone = `555-${amountDollars}`
      const body = newBody({
        customer: { name: 'Money Test', phone, email: null },
        vehicle: {
          ...newBody().vehicle,
          vin: null,
          plate: phone,
        },
        diagnosticAuthorization: { amountDollars, note: null },
      })
      const result = await createCounterTicket(db, { actor, body })
      expect(result).toMatchObject({
        ok: true,
        ticket: { diagnosticAuthorizedCents: cents },
      })
    }
  })

  it('rolls back an existing mileage change when nested ticket creation fails', async () => {
    const result = await createCounterTicket(db, {
      actor,
      body: existingBody({
        mileage: 99_999,
        assignedTechId: tierTwoTechId,
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
