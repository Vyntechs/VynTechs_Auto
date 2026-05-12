import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { customers, vehicles, sessions, shops, profiles } from '@/lib/db/schema'
import { searchIntake } from '@/lib/intake/search'

let db: TestDb
let close: () => Promise<void>

const EMPTY_TREE = { nodes: [], currentNodeId: '', message: '' }

async function seedShop(label: string) {
  const [shop] = await db.insert(shops).values({ name: 'Shop ' + label }).returning()
  const [tech] = await db
    .insert(profiles)
    .values({ userId: crypto.randomUUID(), shopId: shop.id, fullName: 'Tech', role: 'tech' })
    .returning()
  return { shop, tech }
}

async function seed(label = 'a') {
  const { shop, tech } = await seedShop(label)
  const [sandoval] = await db
    .insert(customers)
    .values({ shopId: shop.id, name: 'Robert Sandoval', phone: '3035550142', email: 'rsandoval@example.com' })
    .returning()
  const [chen] = await db
    .insert(customers)
    .values({ shopId: shop.id, name: 'Robin Chen', phone: '7205559183' })
    .returning()
  const [sandovalBmw] = await db
    .insert(vehicles)
    .values({
      customerId: sandoval.id,
      year: 2014,
      make: 'BMW',
      model: '335i',
      vin: 'WBA3A5C50EJF12345',
      plate: 'ABC1234',
    })
    .returning()
  const [sandovalPilot] = await db
    .insert(vehicles)
    .values({ customerId: sandoval.id, year: 2019, make: 'Honda', model: 'Pilot' })
    .returning()
  const [chenF150] = await db
    .insert(vehicles)
    .values({ customerId: chen.id, year: 2018, make: 'Ford', model: 'F-150' })
    .returning()
  // Give sandoval the most recent session (recency tiebreak)
  await db.insert(sessions).values({
    shopId: shop.id,
    techId: tech.id,
    vehicleId: sandovalBmw.id,
    status: 'open',
    intake: { vehicleYear: 2014, vehicleMake: 'BMW', vehicleModel: '335i', customerComplaint: 't' },
    treeState: EMPTY_TREE,
  })
  return { shop, tech, sandoval, chen, sandovalBmw, sandovalPilot, chenF150 }
}

describe('searchIntake', () => {
  beforeEach(async () => {
    const created = await createTestDb()
    db = created.db
    close = created.close
  })
  afterEach(async () => {
    await close()
  })

  it('matches a name prefix in customers', async () => {
    const { shop } = await seed('a')
    const r = await searchIntake({ db, shopId: shop.id, q: 'Rob' })
    expect(r.customers.map((c) => c.name).sort()).toEqual(['Robert Sandoval', 'Robin Chen'].sort())
  })

  it('matches a phone substring', async () => {
    const { shop } = await seed('a')
    const r = await searchIntake({ db, shopId: shop.id, q: '5559183' })
    expect(r.customers.map((c) => c.name)).toEqual(['Robin Chen'])
  })

  it('matches a VIN fragment in vehicles, with owner inline', async () => {
    const { shop } = await seed('a')
    const r = await searchIntake({ db, shopId: shop.id, q: 'WBA3A5C50' })
    expect(r.vehicles).toHaveLength(1)
    expect(r.vehicles[0].vin).toBe('WBA3A5C50EJF12345')
    expect(r.vehicles[0].ownerName).toBe('Robert Sandoval')
  })

  it('multi-token: every token must match somewhere on each row', async () => {
    const { shop } = await seed('a')
    // "rob 335" — Robert/Robin owns BMW 335i; only the BMW satisfies both tokens
    const r = await searchIntake({ db, shopId: shop.id, q: 'rob 335' })
    expect(r.vehicles.map((v) => v.model)).toEqual(['335i'])
  })

  it('returns empty results for a query with no match', async () => {
    const { shop } = await seed('a')
    const r = await searchIntake({ db, shopId: shop.id, q: 'ZZZZZZZ' })
    expect(r.customers).toEqual([])
    expect(r.vehicles).toEqual([])
  })

  it('scopes by shopId — never returns rows from another shop', async () => {
    const { shop: shopA } = await seed('a')
    await seed('b')
    const r = await searchIntake({ db, shopId: shopA.id, q: 'Robin' })
    expect(r.customers).toHaveLength(1)
  })

  it('caps results at 5 per group', async () => {
    const { shop } = await seedShop('a')
    for (let i = 0; i < 10; i++) {
      await db.insert(customers).values({ shopId: shop.id, name: `Smith ${i}`, phone: `000000000${i}` })
    }
    const r = await searchIntake({ db, shopId: shop.id, q: 'Smith' })
    expect(r.customers).toHaveLength(5)
  })

  it('an empty query returns no rows (the caller handles empty=recents)', async () => {
    const { shop } = await seed('a')
    const r = await searchIntake({ db, shopId: shop.id, q: '' })
    expect(r.customers).toEqual([])
    expect(r.vehicles).toEqual([])
  })
})
