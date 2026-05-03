import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const TOKEN_RESPONSE = {
  ok: true,
  json: async () => ({ access_token: 'tok-abc', token_type: 'bearer', expires_in: 3600 }),
}

const SEARCH_RESPONSE = {
  ok: true,
  json: async () => ({
    data: {
      children: [{
        data: {
          title: 'Help: F-150 EcoBoost P0299 underboost',
          permalink: '/r/MechanicAdvice/comments/abc/help_f150/',
          selftext: 'Got P0299. Smoke test showed wastegate vacuum line crack.',
          subreddit: 'MechanicAdvice',
          score: 42,
        },
      }],
    },
  }),
}

describe('RedditAdapter', () => {
  beforeEach(() => {
    process.env.REDDIT_CLIENT_ID = 'id'
    process.env.REDDIT_CLIENT_SECRET = 'secret'
    process.env.REDDIT_USER_AGENT = 'test/1.0'
  })

  afterEach(() => {
    delete process.env.REDDIT_CLIENT_ID
    delete process.env.REDDIT_CLIENT_SECRET
    delete process.env.REDDIT_USER_AGENT
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('token + search both succeed → returns 1 result with snippet containing wastegate', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(TOKEN_RESPONSE)
      .mockResolvedValueOnce(SEARCH_RESPONSE)
    vi.stubGlobal('fetch', fetchMock)

    const { RedditAdapter } = await import('@/lib/retrieval/adapters/reddit')
    const a = new RedditAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      dtcs: ['P0299'], complaintText: 'underboost',
    }, new AbortController().signal)

    expect(r).toHaveLength(1)
    expect(r[0].snippet.toLowerCase()).toContain('wastegate')
    expect(r[0].source).toBe('reddit')
    expect(r[0].url).toContain('reddit.com')
  })

  it('returns [] when REDDIT_CLIENT_ID is missing', async () => {
    delete process.env.REDDIT_CLIENT_ID
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { RedditAdapter } = await import('@/lib/retrieval/adapters/reddit')
    const a = new RedditAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'x',
    }, new AbortController().signal)

    expect(r).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns [] when REDDIT_CLIENT_SECRET is missing', async () => {
    delete process.env.REDDIT_CLIENT_SECRET
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { RedditAdapter } = await import('@/lib/retrieval/adapters/reddit')
    const a = new RedditAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'x',
    }, new AbortController().signal)

    expect(r).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns [] when token fetch fails (ok: false)', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
    vi.stubGlobal('fetch', fetchMock)

    const { RedditAdapter } = await import('@/lib/retrieval/adapters/reddit')
    const a = new RedditAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'x',
    }, new AbortController().signal)

    expect(r).toEqual([])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns [] when search fails (ok: false) after token success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(TOKEN_RESPONSE)
      .mockResolvedValueOnce({ ok: false, status: 403 })
    vi.stubGlobal('fetch', fetchMock)

    const { RedditAdapter } = await import('@/lib/retrieval/adapters/reddit')
    const a = new RedditAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'x',
    }, new AbortController().signal)

    expect(r).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
