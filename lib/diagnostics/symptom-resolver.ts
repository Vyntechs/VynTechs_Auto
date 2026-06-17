/**
 * Pure symptom-slug resolver. Realigned (2026-05-30) from the reverted PR #96
 * DB-backed version to a slug-string producer with NO DB dependency.
 *
 * Why pure: flows/research_runs key on symptom_slug TEXT (the "name-tag"
 * decision). main has no symptoms/platforms tables, and the PGlite unit DB
 * never creates them — a DB-querying resolver would break the suite. Authoring/
 * publish-time integrity (is this a KNOWN slug?) lives in PR-N2's publish gate,
 * not here.
 *
 * Priority: 1) selectedSymptomSlug (pass-through), 2) first DTC code normalized
 * to slug form, 3) first matching COMPLAINT_PATTERNS slug. Returns a slug or null.
 */

export type SymptomResolveInput = {
  selectedSymptomSlug?: string
  dtcCodes?: string[]
  complaintText?: string
}

// First-match-wins. 'cranks-no-start' is listed FIRST so generic crank/no-start
// complaints resolve to the cross-platform slug; the narrower fuel-system slug
// follows. (Authoring-time validation later confirms the slug is real.)
const COMPLAINT_PATTERNS: { pattern: RegExp; slug: string }[] = [
  {
    pattern:
      /crank(s|ing)?\s+(but\s+)?(no.?start|no.?fire|won.?t\s+start|will\s+not\s+start|does\s+not\s+start)|no.?start.*crank|won.?t\s+start.*crank/i,
    slug: 'cranks-no-start',
  },
  {
    pattern:
      /no.?start.*crank|crank.*no.?start|won.?t start.*crank|cranks?\s+but\s+(won.?t|will not)\s+start/i,
    slug: 'no-start-cranks-normally-fuel-system-suspect',
  },
  // Emissions / DEF limp-mode (2011-2016 6.7 PSD beachhead). Appended last so the
  // crank/no-start patterns keep priority. Deliberately precise — a bare "check engine"
  // complaint is too ambiguous to route here and is left to fall through (return null),
  // so the wizard only intercepts genuine emissions/derate language.
  {
    pattern:
      /reduced\s+(engine\s+)?power|\blimp\b|de-?rate|\bdef\b|(diesel\s+)?exhaust\s+fluid|\bscr\b|\bnox\b|emissions?|\bregen(eration)?\b/i,
    slug: 'reduced-power-limp-mode-emissions-suspect',
  },
]

export function resolveSymptomSlug(input: SymptomResolveInput): string | null {
  // 1. Explicit chip selection — pass through as-is.
  if (input.selectedSymptomSlug && input.selectedSymptomSlug.trim()) {
    return input.selectedSymptomSlug.trim()
  }

  // 2. First DTC code — normalize to slug form (lowercase, trimmed).
  if (input.dtcCodes?.length) {
    for (const dtc of input.dtcCodes) {
      const code = dtc.trim().toLowerCase()
      if (code) return code
    }
  }

  // 3. First matching complaint pattern.
  if (input.complaintText) {
    for (const { pattern, slug } of COMPLAINT_PATTERNS) {
      if (pattern.test(input.complaintText)) return slug
    }
  }

  return null
}
