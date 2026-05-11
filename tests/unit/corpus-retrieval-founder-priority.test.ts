import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AppDb } from '@/lib/db/queries'

vi.mock('@/lib/ai/embeddings', () => ({
  embed: vi.fn().mockResolvedValue(Array(1024).fill(0.1)),
}))

const FOUNDER_ROW = {
  id: 'founder-1',
  rootCause: 'Cam phasers — known pattern',
  summary: '5.0 F-150 cold-start misfire',
  confidenceScore: 0.95,
  successConfirmCount: 0,
  comebackRecordedCount: 0,
  entrySource: 'founder' as const,
  distance: 0.4,
}

const AUTO_ROW = {
  id: 'auto-1',
  rootCause: 'Coil pack failure',
  summary: 'misfire under load',
  confidenceScore: 0.6,
  successConfirmCount: 3,
  comebackRecordedCount: 0,
  entrySource: 'auto_promoted' as const,
  distance: 0.05,
}

describe('retrieveCorpus founder priority', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.clearAllMocks())

  it('places a founder match ahead of a closer auto-promoted match', async () => {
    // Founder query returns FOUNDER_ROW; general query returns AUTO_ROW
    // (which is geometrically closer). Merge should prepend founder.
    const execute = vi
      .fn()
      .mockResolvedValueOnce([FOUNDER_ROW])
      .mockResolvedValueOnce([AUTO_ROW])
    const db = { execute } as unknown as AppDb
    const { retrieveCorpus } = await import('@/lib/corpus/retrieval')
    const r = await retrieveCorpus(db, {
      vehicleYear: 2016,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      complaintText: 'cold start misfire',
    })
    expect(r).toHaveLength(2)
    expect(r[0].id).toBe('founder-1')
    expect(r[0].entrySource).toBe('founder')
    expect(r[1].id).toBe('auto-1')
  })

  it('dedupes a row that appears in both founder and general results', async () => {
    // The founder query returns FOUNDER_ROW; general query also surfaces
    // the same founder row (because nothing filters founder out of the
    // general path). The merge must dedupe by id.
    const execute = vi
      .fn()
      .mockResolvedValueOnce([FOUNDER_ROW])
      .mockResolvedValueOnce([FOUNDER_ROW, AUTO_ROW])
    const db = { execute } as unknown as AppDb
    const { retrieveCorpus } = await import('@/lib/corpus/retrieval')
    const r = await retrieveCorpus(db, {
      vehicleYear: 2016,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      complaintText: 'misfire',
    })
    const ids = r.map((m) => m.id)
    expect(ids).toEqual(['founder-1', 'auto-1'])
  })

  it('falls back to auto-promoted entrySource when the column is absent (legacy rows)', async () => {
    const legacyRow = { ...AUTO_ROW, entrySource: undefined }
    const execute = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([legacyRow])
    const db = { execute } as unknown as AppDb
    const { retrieveCorpus } = await import('@/lib/corpus/retrieval')
    const r = await retrieveCorpus(db, {
      vehicleYear: 2016,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      complaintText: 'misfire',
    })
    expect(r[0].entrySource).toBe('auto_promoted')
  })
})
