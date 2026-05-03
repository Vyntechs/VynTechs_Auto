import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const BRAVE_RESPONSE = {
  ok: true,
  json: async () => ({
    web: {
      results: [
        { title: 'F-150 EcoBoost wastegate vacuum line failure - F150Forum', url: 'https://f150forum.com/thread/123', description: 'Multiple reports of wastegate line cracking at 60-100K mi.' },
        { title: 'Random unrelated link', url: 'https://other.example/x', description: 'unrelated' },
      ],
    },
  }),
}

describe('ForumAdapter', () => {
  beforeEach(() => {
    process.env.BRAVE_SEARCH_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(BRAVE_RESPONSE))
  })

  afterEach(() => {
    delete process.env.BRAVE_SEARCH_API_KEY
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('filters to forum-domain results only', async () => {
    const { ForumAdapter } = await import('@/lib/retrieval/adapters/forum')
    const a = new ForumAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'wastegate vacuum line', dtcs: ['P0299'],
    }, new AbortController().signal)
    expect(r).toHaveLength(1)
    expect(r[0].url).toContain('f150forum')
  })

  it('returns [] when BRAVE_SEARCH_API_KEY is missing', async () => {
    delete process.env.BRAVE_SEARCH_API_KEY
    const { ForumAdapter } = await import('@/lib/retrieval/adapters/forum')
    const a = new ForumAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'x',
    }, new AbortController().signal)
    expect(r).toEqual([])
  })

  it('returns [] when the API responds with !ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }))
    const { ForumAdapter } = await import('@/lib/retrieval/adapters/forum')
    const a = new ForumAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'x',
    }, new AbortController().signal)
    expect(r).toEqual([])
  })
})
