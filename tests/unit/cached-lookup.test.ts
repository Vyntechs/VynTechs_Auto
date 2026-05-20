import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  platforms,
  symptoms,
  components,
  testActions,
  symptomTestImplications,
  diagnosticSessions,
  shops,
  vehicles,
  customers,
  profiles,
} from '@/lib/db/schema'
import {
  listCachedSymptomsForPlatform,
  loadCachedDiagnostic,
} from '@/lib/diagnostics/cached-lookup'

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const PLATFORM_SLUG = 'ford-super-duty-4th-gen-67-psd'

async function seedFixtures(db: TestDb) {
  // 1. Platform
  const [platform] = await db
    .insert(platforms)
    .values({
      slug: PLATFORM_SLUG,
      yearRange: '2017-2022',
      parentMake: 'Ford',
      parentModelFamily: 'Super Duty',
      generation: '4th gen',
    })
    .returning({ id: platforms.id })

  // 2. Symptoms (2 DTC + 1 no-start + 1 unlinked + 1 only-retired)
  const [sympP0087, sympP0088, sympNoStart, sympUnlinked, sympRetiredOnly] = await db
    .insert(symptoms)
    .values([
      { slug: 'p0087', description: 'Fuel rail pressure too low', category: 'dtc' },
      { slug: 'p0088', description: 'Fuel rail pressure too high', category: 'dtc' },
      {
        slug: 'no-start-cranks-normally-fuel-system-suspect',
        description: 'Engine cranks normally but will not start — fuel system suspect',
        category: 'no-start',
      },
      { slug: 'p9999', description: 'Unknown test code', category: 'dtc' },
      { slug: 'p0001-retired-only', description: 'Retired implication only', category: 'dtc' },
    ])
    .returning({ id: symptoms.id, slug: symptoms.slug })

  // 3. One component on the platform
  const [component] = await db
    .insert(components)
    .values({
      slug: 'cp-fuel-rail-pressure-sensor',
      platformId: platform.id,
      name: 'Fuel Rail Pressure Sensor',
      kind: 'sensor',
      sourceProvenance: 'TRAINING-CONFIRMED',
    })
    .returning({ id: components.id })

  // 4. Test actions — three active + one for the retired-only symptom
  const [ta87, ta88, taNoStart1, taNoStart2, taRetired] = await db
    .insert(testActions)
    .values([
      {
        slug: 'ta-rail-pressure-key-on-p0087',
        componentId: component.id,
        description: 'Check fuel rail pressure key-on for P0087',
        scenarioRequired: 'key-on',
        observationMethod: 'scan_tool_pid',
        expectedObservation: 'Should read 26,000–28,000 PSI at key-on',
        invasiveness: 1,
        confidenceBoost: 30,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
      {
        slug: 'ta-rail-pressure-key-on-p0088',
        componentId: component.id,
        description: 'Check fuel rail pressure key-on for P0088',
        scenarioRequired: 'key-on',
        observationMethod: 'scan_tool_pid',
        expectedObservation: 'Should read under 30,000 PSI at key-on',
        invasiveness: 1,
        confidenceBoost: 30,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
      {
        slug: 'ta-cranking-fuel-pressure-no-start-p1',
        componentId: component.id,
        description: 'Check fuel pressure while cranking for no-start',
        scenarioRequired: 'cranking',
        observationMethod: 'pressure_test_with_gauge',
        expectedObservation: 'Minimum 14,000 PSI cranking',
        invasiveness: 2,
        confidenceBoost: 40,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
      {
        slug: 'ta-cranking-fuel-pressure-no-start-p2',
        componentId: component.id,
        description: 'Check LP pump output pressure',
        scenarioRequired: 'cranking',
        observationMethod: 'pressure_test_with_gauge',
        expectedObservation: '6–8 PSI at LP pump',
        invasiveness: 2,
        confidenceBoost: 20,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
      {
        slug: 'ta-retired-action',
        componentId: component.id,
        description: 'Retired test action',
        scenarioRequired: 'key-on',
        observationMethod: 'scan_tool_pid',
        invasiveness: 1,
        confidenceBoost: 10,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
    ])
    .returning({ id: testActions.id })

  // 5. Symptom-test implications
  //    p0087: 1 active implication
  //    p0088: 1 active implication
  //    no-start: 2 active implications (priority 1 and 2) — tests ordering
  //    p9999: no implication (unlinked)
  //    p0001-retired-only: 1 implication with isRetired = true
  await db.insert(symptomTestImplications).values([
    {
      symptomId: sympP0087.id,
      testActionId: ta87.id,
      priority: 1,
      sourceProvenance: 'TRAINING-CONFIRMED',
    },
    {
      symptomId: sympP0088.id,
      testActionId: ta88.id,
      priority: 1,
      sourceProvenance: 'TRAINING-CONFIRMED',
    },
    {
      symptomId: sympNoStart.id,
      testActionId: taNoStart2.id,
      priority: 2,
      sourceProvenance: 'TRAINING-CONFIRMED',
    },
    {
      symptomId: sympNoStart.id,
      testActionId: taNoStart1.id,
      priority: 1,
      sourceProvenance: 'TRAINING-CONFIRMED',
    },
    {
      symptomId: sympRetiredOnly.id,
      testActionId: taRetired.id,
      priority: 1,
      sourceProvenance: 'TRAINING-CONFIRMED',
      isRetired: true,
    },
  ])

  return { platformId: platform.id, sympNoStart, sympP0087 }
}

// ---------------------------------------------------------------------------
// listCachedSymptomsForPlatform
// ---------------------------------------------------------------------------

describe('listCachedSymptomsForPlatform', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await seedFixtures(db)
  })

  afterEach(async () => {
    await close()
  })

  it('returns the reachable, deduped symptoms for a known platform ordered by description', async () => {
    const result = await listCachedSymptomsForPlatform({ db, platformSlug: PLATFORM_SLUG })

    // 3 active symptoms: p0087, p0088, no-start (p9999 unlinked, p0001-retired-only excluded)
    expect(result).toHaveLength(3)

    const slugs = result.map((r) => r.slug)
    expect(slugs).toContain('p0087')
    expect(slugs).toContain('p0088')
    expect(slugs).toContain('no-start-cranks-normally-fuel-system-suspect')
    expect(slugs).not.toContain('p9999')
    expect(slugs).not.toContain('p0001-retired-only')

    // Each result has the required shape
    for (const item of result) {
      expect(item).toHaveProperty('slug')
      expect(item).toHaveProperty('description')
      expect(item).toHaveProperty('category')
    }

    // Ordered by description ascending
    const descriptions = result.map((r) => r.description)
    expect(descriptions).toEqual([...descriptions].sort())
  })

  it('no-start symptom appears only once even though it has 2 test implications', async () => {
    const result = await listCachedSymptomsForPlatform({ db, platformSlug: PLATFORM_SLUG })
    const noStartRows = result.filter((r) => r.slug === 'no-start-cranks-normally-fuel-system-suspect')
    expect(noStartRows).toHaveLength(1)
  })

  it('returns [] for an unknown platform slug', async () => {
    const result = await listCachedSymptomsForPlatform({ db, platformSlug: 'nonexistent-platform' })
    expect(result).toEqual([])
  })

  it('excludes a symptom whose only implication is retired', async () => {
    const result = await listCachedSymptomsForPlatform({ db, platformSlug: PLATFORM_SLUG })
    const slugs = result.map((r) => r.slug)
    expect(slugs).not.toContain('p0001-retired-only')
  })
})

// ---------------------------------------------------------------------------
// loadCachedDiagnostic
// ---------------------------------------------------------------------------

describe('loadCachedDiagnostic', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await seedFixtures(db)
  })

  afterEach(async () => {
    await close()
  })

  it('returns a correctly-shaped payload for a known platform + DTC symptom', async () => {
    const result = await loadCachedDiagnostic({
      db,
      platformSlug: PLATFORM_SLUG,
      symptomSlug: 'p0087',
    })

    expect(result).not.toBeNull()
    expect(result!.platform.slug).toBe(PLATFORM_SLUG)
    expect(typeof result!.platform.name).toBe('string')
    expect(result!.platform.name.length).toBeGreaterThan(0)

    expect(result!.symptom.slug).toBe('p0087')
    expect(result!.symptom.category).toBe('dtc')
    // DTC category → dtcDisplay is uppercased slug
    expect(result!.symptom.dtcDisplay).toBe('P0087')

    expect(typeof result!.gateThreshold).toBe('number')
    expect(result!.gateThreshold).toBeGreaterThan(0)
    expect(result!.gateThreshold).toBeLessThanOrEqual(1)

    expect(typeof result!.priorFixCount).toBe('number')
    expect(result!.priorFixCount).toBeGreaterThanOrEqual(0)

    expect(Array.isArray(result!.tests)).toBe(true)
    expect(result!.tests).toHaveLength(1)

    const test = result!.tests[0]
    expect(typeof test.priority).toBe('number')
    expect(typeof test.description).toBe('string')
    expect(typeof test.invasiveness).toBe('number')
  })

  it('dtcDisplay is null for non-DTC category symptoms', async () => {
    const result = await loadCachedDiagnostic({
      db,
      platformSlug: PLATFORM_SLUG,
      symptomSlug: 'no-start-cranks-normally-fuel-system-suspect',
    })

    expect(result).not.toBeNull()
    expect(result!.symptom.category).toBe('no-start')
    expect(result!.symptom.dtcDisplay).toBeNull()
  })

  it('orders tests by priority ascending', async () => {
    const result = await loadCachedDiagnostic({
      db,
      platformSlug: PLATFORM_SLUG,
      symptomSlug: 'no-start-cranks-normally-fuel-system-suspect',
    })

    expect(result).not.toBeNull()
    expect(result!.tests).toHaveLength(2)

    const priorities = result!.tests.map((t) => t.priority)
    expect(priorities[0]).toBe(1)
    expect(priorities[1]).toBe(2)
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b))
  })

  it('returns null for an unknown symptom slug', async () => {
    const result = await loadCachedDiagnostic({
      db,
      platformSlug: PLATFORM_SLUG,
      symptomSlug: 'p9999-does-not-exist',
    })
    expect(result).toBeNull()
  })

  it('returns null for an unknown platform slug', async () => {
    const result = await loadCachedDiagnostic({
      db,
      platformSlug: 'nonexistent-platform',
      symptomSlug: 'p0087',
    })
    expect(result).toBeNull()
  })

  it('returns null for a symptom that has no reachable tests (unlinked symptom)', async () => {
    const result = await loadCachedDiagnostic({
      db,
      platformSlug: PLATFORM_SLUG,
      symptomSlug: 'p9999',
    })
    expect(result).toBeNull()
  })

  it('excludes retired test rows from the tests array', async () => {
    // p0001-retired-only has one implication with isRetired=true → zero active tests → null
    const result = await loadCachedDiagnostic({
      db,
      platformSlug: PLATFORM_SLUG,
      symptomSlug: 'p0001-retired-only',
    })
    // Should return null because there are no active test rows
    expect(result).toBeNull()
  })

  it('priorFixCount reflects completed diagnostic sessions for this symptom', async () => {
    // Seed the minimal graph needed for a diagnostic_session row:
    // shop → customer → vehicle → diagnostic_session (with symptomId = p0087, finalVerdict = commit-allowed)
    const [shop] = await db
      .insert(shops)
      .values({ name: 'Test Shop' })
      .returning({ id: shops.id })

    const [profile] = await db
      .insert(profiles)
      .values({
        userId: '00000000-0000-0000-0000-000000000001',
        shopId: shop.id,
        role: 'tech',
      })
      .returning({ id: profiles.id })

    const [customer] = await db
      .insert(customers)
      .values({ shopId: shop.id, name: 'Test Customer', phone: '555-0000' })
      .returning({ id: customers.id })

    const [vehicle] = await db
      .insert(vehicles)
      .values({ customerId: customer.id, year: 2019, make: 'Ford', model: 'F-250' })
      .returning({ id: vehicles.id })

    // Look up the symptom id for p0087
    const [sympRow] = await db
      .select({ id: symptoms.id })
      .from(symptoms)
      .where(
        (await import('drizzle-orm').then((m) => m.eq))(symptoms.slug, 'p0087'),
      )

    await db.insert(diagnosticSessions).values({
      vehicleId: vehicle.id,
      symptomId: sympRow.id,
      shopId: shop.id,
      techId: profile.id,
      finalVerdict: 'commit-allowed',
      cumulativeConfidence: 0.9,
    })

    const result = await loadCachedDiagnostic({
      db,
      platformSlug: PLATFORM_SLUG,
      symptomSlug: 'p0087',
    })

    expect(result).not.toBeNull()
    expect(result!.priorFixCount).toBe(1)
  })
})
