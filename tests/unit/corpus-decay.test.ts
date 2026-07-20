import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AppDb } from '@/lib/db/queries'
import { createTestDb } from '@/tests/helpers/db'
import { shops } from '@/lib/db/schema'

const embedMock = vi.fn().mockResolvedValue(Array(1024).fill(0.1))
vi.mock('@/lib/ai/embeddings', () => ({
  embed: embedMock,
}))

const BASE_INPUT = {
  shopId: '00000000-0000-4000-8000-000000000001',
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

  it('decays and retires only the originating shop corpus row', async () => {
    const { db, client, close } = await createTestDb()
    try {
      const [shopA] = await db.insert(shops).values({ name: 'Decay source shop' }).returning()
      const [shopB] = await db.insert(shops).values({ name: 'Other shop' }).returning()
      const vectorLiteral = `[${Array(1024).fill('0.1').join(',')}]`
      const entries = [
        { id: crypto.randomUUID(), sourceShopId: shopA.id },
        { id: crypto.randomUUID(), sourceShopId: shopB.id },
        { id: crypto.randomUUID(), sourceShopId: null },
      ]
      for (const entry of entries) {
        await client.query(`
          insert into corpus_entries (
            id, vehicle_year, vehicle_make, vehicle_model, symptom_tags, dtcs,
            root_cause, summary, action_type, verification, source_shop_id,
            success_confirm_count, comeback_recorded_count, confidence_score,
            is_curator_entry, entry_source, is_retired, embedding
          ) values (
            '${entry.id}', 2018, 'Ford', 'F-150', '{}', '{P0299}',
            'wastegate vacuum line crack', 'test', 'repair',
            '{"codesCleared":true,"testDrive":true,"symptomsResolved":"yes"}'::jsonb,
            ${entry.sourceShopId === null ? 'null' : `'${entry.sourceShopId}'`},
            0, 2, 0.5, false, 'auto_promoted', false, '${vectorLiteral}'::vector
          )
        `)
      }

      const { recordCorpusComeback } = await import('@/lib/corpus/decay')
      await expect(recordCorpusComeback(db as unknown as AppDb, {
        ...BASE_INPUT,
        shopId: shopA.id,
      })).resolves.toEqual({ decayed: 1, retired: 1 })

      const after = await client.query<{
        id: string
        source_shop_id: string | null
        comeback_recorded_count: number
        is_retired: boolean
      }>(`
        select id, source_shop_id, comeback_recorded_count, is_retired
        from corpus_entries
        where id in ('${entries.map((entry) => entry.id).join("','")}')
        order by id
      `)
      const byId = new Map(after.rows.map((entry) => [entry.id, entry]))

      expect(byId.get(entries[0].id)).toMatchObject({
        source_shop_id: shopA.id, comeback_recorded_count: 3, is_retired: true,
      })
      expect(byId.get(entries[1].id)).toMatchObject({
        source_shop_id: shopB.id, comeback_recorded_count: 2, is_retired: false,
      })
      expect(byId.get(entries[2].id)).toMatchObject({
        source_shop_id: null, comeback_recorded_count: 2, is_retired: false,
      })
    } finally {
      await close()
    }
  })
})
