import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const SEARCH_RESPONSE = {
  ok: true,
  json: async () => ({
    items: [{
      id: { videoId: 'abc123' },
      snippet: { title: 'F-150 EcoBoost P0299 wastegate fix', description: 'Walking through diagnosis.', channelTitle: 'Auto Channel' },
    }],
  }),
}

const TRANSCRIPT_RESPONSE = {
  ok: true,
  text: async () => `1
00:00:00,000 --> 00:00:05,000
The wastegate vacuum line was cracked here near the actuator can.`,
}

describe('YouTubeAdapter', () => {
  beforeEach(() => {
    process.env.YOUTUBE_API_KEY = 'test-key'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(SEARCH_RESPONSE)
      .mockResolvedValueOnce(TRANSCRIPT_RESPONSE)
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    delete process.env.YOUTUBE_API_KEY
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('returns video + first transcript snippet', async () => {
    const { YouTubeAdapter } = await import('@/lib/retrieval/adapters/youtube')
    const a = new YouTubeAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      dtcs: ['P0299'], complaintText: 'wastegate',
    }, new AbortController().signal)
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].snippet.toLowerCase()).toContain('wastegate')
  })

  it('returns [] when YOUTUBE_API_KEY is missing', async () => {
    delete process.env.YOUTUBE_API_KEY
    const { YouTubeAdapter } = await import('@/lib/retrieval/adapters/youtube')
    const a = new YouTubeAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'x',
    }, new AbortController().signal)
    expect(r).toEqual([])
  })

  it('falls back to description when transcript fetch fails', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(SEARCH_RESPONSE)
      .mockRejectedValueOnce(new Error('transcript 403')))
    const { YouTubeAdapter } = await import('@/lib/retrieval/adapters/youtube')
    const a = new YouTubeAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      dtcs: ['P0299'], complaintText: 'wastegate',
    }, new AbortController().signal)
    expect(r.length).toBeGreaterThan(0)
    // Falls back to the description, which is "Walking through diagnosis."
    expect(r[0].snippet.toLowerCase()).toContain('walking through')
  })

  it('returns [] when search API responds with !ok', async () => {
    vi.unstubAllGlobals()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 403 }))
    const { YouTubeAdapter } = await import('@/lib/retrieval/adapters/youtube')
    const a = new YouTubeAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'x',
    }, new AbortController().signal)
    expect(r).toEqual([])
  })
})
