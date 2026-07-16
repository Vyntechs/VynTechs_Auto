import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '@/lib/db/queries'
import { customers, profiles, shops, vehicles } from '@/lib/db/schema'
import {
  consumeMaterializedTicketIntakeIdentityForCreationV1,
  materializeTicketIntakeIdentityInLockedScopeV1,
  preflightTicketIntakeIdentityV1,
  type TicketIntakeIdentityInputV1,
  type TicketIntakeIdentityLockPlanV1,
  type TicketIntakeIdentitySeamsV1,
} from '@/lib/intake/ticket-identity'
import type {
  MaterializedTicketIntakeIdentityV1,
  ResolvedTicketIntakeIdentityV1,
} from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import type {
  MutationLockRequestV1,
} from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import {
  runBoundedShopOsMutationV1,
} from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const EMPTY_INTENTS = Object.freeze({
  sessions: Object.freeze([]),
  customers: Object.freeze([]),
  vehicles: Object.freeze([]),
  tickets: Object.freeze([]),
  jobs: Object.freeze([]),
})

type IdentityRunOptions = Readonly<{
  seams?: TicketIntakeIdentitySeamsV1
  afterPreflight?: (
    tx: AppDb,
    lockPlan: TicketIntakeIdentityLockPlanV1,
  ) => Promise<void>
  mutateInputAfterCall?: () => void
  transformRequest?: (request: MutationLockRequestV1) => MutationLockRequestV1
  beforeMaterialize?: (tx: AppDb) => Promise<void>
}>

describe('Task 7A ticket intake identity capability', () => {
  let db: TestDb
  let close: () => Promise<void>
  const shopId = uuid(1)
  const actorProfileId = uuid(10)

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: shopId, name: 'North Shop' })
    await db.insert(profiles).values({
      id: actorProfileId,
      userId: uuid(11),
      shopId,
      role: 'owner',
      fullName: 'Owner',
    })
  })

  afterEach(async () => close())

  function newVehicleInput(
    overrides: Partial<Extract<TicketIntakeIdentityInputV1, { mode: 'new_vehicle' }>> = {},
  ): Extract<TicketIntakeIdentityInputV1, { mode: 'new_vehicle' }> {
    return {
      mode: 'new_vehicle',
      shopId,
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
      ...overrides,
    }
  }

  function lockRequestFor(
    lockPlan: TicketIntakeIdentityLockPlanV1 | null,
  ): MutationLockRequestV1 {
    return {
      shopId,
      actorProfileId,
      profileIds: [actorProfileId],
      lockShop: lockPlan?.lockShop ?? false,
      customerIds: lockPlan?.customerIds ?? [],
      vehicleIds: lockPlan?.vehicleIds ?? [],
      ticketIds: [],
      jobIds: [],
      includeAllJobsForTickets: false,
      includeAllLinesForJobs: false,
      includeAllQuoteVersionsForTickets: false,
      includeAllQuoteEventsForTickets: false,
      sessionIds: [],
      sessionEventIds: [],
      vendorAccountIds: [],
      cannedJobIds: [],
      receiptRequestKey: null,
      receiptConditionalInsert: null,
      insertionIntents: lockPlan
        ? {
            ...EMPTY_INTENTS,
            customers: lockPlan.insertionIntents.customers,
            vehicles: lockPlan.insertionIntents.vehicles,
          }
        : EMPTY_INTENTS,
    }
  }

  async function runIdentity(
    input: TicketIntakeIdentityInputV1,
    options: IdentityRunOptions = {},
  ) {
    let resolved: ResolvedTicketIntakeIdentityV1 | undefined
    let materialized: MaterializedTicketIntakeIdentityV1 | undefined
    let materializedTx: AppDb | undefined
    let materializedScope: Parameters<
      typeof consumeMaterializedTicketIntakeIdentityForCreationV1
    >[1] | undefined

    const result = await runBoundedShopOsMutationV1(db, {
      discover: async (tx, attempt) => {
        const pending = preflightTicketIntakeIdentityV1(tx, attempt.capability, input)
        options.mutateInputAfterCall?.()
        const preflight = await pending
        if (preflight.ok) {
          resolved = preflight.identity
          await options.afterPreflight?.(tx, preflight.lockPlan)
        }
        const baseRequest = lockRequestFor(preflight.ok ? preflight.lockPlan : null)
        return {
          lockRequest: options.transformRequest?.(baseRequest) ?? baseRequest,
          payload: preflight,
        }
      },
      executeLocked: async (tx, scope, preflight) => {
        if (!preflight.ok) return preflight
        await options.beforeMaterialize?.(tx)
        const outcome = await materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          preflight.identity,
          options.seams,
        )
        if (!outcome.ok) return outcome
        materialized = outcome.materialized
        materializedTx = tx
        materializedScope = scope
        return Object.freeze({
          ok: true as const,
          value: consumeMaterializedTicketIntakeIdentityForCreationV1(
            tx,
            scope,
            outcome.materialized,
          ),
          lockPlan: preflight.lockPlan,
        })
      },
    })

    return {
      result,
      resolved,
      materialized,
      materializedTx,
      materializedScope,
    }
  }

  async function insertCustomerAndVehicle(input: Readonly<{
    customerId?: string
    vehicleId?: string
    phone?: string
    vin?: string | null
    plate?: string | null
    year?: number
    make?: string
    model?: string
    mileage?: number | null
  }> = {}) {
    const [customer] = await db.insert(customers).values({
      id: input.customerId ?? uuid(20),
      shopId,
      name: 'Ada Driver',
      phone: input.phone ?? '555-0101',
      email: 'ada@example.com',
    }).returning()
    const [vehicle] = await db.insert(vehicles).values({
      id: input.vehicleId ?? uuid(30),
      customerId: customer.id,
      year: input.year ?? 2020,
      make: input.make ?? 'Honda',
      model: input.model ?? 'Civic',
      engine: '2.0L',
      vin: input.vin === undefined ? '2HGFC2F59LH000001' : input.vin,
      mileage: input.mileage === undefined ? 42_000 : input.mileage,
      plate: input.plate === undefined ? 'ADA123' : input.plate,
    }).returning()
    return { customer, vehicle }
  }

  it('preflights and materializes an explicit same-shop vehicle with exact empty created rows', async () => {
    const { customer, vehicle } = await insertCustomerAndVehicle()
    const { result, resolved, materialized, materializedTx, materializedScope } = await runIdentity({
      mode: 'existing_vehicle',
      shopId: shopId.toUpperCase(),
      existingVehicleId: vehicle.id.toUpperCase(),
    })

    expect(result).toEqual({
      ok: true,
      value: {
        input: {
          mode: 'existing_vehicle',
          shopId,
          existingVehicleId: vehicle.id,
        },
        customerId: customer.id,
        vehicleId: vehicle.id,
        createdRows: { sessionIds: [], customerIds: [], vehicleIds: [] },
        mileageDisposition: { kind: 'preserved', mileage: 42_000 },
      },
      lockPlan: {
        lockShop: true,
        customerIds: [customer.id],
        vehicleIds: [vehicle.id],
        insertionIntents: { customers: [], vehicles: [] },
      },
    })
    expect(Object.getPrototypeOf(resolved!)).toBe(null)
    expect(Object.isFrozen(resolved)).toBe(true)
    expect(Reflect.ownKeys(resolved!)).toEqual([])
    expect(Object.getPrototypeOf(materialized!)).toBe(null)
    expect(Object.isFrozen(materialized)).toBe(true)
    expect(Reflect.ownKeys(materialized!)).toEqual([])
    expect(() => consumeMaterializedTicketIntakeIdentityForCreationV1(
      materializedTx!, materializedScope!, materialized!,
    )).toThrow('mutation_attempt_capability_closed')
  })

  it('returns not_found for a missing or cross-shop explicit vehicle without writing', async () => {
    const otherShopId = uuid(2)
    await db.insert(shops).values({ id: otherShopId, name: 'South Shop' })
    const [otherCustomer] = await db.insert(customers).values({
      id: uuid(40), shopId: otherShopId, name: 'Other', phone: '555-9000',
    }).returning()
    const [otherVehicle] = await db.insert(vehicles).values({
      id: uuid(41), customerId: otherCustomer.id, year: 2022,
      make: 'Toyota', model: 'Camry', engine: null, vin: null, mileage: null, plate: null,
    }).returning()

    for (const existingVehicleId of [uuid(999), otherVehicle.id]) {
      const { result } = await runIdentity({
        mode: 'existing_vehicle', shopId, existingVehicleId,
      })
      expect(result).toEqual({ ok: false, error: 'not_found' })
    }
    expect(await db.select().from(customers)).toHaveLength(1)
    expect(await db.select().from(vehicles)).toHaveLength(1)
  })

  it('deep-owns normalized new identity before its first await and inserts only preallocated IDs', async () => {
    const caller = {
      mode: 'new_vehicle' as const,
      shopId: shopId.toUpperCase(),
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
    }
    const writes: string[] = []
    const { result } = await runIdentity(caller, {
      mutateInputAfterCall: () => {
        caller.customer.name = 'Mutated'
        caller.vehicle.make = 'Mutated'
        caller.vehicle.mileage = 1
      },
      seams: {
        afterCustomerInsert: async () => { writes.push('customer') },
        afterVehicleInsert: async () => { writes.push('vehicle') },
      },
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        input: {
          mode: 'new_vehicle',
          shopId,
          customer: { name: 'Maria Lopez', phone: '555-1234', email: 'maria@example.com' },
          vehicle: {
            year: 2018, make: 'Ford', model: 'F-150', engine: '3.5L EcoBoost',
            vin: '1FTEW1EP5JFC10001', mileage: 84_000, plate: 'ABC123',
          },
        },
        mileageDisposition: { kind: 'inserted', mileage: 84_000 },
      },
    })
    if (!result.ok || !('value' in result)) throw new Error('identity materialization failed')
    const customerIntent = result.lockPlan.insertionIntents.customers[0]!
    const vehicleIntent = result.lockPlan.insertionIntents.vehicles[0]!
    expect(result.value).toMatchObject({
      customerId: customerIntent.id,
      vehicleId: vehicleIntent.id,
      createdRows: {
        sessionIds: [],
        customerIds: [customerIntent.id],
        vehicleIds: [vehicleIntent.id],
      },
    })
    expect(vehicleIntent.customerId).toBe(customerIntent.id)
    expect(writes).toEqual(['customer', 'vehicle'])
    const [storedCustomer] = await db.select().from(customers)
    const [storedVehicle] = await db.select().from(vehicles)
    expect(storedCustomer).toMatchObject({
      id: customerIntent.id,
      name: 'Maria Lopez',
      phone: '555-1234',
      email: 'maria@example.com',
    })
    expect(storedVehicle).toMatchObject({
      id: vehicleIntent.id,
      customerId: customerIntent.id,
      make: 'Ford',
      mileage: 84_000,
    })
  })

  it('uses case-sensitive VIN precedence without overwriting deduplicated identity metadata', async () => {
    const { customer, vehicle: vinVehicle } = await insertCustomerAndVehicle({
      phone: '555-1234',
      vin: '1FTEW1EP5JFC10001',
      plate: 'OLD123',
      mileage: 40_000,
    })
    await db.insert(vehicles).values({
      id: uuid(31),
      customerId: customer.id,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
      engine: null,
      vin: null,
      mileage: 20_000,
      plate: 'NEW123',
    })
    let mileageWrites = 0
    const { result } = await runIdentity(newVehicleInput({
      customer: { name: 'Changed Name', phone: '555-1234', email: null },
      vehicle: {
        year: 2018, make: 'Changed Make', model: 'Changed Model', engine: null,
        vin: '1FTEW1EP5JFC10001', mileage: 88_888, plate: 'NEW123',
      },
    }), {
      seams: { afterMileageWrite: async () => { mileageWrites += 1 } },
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        customerId: customer.id,
        vehicleId: vinVehicle.id,
        createdRows: { sessionIds: [], customerIds: [], vehicleIds: [] },
        mileageDisposition: { kind: 'updated', mileage: 88_888 },
      },
    })
    const [storedCustomer] = await db.select().from(customers).where(eq(customers.id, customer.id))
    const [storedVehicle] = await db.select().from(vehicles).where(eq(vehicles.id, vinVehicle.id))
    expect(storedCustomer).toMatchObject({ name: 'Ada Driver', email: 'ada@example.com' })
    expect(storedVehicle).toMatchObject({
      make: 'Honda', model: 'Civic', engine: '2.0L', vin: '1FTEW1EP5JFC10001',
      plate: 'OLD123', mileage: 88_888,
    })
    expect(mileageWrites).toBe(1)
  })

  it('uses exact year/make/model/plate only when VIN is blank', async () => {
    const { customer, vehicle } = await insertCustomerAndVehicle({
      phone: '555-1234',
      vin: null,
      plate: 'ABC123',
      year: 2018,
      make: 'Ford',
      model: 'F-150',
    })
    const { result } = await runIdentity(newVehicleInput({
      customer: { name: 'Ada Driver', phone: '555-1234', email: null },
      vehicle: {
        year: 2018, make: 'Ford', model: 'F-150', engine: null,
        vin: null, mileage: null, plate: 'ABC123',
      },
    }))

    expect(result).toMatchObject({
      ok: true,
      value: {
        customerId: customer.id,
        vehicleId: vehicle.id,
        createdRows: { sessionIds: [], customerIds: [], vehicleIds: [] },
        mileageDisposition: { kind: 'preserved', mileage: 42_000 },
      },
    })
    expect(await db.select().from(vehicles)).toHaveLength(1)
  })

  it('always preallocates a new vehicle when neither VIN nor plate is nonblank', async () => {
    const { customer, vehicle } = await insertCustomerAndVehicle({
      phone: '555-1234',
      vin: null,
      plate: null,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
    })
    const { result } = await runIdentity(newVehicleInput({
      customer: { name: 'Ada Driver', phone: '555-1234', email: null },
      vehicle: {
        year: 2018, make: 'Ford', model: 'F-150', engine: null,
        vin: null, mileage: null, plate: null,
      },
    }))

    expect(result).toMatchObject({
      ok: true,
      value: {
        customerId: customer.id,
        createdRows: { sessionIds: [], customerIds: [], vehicleIds: [expect.any(String)] },
        mileageDisposition: { kind: 'inserted', mileage: null },
      },
    })
    if (!result.ok || !('value' in result)) throw new Error('identity materialization failed')
    expect(result.value.vehicleId).not.toBe(vehicle.id)
    expect(await db.select().from(vehicles)).toHaveLength(2)
  })

  it('fails closed on duplicate customer or vehicle natural-key sets', async () => {
    await db.insert(customers).values([
      { id: uuid(20), shopId, name: 'One', phone: '555-1234' },
      { id: uuid(21), shopId, name: 'Two', phone: '555-1234' },
    ])
    const customerAmbiguous = await runIdentity(newVehicleInput())
    expect(customerAmbiguous.result).toEqual({ ok: false, error: 'identity_ambiguous' })
    expect(await db.select().from(vehicles)).toEqual([])

    await db.delete(customers)
    const [customer] = await db.insert(customers).values({
      id: uuid(22), shopId, name: 'One', phone: '555-1234',
    }).returning()
    await db.insert(vehicles).values([
      {
        id: uuid(30), customerId: customer.id, year: 2018, make: 'Ford', model: 'F-150',
        engine: null, vin: '1FTEW1EP5JFC10001', mileage: null, plate: null,
      },
      {
        id: uuid(31), customerId: customer.id, year: 2019, make: 'Ford', model: 'Ranger',
        engine: null, vin: '1FTEW1EP5JFC10001', mileage: null, plate: null,
      },
    ])
    const vehicleAmbiguous = await runIdentity(newVehicleInput())
    expect(vehicleAmbiguous.result).toEqual({ ok: false, error: 'identity_ambiguous' })
    expect(await db.select().from(vehicles)).toHaveLength(2)
  })

  it('detects a customer natural-key set change before any identity write', async () => {
    const { result } = await runIdentity(newVehicleInput(), {
      afterPreflight: async (tx) => {
        await tx.insert(customers).values({
          id: uuid(25), shopId, name: 'Rival', phone: '555-1234',
        })
      },
    })

    expect(result).toEqual({ ok: false, error: 'identity_drift' })
    expect(await db.select().from(customers)).toMatchObject([
      { id: uuid(25), name: 'Rival', phone: '555-1234' },
    ])
    expect(await db.select().from(vehicles)).toEqual([])
  })

  it('detects a vehicle natural-key set change before any identity write', async () => {
    const [customer] = await db.insert(customers).values({
      id: uuid(20), shopId, name: 'Ada', phone: '555-1234',
    }).returning()
    const { result } = await runIdentity(newVehicleInput({
      customer: { name: 'Ada', phone: '555-1234', email: null },
    }), {
      afterPreflight: async (tx) => {
        await tx.insert(vehicles).values({
          id: uuid(35), customerId: customer.id, year: 2018,
          make: 'Ford', model: 'F-150', engine: null,
          vin: '1FTEW1EP5JFC10001', mileage: null, plate: null,
        })
      },
    })

    expect(result).toEqual({ ok: false, error: 'identity_drift' })
    expect(await db.select().from(customers)).toHaveLength(1)
    expect(await db.select().from(vehicles)).toMatchObject([{ id: uuid(35) }])
  })

  it('keeps 2+ post-preflight matches ambiguous and writes nothing planned', async () => {
    const { result } = await runIdentity(newVehicleInput(), {
      afterPreflight: async (tx) => {
        await tx.insert(customers).values([
          { id: uuid(25), shopId, name: 'Rival A', phone: '555-1234' },
          { id: uuid(26), shopId, name: 'Rival B', phone: '555-1234' },
        ])
      },
    })

    expect(result).toEqual({ ok: false, error: 'identity_ambiguous' })
    expect(await db.select().from(customers)).toHaveLength(2)
    expect(await db.select().from(vehicles)).toEqual([])
  })

  it('preserves null/omitted mileage, skips unchanged writes, and updates changed mileage once', async () => {
    const cases = [
      { suffix: 30, mileage: undefined, expectedKind: 'preserved', expected: 42_000, writes: 0 },
      { suffix: 31, mileage: null, expectedKind: 'preserved', expected: 42_000, writes: 0 },
      { suffix: 32, mileage: 42_000, expectedKind: 'preserved', expected: 42_000, writes: 0 },
      { suffix: 33, mileage: 43_210, expectedKind: 'updated', expected: 43_210, writes: 1 },
    ] as const
    for (const testCase of cases) {
      const { vehicle } = await insertCustomerAndVehicle({
        customerId: uuid(100 + testCase.suffix),
        vehicleId: uuid(testCase.suffix),
        phone: `555-${testCase.suffix}`,
      })
      let writes = 0
      const input: TicketIntakeIdentityInputV1 = {
        mode: 'existing_vehicle',
        shopId,
        existingVehicleId: vehicle.id,
        ...(testCase.mileage === undefined ? {} : { mileage: testCase.mileage }),
      }
      const { result } = await runIdentity(input, {
        seams: { afterMileageWrite: async () => { writes += 1 } },
      })
      expect(result).toMatchObject({
        ok: true,
        value: {
          mileageDisposition: { kind: testCase.expectedKind, mileage: testCase.expected },
        },
      })
      expect(writes).toBe(testCase.writes)
      const [persisted] = await db.select().from(vehicles).where(eq(vehicles.id, vehicle.id))
      expect(persisted.mileage).toBe(testCase.expected)
    }
  })

  it.each(['customer', 'vehicle', 'mileage'] as const)(
    'rolls back every identity write when the %s post-write seam fails',
    async (stage) => {
      const fail = async () => { throw new Error(`after_${stage}`) }
      if (stage === 'mileage') {
        const { vehicle } = await insertCustomerAndVehicle()
        await expect(runIdentity({
          mode: 'existing_vehicle', shopId, existingVehicleId: vehicle.id, mileage: 99_999,
        }, { seams: { afterMileageWrite: fail } })).rejects.toThrow('after_mileage')
        const [persisted] = await db.select().from(vehicles).where(eq(vehicles.id, vehicle.id))
        expect(persisted.mileage).toBe(42_000)
        return
      }

      await expect(runIdentity(newVehicleInput(), {
        seams: stage === 'customer'
          ? { afterCustomerInsert: fail }
          : { afterVehicleInsert: fail },
      })).rejects.toThrow(`after_${stage}`)
      expect(await db.select().from(customers)).toEqual([])
      expect(await db.select().from(vehicles)).toEqual([])
    },
  )

  it('rejects forged, prior-attempt, and extra-intent handles without an identity write', async () => {
    let staleResolved: ResolvedTicketIntakeIdentityV1 | undefined
    const first = await runIdentity(newVehicleInput({
      customer: { name: 'First', phone: '555-1000', email: null },
      vehicle: { year: 2020, make: 'A', model: 'One', engine: null, vin: null, mileage: null, plate: null },
    }))
    staleResolved = first.resolved

    await expect(runBoundedShopOsMutationV1(db, {
      discover: async (_tx, _attempt) => ({
        lockRequest: lockRequestFor(null),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        await expect(materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          Object.freeze(Object.create(null)) as ResolvedTicketIntakeIdentityV1,
        )).rejects.toThrow('ticket_intake_identity_invalid')
        await expect(materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          staleResolved!,
        )).rejects.toThrow('ticket_intake_identity_invalid')
        return 'rejected'
      },
    })).resolves.toBe('rejected')

    await expect(runIdentity(newVehicleInput({
      customer: { name: 'Second', phone: '555-2000', email: null },
      vehicle: { year: 2021, make: 'B', model: 'Two', engine: null, vin: null, mileage: null, plate: null },
    }), {
      transformRequest: (request) => ({
        ...request,
        insertionIntents: {
          ...request.insertionIntents,
          customers: [
            ...request.insertionIntents.customers,
            { id: uuid(90), shopId },
          ],
        },
      }),
    })).rejects.toThrow('ticket_intake_identity_invalid')

    const persisted = await db.select().from(customers)
    expect(persisted.map(({ phone }) => phone)).toEqual(['555-1000'])
  })

  it('returns a deeply frozen lock-plan copy that caller mutation cannot alter', async () => {
    let observedPlan: TicketIntakeIdentityLockPlanV1 | undefined
    const { result } = await runIdentity(newVehicleInput(), {
      afterPreflight: async (_tx, lockPlan) => {
        observedPlan = lockPlan
        expect(Object.isFrozen(lockPlan)).toBe(true)
        expect(Object.isFrozen(lockPlan.customerIds)).toBe(true)
        expect(Object.isFrozen(lockPlan.vehicleIds)).toBe(true)
        expect(Object.isFrozen(lockPlan.insertionIntents)).toBe(true)
        expect(Object.isFrozen(lockPlan.insertionIntents.customers)).toBe(true)
        expect(Object.isFrozen(lockPlan.insertionIntents.customers[0])).toBe(true)
        expect(Object.isFrozen(lockPlan.insertionIntents.vehicles)).toBe(true)
        expect(Object.isFrozen(lockPlan.insertionIntents.vehicles[0])).toBe(true)
        expect(() => {
          ;(lockPlan.insertionIntents.customers as Array<{ id: string; shopId: string }>)[0]!.id = uuid(90)
        }).toThrow()
      },
    })

    expect(result).toMatchObject({ ok: true })
    if (!result.ok || !('lockPlan' in result)) throw new Error('identity materialization failed')
    expect(result.lockPlan).toBe(observedPlan)
    expect(result.lockPlan.insertionIntents.customers[0]!.id).not.toBe(uuid(90))
  })

  it.each(['missing_intent', 'parent_mismatch', 'wrong_locked_ids'] as const)(
    'rejects a %s scope before any planned identity write',
    async (variant) => {
      const existing = variant === 'wrong_locked_ids'
        ? await insertCustomerAndVehicle({
            customerId: uuid(50), vehicleId: uuid(51), phone: '555-5000',
          })
        : null
      const input = variant === 'wrong_locked_ids'
        ? {
            mode: 'existing_vehicle' as const,
            shopId,
            existingVehicleId: existing!.vehicle.id,
          }
        : newVehicleInput()
      await expect(runIdentity(input, {
        transformRequest: (request) => {
          if (variant === 'missing_intent') {
            return {
              ...request,
              insertionIntents: { ...request.insertionIntents, vehicles: [] },
            }
          }
          if (variant === 'parent_mismatch') {
            const otherCustomerId = uuid(91)
            return {
              ...request,
              insertionIntents: {
                ...request.insertionIntents,
                customers: [
                  ...request.insertionIntents.customers,
                  { id: otherCustomerId, shopId },
                ],
                vehicles: request.insertionIntents.vehicles.map((intent) => ({
                  ...intent,
                  customerId: otherCustomerId,
                })),
              },
            }
          }
          return {
            ...request,
            customerIds: [],
            vehicleIds: [],
          }
        },
      })).rejects.toThrow()

      if (variant === 'wrong_locked_ids') {
        expect(await db.select().from(customers)).toHaveLength(1)
        expect(await db.select().from(vehicles)).toHaveLength(1)
      } else {
        expect(await db.select().from(customers)).toEqual([])
        expect(await db.select().from(vehicles)).toEqual([])
      }
    },
  )

  it('rejects live wrong-shop scope and cross-transaction materialized consumption', async () => {
    const otherShopId = uuid(2)
    const otherActorId = uuid(12)
    await db.insert(shops).values({ id: otherShopId, name: 'South Shop' })
    await db.insert(profiles).values({
      id: otherActorId, userId: uuid(13), shopId: otherShopId,
      role: 'owner', fullName: 'Other Owner',
    })

    await expect(runBoundedShopOsMutationV1(db, {
      discover: async (tx, attempt) => {
        const preflight = await preflightTicketIntakeIdentityV1(
          tx,
          attempt.capability,
          newVehicleInput(),
        )
        if (!preflight.ok) throw new Error('preflight failed')
        return {
          lockRequest: {
            ...lockRequestFor(null),
            shopId: otherShopId,
            actorProfileId: otherActorId,
            profileIds: [otherActorId],
            lockShop: true,
          },
          payload: preflight.identity,
        }
      },
      executeLocked: async (tx, scope, identity) =>
        materializeTicketIntakeIdentityInLockedScopeV1(tx, scope, identity),
    })).rejects.toThrow('ticket_intake_identity_invalid')

    const successful = await runIdentity(newVehicleInput())
    await expect(runBoundedShopOsMutationV1(db, {
      discover: async () => ({ lockRequest: lockRequestFor(null), payload: undefined }),
      executeLocked: async (tx, scope) => {
        expect(() => consumeMaterializedTicketIntakeIdentityForCreationV1(
          tx,
          scope,
          successful.materialized!,
        )).toThrow('ticket_intake_identity_invalid')
        return 'rejected'
      },
    })).resolves.toBe('rejected')
  })
})
