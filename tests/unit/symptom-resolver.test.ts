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

// Realistic descriptive slugs matching the live DB shape.
const SLUG_P0087 = 'p0087-fuel-rail-pressure-too-low'
const SLUG_P0088 = 'p0088-fuel-rail-pressure-too-high'
const SLUG_NO_START = 'no-start-cranks-normally-fuel-system-suspect'
const SLUG_P9999 = 'p9999-unknown-test-code'

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
      {
        slug: SLUG_P0087,
        description:
          'P0087 — Fuel rail pressure too low. Indicates HP fuel pump or regulator issue.',
        category: 'dtc',
      },
      {
        slug: SLUG_P0088,
        description:
          'P0088 — Fuel rail pressure too high. Indicates pressure-relief valve or regulator issue.',
        category: 'dtc',
      },
      {
        slug: SLUG_NO_START,
        description:
          'Engine cranks normally but will not start — fuel system suspect. No DTC set.',
        category: 'no-start',
      },
      {
        slug: SLUG_P9999,
        description: 'Unknown test code with no linked test actions on this platform.',
        category: 'dtc',
      },
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

  // 5. symptom_test_implications — link 3 real symptoms; p9999 is intentionally excluded
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
    // selectedSymptomSlug is the full descriptive slug as stored in DB
    const result = await resolveSymptomSlug({
      db,
      platformSlug: PLATFORM_SLUG,
      selectedSymptomSlug: SLUG_P0087,
      dtcCodes: ['P0088'],
      complaintText: 'truck cranks but will not start',
    })
    expect(result).not.toBeNull()
    expect(result!.symptomSlug).toBe(SLUG_P0087)
    expect(result!.symptomId).toBeTypeOf('string')
    expect(result!.platformId).toBeTypeOf('string')
  })

  it('DTC code prefix-matches the descriptive symptom slug', async () => {
    // 'P0087' → matches 'p0087-fuel-rail-pressure-too-low' (startsWith 'p0087-')
    const result = await resolveSymptomSlug({
      db,
      platformSlug: PLATFORM_SLUG,
      dtcCodes: ['P0087'],
    })
    expect(result).not.toBeNull()
    expect(result!.symptomSlug).toBe(SLUG_P0087)
    expect(result!.symptomId).toBeTypeOf('string')
    expect(result!.platformId).toBeTypeOf('string')
  })

  it('normalizes DTC code to lowercase for prefix match', async () => {
    // Uppercase 'P0087' must be normalized before prefix comparison
    const result = await resolveSymptomSlug({
      db,
      platformSlug: PLATFORM_SLUG,
      dtcCodes: ['P0087'],
    })
    expect(result).not.toBeNull()
    expect(result!.symptomSlug).toBe(SLUG_P0087)
  })

  it('matches complaint keyword for no-start when no chip or DTC', async () => {
    const result = await resolveSymptomSlug({
      db,
      platformSlug: PLATFORM_SLUG,
      complaintText: 'truck cranks but will not start',
    })
    expect(result).not.toBeNull()
    expect(result!.symptomSlug).toBe(SLUG_NO_START)
    expect(result!.symptomId).toBeTypeOf('string')
    expect(result!.platformId).toBeTypeOf('string')
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
    // SLUG_P9999 has no implication rows — not reachable, must return null
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
    // The resolver must NOT return this symptom slug.
    const [platform] = await db
      .select({ id: platforms.id })
      .from(platforms)
      .where(eq(platforms.slug, PLATFORM_SLUG))

    const [retiredSymptom] = await db
      .insert(symptoms)
      .values({
        slug: 'p0193-fuel-rail-pressure-sensor-circuit-high',
        description: 'P0193 — Fuel rail pressure sensor circuit high input',
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
