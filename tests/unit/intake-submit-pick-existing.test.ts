import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { customers, profiles, sessions, shops, vehicles } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

let currentDb: TestDb
vi.mock('@/lib/db/client', () => ({
  db: new Proxy({} as TestDb, {
    get: (_t, prop) => {
      const value = (currentDb as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey]
      return typeof value === 'function' ? value.bind(currentDb) : value
    },
  }),
}))

vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
}))

vi.mock('@/lib/ai/tree-engine', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/tree-engine')>('@/lib/ai/tree-engine')
  return {
    ...actual,
    generateInitialTree: vi.fn().mockResolvedValue({
      nodes: [{ id: 'scan-codes', label: 'Pull DTCs', status: 'active' }],
      currentNodeId: 'scan-codes',
      message: 'pull codes',
    }),
  }
})

vi.mock('@/lib/corpus/retrieval', async () => {
  const actual = await vi.importActual<typeof import('@/lib/corpus/retrieval')>('@/lib/corpus/retrieval')
  return {
    ...actual,
    retrieveCorpus: vi.fn().mockResolvedValue([]),
  }
})

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/intake/submit', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/intake/submit — pick-existing path', () => {
  let close: () => Promise<void>
  let shopId: string
  let ownerProfileId: string

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close

    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    shopId = shop.id
    const [profile] = await currentDb
      .insert(profiles)
      .values({
        userId: crypto.randomUUID(),
        role: 'owner',
        shopId,
        fullName: 'Owner',
        // isComp:true bypasses the Stripe paywall check; the unit test is
        // about the pick-existing intake flow, not billing.
        isComp: true,
      })
      .returning()
    ownerProfileId = profile.id

    const { requireUserAndProfile } = await import('@/lib/auth')
    vi.mocked(requireUserAndProfile).mockResolvedValue({
      user: { id: profile.userId, email: 'owner@shop.test' },
      profile,
    })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('creates a session attached to the existing vehicle without inserting new customer/vehicle rows', async () => {
    const [c] = await currentDb
      .insert(customers)
      .values({ shopId, name: 'Existing', phone: '7705551234' })
      .returning()
    const [v] = await currentDb
      .insert(vehicles)
      .values({ customerId: c.id, year: 2018, make: 'Ford', model: 'F-150' })
      .returning()
    const customerCountBefore = (await currentDb.select().from(customers)).length
    const vehicleCountBefore = (await currentDb.select().from(vehicles)).length

    const { POST } = await import('@/app/api/intake/submit/route')
    const res = await POST(
      makeReq({
        existingVehicleId: v.id,
        complaint: { description: 'engine noise' },
      }),
    )

    expect(res.status).toBe(201)
    const body = (await res.json()) as { sessionId: string }
    expect(body.sessionId).toBeTruthy()

    expect((await currentDb.select().from(customers)).length).toBe(customerCountBefore)
    expect((await currentDb.select().from(vehicles)).length).toBe(vehicleCountBefore)

    const [created] = await currentDb
      .select()
      .from(sessions)
      .where(eq(sessions.id, body.sessionId))
    expect(created.vehicleId).toBe(v.id)
    expect(created.techId).toBe(ownerProfileId)
  })

  it('updates existing vehicle.mileage when one is provided on a pick-existing submit', async () => {
    const [c] = await currentDb.insert(customers).values({ shopId, name: 'X', phone: '0' }).returning()
    const [v] = await currentDb
      .insert(vehicles)
      .values({ customerId: c.id, year: 2018, make: 'Ford', model: 'F-150', mileage: 90000 })
      .returning()

    const { POST } = await import('@/app/api/intake/submit/route')
    await POST(
      makeReq({
        existingVehicleId: v.id,
        complaint: { description: 'd' },
        vehicle: { mileage: '104500' },
      }),
    )

    const [u] = await currentDb.select().from(vehicles).where(eq(vehicles.id, v.id))
    expect(u.mileage).toBe(104500)
  })

  it('rejects existingVehicleId from a different shop with 403', async () => {
    const [otherShop] = await currentDb.insert(shops).values({ name: 'Other' }).returning()
    const [otherCustomer] = await currentDb
      .insert(customers)
      .values({ shopId: otherShop.id, name: 'Outside', phone: '0' })
      .returning()
    const [otherVehicle] = await currentDb
      .insert(vehicles)
      .values({ customerId: otherCustomer.id, year: 2018, make: 'Ford', model: 'F-150' })
      .returning()

    const { POST } = await import('@/app/api/intake/submit/route')
    const res = await POST(
      makeReq({
        existingVehicleId: otherVehicle.id,
        complaint: { description: 'd' },
      }),
    )
    expect(res.status).toBe(403)
  })

  it('returns 404 when existingVehicleId references a missing row', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const res = await POST(
      makeReq({
        existingVehicleId: '00000000-0000-0000-0000-000000000001',
        complaint: { description: 'd' },
      }),
    )
    expect(res.status).toBe(404)
  })

  it('returns 422 when neither existingVehicleId nor manual fields are provided', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const res = await POST(makeReq({ complaint: { description: 'something' } }))
    expect(res.status).toBe(422)
  })

  it('still accepts the original manual-entry body unchanged (backwards-compat)', async () => {
    const { POST } = await import('@/app/api/intake/submit/route')
    const res = await POST(
      makeReq({
        customer: { name: 'New', phone: '7705550001' },
        vehicle: { year: '2020', make: 'Honda', model: 'Civic', vin: 'VIN12345678901234' },
        complaint: { description: 'oil change' },
      }),
    )
    expect(res.status).toBe(201)
    const all = await currentDb.select().from(customers)
    expect(all.some((c) => c.name === 'New')).toBe(true)
  })
})
