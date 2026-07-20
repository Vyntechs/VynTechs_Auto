import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/lib/intake/decode-vin', () => ({
  decodeVin: vi.fn(),
  normalizeVin: vi.fn((raw: string) => {
    const vin = raw.trim().toUpperCase()
    return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin) ? vin : null
  }),
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
vi.mock('@/lib/rate-limit', () => ({
  rateLimitReject: vi.fn(async () => null),
}))

import { POST } from '@/app/api/intake/decode-vin/route'
import { decodeVin } from '@/lib/intake/decode-vin'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { rateLimitReject } from '@/lib/rate-limit'

const decodeVinMock = vi.mocked(decodeVin)
const requireUserMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const rateLimitMock = vi.mocked(rateLimitReject)

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
    paywallMock.mockResolvedValue(null)
    rateLimitMock.mockResolvedValue(null)
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
    expect(decodeVinMock).toHaveBeenCalledWith('WBA3A5C50EJF12345')
  })

  it('normalizes lowercase VIN input before decoding', async () => {
    decodeVinMock.mockResolvedValue({ year: 2014, make: 'BMW', model: '335i', engine: 'N55' })
    const res = await POST(makeReq({ vin: 'wba3a5c50ejf12345' }))
    expect(res.status).toBe(200)
    expect(decodeVinMock).toHaveBeenCalledWith('WBA3A5C50EJF12345')
  })

  it('returns 200 with {error:"invalid"} on NHTSA-rejected VIN', async () => {
    decodeVinMock.mockResolvedValue({ error: 'invalid' })
    const res = await POST(makeReq({ vin: 'WBA3A5C50EJF99999' }))
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
    expect(await res.json()).toEqual({ error: 'invalid_vin' })
  })

  it.each([
    'SHORT',
    'WBA3A5C50EJF1234I',
    'WBA3A5C50EJF1234O',
    'WBA3A5C50EJF1234Q',
    'WBA3A5C50EJF1234-',
  ])('rejects malformed VIN %s before quota or provider work', async (vin) => {
    const res = await POST(makeReq({ vin }))
    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'invalid_vin' })
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(decodeVinMock).not.toHaveBeenCalled()
  })

  it('uses a per-user VIN quota and stops before provider work when exhausted', async () => {
    const { NextResponse } = await import('next/server')
    rateLimitMock.mockResolvedValue(
      NextResponse.json({ error: 'rate_limited' }, { status: 429 }),
    )

    const res = await POST(makeReq({ vin: 'WBA3A5C50EJF12345' }))

    expect(rateLimitMock).toHaveBeenCalledWith({}, 'vin-decode:u1', 20)
    expect(res.status).toBe(429)
    expect(decodeVinMock).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValue(null)
    const json = vi.fn(async () => {
      throw new Error('body must not be parsed')
    })
    const res = await POST({ json } as unknown as Request)
    expect(res.status).toBe(401)
    expect(json).not.toHaveBeenCalled()
    expect(paywallMock).not.toHaveBeenCalled()
  })

  it('returns base-access rejection before parsing or decode work', async () => {
    const { NextResponse } = await import('next/server')
    paywallMock.mockResolvedValue(
      NextResponse.json({ error: 'deactivated' }, { status: 403 }),
    )
    const json = vi.fn(async () => {
      throw new Error('body must not be parsed')
    })

    const res = await POST({ json } as unknown as Request)

    expect(res.status).toBe(403)
    expect(json).not.toHaveBeenCalled()
    expect(decodeVinMock).not.toHaveBeenCalled()
  })
})
