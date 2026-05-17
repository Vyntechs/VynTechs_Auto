import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { shops, sessions, repairOrders, customers, vehicles } from '@/lib/db/schema'
import { createSessionFromIntake } from '@/lib/intake/session'

const SAMPLE_INTAKE = {
  customer: { name: 'Jane Doe', phone: '5125550100', email: 'jane@example.com' },
  vehicle: {
    year: 2018,
    make: 'Ford',
    model: 'F-150',
    engine: '5.0L',
    vin: '1FTFW1E5XJFA00001',
    mileage: 78000,
    plate: 'TX-ABC-123',
  },
  complaint: {
    description: 'check engine light',
    whenStarted: 'last week',
    howOften: 'intermittent',
    authorized: 'yes',
  },
}

async function seedShopAndTech(db: TestDb, shopMgmtEnabled: boolean) {
  const shop = await createShop(db, { name: 'Test Shop' })
  if (shopMgmtEnabled) {
    await db.update(shops).set({ shopMgmtEnabled: true }).where(eq(shops.id, shop.id))
  }
  const tech = await createProfile(db, {
    userId: crypto.randomUUID(),
    shopId: shop.id,
  })
  return { shop, tech }
}

describe('createSessionFromIntake — shop-management foundation', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('creates no repair_orders row when shop_mgmt_enabled is false', async () => {
    const { shop, tech } = await seedShopAndTech(db, false)

    const { sessionId } = await createSessionFromIntake(db, {
      shopId: shop.id,
      advisorProfileId: tech.id,
      ...SAMPLE_INTAKE,
    })

    const allRos = await db.select().from(repairOrders)
    expect(allRos).toHaveLength(0)

    const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(s.repairOrderId).toBeNull()
  })

  it('creates a repair_orders row linked to the session when shop_mgmt_enabled is true', async () => {
    const { shop, tech } = await seedShopAndTech(db, true)

    const { sessionId } = await createSessionFromIntake(db, {
      shopId: shop.id,
      advisorProfileId: tech.id,
      ...SAMPLE_INTAKE,
    })

    const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(s.repairOrderId).not.toBeNull()

    const [ro] = await db.select().from(repairOrders).where(eq(repairOrders.id, s.repairOrderId!))
    expect(ro).toBeDefined()
    expect(ro.shopId).toBe(shop.id)
    expect(ro.status).toBe('open')
    expect(ro.openedBy).toBe(tech.id)
    expect(ro.closedAt).toBeNull()

    const [customer] = await db.select().from(customers).where(eq(customers.id, ro.customerId))
    expect(customer.phone).toBe('5125550100')
    const [vehicle] = await db.select().from(vehicles).where(eq(vehicles.id, ro.vehicleId))
    expect(vehicle.vin).toBe('1FTFW1E5XJFA00001')
  })

  it('persists customer_authorized on the session regardless of shop_mgmt_enabled', async () => {
    const { shop: shopOff, tech: techOff } = await seedShopAndTech(db, false)
    const { sessionId: idOff } = await createSessionFromIntake(db, {
      shopId: shopOff.id,
      advisorProfileId: techOff.id,
      ...SAMPLE_INTAKE,
    })
    const [sOff] = await db.select().from(sessions).where(eq(sessions.id, idOff))
    expect(sOff.customerAuthorized).toBe(true)

    const { shop: shopOn, tech: techOn } = await seedShopAndTech(db, true)
    const { sessionId: idOn } = await createSessionFromIntake(db, {
      shopId: shopOn.id,
      advisorProfileId: techOn.id,
      ...SAMPLE_INTAKE,
    })
    const [sOn] = await db.select().from(sessions).where(eq(sessions.id, idOn))
    expect(sOn.customerAuthorized).toBe(true)
  })

  it('stores customer_authorized as null when the intake form sent an empty/missing value', async () => {
    const { shop, tech } = await seedShopAndTech(db, false)

    const { sessionId } = await createSessionFromIntake(db, {
      shopId: shop.id,
      advisorProfileId: tech.id,
      ...SAMPLE_INTAKE,
      complaint: { ...SAMPLE_INTAKE.complaint, authorized: '' },
    })

    const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(s.customerAuthorized).toBeNull()
  })

  it('treats explicit "no" as customer_authorized = false', async () => {
    const { shop, tech } = await seedShopAndTech(db, false)

    const { sessionId } = await createSessionFromIntake(db, {
      shopId: shop.id,
      advisorProfileId: tech.id,
      ...SAMPLE_INTAKE,
      complaint: { ...SAMPLE_INTAKE.complaint, authorized: 'no' },
    })

    const [s] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(s.customerAuthorized).toBe(false)
  })
})
