import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { shopEntitlements, stripeCustomers, type Profile } from '@/lib/db/schema'

// Integration-style gate test: Counter search runs with the REAL base-access
// gate against pglite while diagnostic entitlement remains irrelevant.
const dbRef = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/lib/db/client', () => ({
  get db() {
    return dbRef.current
  },
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))
vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
}))
vi.mock('@/lib/intake/search', () => ({
  searchIntake: vi.fn(async () => ({ customers: [], vehicles: [] })),
}))
vi.mock('@/lib/intake/recent-customers', () => ({
  getRecentIntakeCustomers: vi.fn(async () => []),
}))

import { POST } from '@/app/api/intake/search/route'
import { requireUserAndProfile } from '@/lib/auth'

const authMock = vi.mocked(requireUserAndProfile)

function req(body: unknown) {
  return new Request('http://localhost/api/intake/search', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('base access on /api/intake/search', () => {
  let db: TestDb
  let close: () => Promise<void>
  let profile: Profile
  let shopId: string

  beforeEach(async () => {
    vi.clearAllMocks()
    ;({ db, close } = await createTestDb())
    dbRef.current = db
    const shop = await createShop(db, { name: 'Gate Garage' })
    shopId = shop.id
    profile = await createProfile(db, {
      userId: crypto.randomUUID(),
      shopId: shop.id,
    })
    await db.insert(stripeCustomers).values({
      shopId: shop.id,
      stripeCustomerId: 'cus_gate',
      subscriptionStatus: 'active',
    })
    authMock.mockResolvedValue({
      profile,
      user: { id: profile.userId, email: 'tech@gate.test' },
    } as never)
  })

  afterEach(async () => {
    dbRef.current = null
    await close()
  })

  it('keeps Counter search available when diagnostics is explicitly false', async () => {
    await db.insert(shopEntitlements).values({ shopId, diagnostics: false })
    const res = await POST(req({ q: 'smith' }))
    expect(res.status).toBe(200)
  })

  it('passes an explicitly entitled shop', async () => {
    await db.insert(shopEntitlements).values({ shopId, diagnostics: true })
    const res = await POST(req({ q: 'smith' }))
    expect(res.status).toBe(200)
  })

  it('passes a paid shop with no entitlement row (grandfathered inert default)', async () => {
    const res = await POST(req({ q: 'smith' }))
    expect(res.status).toBe(200)
  })

  it('rejects a paywalled profile before Counter search', async () => {
    await db.delete(stripeCustomers)
    const res = await POST(req({ q: 'smith' }))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'paywall',
      reason: 'no_subscription',
    })
  })
})
