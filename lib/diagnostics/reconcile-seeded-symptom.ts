/**
 * Reconciles the resolver's candidate symptom to an ACTUALLY-SEEDED, topology-
 * reachable symptom slug for a given platform — the missing link that was
 * dropping every real intake to the legacy AI plan.
 *
 * Why this exists: `resolveSymptomSlug` (pure, shared with the curator-flow gate)
 * emits a different vocabulary than the seeded `symptoms` table — it returns the
 * bare DTC code `p0087`, while the topology graph is filed under the descriptive
 * slug `p0087-fuel-rail-pressure-too-low`. The two never matched, so the topology
 * gate fired for zero real sessions. We do NOT change the resolver (that would
 * re-key the curator gate and break its pinned tests); we reconcile to seeded
 * vocabulary HERE, only at the topology call sites.
 *
 * Safety: every returned slug is reachability-gated — it is only returned when it
 * exists in the platform's reachable set (the same condition loadSystemTopology
 * enforces: platform row + symptom.system + >=1 non-retired component for that
 * system). An unseeded target can never be promised, so DEF/emissions, unknown
 * codes, gas trucks and unseeded platforms all fall to AI for free.
 *
 * Decision principle: the code the tech entered wins. A complaint carrying a
 * seeded DTC routes to that code's graph even if it also contains crank/no-start
 * language — predictable for the tech and matches "I typed P0087, show me P0087".
 * Prose fallbacks (crank/no-start, rail-pressure) only fire when no seeded DTC.
 */
import { and, eq, isNotNull } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { components, platforms, symptoms } from '@/lib/db/schema'

export type ReconcileInput = {
  /** resolveSymptomSlug() output: chip slug, bare DTC code, pattern slug, or null. */
  candidateSlug: string | null
  /** Raw customer complaint — re-scanned here for separator-split codes and prose. */
  complaintText: string
}

// Separator-tolerant scan that also catches "P 0087" / "P-0087" which the
// resolver's contiguous \bp[0-9]{4}\b misses. Word boundaries on both ends keep
// glued tokens ("thep0087sensor") from matching.
const DTC_RE = /\bp\s*-?\s*([0-9]{4})\b/i

// Crank/no-start prose the resolver's COMPLAINT_PATTERNS miss (e.g. crank-first
// word order, "turns over", "no fire"). Both orderings; stops at sentence breaks.
const CRANK = String.raw`crank(?:s|ing)?|turn(?:s|ing)?\s+over`
const NOSTART = String.raw`no.?start|no.?fire|won.?t\s+(?:start|fire)|will\s+not\s+start|does\s+not\s+(?:start|fire)|doesn.?t\s+(?:start|fire)`
const CRANK_NOSTART_RE = new RegExp(`(?:${CRANK})[^.]*?(?:${NOSTART})|(?:${NOSTART})[^.]*?(?:${CRANK})`, 'i')

// Fuel-rail-pressure prose. Deliberately requires the word "rail" so vague
// "low fuel pressure" (lift pump, filter, ...) is NOT forced into the rail graph.
const RAIL_PRESSURE_RE = /rail\s+pressure/i

/** First DTC code in the text, separator-tolerant, normalized to `p0087`. */
export function tolerantFirstDtc(text: string): string | null {
  const m = text.match(DTC_RE)
  return m ? `p${m[1]}` : null
}

/**
 * Pure reconciliation. Given the platform's reachable seeded symptom slugs,
 * pick the best match for the candidate + complaint, or null (→ AI fallback).
 */
export function pickSeededSymptom(reachable: string[], input: ReconcileInput): string | null {
  const text = input.complaintText ?? ''
  const has = (slug: string) => reachable.includes(slug)

  // 1. Exact chip pass-through (the resolver already produced a seeded slug).
  if (input.candidateSlug && has(input.candidateSlug)) return input.candidateSlug

  // 2. First DTC code → the seeded slug filed under that code. First-code-only
  //    (mirrors the resolver): never promote a later/secondary code over an
  //    unseeded primary, which would misroute the tech's stated fault.
  const code = tolerantFirstDtc(text)
  if (code) {
    const hit = reachable.find((s) => s.startsWith(`${code}-`))
    if (hit) return hit
    // First code present but unseeded → don't return yet; a crank no-start with
    // an incidental code can still match the prose fallback below.
  }

  // 3a. Crank/no-start prose → the seeded no-start graph.
  if (CRANK_NOSTART_RE.test(text)) {
    const nostart = reachable.find((s) => s.includes('no-start'))
    if (nostart) return nostart
  }

  // 3b. Rail-pressure prose (only when no DTC was present at all — a weaker
  //     signal than an entered code, so we don't let it override one).
  if (!code && RAIL_PRESSURE_RE.test(text)) {
    if (/\blow\b/i.test(text)) {
      const low = reachable.find((s) => s.startsWith('p0087-'))
      if (low) return low
    }
    if (/\bhigh\b/i.test(text)) {
      const high = reachable.find((s) => s.startsWith('p0088-'))
      if (high) return high
    }
  }

  return null
}

/**
 * The platform's reachable seeded symptom slugs — exactly the symptoms for which
 * loadSystemTopology would return non-null: platform exists, symptom.system is
 * non-null, and >=1 non-retired component on the platform carries that system.
 */
export async function loadReachableSymptomSlugs(db: AppDb, platformSlug: string): Promise<string[]> {
  const platform = await db.query.platforms.findFirst({
    where: eq(platforms.slug, platformSlug),
    columns: { id: true },
  })
  if (!platform) return []

  const compRows = await db
    .select({ systems: components.systems })
    .from(components)
    .where(and(eq(components.platformId, platform.id), eq(components.isRetired, false)))
  const systemsWithComponents = new Set<string>()
  for (const c of compRows) for (const s of c.systems ?? []) systemsWithComponents.add(s)
  if (systemsWithComponents.size === 0) return []

  const symptomRows = await db
    .select({ slug: symptoms.slug, system: symptoms.system })
    .from(symptoms)
    .where(isNotNull(symptoms.system))
  return symptomRows.filter((r) => r.system && systemsWithComponents.has(r.system)).map((r) => r.slug)
}

/**
 * Wired entry point for the two topology call sites (intake route + session
 * page). Loads the platform's reachable set, then reconciles. Both sites call
 * this with the same inputs so the intake↔render mirror cannot drift.
 */
export async function reconcileSeededSymptom(
  db: AppDb,
  platformSlug: string,
  input: ReconcileInput,
): Promise<string | null> {
  const reachable = await loadReachableSymptomSlugs(db, platformSlug)
  return pickSeededSymptom(reachable, input)
}
