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

describe('6.0 PSD seed — batch 2 (architecture_facts)', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeAll(async () => {
    ;({ db, close } = await createTestDb())
    await applySeedFile(db, 'drizzle/data/2026-05-24-6.0-psd-cranks-no-start/01-platform-and-symptom.sql')
    await applySeedFile(db, 'drizzle/data/2026-05-24-6.0-psd-cranks-no-start/02-architecture-facts.sql')
  })

  afterAll(async () => {
    await close()
  })

  it('seeds ≥10 architecture_facts for the 6.0 PSD platform', async () => {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM architecture_facts af
      JOIN platforms p ON p.id = af.platform_id
      WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND af.is_retired = false
    `)
    expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(10)
  })

  it('explicitly distinguishes IPR valve from ICP sensor in architecture_facts', async () => {
    const result = await db.execute(sql`
      SELECT description FROM architecture_facts af
      JOIN platforms p ON p.id = af.platform_id
      WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd'
        AND af.description ~* '(IPR.+ICP|ICP.+IPR)'
        AND af.is_retired = false
    `)
    expect(result.rows.length).toBeGreaterThanOrEqual(1)
  })

  it('encodes oil cooler 15°F delta-T threshold fact', async () => {
    const result = await db.execute(sql`
      SELECT description FROM architecture_facts af
      JOIN platforms p ON p.id = af.platform_id
      WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd'
        AND af.description ~* '15'
        AND af.description ~* 'oil cooler'
        AND af.is_retired = false
    `)
    expect(result.rows.length).toBeGreaterThanOrEqual(1)
  })

  it('all architecture_facts rows have required fields populated', async () => {
    const result = await db.execute(sql`
      SELECT af.slug, af.description, af.source_provenance, af.is_retired
      FROM architecture_facts af
      JOIN platforms p ON p.id = af.platform_id
      WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd'
    `)
    for (const row of result.rows) {
      expect(row.slug).toBeTruthy()
      expect(row.description).toBeTruthy()
      expect(row.source_provenance).toBeTruthy()
      expect(row.is_retired).toBe(false)
    }
  })
})
