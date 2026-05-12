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

  it('embeds an empty vehicles array when the matched customer has 0 vehicles', async () => {
    const { shop } = await seedShop('zero')
    await db.insert(customers).values({
      shopId: shop.id, name: 'Solo Customer', phone: '5559001', email: null,
    })
    const r = await searchIntake({ db, shopId: shop.id, q: 'Solo' })
    expect(r.customers).toHaveLength(1)
    expect(r.customers[0].vehicles).toEqual([])
    expect(r.customers[0].vehicleCount).toBe(0)
  })

  it("embeds the customer's vehicles ordered by last_visit DESC, capped at 10", async () => {
    const { shop, tech } = await seedShop('multi')
    const [c] = await db
      .insert(customers)
      .values({ shopId: shop.id, name: 'Multi Customer', phone: '5559002', email: null })
      .returning()

    const seededVehicleIds: string[] = []
    for (let i = 0; i < 12; i += 1) {
      const [v] = await db
        .insert(vehicles)
        .values({ customerId: c.id, year: 2010 + i, make: 'Ford', model: `M${i}` })
        .returning()
      seededVehicleIds.push(v.id)
    }
    const intakePayload = {
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'M0', customerComplaint: 'noise',
    }
    for (let i = 0; i < 12; i += 1) {
      const createdAt = new Date(Date.now() - (12 - i) * 86_400_000)
      await db.insert(sessions).values({
        shopId: shop.id,
        techId: tech.id,
        vehicleId: seededVehicleIds[i],
        status: 'open',
        intake: intakePayload,
        treeState: EMPTY_TREE,
        createdAt,
      })
    }

    const r = await searchIntake({ db, shopId: shop.id, q: 'Multi' })
    expect(r.customers).toHaveLength(1)
    expect(r.customers[0].vehicleCount).toBe(12)
    expect(r.customers[0].vehicles).toHaveLength(10)
    expect(r.customers[0].vehicles[0].id).toBe(seededVehicleIds[11])
    expect(r.customers[0].vehicles[9].id).toBe(seededVehicleIds[2])
    expect(r.customers[0].vehicles.map((v) => v.id)).not.toContain(seededVehicleIds[0])
    expect(r.customers[0].vehicles.map((v) => v.id)).not.toContain(seededVehicleIds[1])
  })

  it("falls back to year DESC ordering when the customer has no sessions yet", async () => {
    const { shop } = await seedShop('fresh')
    const [c] = await db
      .insert(customers)
      .values({ shopId: shop.id, name: 'Fresh Customer', phone: '5559003', email: null })
      .returning()
    await db.insert(vehicles).values([
      { customerId: c.id, year: 2018, make: 'Honda', model: 'Civic' },
      { customerId: c.id, year: 2020, make: 'Honda', model: 'Accord' },
    ])
    const r = await searchIntake({ db, shopId: shop.id, q: 'Fresh' })
    expect(r.customers[0].vehicles).toHaveLength(2)
    expect(r.customers[0].vehicles[0].year).toBe(2020)
    expect(r.customers[0].vehicles[1].year).toBe(2018)
  })

  it('embedded vehicle shape matches CustomerVehicle (no ownerId / ownerName)', async () => {
    const { shop } = await seedShop('shape')
    const [c] = await db
      .insert(customers)
      .values({ shopId: shop.id, name: 'Shape Customer', phone: '5559004', email: null })
      .returning()
    await db.insert(vehicles).values({
      customerId: c.id,
      year: 2019, make: 'BMW', model: '335i', engine: 'N55',
      vin: '1FTEW1EP5JFC10001', plate: 'ABC123', mileage: 84000,
    })
    const r = await searchIntake({ db, shopId: shop.id, q: 'Shape' })
    const v = r.customers[0].vehicles[0]
    expect(v.id).toBeTruthy()
    expect(v.year).toBe(2019)
    expect(v.make).toBe('BMW')
    expect(v.model).toBe('335i')
    expect(v.engine).toBe('N55')
    expect(v.vin).toBe('1FTEW1EP5JFC10001')
    expect(v.plate).toBe('ABC123')
    expect(v.mileage).toBe(84000)
    expect(v.lastVisit).toBeNull()
    expect((v as unknown as { ownerId?: string }).ownerId).toBeUndefined()
    expect((v as unknown as { ownerName?: string }).ownerName).toBeUndefined()
  })
})
