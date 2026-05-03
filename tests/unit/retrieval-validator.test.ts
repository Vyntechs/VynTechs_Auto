import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@/lib/ai/client', () => ({
  anthropic: {
    messages: { create: vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({
        validated: [
          { index: 0, keep: true, relevance: 0.9, why: 'directly matches' },
          { index: 1, keep: false, relevance: 0.1 },
        ],
      }) }],
      usage: { input_tokens: 100, output_tokens: 60 },
    }) },
  },
  MODEL: 'claude-sonnet-4-6',
  cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
}))

afterEach(() => {
  vi.resetModules()
})

describe('validateRetrievalResults', () => {
  it('drops irrelevant snippets', async () => {
    const { validateRetrievalResults } = await import('@/lib/retrieval/validator')
    const r = await validateRetrievalResults({
      ctx: { vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', complaintText: 'underboost' },
      results: [
        { source: 'nhtsa', title: 'wastegate recall', snippet: 'wastegate vacuum line crack' },
        { source: 'reddit', title: 'unrelated', snippet: 'paint flaking on tailgate' },
      ],
    })
    expect(r).toHaveLength(1)
    expect(r[0].title).toBe('wastegate recall')
  })

  it('returns input unchanged when LLM returns invalid JSON', async () => {
    vi.doMock('@/lib/ai/client', () => ({
      anthropic: {
        messages: {
          create: vi.fn().mockResolvedValue({
            content: [{ type: 'text', text: 'not json' }],
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
        },
      },
      MODEL: 'claude-sonnet-4-6',
      cachedSystem: (t: string) => [{ type: 'text', text: t, cache_control: { type: 'ephemeral' } }],
    }))
    const { validateRetrievalResults } = await import('@/lib/retrieval/validator')
    const input = {
      ctx: { vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', complaintText: 'underboost' },
      results: [
        { source: 'nhtsa', title: 'wastegate recall', snippet: 'wastegate vacuum line crack' },
        { source: 'reddit', title: 'unrelated', snippet: 'paint flaking on tailgate' },
      ],
    }
    const r = await validateRetrievalResults(input)
    expect(r).toEqual(input.results)
  })
})
