import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppDb } from '@/lib/db/queries'

const getCachedResults = vi.fn()
const setCachedResults = vi.fn()

vi.mock('@/lib/retrieval/cache', () => ({
  cacheKeyFor: (_ctx: unknown, source: string) => `key-${source}`,
  getCachedResults: (db: AppDb, key: string) => getCachedResults(db, key),
  setCachedResults: (db: AppDb, key: string, source: string, results: unknown) =>
    setCachedResults(db, key, source, results),
}))

const ctx = {
  vehicleYear: 2018,
  vehicleMake: 'Ford',
  vehicleModel: 'F-150',
  complaintText: 'x',
}

const db = {} as AppDb

describe('runRetrieval', () => {
  beforeEach(() => {
    getCachedResults.mockReset()
    setCachedResults.mockReset()
    getCachedResults.mockResolvedValue(null)
    setCachedResults.mockResolvedValue(undefined)
  })

  it('aggregates results from multiple adapters under budget', async () => {
    const { runRetrieval } = await import('@/lib/retrieval/orchestrator')
    const adapter1 = {
      id: 'a1',
      weight: 0.9,
      query: vi.fn().mockResolvedValue([{ source: 'a1', title: 't1', snippet: 's1' }]),
    }
    const adapter2 = {
      id: 'a2',
      weight: 0.5,
      query: vi.fn().mockResolvedValue([{ source: 'a2', title: 't2', snippet: 's2' }]),
    }
    const r = await runRetrieval({
      db,
      adapters: [adapter1, adapter2],
      ctx,
      budget: { maxQueries: 2, maxWallClockMs: 5_000, maxTokens: 50_000 },
    })
    expect(r.results).toHaveLength(2)
    expect(r.queriesUsed).toBe(2)
  })

  it('stops when query budget reached', async () => {
    const { runRetrieval } = await import('@/lib/retrieval/orchestrator')
    const adapter1 = { id: 'a1', weight: 0.9, query: vi.fn().mockResolvedValue([]) }
    const adapter2 = { id: 'a2', weight: 0.5, query: vi.fn() }
    await runRetrieval({
      db,
      adapters: [adapter1, adapter2],
      ctx,
      budget: { maxQueries: 1, maxWallClockMs: 5_000, maxTokens: 50_000 },
    })
    expect(adapter1.query).toHaveBeenCalled()
    expect(adapter2.query).not.toHaveBeenCalled()
  })

  it('cache hit short-circuits the adapter call', async () => {
    getCachedResults.mockImplementation(async (_db: AppDb, key: string) => {
      if (key === 'key-a1') return [{ source: 'a1', title: 'cached', snippet: 'x' }]
      return null
    })
    const { runRetrieval } = await import('@/lib/retrieval/orchestrator')
    const adapter1 = {
      id: 'a1',
      weight: 0.9,
      query: vi.fn().mockResolvedValue([{ source: 'a1', title: 'live', snippet: 'y' }]),
    }
    const adapter2 = {
      id: 'a2',
      weight: 0.5,
      query: vi.fn().mockResolvedValue([{ source: 'a2', title: 't2', snippet: 's2' }]),
    }
    const r = await runRetrieval({
      db,
      adapters: [adapter1, adapter2],
      ctx,
      budget: { maxQueries: 5, maxWallClockMs: 5_000, maxTokens: 50_000 },
    })
    expect(adapter1.query).not.toHaveBeenCalled()
    expect(r.cacheHits).toContain('a1')
    expect(r.results).toHaveLength(2)
    const titles = r.results.map((x) => x.title).sort()
    expect(titles).toStrictEqual(['cached', 't2'])
    expect(r.queriesUsed).toBe(1)
  })

  it('errors from one adapter do not fail the run', async () => {
    const { runRetrieval } = await import('@/lib/retrieval/orchestrator')
    const adapter1 = {
      id: 'a1',
      weight: 0.9,
      query: vi.fn().mockRejectedValue(new Error('boom')),
    }
    const adapter2 = {
      id: 'a2',
      weight: 0.5,
      query: vi.fn().mockResolvedValue([{ source: 'a2', title: 't2', snippet: 's2' }]),
    }
    const r = await runRetrieval({
      db,
      adapters: [adapter1, adapter2],
      ctx,
      budget: { maxQueries: 5, maxWallClockMs: 5_000, maxTokens: 50_000 },
    })
    expect(r.results).toHaveLength(1)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toStrictEqual({ adapterId: 'a1', message: 'boom' })
    expect(r.queriesUsed).toBe(2)
  })

  it('stops when token budget reached', async () => {
    const { runRetrieval } = await import('@/lib/retrieval/orchestrator')
    const heavySnippet = 'x'.repeat(800)
    const adapter1 = {
      id: 'a1',
      weight: 0.9,
      query: vi
        .fn()
        .mockResolvedValue([{ source: 'a1', title: 'big', snippet: heavySnippet }]),
    }
    const adapter2 = {
      id: 'a2',
      weight: 0.5,
      query: vi.fn().mockResolvedValue([{ source: 'a2', title: 't2', snippet: 's2' }]),
    }
    const r = await runRetrieval({
      db,
      adapters: [adapter1, adapter2],
      ctx,
      budget: { maxQueries: 5, maxWallClockMs: 5_000, maxTokens: 100 },
    })
    expect(adapter1.query).toHaveBeenCalled()
    expect(adapter2.query).not.toHaveBeenCalled()
    expect(r.tokensUsed).toBeGreaterThanOrEqual(100)
  })

  it('tags wall-clock-aborted adapter errors as budget exceeded', async () => {
    const { runRetrieval } = await import('@/lib/retrieval/orchestrator')
    const adapter1 = {
      id: 'a1',
      weight: 0.9,
      query: vi.fn().mockImplementation(async (_ctx, signal: AbortSignal) => {
        // Simulate the adapter being aborted by the wall-clock controller.
        const abortErr = new Error('aborted')
        abortErr.name = 'AbortError'
        // Fire an abort event on the passed signal so controller.signal.aborted is true.
        const ac = signal as AbortSignal & { dispatchEvent?: (ev: Event) => boolean }
        Object.defineProperty(ac, 'aborted', { value: true, configurable: true })
        throw abortErr
      }),
    }
    const r = await runRetrieval({
      db,
      adapters: [adapter1],
      ctx,
      budget: { maxQueries: 5, maxWallClockMs: 5_000, maxTokens: 50_000 },
    })
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toStrictEqual({
      adapterId: 'a1',
      message: 'wall-clock budget exceeded',
    })
  })
})
