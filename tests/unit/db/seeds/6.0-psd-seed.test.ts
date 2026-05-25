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

describe('6.0 PSD seed — batch 4 (observable_properties)', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeAll(async () => {
    ;({ db, close } = await createTestDb())
    await applySeedFile(db, 'drizzle/data/2026-05-24-6.0-psd-cranks-no-start/01-platform-and-symptom.sql')
    await applySeedFile(db, 'drizzle/data/2026-05-24-6.0-psd-cranks-no-start/02-architecture-facts.sql')
    await applySeedFile(db, 'drizzle/data/2026-05-24-6.0-psd-cranks-no-start/03-components.sql')
    await applySeedFile(db, 'drizzle/data/2026-05-24-6.0-psd-cranks-no-start/04-observable-properties.sql')
  })

  afterAll(async () => {
    await close()
  })

  // ≥20 observable properties tied to 6.0 PSD components
  it('seeds ≥20 observable properties tied to 6.0 PSD components', async () => {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count
      FROM observable_properties op
      JOIN components c ON c.id = op.component_id
      WHERE c.platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-3rd-gen-60-psd')
        AND op.is_retired = false
    `)
    expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(20)
  })

  // ICP voltage and ICP PSI actual must be distinct properties — they measure
  // different things (raw sensor voltage vs PCM-computed pressure).
  it('includes both sd3-60psd-icp-volts and sd3-60psd-icp-psi-actual as distinct properties', async () => {
    const result = await db.execute(sql`
      SELECT slug FROM observable_properties
      WHERE slug IN ('sd3-60psd-icp-volts', 'sd3-60psd-icp-psi-actual')
    `)
    expect(result.rows).toHaveLength(2)
  })

  // Fuel pressure description must surface the unresolved Ford-vs-aftermarket
  // disagreement so the tech knows this is a contested reading.
  it('sd3-60psd-fuel-pressure-schrader description surfaces the unresolved cranking-pressure disagreement', async () => {
    const result = await db.execute(sql`
      SELECT description FROM observable_properties
      WHERE slug = 'sd3-60psd-fuel-pressure-schrader'
    `)
    expect(result.rows).toHaveLength(1)
    const desc = result.rows[0].description as string
    expect(desc).toMatch(/unresolved|disagree|45 psi.{0,30}10.{0,10}15|both .{0,30}documented/i)
  })

  // Glow plug current description must mention both the ~80 A per-bank initial
  // inrush AND the per-plug steady-state current so techs know both numbers.
  it('sd3-60psd-glow-plug-current-per-bank description mentions both 80 A bank and per-plug current', async () => {
    const result = await db.execute(sql`
      SELECT description FROM observable_properties
      WHERE slug = 'sd3-60psd-glow-plug-current-per-bank'
    `)
    expect(result.rows).toHaveLength(1)
    const desc = result.rows[0].description as string
    expect(desc).toMatch(/80\s*A/i)
    expect(desc).toMatch(/10.{0,5}12\s*A|per.plug/i)
  })

  // All observable_properties rows must have required fields populated.
  it('all observable_properties rows have required fields populated', async () => {
    const result = await db.execute(sql`
      SELECT op.slug, op.description, op.observation_method, op.source_provenance, op.is_retired
      FROM observable_properties op
      JOIN components c ON c.id = op.component_id
      WHERE c.platform_id = (SELECT id FROM platforms WHERE slug = 'ford-super-duty-3rd-gen-60-psd')
    `)
    for (const row of result.rows) {
      expect(row.slug, 'slug must be present').toBeTruthy()
      expect(row.description, `${row.slug} description must be present`).toBeTruthy()
      expect(row.observation_method, `${row.slug} observation_method must be present`).toBeTruthy()
      expect(row.source_provenance, `${row.slug} source_provenance must be present`).toBeTruthy()
      expect(row.is_retired, `${row.slug} is_retired must be false`).toBe(false)
    }
  })
})
