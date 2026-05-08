import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { customers, shops, vehicles } from '@/lib/db/schema'
import { upsertVehicle } from '@/lib/intake/vehicles'

describe('upsertVehicle', () => {
  let db: TestDb
  let close: () => Promise<void>
  let customerAId: string
  let customerBId: string

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop] = await db.insert(shops).values({ name: 'Shop' }).returning()
    const [a] = await db
      .insert(customers)
      .values({ shopId: shop.id, name: 'A', phone: '555-0001', email: null })
      .returning()
    const [b] = await db
      .insert(customers)
      .values({ shopId: shop.id, name: 'B', phone: '555-0002', email: null })
      .returning()
    customerAId = a.id
    customerBId = b.id
  })

  afterEach(async () => {
    await close()
  })

  it('creates a new vehicle when VIN not seen for this customer', async () => {
    const result = await upsertVehicle(db, {
      customerId: customerAId,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
      engine: '3.5L EcoBoost',
      vin: '1FTEW1EP5JFC10001',
      mileage: 84000,
      plate: 'ABC123',
    })
    expect(result.id).toBeTruthy()
    expect(result.vin).toBe('1FTEW1EP5JFC10001')
  })

  it('reuses an existing vehicle when VIN matches within the same customer', async () => {
    const first = await upsertVehicle(db, {
      customerId: customerAId,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
      engine: null,
      vin: '1FTEW1EP5JFC10001',
      mileage: 84000,
      plate: null,
    })
    const second = await upsertVehicle(db, {
      customerId: customerAId,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
      engine: null,
      vin: '1FTEW1EP5JFC10001',
      mileage: 85000,
      plate: null,
    })
    expect(second.id).toBe(first.id)
    const allRows = await db.select().from(vehicles)
    expect(allRows).toHaveLength(1)
  })

  it('does not match VIN across different customers (per-customer isolation)', async () => {
    const inA = await upsertVehicle(db, {
      customerId: customerAId,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
      engine: null,
      vin: '1FTEW1EP5JFC10001',
      mileage: null,
      plate: null,
    })
    const inB = await upsertVehicle(db, {
      customerId: customerBId,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
      engine: null,
      vin: '1FTEW1EP5JFC10001',
      mileage: null,
      plate: null,
    })
    expect(inA.id).not.toBe(inB.id)
  })

  it('falls back to year+make+model+plate match when VIN is null', async () => {
    const first = await upsertVehicle(db, {
      customerId: customerAId,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
      engine: null,
      vin: null,
      mileage: null,
      plate: 'ABC123',
    })
    const second = await upsertVehicle(db, {
      customerId: customerAId,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
      engine: null,
      vin: null,
      mileage: null,
      plate: 'ABC123',
    })
    expect(second.id).toBe(first.id)
  })

  it('creates a new vehicle when VIN is null and no fallback match', async () => {
    const first = await upsertVehicle(db, {
      customerId: customerAId,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
      engine: null,
      vin: null,
      mileage: null,
      plate: 'ABC123',
    })
    const second = await upsertVehicle(db, {
      customerId: customerAId,
      year: 2021,
      make: 'Toyota',
      model: 'Camry',
      engine: null,
      vin: null,
      mileage: null,
      plate: 'XYZ789',
    })
    expect(second.id).not.toBe(first.id)
    const allRows = await db.select().from(vehicles)
    expect(allRows).toHaveLength(2)
  })
})
