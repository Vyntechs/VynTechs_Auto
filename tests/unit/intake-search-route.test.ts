import { describe, expect, it, beforeEach, vi } from 'vitest'

vi.mock('@/lib/intake/search', () => ({
  searchIntake: vi.fn(),
}))
vi.mock('@/lib/intake/recent-customers', () => ({
  getRecentIntakeCustomers: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))
// Stub the paywall check so the test exercises route logic only — the
// route's real paywall path is covered by auth-access.test.ts.
vi.mock('@/lib/auth-access', () => ({
  entitlementReject: vi.fn(async () => null),
}))

import { POST } from '@/app/api/intake/search/route'
import { searchIntake } from '@/lib/intake/search'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'
import { requireUserAndProfile } from '@/lib/auth'

const searchMock = vi.mocked(searchIntake)
const recentsMock = vi.mocked(getRecentIntakeCustomers)
const authMock = vi.mocked(requireUserAndProfile)

function req(body: unknown) {
  return new Request('http://localhost/api/intake/search', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const ownerProfile = {
  id: 'p1',
  userId: 'u1',
  shopId: 's1',
  fullName: 'Owner',
  role: 'owner',
  skillTier: null,
  membershipStatus: 'active' as const,
  membershipActivatedAt: new Date(),
  isComp: false,
  isCurator: false,
  lastSeenWhatsNewAt: null,
  deactivatedAt: null,
  createdAt: new Date(),
}

describe('POST /api/intake/search', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ profile: ownerProfile, user: { id: 'u1', email: 'o@shop.test' } })
  })

  it('returns search results for a non-empty query', async () => {
    searchMock.mockResolvedValue({
      customers: [{ id: 'c1', name: 'X', phone: null, email: null, vehicleCount: 0, vehicles: [], lastVisit: null }],
      vehicles: [],
    })
    const res = await POST(req({ q: 'smith' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.customers).toHaveLength(1)
    expect(typeof body.latencyMs).toBe('number')
    expect(searchMock).toHaveBeenCalledWith({ db: {}, shopId: 's1', q: 'smith' })
  })

  it('returns recent customers when q is empty', async () => {
    recentsMock.mockResolvedValue([
      { id: 'c1', name: 'Recent', phone: null, email: null, vehicleCount: 1, vehicles: [], lastVisit: new Date() },
    ])
    const res = await POST(req({ q: '' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.customers).toHaveLength(1)
    expect(body.vehicles).toEqual([])
    expect(recentsMock).toHaveBeenCalled()
    expect(searchMock).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    authMock.mockResolvedValue(null)
    const res = await POST(req({ q: 'smith' }))
    expect(res.status).toBe(401)
  })

  it('returns 403 when profile has no shopId', async () => {
    authMock.mockResolvedValue({
      profile: { ...ownerProfile, shopId: null },
      user: { id: 'u1', email: 'o@shop.test' },
    })
    const res = await POST(req({ q: 'smith' }))
    expect(res.status).toBe(403)
  })

  it('returns 400 on invalid JSON', async () => {
    const badReq = new Request('http://localhost/api/intake/search', {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(badReq)
    expect(res.status).toBe(400)
  })
})
