import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { createProfile, createShop, listSessionsForVehicle } from '@/lib/db/queries'
import { customers, sessions, vehicles } from '@/lib/db/schema'

async function seedVehicleWithSessions(db: TestDb) {
  const shop = await createShop(db, { name: 'Test Shop' })
  const tech = await createProfile(db, {
    userId: crypto.randomUUID(),
    shopId: shop.id,
  })
  const [customer] = await db
    .insert(customers)
    .values({ shopId: shop.id, name: 'Jane Doe', phone: '555-0100' })
    .returning()
  const [vehicle] = await db
    .insert(vehicles)
    .values({
      customerId: customer.id,
      year: 2018,
      make: 'Toyota',
      model: 'Camry',
      vin: '4T1B11HK7JU000001',
      plate: 'ABC123',
    })
    .returning()

  const t0 = new Date('2026-01-01T10:00:00Z')
  const t1 = new Date('2026-02-01T10:00:00Z')
  const t2 = new Date('2026-03-01T10:00:00Z')

  const baseIntake = {
    vehicleYear: 2018,
    vehicleMake: 'Toyota',
    vehicleModel: 'Camry',
    customerComplaint: 'rough idle',
  }
  const baseTree = {
    nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' as const }],
    currentNodeId: 'root',
    message: 'go',
  }

  // Insert oldest first to prove ordering is driven by createdAt, not insertion order.
  await db.insert(sessions).values([
    {
      shopId: shop.id,
      techId: tech.id,
      vehicleId: vehicle.id,
      intake: baseIntake,
      treeState: baseTree,
      createdAt: t0,
    },
    {
      shopId: shop.id,
      techId: tech.id,
      vehicleId: vehicle.id,
      intake: baseIntake,
      treeState: baseTree,
      createdAt: t2,
    },
    {
      shopId: shop.id,
      techId: tech.id,
      vehicleId: vehicle.id,
      intake: baseIntake,
      treeState: baseTree,
      createdAt: t1,
    },
  ])

  return { shop, vehicle, t0, t1, t2 }
}

describe('listSessionsForVehicle', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns all sessions for the vehicle ordered by createdAt DESC', async () => {
    const { vehicle, t0, t1, t2 } = await seedVehicleWithSessions(db)

    const rows = await listSessionsForVehicle(db, vehicle.id)

    expect(rows.map((r) => new Date(r.createdAt).toISOString())).toEqual([
      t2.toISOString(),
      t1.toISOString(),
      t0.toISOString(),
    ])
  })

  it('returns an empty array for a vehicle with no sessions', async () => {
    await seedVehicleWithSessions(db)
    const unknownVehicleId = '00000000-0000-0000-0000-000000000abc'

    const rows = await listSessionsForVehicle(db, unknownVehicleId)

    expect(rows).toEqual([])
  })
})
