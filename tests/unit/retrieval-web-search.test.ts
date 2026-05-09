import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const TAVILY_RESPONSE = {
  ok: true,
  json: async () => ({
    results: [
      {
        title: 'Ford 6.7 Powerstroke CP4 Failure Explained',
        url: 'https://1023diesel.com/cp4-failure-on-ford-6-7powerstroke/',
        content: 'P0087 on the 6.7 is commonly caused by CP4 pump wear and metal contamination.',
        score: 0.86,
      },
      {
        title: 'Ford F-Series — fuel rail pressure low',
        url: 'https://example.org/x',
        content: 'Symptoms include hard start and limp mode.',
        score: 0.42,
      },
    ],
  }),
}

describe('WebSearchAdapter', () => {
  beforeEach(() => {
    process.env.TAVILY_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(TAVILY_RESPONSE))
  })

  afterEach(() => {
    delete process.env.TAVILY_API_KEY
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('maps Tavily results to RetrievalResult shape', async () => {
    const { WebSearchAdapter } = await import('@/lib/retrieval/adapters/web-search')
    const a = new WebSearchAdapter()
    const r = await a.query(
      {
        vehicleYear: 2020,
        vehicleMake: 'Ford',
        vehicleModel: 'F-250',
        vehicleEngine: '6.7L Powerstroke',
        complaintText: 'loss of power, P0087 stored',
        dtcs: ['P0087'],
      },
      new AbortController().signal,
    )
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({
      source: 'web-search',
      url: 'https://1023diesel.com/cp4-failure-on-ford-6-7powerstroke/',
      title: 'Ford 6.7 Powerstroke CP4 Failure Explained',
    })
    expect(r[0].snippet).toContain('CP4 pump wear')
    expect(typeof r[0].weightHint).toBe('number')
  })

  it('returns [] when TAVILY_API_KEY is missing', async () => {
    delete process.env.TAVILY_API_KEY
    const { WebSearchAdapter } = await import('@/lib/retrieval/adapters/web-search')
    const a = new WebSearchAdapter()
    const r = await a.query(
      { vehicleYear: 2020, vehicleMake: 'Ford', vehicleModel: 'F-250', complaintText: 'x' },
      new AbortController().signal,
    )
    expect(r).toEqual([])
  })

  it('returns [] when the API responds with !ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))
    const { WebSearchAdapter } = await import('@/lib/retrieval/adapters/web-search')
    const a = new WebSearchAdapter()
    const r = await a.query(
      { vehicleYear: 2020, vehicleMake: 'Ford', vehicleModel: 'F-250', complaintText: 'x' },
      new AbortController().signal,
    )
    expect(r).toEqual([])
  })

  it('clamps weightHint into [0.3, 0.9] range', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { title: 'A', url: 'https://a.test', content: 'x', score: 0.05 },
            { title: 'B', url: 'https://b.test', content: 'x', score: 1.5 },
            { title: 'C', url: 'https://c.test', content: 'x' },
          ],
        }),
      }),
    )
    const { WebSearchAdapter } = await import('@/lib/retrieval/adapters/web-search')
    const a = new WebSearchAdapter()
    const r = await a.query(
      { vehicleYear: 2020, vehicleMake: 'Ford', vehicleModel: 'F-250', complaintText: 'x' },
      new AbortController().signal,
    )
    expect(r[0].weightHint).toBe(0.3)
    expect(r[1].weightHint).toBe(0.9)
    expect(r[2].weightHint).toBe(0.5)
  })

  it('builds query string from vehicle + DTCs + complaint + observation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(TAVILY_RESPONSE)
    vi.stubGlobal('fetch', fetchMock)
    const { WebSearchAdapter } = await import('@/lib/retrieval/adapters/web-search')
    const a = new WebSearchAdapter()
    await a.query(
      {
        vehicleYear: 2020,
        vehicleMake: 'Ford',
        vehicleModel: 'F-250',
        vehicleEngine: '6.7L',
        complaintText: 'low fuel pressure',
        dtcs: ['P0087', 'P0088'],
        observation: 'rail pressure crashes at 3000 RPM',
      },
      new AbortController().signal,
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('2020 Ford F-250 6.7L'),
      }),
    )
    const sentBody = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body)
    expect(sentBody.query).toContain('P0087')
    expect(sentBody.query).toContain('low fuel pressure')
    expect(sentBody.query).toContain('rail pressure crashes')
    expect(sentBody.api_key).toBe('test-key')
  })
})
