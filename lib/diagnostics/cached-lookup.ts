import { and, asc, count, eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import {
  platforms,
  symptoms,
  testActions,
  components,
  symptomTestImplications,
  diagnosticSessions,
} from '@/lib/db/schema'
import { getGateThreshold } from './gate-thresholds'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CachedComplaint = {
  slug: string
  description: string
  category: string
}

export type CachedDiagnosticTest = {
  priority: number
  description: string
  scenario: string
  observationMethod: string
  expectedReading: string | null
  invasiveness: number
}

export type CachedDiagnostic = {
  platform: { slug: string; name: string }
  symptom: {
    slug: string
    description: string
    category: string
    dtcDisplay: string | null
  }
  gateThreshold: number
  priorFixCount: number
  tests: CachedDiagnosticTest[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a human-readable platform name from the stored columns. */
function buildPlatformName(row: {
  parentMake: string
  parentModelFamily: string
  generation: string | null
  yearRange: string
}): string {
  const parts = [row.parentMake, row.parentModelFamily]
  if (row.generation) parts.push(row.generation)
  parts.push(`(${row.yearRange})`)
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// listCachedSymptomsForPlatform
// ---------------------------------------------------------------------------

/**
 * Returns the DISTINCT symptoms reachable for the given platform — i.e. those
 * that have at least one active symptom_test_implication → test_action →
 * component chain on this platform.
 *
 * Used to populate the chip-picker on the new-session form.
 */
export async function listCachedSymptomsForPlatform({
  db,
  platformSlug,
}: {
  db: AppDb
  platformSlug: string
}): Promise<CachedComplaint[]> {
  // Resolve platform
  const platform = await db.query.platforms.findFirst({
    where: eq(platforms.slug, platformSlug),
    columns: { id: true },
  })
  if (!platform) return []

  // Join symptoms → STI → testActions → components, filtered by platformId
  // and all isRetired = false. GROUP BY to deduplicate.
  const rows = await db
    .select({
      slug: symptoms.slug,
      description: symptoms.description,
      category: symptoms.category,
    })
    .from(symptoms)
    .innerJoin(symptomTestImplications, eq(symptomTestImplications.symptomId, symptoms.id))
    .innerJoin(testActions, eq(testActions.id, symptomTestImplications.testActionId))
    .innerJoin(components, eq(components.id, testActions.componentId))
    .where(
      and(
        eq(components.platformId, platform.id),
        eq(symptomTestImplications.isRetired, false),
        eq(testActions.isRetired, false),
        eq(components.isRetired, false),
      ),
    )
    .groupBy(symptoms.id, symptoms.slug, symptoms.description, symptoms.category)
    .orderBy(asc(symptoms.description))

  return rows.map((r) => ({
    slug: r.slug,
    description: r.description,
    category: r.category,
  }))
}

// ---------------------------------------------------------------------------
// loadCachedDiagnostic
// ---------------------------------------------------------------------------

/**
 * Loads the full cached-diagnostic payload for a platform + symptom pair:
 * platform info, symptom info, ordered tests, gate threshold, and prior-fix
 * count.
 *
 * Returns null when the platform or symptom doesn't exist, or when there are
 * no active test rows for this platform + symptom combination.
 */
export async function loadCachedDiagnostic({
  db,
  platformSlug,
  symptomSlug,
}: {
  db: AppDb
  platformSlug: string
  symptomSlug: string
}): Promise<CachedDiagnostic | null> {
  // Resolve platform
  const platform = await db.query.platforms.findFirst({
    where: eq(platforms.slug, platformSlug),
    columns: {
      id: true,
      slug: true,
      parentMake: true,
      parentModelFamily: true,
      generation: true,
      yearRange: true,
    },
  })
  if (!platform) return null

  // Resolve symptom
  const symptom = await db.query.symptoms.findFirst({
    where: eq(symptoms.slug, symptomSlug),
    columns: { id: true, slug: true, description: true, category: true },
  })
  if (!symptom) return null

  // Fetch active test rows ordered by STI priority
  // Join: symptomTestImplications → testActions → components
  // Filter: this symptom, this platform, all isRetired = false
  const testRows = await db
    .select({
      priority: symptomTestImplications.priority,
      description: testActions.description,
      scenario: testActions.scenarioRequired,
      observationMethod: testActions.observationMethod,
      expectedReading: testActions.expectedObservation,
      invasiveness: testActions.invasiveness,
    })
    .from(symptomTestImplications)
    .innerJoin(testActions, eq(testActions.id, symptomTestImplications.testActionId))
    .innerJoin(components, eq(components.id, testActions.componentId))
    .where(
      and(
        eq(symptomTestImplications.symptomId, symptom.id),
        eq(components.platformId, platform.id),
        eq(symptomTestImplications.isRetired, false),
        eq(testActions.isRetired, false),
        eq(components.isRetired, false),
      ),
    )
    .orderBy(asc(symptomTestImplications.priority))

  // No active tests → treat as no cached diagnostic
  if (testRows.length === 0) return null

  // Count prior fix sessions: diagnostic_sessions tied to this symptom with
  // finalVerdict = 'commit-allowed'. The linkage is direct:
  // diagnosticSessions.symptomId → symptoms.id.
  const [fixCountRow] = await db
    .select({ value: count() })
    .from(diagnosticSessions)
    .where(
      and(
        eq(diagnosticSessions.symptomId, symptom.id),
        eq(diagnosticSessions.finalVerdict, 'commit-allowed'),
      ),
    )
  const priorFixCount = fixCountRow?.value ?? 0

  // DTC display: uppercase slug when category is 'dtc', else null
  const dtcDisplay = symptom.category === 'dtc' ? symptom.slug.toUpperCase() : null

  return {
    platform: {
      slug: platform.slug,
      name: buildPlatformName(platform),
    },
    symptom: {
      slug: symptom.slug,
      description: symptom.description,
      category: symptom.category,
      dtcDisplay,
    },
    gateThreshold: getGateThreshold(symptom.slug),
    priorFixCount,
    tests: testRows.map((r) => ({
      priority: r.priority,
      description: r.description,
      scenario: r.scenario,
      observationMethod: r.observationMethod,
      expectedReading: r.expectedReading ?? null,
      invasiveness: r.invasiveness,
    })),
  }
}
