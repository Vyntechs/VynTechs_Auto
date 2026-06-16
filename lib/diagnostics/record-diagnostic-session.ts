import { eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import { symptoms, diagnosticSessions, type OutcomePayload } from '@/lib/db/schema'
import { resolveSymptomSlug } from './symptom-resolver'

/**
 * Writes the proof-of-fix record. cached-lookup.ts counts diagnostic_sessions
 * rows with finalVerdict = 'commit-allowed' (keyed by symptomId) to show "N techs
 * have confirmed this fix". Nothing wrote those rows, so the counter was stuck at
 * zero. This is the writer — wired into session close as a non-fatal hook.
 *
 * Honesty is the whole point. It records a confirmed fix ONLY when it is true,
 * and stays silent rather than guess:
 *   - 'commit-allowed' requires a real repair action AND the tech confirming the
 *     symptom is resolved. A no_fix/referred close, or "not resolved", is never
 *     a win — it is recorded with a truthful non-allowed verdict.
 *   - If the complaint can't be resolved to a KNOWN problem, or that problem
 *     isn't in the catalog yet, NO row is written (no fabricated attribution).
 *     The writer activates automatically once the catalog row exists.
 */

export type FinalVerdict = 'commit-allowed' | 'commit-refused' | 'incomplete'

export type RecordDiagnosticSessionInput = {
  /** diagnostic_sessions.vehicleId is NOT NULL — null here means "stay silent". */
  vehicleId: string | null
  shopId: string
  techId: string
  complaintText?: string
  dtcCodes?: string[]
  selectedSymptomSlug?: string
  outcome: OutcomePayload
}

export type RecordDiagnosticSessionResult =
  | { written: true; diagnosticSessionId: string; finalVerdict: FinalVerdict }
  | {
      written: false
      reason: 'no-vehicle' | 'symptom-unresolved' | 'symptom-not-in-catalog'
    }

/** Action types that represent an actual repair (vs. no_fix / referred). */
const REAL_FIX_ACTIONS: ReadonlySet<OutcomePayload['actionType']> = new Set([
  'part_replacement',
  'repair',
  'adjustment',
  'cleaning',
])

/**
 * Map a tech's self-reported outcome to an honest verdict. A confirmed fix
 * ('commit-allowed') requires BOTH a real repair action AND the tech confirming
 * the symptom is resolved — never one without the other.
 */
export function verdictFromOutcome(outcome: OutcomePayload): FinalVerdict {
  if (!REAL_FIX_ACTIONS.has(outcome.actionType)) return 'commit-refused'
  switch (outcome.verification.symptomsResolved) {
    case 'yes':
      return 'commit-allowed'
    case 'partial':
      return 'incomplete'
    case 'no':
    default:
      return 'commit-refused'
  }
}

export async function recordDiagnosticSession(
  db: AppDb,
  input: RecordDiagnosticSessionInput,
): Promise<RecordDiagnosticSessionResult> {
  // A diagnostic_sessions row requires a vehicle (NOT NULL FK). Without one we
  // cannot honestly attribute the outcome — stay silent.
  if (!input.vehicleId) return { written: false, reason: 'no-vehicle' }

  // Resolve the complaint to a known problem slug. The resolver returns null when
  // it has no confident match — we record nothing rather than guess.
  const slug = resolveSymptomSlug({
    selectedSymptomSlug: input.selectedSymptomSlug,
    dtcCodes: input.dtcCodes,
    complaintText: input.complaintText,
  })
  if (!slug) return { written: false, reason: 'symptom-unresolved' }

  // The slug must exist in the symptom catalog. While the catalog is still being
  // seeded (separate track), this returns nothing and we stay silent.
  const symptom = await db.query.symptoms.findFirst({
    where: eq(symptoms.slug, slug),
    columns: { id: true },
  })
  if (!symptom) return { written: false, reason: 'symptom-not-in-catalog' }

  const finalVerdict = verdictFromOutcome(input.outcome)

  const [row] = await db
    .insert(diagnosticSessions)
    .values({
      vehicleId: input.vehicleId,
      symptomId: symptom.id,
      shopId: input.shopId,
      techId: input.techId,
      completedAt: new Date(),
      finalVerdict,
    })
    .returning()

  return { written: true, diagnosticSessionId: row.id, finalVerdict }
}
