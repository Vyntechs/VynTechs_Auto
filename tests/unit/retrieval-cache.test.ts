import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cacheKeyFor, getCachedResults, setCachedResults } from '@/lib/retrieval/cache'
import type { AppDb } from '@/lib/db/queries'

type FakeDb = {
  query: { retrievalCache: { findFirst: ReturnType<typeof vi.fn> } }
  insert: ReturnType<typeof vi.fn>
}

const findFirst = vi.fn()
const valuesMock = vi.fn()
const onConflictMock = vi.fn()
const returningMock = vi.fn().mockResolvedValue([])
const insertMock = vi.fn()

const fakeDb: FakeDb = {
  query: { retrievalCache: { findFirst } },
  insert: insertMock,
}

describe('retrieval cache', () => {
  beforeEach(() => {
    findFirst.mockReset()
    valuesMock.mockReset()
    onConflictMock.mockReset()
    returningMock.mockClear()
    insertMock.mockReset()

    onConflictMock.mockReturnValue({ returning: returningMock })
    valuesMock.mockReturnValue({ onConflictDoUpdate: onConflictMock })
    insertMock.mockReturnValue({ values: valuesMock })
  })

  it('returns cached results when fresh', async () => {
    findFirst.mockResolvedValueOnce({
      results: [{ source: 'nhtsa', title: 't', snippet: 's' }],
      expiresAt: new Date(Date.now() + 60_000),
    })
    const r = await getCachedResults(fakeDb as unknown as AppDb, 'key-1')
    expect(r).toHaveLength(1)
  })

  it('returns null when expired', async () => {
    findFirst.mockResolvedValueOnce({
      results: [],
      expiresAt: new Date(Date.now() - 1000),
    })
    const r = await getCachedResults(fakeDb as unknown as AppDb, 'key-2')
    expect(r).toBeNull()
  })

  it('returns null when no row found', async () => {
    findFirst.mockResolvedValueOnce(undefined)
    const r = await getCachedResults(fakeDb as unknown as AppDb, 'missing')
    expect(r).toBeNull()
  })

  it('setCachedResults invokes insert with onConflictDoUpdate', async () => {
    await setCachedResults(fakeDb as unknown as AppDb, 'key-3', 'nhtsa', [
      { source: 'nhtsa', title: 'a', snippet: 'b' },
    ])
    expect(insertMock).toHaveBeenCalledTimes(1)
    expect(valuesMock).toHaveBeenCalledTimes(1)
    const valuesArg = valuesMock.mock.calls[0][0]
    expect(valuesArg.cacheKey).toBe('key-3')
    expect(valuesArg.source).toBe('nhtsa')
    expect(valuesArg.results).toHaveLength(1)
    expect(valuesArg.expiresAt).toBeInstanceOf(Date)
    expect(onConflictMock).toHaveBeenCalledTimes(1)
    expect(returningMock).toHaveBeenCalledTimes(1)
  })

  it('cacheKeyFor produces stable hash regardless of dtc/symptom order', () => {
    const ctx1 = {
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      vehicleEngine: '3.5L',
      complaintText: 'x',
      dtcs: ['P0299', 'P0171'],
      symptomTags: ['boost', 'misfire'],
    }
    const ctx2 = {
      ...ctx1,
      vehicleMake: 'FORD',
      vehicleModel: 'f-150',
      dtcs: ['P0171', 'P0299'],
      symptomTags: ['misfire', 'boost'],
    }
    expect(cacheKeyFor(ctx1, 'nhtsa')).toBe(cacheKeyFor(ctx2, 'nhtsa'))
  })
})
