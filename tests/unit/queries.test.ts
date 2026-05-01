import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  getShopById,
  createProfile,
  getProfileByUserId,
  createSession,
  getSessionById,
} from '@/lib/db/queries'

describe('shops queries', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('createShop persists a shop with the given name', async () => {
    const shop = await createShop(db, { name: "Joe's Garage" })
    expect(shop.name).toBe("Joe's Garage")
  })

  it('getShopById returns the shop matching the given id', async () => {
    const created = await createShop(db, { name: 'Test Shop' })
    const fetched = await getShopById(db, created.id)
    expect(fetched?.name).toBe('Test Shop')
  })
})

describe('profiles queries', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('createProfile persists a profile with the given user_id', async () => {
    const userId = crypto.randomUUID()
    const profile = await createProfile(db, { user_id: userId })
    expect(profile.user_id).toBe(userId)
  })

  it('getProfileByUserId returns the profile matching the given user_id', async () => {
    const userId = crypto.randomUUID()
    await createProfile(db, { user_id: userId, full_name: 'Mike Smith' })
    const fetched = await getProfileByUserId(db, userId)
    expect(fetched?.full_name).toBe('Mike Smith')
  })
})

describe('sessions queries', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('createSession persists a session and roundtrips its intake payload', async () => {
    const shop = await createShop(db, { name: 'Test Shop' })
    const tech = await createProfile(db, {
      user_id: crypto.randomUUID(),
      shop_id: shop.id,
    })
    const session = await createSession(db, {
      shopId: shop.id,
      techId: tech.id,
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'loss of power on hills',
      },
      treeState: { nodes: [], currentNodeId: 'root' },
    })
    expect(session.intake.vehicleMake).toBe('Ford')
  })

  it('getSessionById returns the session with eager-loaded shop and tech', async () => {
    const shop = await createShop(db, { name: "Joe's Garage" })
    const tech = await createProfile(db, {
      user_id: crypto.randomUUID(),
      shop_id: shop.id,
      full_name: 'Mike Smith',
    })
    const created = await createSession(db, {
      shopId: shop.id,
      techId: tech.id,
      intake: {
        vehicleYear: 2020,
        vehicleMake: 'Toyota',
        vehicleModel: 'Camry',
        customerComplaint: 'noise on braking',
      },
      treeState: { nodes: [], currentNodeId: 'root' },
    })
    const fetched = await getSessionById(db, created.id)
    expect(fetched?.shop.name).toBe("Joe's Garage")
    expect(fetched?.tech.full_name).toBe('Mike Smith')
  })
})
