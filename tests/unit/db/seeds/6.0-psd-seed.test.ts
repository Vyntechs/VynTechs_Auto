import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, applySeedFile, type TestDb } from '../../../helpers/db'

describe('6.0 PSD seed — batch 1 (platform + symptom)', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeAll(async () => {
    ;({ db, close } = await createTestDb())
    await applySeedFile(db, 'drizzle/data/2026-05-24-6.0-psd-cranks-no-start/01-platform-and-symptom.sql')
  })

  afterAll(async () => {
    await close()
  })

  it('inserts the 2003-2007 F-250 6.0L PSD platform with the expected slug', async () => {
    const result = await db.execute(sql`
      SELECT slug, parent_make, parent_model_family, generation, year_range
      FROM platforms WHERE slug = 'ford-super-duty-3rd-gen-60-psd'
    `)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      slug: 'ford-super-duty-3rd-gen-60-psd',
      parent_make: 'Ford',
      generation: '3rd gen',
    })
  })

  it('ensures cranks-no-start symptom exists with no-start category', async () => {
    const result = await db.execute(sql`
      SELECT slug, category FROM symptoms WHERE slug = 'cranks-no-start'
    `)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0]).toMatchObject({
      slug: 'cranks-no-start',
      category: 'no-start',
    })
  })
})
