import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { customers, vehicles, sessions, shops, profiles } from '@/lib/db/schema'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'

let db: TestDb
let close: () => Promise<void>

const EMPTY_TREE = { nodes: [], currentNodeId: '', message: '' }

async function seedShopAndTech(label: string) {
  const [shop] = await db.insert(shops).values({ name: 'Shop ' + label }).returning()
  const [tech] = await db
    .insert(profiles)
    .values({
      userId: crypto.randomUUID(),
      shopId: shop.id,
      fullName: 'Tech',
      role: 'tech',
    })
    .returning()
  return { shop, tech }
}

async function seedCustomerVehicleSession(opts: {
  shopId: string
  techId: string
  customerName: string
  customerPhone?: string
  hoursAgo: number
}) {
  const [customer] = await db
    .insert(customers)
    .values({ shopId: opts.shopId, name: opts.customerName, phone: opts.customerPhone ?? '0000000000' })
    .returning()
  const [vehicle] = await db
    .insert(vehicles)
    .values({ customerId: customer.id, year: 2018, make: 'Ford', model: 'F-150' })
    .returning()
  const createdAt = new Date(Date.now() - opts.hoursAgo * 60 * 60 * 1000)
  await db.insert(sessions).values({
    shopId: opts.shopId,
    techId: opts.techId,
    vehicleId: vehicle.id,
    status: 'open',
    intake: {
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'test',
    },
    treeState: EMPTY_TREE,
    createdAt,
  })
  return { customer, vehicle }
}

describe('getRecentIntakeCustomers', () => {
  beforeEach(async () => {
    const created = await createTestDb()
    db = created.db
    close = created.close
  })
  afterEach(async () => {
    await close()
  })

  it('returns customers with sessions in the last 12 hours, newest first', async () => {
    const { shop, tech } = await seedShopAndTech('a')
    await seedCustomerVehicleSession({ shopId: shop.id, techId: tech.id, customerName: 'Sandoval', hoursAgo: 1 })
    await seedCustomerVehicleSession({ shopId: shop.id, techId: tech.id, customerName: 'Mendez', hoursAgo: 6 })
    await seedCustomerVehicleSession({ shopId: shop.id, techId: tech.id, customerName: 'Park', hoursAgo: 24 })

    const result = await getRecentIntakeCustomers({
      db,
      shopId: shop.id,
      withinHours: 12,
      limit: 8,
    })

    expect(result.map((c) => c.name)).toEqual(['Sandoval', 'Mendez'])
  })

  it('scopes by shopId — never returns rows from other shops', async () => {
    const { shop: shopA, tech: techA } = await seedShopAndTech('a')
    const { shop: shopB, tech: techB } = await seedShopAndTech('b')
    await seedCustomerVehicleSession({ shopId: shopA.id, techId: techA.id, customerName: 'In-shop', hoursAgo: 1 })
    await seedCustomerVehicleSession({ shopId: shopB.id, techId: techB.id, customerName: 'Other-shop', hoursAgo: 1 })

    const result = await getRecentIntakeCustomers({
      db,
      shopId: shopA.id,
      withinHours: 12,
      limit: 8,
    })

    expect(result.map((c) => c.name)).toEqual(['In-shop'])
  })

  it('respects limit', async () => {
    const { shop, tech } = await seedShopAndTech('a')
    for (let i = 0; i < 12; i++) {
      await seedCustomerVehicleSession({
        shopId: shop.id,
        techId: tech.id,
        customerName: `Customer ${i}`,
        customerPhone: `555555${String(i).padStart(4, '0')}`,
        hoursAgo: i * 0.5,
      })
    }
    const result = await getRecentIntakeCustomers({
      db,
      shopId: shop.id,
      withinHours: 12,
      limit: 5,
    })
    expect(result).toHaveLength(5)
  })

  it('returns an empty array when the shop has no recent sessions', async () => {
    const { shop } = await seedShopAndTech('empty')
    const result = await getRecentIntakeCustomers({
      db,
      shopId: shop.id,
      withinHours: 12,
      limit: 8,
    })
    expect(result).toEqual([])
  })

  it('returns vehicleCount per customer (counts all vehicles, not just the one in the session)', async () => {
    const { shop, tech } = await seedShopAndTech('a')
    const { customer } = await seedCustomerVehicleSession({
      shopId: shop.id,
      techId: tech.id,
      customerName: 'Sandoval',
      hoursAgo: 1,
    })
    await db.insert(vehicles).values({ customerId: customer.id, year: 2019, make: 'Honda', model: 'Pilot' })

    const result = await getRecentIntakeCustomers({
      db,
      shopId: shop.id,
      withinHours: 12,
      limit: 8,
    })
    expect(result[0].vehicleCount).toBe(2)
  })
})
