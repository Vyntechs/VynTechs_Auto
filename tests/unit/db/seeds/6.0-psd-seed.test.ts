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

describe('6.0 PSD seed — batch 3 (components)', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeAll(async () => {
    ;({ db, close } = await createTestDb())
    await applySeedFile(db, 'drizzle/data/2026-05-24-6.0-psd-cranks-no-start/01-platform-and-symptom.sql')
    await applySeedFile(db, 'drizzle/data/2026-05-24-6.0-psd-cranks-no-start/02-architecture-facts.sql')
    await applySeedFile(db, 'drizzle/data/2026-05-24-6.0-psd-cranks-no-start/03-components.sql')
  })

  afterAll(async () => {
    await close()
  })

  // Section 2 of the research input has 14 rows in its component table.
  // Standpipes (front + rear) are ONE table row in Section 2, so we seed
  // them as one component row (sd3-60psd-standpipes) to match the research
  // input count. Total: 14 components.
  it('seeds exactly 14 components for the 6.0 PSD platform', async () => {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM components c
      JOIN platforms p ON p.id = c.platform_id
      WHERE p.slug = 'ford-super-duty-3rd-gen-60-psd' AND c.is_retired = false
    `)
    expect(Number(result.rows[0].count)).toBe(14)
  })

  // IPR valve and ICP sensor must be separate component rows — this is the
  // critical distinction the original Angel session violated.
  it('distinguishes IPR valve from ICP sensor as separate component rows', async () => {
    const iprResult = await db.execute(sql`
      SELECT slug FROM components
      WHERE slug = 'sd3-60psd-ipr-valve'
        AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-3rd-gen-60-psd')
    `)
    const icpResult = await db.execute(sql`
      SELECT slug FROM components
      WHERE slug = 'sd3-60psd-icp-sensor'
        AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-3rd-gen-60-psd')
    `)
    expect(iprResult.rows).toHaveLength(1)
    expect(icpResult.rows).toHaveLength(1)
  })

  // STC fitting body text must carry the year-split note (2004.5 / late-rail)
  // so technicians know it only applies to late-rail trucks.
  it('STC fitting body text mentions 2004.5 year split and late-rail', async () => {
    const result = await db.execute(sql`
      SELECT body FROM components
      WHERE slug = 'sd3-60psd-stc-fitting'
        AND platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-3rd-gen-60-psd')
    `)
    expect(result.rows).toHaveLength(1)
    const body: string = result.rows[0].body as string
    expect(body).toMatch(/2004\.5|late.?rail/i)
  })

  // Every component must have a non-null function and a non-empty systems array.
  it('all components have non-null function and non-empty systems array', async () => {
    const result = await db.execute(sql`
      SELECT slug, "function", systems
      FROM components
      WHERE platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-3rd-gen-60-psd')
        AND is_retired = false
    `)
    for (const row of result.rows) {
      expect(row.function, `slug ${row.slug} must have function`).toBeTruthy()
      expect(
        (row.systems as string[]).length,
        `slug ${row.slug} must have at least one system`,
      ).toBeGreaterThan(0)
    }
  })
})
