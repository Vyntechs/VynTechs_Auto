import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppDb } from '@/lib/db/queries'

const embedMock = vi.fn().mockResolvedValue(Array(1024).fill(0.1))
vi.mock('@/lib/ai/embeddings', () => ({
  embed: embedMock,
}))

const BASE_INPUT = {
  vehicleYear: 2018,
  vehicleMake: 'Ford',
  vehicleModel: 'F-150',
  rootCause: 'wastegate vacuum line crack',
  dtcs: ['P0299'],
}

describe('recordCorpusComeback', () => {
  beforeEach(() => {
    embedMock.mockClear()
    vi.resetModules()
  })

  it('returns decayed count = number of rows updated', async () => {
    // First execute = UPDATE returning 2 rows. Second execute = retire UPDATE
    // (none qualify since comebacks < 3). Mock the second call returning [].
    const execute = vi.fn()
      .mockResolvedValueOnce([
        { id: 'e1', comebackRecordedCount: 1, successConfirmCount: 5 },
        { id: 'e2', comebackRecordedCount: 1, successConfirmCount: 3 },
      ])
    const db = { execute } as unknown as AppDb
    const { recordCorpusComeback } = await import('@/lib/corpus/decay')
    const r = await recordCorpusComeback(db, BASE_INPUT)
    expect(r.decayed).toBe(2)
    expect(r.retired).toBe(0)
    expect(execute).toHaveBeenCalledTimes(1) // no retire call needed
  })

  it('auto-retires entries where comebacks >= 3 AND comebacks > successes', async () => {
    const execute = vi.fn()
      // first call: UPDATE returns rows, e1 qualifies, e2 doesn't
      .mockResolvedValueOnce([
        { id: 'e1', comebackRecordedCount: 4, successConfirmCount: 1 }, // retire
        { id: 'e2', comebackRecordedCount: 1, successConfirmCount: 5 }, // keep
      ])
      // second call: retire UPDATE
      .mockResolvedValueOnce([])
    const db = { execute } as unknown as AppDb
    const { recordCorpusComeback } = await import('@/lib/corpus/decay')
    const r = await recordCorpusComeback(db, BASE_INPUT)
    expect(r.decayed).toBe(2)
    expect(r.retired).toBe(1) // only e1 qualifies
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('does not retire when only one entry has comebacks=3 and successes=3 (tie)', async () => {
    // Tie should NOT retire — comebacks must STRICTLY exceed successes
    const execute = vi.fn()
      .mockResolvedValueOnce([
        { id: 'e1', comebackRecordedCount: 3, successConfirmCount: 3 },
      ])
    const db = { execute } as unknown as AppDb
    const { recordCorpusComeback } = await import('@/lib/corpus/decay')
    const r = await recordCorpusComeback(db, BASE_INPUT)
    expect(r.retired).toBe(0)
    expect(execute).toHaveBeenCalledTimes(1) // skip the retire call
  })

  it('returns 0/0 when no entries match the cosine threshold', async () => {
    const execute = vi.fn().mockResolvedValueOnce([])
    const db = { execute } as unknown as AppDb
    const { recordCorpusComeback } = await import('@/lib/corpus/decay')
    const r = await recordCorpusComeback(db, BASE_INPUT)
    expect(r.decayed).toBe(0)
    expect(r.retired).toBe(0)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
