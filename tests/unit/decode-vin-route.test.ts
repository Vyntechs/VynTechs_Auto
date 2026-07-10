import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/intake/decode-vin', () => ({
  decodeVin: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))
// The route's paywall check runs against a real DB by default; with `db: {}`
// here it would throw. Stub it to no-op so the test exercises route logic
// only. Paywall semantics are covered separately in auth-access.test.ts.
vi.mock('@/lib/auth-access', () => ({
  paywallReject: vi.fn(async () => null),
}))

import { POST } from '@/app/api/intake/decode-vin/route'
import { decodeVin } from '@/lib/intake/decode-vin'
import { requireUserAndProfile } from '@/lib/auth'

const decodeVinMock = vi.mocked(decodeVin)
const requireUserMock = vi.mocked(requireUserAndProfile)

function makeReq(body: unknown): Request {
  return new Request('http://localhost/api/intake/decode-vin', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('POST /api/intake/decode-vin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({
      profile: {
        id: 'p1',
        userId: 'u1',
        shopId: 's1',
        fullName: 'Owner',
        role: 'owner',
        skillTier: null,
        membershipStatus: 'active',
        membershipActivatedAt: new Date(),
        isComp: false,
        isCurator: false,
        lastSeenWhatsNewAt: null,
        deactivatedAt: null,
        createdAt: new Date(),
      },
      user: { id: 'u1', email: 'owner@shop.test' },
    })
  })

  it('returns 200 with decoded fields on success', async () => {
    decodeVinMock.mockResolvedValue({ year: 2014, make: 'BMW', model: '335i', engine: 'N55' })
    const res = await POST(makeReq({ vin: 'WBA3A5C50EJF12345' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ year: 2014, make: 'BMW', model: '335i', engine: 'N55' })
  })

  it('returns 200 with {error:"invalid"} on NHTSA-rejected VIN', async () => {
    decodeVinMock.mockResolvedValue({ error: 'invalid' })
    const res = await POST(makeReq({ vin: 'BADVIN1234567890Z' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'invalid' })
  })

  it('returns 200 with {error:"unavailable"} on NHTSA outage', async () => {
    decodeVinMock.mockResolvedValue({ error: 'unavailable' })
    const res = await POST(makeReq({ vin: 'WBA3A5C50EJF12345' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ error: 'unavailable' })
  })

  it('returns 400 on missing vin field', async () => {
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
  })

  it('returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValue(null)
    const res = await POST(makeReq({ vin: 'WBA3A5C50EJF12345' }))
    expect(res.status).toBe(401)
  })
})
