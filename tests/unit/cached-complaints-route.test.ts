import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CachedComplaint } from '@/lib/diagnostics/cached-lookup'

// Auth mock — pattern from advance-stream-route.test.ts.
// Default: authenticated user. Individual tests override as needed.
const mockGetUser = vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } })
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
  }),
}))

// DB stub — the route passes `db` into listCachedSymptomsForPlatform, but we
// mock that function at the module level so the real DB is never touched.
vi.mock('@/lib/db/client', () => ({ db: {} }))

// Mock listCachedSymptomsForPlatform so we control what it returns without a
// real DB. resolvePlatformSlug is a pure function and is NOT mocked — it runs
// for real, which gives us honest end-to-end coverage through that layer.
const mockListCachedSymptoms = vi.fn()
vi.mock('@/lib/diagnostics/cached-lookup', () => ({
  listCachedSymptomsForPlatform: (...args: unknown[]) => mockListCachedSymptoms(...args),
}))

import { GET } from '@/app/api/diagnostics/cached-complaints/route'

const FIXTURE_COMPLAINTS: CachedComplaint[] = [
  { slug: 'p0087', description: 'Fuel rail pressure too low', category: 'dtc' },
  { slug: 'p0088', description: 'Fuel rail pressure too high', category: 'dtc' },
]

function makeReq(params: Record<string, string>): Request {
  const url = new URL('http://localhost/api/diagnostics/cached-complaints')
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  return new Request(url.toString())
}

describe('GET /api/diagnostics/cached-complaints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to default: authenticated
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    // Default: no cached complaints
    mockListCachedSymptoms.mockResolvedValue([])
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await GET(makeReq({ year: '2018', make: 'Ford', model: 'F-250', engine: '6.7L Power Stroke Diesel' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns 400 when year is missing', async () => {
    const res = await GET(makeReq({ make: 'Ford', model: 'F-250' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'missing required vehicle params' })
  })

  it('returns 400 when make is missing', async () => {
    const res = await GET(makeReq({ year: '2018', model: 'F-250' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'missing required vehicle params' })
  })

  it('returns 400 when model is missing', async () => {
    const res = await GET(makeReq({ year: '2018', make: 'Ford' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'missing required vehicle params' })
  })

  it('returns 400 when year is not a valid number', async () => {
    const res = await GET(makeReq({ year: 'abc', make: 'Ford', model: 'F-250' }))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid year' })
  })

  it('returns 200 with platformSlug null + empty complaints for unresolved vehicle (F-150 EcoBoost)', async () => {
    // F-150 3.5L EcoBoost does not match the Ford 6.7 PSD resolver
    const res = await GET(
      makeReq({ year: '2018', make: 'Ford', model: 'F-150', engine: '3.5L EcoBoost' }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ platformSlug: null, complaints: [] })
    // listCachedSymptomsForPlatform must NOT be called when no platform resolves
    expect(mockListCachedSymptoms).not.toHaveBeenCalled()
  })

  it('returns 200 with platformSlug + complaints for resolved vehicle (F-250 6.7L PSD)', async () => {
    mockListCachedSymptoms.mockResolvedValue(FIXTURE_COMPLAINTS)
    const res = await GET(
      makeReq({
        year: '2018',
        make: 'Ford',
        model: 'F-250',
        engine: '6.7L Power Stroke Diesel',
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.platformSlug).toBe('ford-super-duty-4th-gen-67-psd')
    expect(body.complaints).toEqual(FIXTURE_COMPLAINTS)
    expect(mockListCachedSymptoms).toHaveBeenCalledWith({
      db: {},
      platformSlug: 'ford-super-duty-4th-gen-67-psd',
    })
  })

  it('engine param defaults to empty string when omitted', async () => {
    // No engine → resolvePlatformSlug returns null (no match without engine hint)
    const res = await GET(makeReq({ year: '2018', make: 'Ford', model: 'F-250' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ platformSlug: null, complaints: [] })
    expect(mockListCachedSymptoms).not.toHaveBeenCalled()
  })
})
