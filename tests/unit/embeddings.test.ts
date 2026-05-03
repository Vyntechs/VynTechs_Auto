import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const SINGLE_RESPONSE = {
  ok: true,
  json: async () => ({
    data: [{ embedding: Array.from({ length: 1536 }, (_, i) => i / 1536), index: 0 }],
  }),
}

describe('embed', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(SINGLE_RESPONSE))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('returns a 1536-dimensional vector', async () => {
    const { embed } = await import('@/lib/ai/embeddings')
    const v = await embed('2018 F-150 EcoBoost wastegate vacuum line crack P0299')
    expect(v).toHaveLength(1536)
    expect(typeof v[0]).toBe('number')
  })

  it('throws when API responds with !ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'overloaded' }),
    )
    const { embed } = await import('@/lib/ai/embeddings')
    await expect(embed('foo')).rejects.toThrow(/embed failed/)
  })

  it('throws when response is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) }))
    const { embed } = await import('@/lib/ai/embeddings')
    await expect(embed('foo')).rejects.toThrow(/malformed/)
  })
})

describe('embedMany', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('returns vectors in input order even when API returns them shuffled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { embedding: [2, 2, 2], index: 1 },
            { embedding: [0, 0, 0], index: 0 },
            { embedding: [1, 1, 1], index: 2 },
          ],
        }),
      }),
    )
    const { embedMany } = await import('@/lib/ai/embeddings')
    const result = await embedMany(['a', 'b', 'c'])
    expect(result).toEqual([[0, 0, 0], [2, 2, 2], [1, 1, 1]])
  })
})
