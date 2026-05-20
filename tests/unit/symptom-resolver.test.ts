import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  platforms,
  symptoms,
  components,
  testActions,
  symptomTestImplications,
} from '@/lib/db/schema'
import { resolveSymptomSlug } from '@/lib/diagnostics/symptom-resolver'

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

  // 2. Symptoms (3 linked + 1 unlinked)
  const [sympP0087, sympP0088, sympNoStart, sympP9999] = await db
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
    ])
    .returning({ id: symptoms.id, slug: symptoms.slug })

  // 3. One component on the platform (needed as FK target for test_actions)
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

  // 4. Three test_actions (one per linked symptom)
  const [ta87, ta88, taNoStart] = await db
    .insert(testActions)
    .values([
      {
        slug: 'ta-rail-pressure-key-on-p0087',
        componentId: component.id,
        description: 'Check fuel rail pressure key-on for P0087',
        scenarioRequired: 'key-on',
        observationMethod: 'scan_tool_pid',
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
        invasiveness: 1,
        confidenceBoost: 30,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
      {
        slug: 'ta-cranking-fuel-pressure-no-start',
        componentId: component.id,
        description: 'Check fuel pressure while cranking for no-start',
        scenarioRequired: 'cranking',
        observationMethod: 'pressure_test_with_gauge',
        invasiveness: 2,
        confidenceBoost: 40,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
    ])
    .returning({ id: testActions.id })

  // 5. symptom_test_implications — link the 3 real symptoms; p9999 is intentionally excluded
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
      testActionId: taNoStart.id,
      priority: 1,
      sourceProvenance: 'TRAINING-CONFIRMED',
    },
  ])

  return { platformId: platform.id }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveSymptomSlug', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await seedFixtures(db)
  })

  afterEach(async () => {
    await close()
  })

  it('chip slug wins over DTC and complaint text', async () => {
    const result = await resolveSymptomSlug({
      db,
      platformSlug: PLATFORM_SLUG,
      selectedSymptomSlug: 'p0087',
      dtcCodes: ['P0088'],
      complaintText: 'truck cranks but will not start',
    })
    expect(result).toBe('p0087')
  })

  it('falls back to DTC when no chip slug is provided', async () => {
    const result = await resolveSymptomSlug({
      db,
      platformSlug: PLATFORM_SLUG,
      dtcCodes: ['P0087'],
    })
    expect(result).toBe('p0087')
  })

  it('normalizes DTC code to lowercase for slug lookup', async () => {
    // Input is uppercase 'P0087'; the seeded symptom slug is lowercase 'p0087', so
    // this test genuinely proves the resolver lowercases the input DTC before the DB lookup.
    const result = await resolveSymptomSlug({
      db,
      platformSlug: PLATFORM_SLUG,
      dtcCodes: ['P0087'],
    })
    expect(result).toBe('p0087')
  })

  it('matches complaint keyword for no-start when no chip or DTC', async () => {
    const result = await resolveSymptomSlug({
      db,
      platformSlug: PLATFORM_SLUG,
      complaintText: 'truck cranks but will not start',
    })
    expect(result).toBe('no-start-cranks-normally-fuel-system-suspect')
  })

  it('returns null when nothing matches any symptom', async () => {
    const result = await resolveSymptomSlug({
      db,
      platformSlug: PLATFORM_SLUG,
      complaintText: 'wipers stopped working',
    })
    expect(result).toBeNull()
  })

  it('returns null when DTC exists but has no symptom_test_implications for the platform', async () => {
    const result = await resolveSymptomSlug({
      db,
      platformSlug: PLATFORM_SLUG,
      dtcCodes: ['P9999'],
    })
    expect(result).toBeNull()
  })

  it('returns null for an unknown platform slug', async () => {
    const result = await resolveSymptomSlug({
      db,
      platformSlug: 'nonexistent-platform',
      dtcCodes: ['P0087'],
    })
    expect(result).toBeNull()
  })

  it('returns null when the symptom_test_implication is retired (retired rows are not reachable)', async () => {
    // Seed a new symptom + test_action + component linked to the platform,
    // then mark the symptom_test_implication as isRetired = true.
    // The resolver must NOT return this symptom slug — a retired implication breaks the join chain.
    const [platform] = await db
      .select({ id: platforms.id })
      .from(platforms)
      .where(eq(platforms.slug, PLATFORM_SLUG))

    const [retiredSymptom] = await db
      .insert(symptoms)
      .values({
        slug: 'p0193',
        description: 'Fuel rail pressure sensor circuit high input',
        category: 'dtc',
      })
      .returning({ id: symptoms.id })

    const [retiredComponent] = await db
      .insert(components)
      .values({
        slug: 'cp-frps-retired-test',
        platformId: platform.id,
        name: 'Fuel Rail Pressure Sensor (retired test)',
        kind: 'sensor',
        sourceProvenance: 'TRAINING-CONFIRMED',
      })
      .returning({ id: components.id })

    const [retiredTestAction] = await db
      .insert(testActions)
      .values({
        slug: 'ta-frps-p0193-retired',
        componentId: retiredComponent.id,
        description: 'Check FRPS signal voltage for P0193',
        scenarioRequired: 'key-on',
        observationMethod: 'electrical_measurement_at_pin',
        invasiveness: 1,
        confidenceBoost: 25,
        sourceProvenance: 'TRAINING-CONFIRMED',
      })
      .returning({ id: testActions.id })

    // Insert the implication with isRetired = true — this is the retired row.
    await db.insert(symptomTestImplications).values({
      symptomId: retiredSymptom.id,
      testActionId: retiredTestAction.id,
      priority: 1,
      sourceProvenance: 'TRAINING-CONFIRMED',
      isRetired: true,
    })

    const result = await resolveSymptomSlug({
      db,
      platformSlug: PLATFORM_SLUG,
      dtcCodes: ['P0193'],
    })
    expect(result).toBeNull()
  })
})
