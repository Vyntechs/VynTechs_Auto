/**
 * Curator-wizard interception decision, extracted from the session page so it is
 * testable end-to-end (resolvers + published-flow lookup + version-pinning compose
 * correctly) — Gate A. page.tsx renders <CuratorGuidedWizard> iff this returns
 * non-null; null means fall through to the AI ActiveSession path.
 *
 * Pure-ish: reads the session's stored intake + wizardState, runs the pure
 * resolvers, then hits the DB only for the flow lookup. No side effects.
 */
import type { AppDb } from '@/lib/db/queries'
import type { Session } from '@/lib/db/schema'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'
import { resolveSymptomSlug } from '@/lib/diagnostics/symptom-resolver'
import { getPublishedFlowFor, getFlowVersionById, type PublishedFlowLookup } from '@/lib/flows/lookup'

export type WizardInterception = {
  flowVersionId: string
  versionNumber: number
  body: PublishedFlowLookup['body']
  newerVersionAvailable: boolean
}

export async function resolveWizardInterception(
  db: AppDb,
  session: Session,
): Promise<WizardInterception | null> {
  // Once locked into repair, don't intercept — ActiveSession renders RepairPhaseView.
  const alreadyLocked =
    session.treeState.phase === 'repairing' || Boolean(session.treeState.diagnosisLockedAt)
  if (alreadyLocked) return null

  // Resolve (platform_slug, symptom_slug) from the session's intake — pure, no DB.
  const platformSlug = resolvePlatformSlug({
    year: session.intake.vehicleYear,
    make: session.intake.vehicleMake,
    model: session.intake.vehicleModel,
    engine: session.intake.vehicleEngine ?? '',
  })
  const symptomSlug = resolveSymptomSlug({ complaintText: session.intake.customerComplaint })
  if (!platformSlug || !symptomSlug) return null

  if (session.wizardState?.flowVersionId) {
    // Version-PIN: a session keeps the version it started on. Both reads are
    // independent indexed point-lookups — run them together so this hot path
    // (every returning wizard session) stays a single round-trip.
    const [pinned, current] = await Promise.all([
      getFlowVersionById(db, { flowVersionId: session.wizardState.flowVersionId }),
      getPublishedFlowFor(db, { platformSlug, symptomSlug }),
    ])
    // null pinned = the pinned version was deleted — fall through to the AI path.
    if (!pinned) return null
    return {
      flowVersionId: pinned.flowVersionId,
      versionNumber: pinned.versionNumber,
      body: pinned.body,
      newerVersionAvailable: Boolean(
        current && current.flowVersionId !== session.wizardState.flowVersionId,
      ),
    }
  }

  // First entry: pin the currently-published version (if any).
  const flowLookup = await getPublishedFlowFor(db, { platformSlug, symptomSlug })
  if (!flowLookup) return null
  return {
    flowVersionId: flowLookup.flowVersionId,
    versionNumber: flowLookup.versionNumber,
    body: flowLookup.body,
    newerVersionAvailable: false,
  }
}
