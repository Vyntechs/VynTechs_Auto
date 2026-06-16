import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { and, count, eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile, createSession } from '@/lib/db/queries'
import {
  customers,
  vehicles,
  symptoms,
  diagnosticSessions,
  platforms,
  components,
  testActions,
  symptomTestImplications,
} from '@/lib/db/schema'
import type { OutcomePayload } from '@/lib/db/schema'
import { recordDiagnosticSession } from '@/lib/diagnostics/record-diagnostic-session'
import { resolveSymptomSlug } from '@/lib/diagnostics/symptom-resolver'
import { loadCachedDiagnostic } from '@/lib/diagnostics/cached-lookup'

// ---------------------------------------------------------------------------
// Why this suite exists
//
// The "proof-of-fix" counter (cached-lookup.ts) counts diagnostic_sessions rows
// with finalVerdict = 'commit-allowed', keyed by symptomId. Nothing writes those
// rows today, so the counter is structurally stuck at zero. recordDiagnosticSession
// is the writer that fixes that — but it MUST be honest:
//   - a confirmed fix is recorded ONLY when the tech's own verification says the
//     symptom was resolved AND a real repair action was taken;
//   - a non-fix (no_fix/referred, or "symptoms NOT resolved") is NEVER counted as
//     a win — it is recorded with a truthful non-allowed verdict, or not at all;
//   - when the complaint can't be resolved to a KNOWN problem (empty/unseeded
//     catalog, unrecognizable complaint), the writer stays SILENT rather than
//     guess — no fabricated symptom attribution.
//
// These tests fail if any of those honesty invariants break.
// ---------------------------------------------------------------------------

async function seedShopTechVehicle(db: TestDb) {
  const shop = await createShop(db, { name: 'Test Shop' })
  const tech = await createProfile(db, { userId: crypto.randomUUID(), shopId: shop.id })
  const [customer] = await db
    .insert(customers)
    .values({ shopId: shop.id, name: 'Acme Hauling', phone: '555-0100' })
    .returning()
  const [vehicle] = await db
    .insert(vehicles)
    .values({ customerId: customer.id, year: 2017, make: 'Ford', model: 'F-250', engine: '6.7L Power Stroke' })
    .returning()
  return { shop, tech, vehicle }
}

async function seedSymptom(db: TestDb, slug: string) {
  const [symptom] = await db
    .insert(symptoms)
    .values({ slug, description: `desc for ${slug}`, category: 'no-start' })
    .returning()
  return symptom
}

function makeOutcome(overrides: Partial<OutcomePayload> = {}): OutcomePayload {
  return {
    rootCause:
      'High-pressure fuel pump failure on 6.7L Power Stroke — confirmed zero rail pressure on crank',
    actionType: 'part_replacement',
    verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
    diagMinutes: 40,
    repairMinutes: 120,
    ...overrides,
  }
}

/** Mirror of cached-lookup.ts's proof-of-fix query, so we prove the linkage to
 *  the REAL counter — not just that some row exists. */
async function priorFixCount(db: TestDb, symptomId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(diagnosticSessions)
    .where(
      and(
        eq(diagnosticSessions.symptomId, symptomId),
        eq(diagnosticSessions.finalVerdict, 'commit-allowed'),
      ),
    )
  return row?.value ?? 0
}

describe('recordDiagnosticSession', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })
  afterEach(async () => {
    await close()
  })

  it('records a commit-allowed session when a real repair resolves the verified symptom — and the proof-of-fix counter increments', async () => {
    const { shop, tech, vehicle } = await seedShopTechVehicle(db)
    const symptom = await seedSymptom(db, 'cranks-no-start')

    const result = await recordDiagnosticSession(db, {
      vehicleId: vehicle.id,
      shopId: shop.id,
      techId: tech.id,
      complaintText: 'engine cranks but no start, no fuel',
      outcome: makeOutcome({ actionType: 'repair', verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' } }),
    })

    expect(result.written).toBe(true)
    if (!result.written) throw new Error('unreachable')
    expect(result.finalVerdict).toBe('commit-allowed')

    // a real row landed, tied to the resolved symptom + this vehicle/shop/tech
    const [row] = await db
      .select()
      .from(diagnosticSessions)
      .where(eq(diagnosticSessions.id, result.diagnosticSessionId))
    expect(row.symptomId).toBe(symptom.id)
    expect(row.vehicleId).toBe(vehicle.id)
    expect(row.shopId).toBe(shop.id)
    expect(row.techId).toBe(tech.id)
    expect(row.finalVerdict).toBe('commit-allowed')
    expect(row.completedAt).not.toBeNull()

    // the actual counter the UI reads now returns 1 for this symptom
    expect(await priorFixCount(db, symptom.id)).toBe(1)
  })

  it('never counts a "no_fix" close as a confirmed fix, even if the resolved box was ticked yes (no fabrication)', async () => {
    const { shop, tech, vehicle } = await seedShopTechVehicle(db)
    const symptom = await seedSymptom(db, 'cranks-no-start')

    const result = await recordDiagnosticSession(db, {
      vehicleId: vehicle.id,
      shopId: shop.id,
      techId: tech.id,
      complaintText: 'cranks but will not start',
      // contradictory input: claims resolved, but no actual fix was performed
      outcome: makeOutcome({ actionType: 'no_fix', verification: { codesCleared: false, testDrive: false, symptomsResolved: 'yes' } }),
    })

    expect(result.written).toBe(true)
    if (!result.written) throw new Error('unreachable')
    expect(result.finalVerdict).toBe('commit-refused')
    // the win counter must stay empty
    expect(await priorFixCount(db, symptom.id)).toBe(0)
  })

  it('never counts a close where the tech says symptoms were NOT resolved', async () => {
    const { shop, tech, vehicle } = await seedShopTechVehicle(db)
    const symptom = await seedSymptom(db, 'cranks-no-start')

    const result = await recordDiagnosticSession(db, {
      vehicleId: vehicle.id,
      shopId: shop.id,
      techId: tech.id,
      complaintText: 'cranks no start',
      outcome: makeOutcome({ actionType: 'part_replacement', verification: { codesCleared: false, testDrive: true, symptomsResolved: 'no' } }),
    })

    expect(result.written).toBe(true)
    if (!result.written) throw new Error('unreachable')
    expect(result.finalVerdict).toBe('commit-refused')
    expect(await priorFixCount(db, symptom.id)).toBe(0)
  })

  it('records a partial resolution as "incomplete", not a win', async () => {
    const { shop, tech, vehicle } = await seedShopTechVehicle(db)
    const symptom = await seedSymptom(db, 'cranks-no-start')

    const result = await recordDiagnosticSession(db, {
      vehicleId: vehicle.id,
      shopId: shop.id,
      techId: tech.id,
      complaintText: 'cranks but no start intermittently',
      outcome: makeOutcome({ actionType: 'repair', verification: { codesCleared: false, testDrive: true, symptomsResolved: 'partial' } }),
    })

    expect(result.written).toBe(true)
    if (!result.written) throw new Error('unreachable')
    expect(result.finalVerdict).toBe('incomplete')
    expect(await priorFixCount(db, symptom.id)).toBe(0)
  })

  it('stays SILENT when the complaint cannot be resolved to a known problem (no guessing)', async () => {
    const { shop, tech, vehicle } = await seedShopTechVehicle(db)
    await seedSymptom(db, 'cranks-no-start')

    const result = await recordDiagnosticSession(db, {
      vehicleId: vehicle.id,
      shopId: shop.id,
      techId: tech.id,
      complaintText: 'customer says it feels weird sometimes', // matches no pattern
      outcome: makeOutcome(),
    })

    expect(result.written).toBe(false)
    if (result.written) throw new Error('unreachable')
    expect(result.reason).toBe('symptom-unresolved')
    const [{ value }] = await db.select({ value: count() }).from(diagnosticSessions)
    expect(value).toBe(0)
  })

  it('stays SILENT when the resolved problem is not in the catalog yet (valve installed, data not yet arrived)', async () => {
    const { shop, tech, vehicle } = await seedShopTechVehicle(db)
    // NOTE: no symptom row seeded — the catalog is empty for this slug

    const result = await recordDiagnosticSession(db, {
      vehicleId: vehicle.id,
      shopId: shop.id,
      techId: tech.id,
      selectedSymptomSlug: 'cranks-no-start',
      complaintText: 'cranks but no start',
      outcome: makeOutcome(),
    })

    expect(result.written).toBe(false)
    if (result.written) throw new Error('unreachable')
    expect(result.reason).toBe('symptom-not-in-catalog')
    const [{ value }] = await db.select({ value: count() }).from(diagnosticSessions)
    expect(value).toBe(0)
  })

  it('stays SILENT when the session has no vehicle (cannot honestly attribute a fix)', async () => {
    const { shop, tech } = await seedShopTechVehicle(db)
    await seedSymptom(db, 'cranks-no-start')

    const result = await recordDiagnosticSession(db, {
      vehicleId: null,
      shopId: shop.id,
      techId: tech.id,
      complaintText: 'cranks but no start',
      outcome: makeOutcome(),
    })

    expect(result.written).toBe(false)
    if (result.written) throw new Error('unreachable')
    expect(result.reason).toBe('no-vehicle')
  })

  // This is the end-to-end proof that the writer is wired to the SAME slug the
  // counter reads. The writer resolves the symptom from the complaint via
  // resolveSymptomSlug; the counter's view path (app/(app)/sessions/[id]/page.tsx)
  // resolves it the identical way. Here we seed the catalog under that exact
  // emitted slug, then assert the REAL loadCachedDiagnostic.priorFixCount — not a
  // hand-copied mirror — moves 0 -> 1. If writer and counter ever keyed on
  // different slugs, this test would stay at 0 and fail.
  describe('real proof-of-fix counter linkage (loadCachedDiagnostic)', () => {
    async function seedCatalogChainForCranksNoStart() {
      const [platform] = await db
        .insert(platforms)
        .values({
          slug: 'ford-super-duty-67',
          yearRange: '2017-2022',
          parentMake: 'Ford',
          parentModelFamily: 'Super Duty',
          generation: '4th Gen',
        })
        .returning()
      const [symptom] = await db
        .insert(symptoms)
        .values({ slug: 'cranks-no-start', description: 'Cranks, no start', category: 'no-start' })
        .returning()
      const [component] = await db
        .insert(components)
        .values({
          slug: 'hp-fuel-pump',
          platformId: platform.id,
          name: 'HP Fuel Pump',
          kind: 'pump',
          systems: ['fuel'],
          sourceProvenance: 'TRAINING-CONFIRMED',
          isRetired: false,
        })
        .returning()
      const [ta] = await db
        .insert(testActions)
        .values({
          slug: 'measure-rail-pressure',
          componentId: component.id,
          description: 'Read fuel rail pressure',
          scenarioRequired: 'idle',
          observationMethod: 'pressure_test_with_gauge',
          invasiveness: 1,
          sourceProvenance: 'TRAINING-CONFIRMED',
        })
        .returning()
      await db
        .insert(symptomTestImplications)
        .values({ symptomId: symptom.id, testActionId: ta.id, priority: 1, sourceProvenance: 'TRAINING-CONFIRMED' })
      return { platform, symptom }
    }

    it('a recorded verified fix makes the real loadCachedDiagnostic counter go 0 -> 1', async () => {
      await seedCatalogChainForCranksNoStart()

      // The writer and the counter must resolve the complaint to the SAME slug —
      // assert that explicitly so the linkage cannot be a coincidence.
      expect(resolveSymptomSlug({ complaintText: 'engine cranks but no start' })).toBe('cranks-no-start')

      const before = await loadCachedDiagnostic({
        db,
        platformSlug: 'ford-super-duty-67',
        symptomSlug: 'cranks-no-start',
      })
      expect(before?.priorFixCount).toBe(0)

      const { shop, tech, vehicle } = await seedShopTechVehicle(db)
      const result = await recordDiagnosticSession(db, {
        vehicleId: vehicle.id,
        shopId: shop.id,
        techId: tech.id,
        complaintText: 'engine cranks but no start',
        outcome: makeOutcome({ actionType: 'repair' }),
      })
      expect(result.written).toBe(true)
      if (!result.written) throw new Error('unreachable')
      expect(result.finalVerdict).toBe('commit-allowed')

      const after = await loadCachedDiagnostic({
        db,
        platformSlug: 'ford-super-duty-67',
        symptomSlug: 'cranks-no-start',
      })
      expect(after?.priorFixCount).toBe(1)
    })

    it('a non-fix close does NOT move the real counter', async () => {
      await seedCatalogChainForCranksNoStart()
      const { shop, tech, vehicle } = await seedShopTechVehicle(db)

      await recordDiagnosticSession(db, {
        vehicleId: vehicle.id,
        shopId: shop.id,
        techId: tech.id,
        complaintText: 'engine cranks but no start',
        outcome: makeOutcome({ actionType: 'no_fix', verification: { codesCleared: false, testDrive: false, symptomsResolved: 'no' } }),
      })

      const after = await loadCachedDiagnostic({
        db,
        platformSlug: 'ford-super-duty-67',
        symptomSlug: 'cranks-no-start',
      })
      expect(after?.priorFixCount).toBe(0)
    })
  })
})
