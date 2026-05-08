import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { customers, profiles, sessions, shops, vehicles } from '@/lib/db/schema'
import { createSessionFromIntake } from '@/lib/intake/session'
import { eq } from 'drizzle-orm'

describe('createSessionFromIntake', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let advisorProfileId: string

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop] = await db.insert(shops).values({ name: 'Shop' }).returning()
    shopId = shop.id
    const [profile] = await db
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000001',
        role: 'owner',
        shopId,
        fullName: 'Owner',
      })
      .returning()
    advisorProfileId = profile.id
  })

  afterEach(async () => {
    await close()
  })

  it('creates customer + vehicle + session in one transaction', async () => {
    const result = await createSessionFromIntake(db, {
      shopId,
      advisorProfileId,
      customer: { name: 'Maria Lopez', phone: '555-1234', email: 'maria@example.com' },
      vehicle: {
        year: 2018,
        make: 'Ford',
        model: 'F-150',
        engine: '3.5L',
        vin: '1FTEW1EP5JFC10001',
        mileage: 84000,
        plate: 'ABC123',
      },
      complaint: {
        description: 'Loss of power on hills',
        whenStarted: '2 weeks ago',
        howOften: 'Daily',
        authorized: 'Diagnostic only',
      },
    })

    expect(result.sessionId).toBeTruthy()

    const customerRows = await db.select().from(customers)
    expect(customerRows).toHaveLength(1)
    expect(customerRows[0].name).toBe('Maria Lopez')

    const vehicleRows = await db.select().from(vehicles)
    expect(vehicleRows).toHaveLength(1)
    expect(vehicleRows[0].customerId).toBe(customerRows[0].id)

    const sessionRows = await db.select().from(sessions).where(eq(sessions.id, result.sessionId))
    expect(sessionRows).toHaveLength(1)
    expect(sessionRows[0].vehicleId).toBe(vehicleRows[0].id)
    expect(sessionRows[0].shopId).toBe(shopId)
    expect(sessionRows[0].techId).toBe(advisorProfileId)
    expect(sessionRows[0].status).toBe('open')
    expect(sessionRows[0].intake.customerComplaint).toBe('Loss of power on hills')
    expect(sessionRows[0].intake.vehicleYear).toBe(2018)
  })

  it('reuses existing customer + vehicle when phone + VIN match', async () => {
    await createSessionFromIntake(db, {
      shopId,
      advisorProfileId,
      customer: { name: 'Maria Lopez', phone: '555-1234', email: null },
      vehicle: {
        year: 2018,
        make: 'Ford',
        model: 'F-150',
        engine: null,
        vin: '1FTEW1EP5JFC10001',
        mileage: 84000,
        plate: null,
      },
      complaint: { description: 'first visit', whenStarted: '', howOften: '', authorized: '' },
    })
    await createSessionFromIntake(db, {
      shopId,
      advisorProfileId,
      customer: { name: 'Maria Lopez', phone: '555-1234', email: null },
      vehicle: {
        year: 2018,
        make: 'Ford',
        model: 'F-150',
        engine: null,
        vin: '1FTEW1EP5JFC10001',
        mileage: 85000,
        plate: null,
      },
      complaint: { description: 'second visit', whenStarted: '', howOften: '', authorized: '' },
    })

    expect(await db.select().from(customers)).toHaveLength(1)
    expect(await db.select().from(vehicles)).toHaveLength(1)
    expect(await db.select().from(sessions)).toHaveLength(2)
  })

  it('creates a second vehicle for the same customer (multi-vehicle case)', async () => {
    await createSessionFromIntake(db, {
      shopId,
      advisorProfileId,
      customer: { name: 'Maria Lopez', phone: '555-1234', email: null },
      vehicle: {
        year: 2018,
        make: 'Ford',
        model: 'F-150',
        engine: null,
        vin: '1FTEW1EP5JFC10001',
        mileage: 84000,
        plate: null,
      },
      complaint: { description: 'truck visit', whenStarted: '', howOften: '', authorized: '' },
    })
    await createSessionFromIntake(db, {
      shopId,
      advisorProfileId,
      customer: { name: 'Maria Lopez', phone: '555-1234', email: null },
      vehicle: {
        year: 2021,
        make: 'Toyota',
        model: 'Camry',
        engine: null,
        vin: '4T1G11AK0NU666001',
        mileage: 22000,
        plate: null,
      },
      complaint: { description: 'camry visit', whenStarted: '', howOften: '', authorized: '' },
    })

    expect(await db.select().from(customers)).toHaveLength(1)
    expect(await db.select().from(vehicles)).toHaveLength(2)
    expect(await db.select().from(sessions)).toHaveLength(2)
  })
})
