import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AppDb } from '@/lib/db/queries'

vi.mock('@/lib/ai/embeddings', () => ({
  embed: vi.fn().mockResolvedValue(Array(1024).fill(0.1)),
}))

const ROW = {
  id: 'corpus-1',
  rootCause: 'Wastegate vacuum line crack',
  summary: 'F-150 EcoBoost wastegate line',
  confidenceScore: 0.82,
  successConfirmCount: 4,
  comebackRecordedCount: 0,
  distance: 0.18,
}

function makeDb(rows: unknown[]): { db: AppDb; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn().mockResolvedValue(rows)
  const db = { execute } as unknown as AppDb
  return { db, execute }
}

describe('retrieveCorpus', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.clearAllMocks())

  it('returns ranked matches for vehicle+DTC+symptom query', async () => {
    const { db } = makeDb([ROW])
    const { retrieveCorpus } = await import('@/lib/corpus/retrieval')
    const r = await retrieveCorpus(db, {
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      dtcs: ['P0299', 'P0236'],
      symptomTags: ['power_loss'],
      complaintText: 'loss of power going up hills',
    })
    expect(r).toHaveLength(1)
    expect(r[0].id).toBe('corpus-1')
    expect(r[0].similarityScore).toBeCloseTo(0.82, 2) // 1 - 0.18
    expect(r[0].rootCause).toBe('Wastegate vacuum line crack')
  })

  it('returns [] when no rows matched the prefilter', async () => {
    const { db } = makeDb([])
    const { retrieveCorpus } = await import('@/lib/corpus/retrieval')
    const r = await retrieveCorpus(db, {
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      complaintText: 'loss of power',
    })
    expect(r).toEqual([])
  })

  it('handles empty dtcs and tags by skipping the prefilter clause', async () => {
    const { db, execute } = makeDb([ROW])
    const { retrieveCorpus } = await import('@/lib/corpus/retrieval')
    await retrieveCorpus(db, {
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      complaintText: 'loss of power',
    })
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('clamps similarityScore to >= 0 even if distance > 1', async () => {
    const { db } = makeDb([{ ...ROW, distance: 1.4 }])
    const { retrieveCorpus } = await import('@/lib/corpus/retrieval')
    const r = await retrieveCorpus(db, {
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      complaintText: 'x',
    })
    expect(r[0].similarityScore).toBe(0)
  })
})
