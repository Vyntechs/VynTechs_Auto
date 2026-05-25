/**
 * Integration test: 6.0 PSD cranks-no-start full seed-to-loader pipeline.
 *
 * Applies all 7 seed batches to PGlite, then calls loadCachedDiagnostic and
 * loadSystemTopology with the new platform + symptom. Asserts the structured
 * output matches the seed — including the three fact-check corrections:
 *   - air/puff: turbo NOT required
 *   - ICP sensor unplug: NOT the IPR
 *   - low-pressure fuel: unresolved source disagreement on cranking pressure
 *
 * WHY this matters: proves the architecture works for 6.0 PSD the same way
 * it works for the 6.7L precedent — future sessions on this platform+symptom
 * will hit the cache and bypass the AI tree-engine entirely.
 *
 * NOTE on component count for topology: loadSystemTopology filters components
 * by systems array containing the symptom's system value. 9 of the 14 seeded
 * components are tagged for 'high-pressure-oil-injection'. The 5 others
 * (glow-plugs, gpcm, lift-pump, fuel-filters, egr-cooler) are in different
 * systems (glow-plug, fuel, exhaust-gas-recirculation).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, applySeedFile, type TestDb } from '../helpers/db'
import { loadCachedDiagnostic } from '@/lib/diagnostics/cached-lookup'
import { loadSystemTopology } from '@/lib/diagnostics/load-system-topology'

const PLATFORM_SLUG = 'ford-super-duty-3rd-gen-60-psd'
const SYMPTOM_SLUG = 'cranks-no-start'
const SEED_DIR = 'drizzle/data/2026-05-24-6.0-psd-cranks-no-start'

let db: TestDb
let close: () => Promise<void>

beforeAll(async () => {
  ;({ db, close } = await createTestDb())

  await applySeedFile(db, `${SEED_DIR}/01-platform-and-symptom.sql`)
  await applySeedFile(db, `${SEED_DIR}/02-architecture-facts.sql`)
  await applySeedFile(db, `${SEED_DIR}/03-components.sql`)
  await applySeedFile(db, `${SEED_DIR}/04-observable-properties.sql`)
  await applySeedFile(db, `${SEED_DIR}/05-test-actions.sql`)
  await applySeedFile(db, `${SEED_DIR}/06-branch-logic.sql`)
  await applySeedFile(db, `${SEED_DIR}/07-symptom-test-implications.sql`)
}, 60_000)

afterAll(async () => {
  await close()
})

// ---------------------------------------------------------------------------
// loadCachedDiagnostic group
// ---------------------------------------------------------------------------

describe('loadCachedDiagnostic — 6.0 PSD cranks-no-start', () => {
  it('returns a non-null result with at least 11 tests in priority order', async () => {
    const result = await loadCachedDiagnostic({ db, platformSlug: PLATFORM_SLUG, symptomSlug: SYMPTOM_SLUG })
    expect(result).not.toBeNull()
    expect(result!.tests.length).toBeGreaterThanOrEqual(11)
    // Verify priority order is ascending (sorted correctly by loader)
    const priorities = result!.tests.map((t) => t.priority)
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b))
  })

  it('first test in priority order is the DTC pull (priority 1)', async () => {
    const result = await loadCachedDiagnostic({ db, platformSlug: PLATFORM_SLUG, symptomSlug: SYMPTOM_SLUG })
    expect(result).not.toBeNull()
    // Priority-1 test is the full DTC pull — confirmed by its description opening
    const firstTest = result!.tests[0]
    expect(firstTest.priority).toBe(1)
    expect(firstTest.description).toMatch(/full dtc pull/i)
  })

  it('last unique priority is 10 (compression test — most invasive, last resort)', async () => {
    const result = await loadCachedDiagnostic({ db, platformSlug: PLATFORM_SLUG, symptomSlug: SYMPTOM_SLUG })
    expect(result).not.toBeNull()
    const maxPriority = Math.max(...result!.tests.map((t) => t.priority)
    )
    expect(maxPriority).toBe(10)
  })

  it('air-puff test description explicitly says turbo NOT required', async () => {
    const result = await loadCachedDiagnostic({ db, platformSlug: PLATFORM_SLUG, symptomSlug: SYMPTOM_SLUG })
    expect(result).not.toBeNull()
    // Match the air/puff test by its specific title phrase
    const airTest = result!.tests.find((t) => /air.*puff.*test|puff.*test.*high-pressure/i.test(t.description))
    expect(airTest).toBeDefined()
    // Fact-check correction #1: turbo removal is NOT required for the puff test
    expect(airTest!.description).toMatch(/turbo removal is not required/i)
  })

  it('ICP sensor unplug test description explicitly says NOT the IPR', async () => {
    const result = await loadCachedDiagnostic({ db, platformSlug: PLATFORM_SLUG, symptomSlug: SYMPTOM_SLUG })
    expect(result).not.toBeNull()
    // Match by the ICP sensor unplug test's specific title phrase — distinct from the ICP live read test
    const icpUnplugTest = result!.tests.find((t) =>
      /icp sensor unplug test/i.test(t.description),
    )
    expect(icpUnplugTest).toBeDefined()
    // Fact-check correction #2: the ICP unplug is NOT the IPR test
    expect(icpUnplugTest!.description).toMatch(/not the ipr/i)
    // The IPR default of 15% (fully open) must be named so techs understand
    // why unplugging the IPR is a completely different test with the opposite result
    expect(icpUnplugTest!.description).toMatch(/15%|default.*15|fully open/i)
  })

  it('low-pressure fuel test expectedReading surfaces the unresolved cranking-pressure disagreement', async () => {
    const result = await loadCachedDiagnostic({ db, platformSlug: PLATFORM_SLUG, symptomSlug: SYMPTOM_SLUG })
    expect(result).not.toBeNull()
    const fuelTest = result!.tests.find((t) =>
      /low-pressure fuel test|schrader port/i.test(t.description),
    )
    expect(fuelTest).toBeDefined()
    // Fact-check correction #3: the cranking pressure spec is UNRESOLVED across sources.
    // The expectedReading (aliased from expectedObservation) must surface the disagreement.
    expect(fuelTest!.expectedReading).toMatch(/unresolved|disagree|10.{0,10}15.{0,20}psi/i)
  })

  it('returns the correct platform and symptom metadata', async () => {
    const result = await loadCachedDiagnostic({ db, platformSlug: PLATFORM_SLUG, symptomSlug: SYMPTOM_SLUG })
    expect(result).not.toBeNull()
    expect(result!.platform.slug).toBe(PLATFORM_SLUG)
    expect(result!.symptom.slug).toBe(SYMPTOM_SLUG)
    expect(result!.symptom.category).toBe('no-start')
    // Non-DTC symptom → dtcDisplay is null
    expect(result!.symptom.dtcDisplay).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// loadSystemTopology group
// ---------------------------------------------------------------------------

describe('loadSystemTopology — 6.0 PSD high-pressure-oil-injection system', () => {
  it('returns a result with 9 components tagged for the high-pressure-oil-injection system', async () => {
    // Only 9 of the 14 seeded components are tagged with high-pressure-oil-injection.
    // The other 5 (glow-plugs, gpcm, lift-pump, fuel-filters, egr-cooler) belong to
    // glow-plug / fuel / exhaust-gas-recirculation systems respectively.
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: SYMPTOM_SLUG })
    expect(result).not.toBeNull()
    expect(result!.components.length).toBe(9)
  })

  it('components include both sd3-60psd-ipr-valve AND sd3-60psd-icp-sensor as distinct entries', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: SYMPTOM_SLUG })
    expect(result).not.toBeNull()
    const slugs = result!.components.map((c) => c.slug)
    // Both must be present — seed explicitly distinguishes them; they are different parts
    expect(slugs).toContain('sd3-60psd-ipr-valve')
    expect(slugs).toContain('sd3-60psd-icp-sensor')
  })

  it('no duplicate component slugs in the result', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: SYMPTOM_SLUG })
    expect(result).not.toBeNull()
    const slugs = result!.components.map((c) => c.slug)
    const uniqueSlugs = [...new Set(slugs)]
    expect(slugs.length).toBe(uniqueSlugs.length)
  })

  it('returns the correct platform and system metadata', async () => {
    const result = await loadSystemTopology({ db, platformSlug: PLATFORM_SLUG, symptomSlug: SYMPTOM_SLUG })
    expect(result).not.toBeNull()
    expect(result!.platform.slug).toBe(PLATFORM_SLUG)
    expect(result!.system).toBe('high-pressure-oil-injection')
  })
})

// ---------------------------------------------------------------------------
// Cross-system sanity: seed counts match expectations
// ---------------------------------------------------------------------------

describe('Seed count sanity — all 7 batches', () => {
  it('seeded ≥10 architecture_facts for the platform', async () => {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM architecture_facts af
      JOIN platforms p ON p.id = af.platform_id
      WHERE p.slug = ${PLATFORM_SLUG} AND af.is_retired = false
    `)
    expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(10)
  })

  it('seeded exactly 14 components for the platform', async () => {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM components c
      JOIN platforms p ON p.id = c.platform_id
      WHERE p.slug = ${PLATFORM_SLUG} AND c.is_retired = false
    `)
    expect(Number(result.rows[0].count)).toBe(14)
  })

  it('seeded at least 20 observable_properties tied to platform components', async () => {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM observable_properties op
      JOIN components c ON c.id = op.component_id
      JOIN platforms p ON p.id = c.platform_id
      WHERE p.slug = ${PLATFORM_SLUG} AND op.is_retired = false
    `)
    expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(20)
  })

  it('seeded exactly 11 test_actions for the platform', async () => {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM test_actions ta
      JOIN components c ON c.id = ta.component_id
      JOIN platforms p ON p.id = c.platform_id
      WHERE p.slug = ${PLATFORM_SLUG} AND ta.is_retired = false
    `)
    expect(Number(result.rows[0].count)).toBe(11)
  })

  it('seeded at least 30 branch_logic edges for the platform', async () => {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM branch_logic bl
      JOIN test_actions ta ON ta.id = bl.test_action_id
      JOIN components c ON c.id = ta.component_id
      JOIN platforms p ON p.id = c.platform_id
      WHERE p.slug = ${PLATFORM_SLUG} AND bl.is_retired = false
    `)
    expect(Number(result.rows[0].count)).toBeGreaterThanOrEqual(30)
  })

  it('seeded exactly 11 symptom_test_implications for cranks-no-start', async () => {
    const result = await db.execute(sql`
      SELECT COUNT(*)::int AS count FROM symptom_test_implications sti
      JOIN symptoms s ON s.id = sti.symptom_id
      WHERE s.slug = ${SYMPTOM_SLUG} AND sti.is_retired = false
    `)
    expect(Number(result.rows[0].count)).toBe(11)
  })
})
