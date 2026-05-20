import { and, eq, inArray } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { platforms, symptoms, testActions, components, symptomTestImplications } from '@/lib/db/schema'

export type SymptomResolveInput = {
  db: AppDb
  platformSlug: string
  selectedSymptomSlug?: string
  dtcCodes?: string[]
  complaintText?: string
}

// Keyword patterns for free-text complaint -> symptom slug.
// PR 1 only covers the one drivability symptom we have cached.
const COMPLAINT_PATTERNS: { pattern: RegExp; slug: string }[] = [
  {
    pattern:
      /no.?start.*crank|crank.*no.?start|won.?t start.*crank|cranks?\s+but\s+(won.?t|will not)\s+start/i,
    slug: 'no-start-cranks-normally-fuel-system-suspect',
  },
]

export async function resolveSymptomSlug(input: SymptomResolveInput): Promise<string | null> {
  const { db, platformSlug } = input

  // Build a priority-ordered list of candidate slugs.
  const candidates: string[] = []

  if (input.selectedSymptomSlug) {
    candidates.push(input.selectedSymptomSlug)
  }

  if (input.dtcCodes) {
    for (const dtc of input.dtcCodes) {
      const slug = dtc.trim().toLowerCase()
      if (slug && !candidates.includes(slug)) candidates.push(slug)
    }
  }

  if (input.complaintText) {
    for (const { pattern, slug } of COMPLAINT_PATTERNS) {
      if (pattern.test(input.complaintText) && !candidates.includes(slug)) {
        candidates.push(slug)
      }
    }
  }

  if (candidates.length === 0) return null

  // Resolve the platform row.
  const platform = await db.query.platforms.findFirst({
    where: eq(platforms.slug, platformSlug),
    columns: { id: true },
  })
  if (!platform) return null

  // Find which candidate slugs have at least one symptom_test_implication reachable
  // for this platform. The linkage is:
  //   symptoms → symptom_test_implications (symptomId)
  //              → test_actions (testActionId)
  //              → components (componentId)
  // where components.platformId = platform.id
  //
  // symptom_test_implications has NO direct platformId column; the platform
  // is encoded via testAction → component → platform.
  const rows = await db
    .select({ slug: symptoms.slug })
    .from(symptoms)
    .innerJoin(symptomTestImplications, eq(symptomTestImplications.symptomId, symptoms.id))
    .innerJoin(testActions, eq(testActions.id, symptomTestImplications.testActionId))
    .innerJoin(components, eq(components.id, testActions.componentId))
    .where(
      and(
        inArray(symptoms.slug, candidates),
        eq(components.platformId, platform.id),
      ),
    )
    .groupBy(symptoms.slug)

  if (rows.length === 0) return null

  const reachable = new Set(rows.map((r) => r.slug))

  // Return the first candidate (highest priority) that is reachable.
  for (const slug of candidates) {
    if (reachable.has(slug)) return slug
  }

  return null
}
