import { and, eq } from 'drizzle-orm'
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

export type SymptomResolveResult = {
  symptomSlug: string
  symptomId: string
  platformId: string
}

export async function resolveSymptomSlug(
  input: SymptomResolveInput,
): Promise<SymptomResolveResult | null> {
  const { db, platformSlug } = input

  // Resolve the platform row.
  const platform = await db.query.platforms.findFirst({
    where: eq(platforms.slug, platformSlug),
    columns: { id: true },
  })
  if (!platform) return null

  // Load ALL reachable symptoms for this platform (no slug filter — platform has few symptoms).
  // Linkage: symptoms → symptom_test_implications → test_actions → components → platform.id
  const rows = await db
    .select({ slug: symptoms.slug, id: symptoms.id })
    .from(symptoms)
    .innerJoin(symptomTestImplications, eq(symptomTestImplications.symptomId, symptoms.id))
    .innerJoin(testActions, eq(testActions.id, symptomTestImplications.testActionId))
    .innerJoin(components, eq(components.id, testActions.componentId))
    .where(
      and(
        eq(symptomTestImplications.isRetired, false),
        eq(testActions.isRetired, false),
        eq(components.isRetired, false),
        eq(components.platformId, platform.id),
      ),
    )
    .groupBy(symptoms.slug, symptoms.id)

  if (rows.length === 0) return null

  // Priority order:
  //   1. selectedSymptomSlug — exact slug match
  //   2. dtcCodes — prefix match: slug === code OR slug.startsWith(code + '-')
  //   3. complaintText patterns — exact slug match from COMPLAINT_PATTERNS

  // 1. Chip selection (exact match)
  if (input.selectedSymptomSlug) {
    const match = rows.find((r) => r.slug === input.selectedSymptomSlug)
    if (match) return { symptomSlug: match.slug, symptomId: match.id, platformId: platform.id }
  }

  // 2. DTC codes (prefix match against descriptive slugs)
  if (input.dtcCodes?.length) {
    for (const dtc of input.dtcCodes) {
      const code = dtc.trim().toLowerCase()
      if (!code) continue
      const match = rows.find((r) => r.slug === code || r.slug.startsWith(code + '-'))
      if (match) return { symptomSlug: match.slug, symptomId: match.id, platformId: platform.id }
    }
  }

  // 3. Complaint-text keyword patterns (exact slug match)
  if (input.complaintText) {
    for (const { pattern, slug } of COMPLAINT_PATTERNS) {
      if (pattern.test(input.complaintText)) {
        const match = rows.find((r) => r.slug === slug)
        if (match) return { symptomSlug: match.slug, symptomId: match.id, platformId: platform.id }
      }
    }
  }

  return null
}
