import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { getSessionForUser } from '@/lib/sessions'
import { routeForSession } from '@/lib/session-routing'
import { ActiveSession } from '@/components/screens/active-session'
import { ClosedCaseSummary } from '@/components/screens/closed-case-summary'
import { TreeGenerating } from '@/components/screens/tree-generating'
import { formatVehicleName } from '@/lib/format'
import { sessionEvents } from '@/lib/db/schema'
import { resolveWizardInterception } from '@/lib/flows/interception'
import { CuratorGuidedWizard } from '@/components/screens/curator-guided-wizard'
import { loadSystemTopology } from '@/lib/diagnostics/load-system-topology'
import { layoutTopology } from '@/lib/diagnostics/topology-layout'
import { TopologyDiagnostic } from '@/components/screens/topology-diagnostic'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'
import { resolveSymptomSlug, extractDtcCodes } from '@/lib/diagnostics/symptom-resolver'
import { reconcileSeededSymptom } from '@/lib/diagnostics/reconcile-seeded-symptom'
import { symptomLabel } from '@/lib/diagnostics/symptom-label'
import { getAdaptiveEligibility } from '@/lib/diagnostics/adaptive/eligibility'
import { resolveAdaptiveCoverage } from '@/lib/diagnostics/adaptive/coverage'
import { AdaptiveDiagnosticEntry } from '@/components/screens/adaptive-diagnostic-entry'
import { resolveDiagnosticRepairAccess } from '@/lib/shop-os/repair-authorization'

export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const result = await getSessionForUser({ db, userId: ctx.user.id, sessionId: id })
  if (!result.ok) notFound()

  const { session } = result
  const route = routeForSession(session)

  if (route.kind === 'tree-generating') {
    return (
      <TreeGenerating vehicle={formatVehicleName(session.intake)} />
    )
  }

  if (route.kind === 'redirect') {
    redirect(route.to)
  }

  if (route.kind === 'closed-summary') {
    return <ClosedCaseSummary session={session} />
  }

  // ---- Curator-guided wizard branch (active-session only) -------------------
  // Intercept to the sourced wizard when a published flow covers this case; null =
  // uncovered case or locked into repair → fall through to ActiveSession silently
  // (the existing AI path serves it unchanged). Decision logic + version-pinning
  // live in resolveWizardInterception (unit-tested in interception-beachhead.test.ts).
  const wizard = await resolveWizardInterception(db, session)
  if (wizard) {
    return (
      <CuratorGuidedWizard
        sessionId={session.id}
        flowVersionId={wizard.flowVersionId}
        versionNumber={wizard.versionNumber}
        body={wizard.body}
        initialState={session.wizardState ?? null}
        newerVersionAvailable={wizard.newerVersionAvailable}
      />
    )
  }

  // ---- Adaptive diagnostic entry (eligible Shop OS sessions only) ----------
  // This narrow branch intentionally duplicates the legacy topology resolution
  // below. Feature-off and ineligible sessions must retain that path unchanged.
  const adaptiveEligibility = ctx.profile.shopId
    ? await getAdaptiveEligibility(db, {
        sessionId: session.id,
        shopId: ctx.profile.shopId,
      })
    : { eligible: false as const }

  if (adaptiveEligibility.eligible) {
    const adaptivePlatformSlug = resolvePlatformSlug({
      year: session.intake.vehicleYear,
      make: session.intake.vehicleMake,
      model: session.intake.vehicleModel,
      engine: session.intake.vehicleEngine ?? '',
    })
    const adaptiveSymptomSlug = adaptivePlatformSlug
      ? await reconcileSeededSymptom(db, adaptivePlatformSlug, {
          candidateSlug: resolveSymptomSlug({
            dtcCodes: extractDtcCodes(session.intake.customerComplaint),
            complaintText: session.intake.customerComplaint,
          }),
          complaintText: session.intake.customerComplaint,
        })
      : null
    const adaptiveCoverage = await resolveAdaptiveCoverage(db, {
      platformSlug: adaptivePlatformSlug,
      symptomSlug: adaptiveSymptomSlug,
    })

    if (session.adaptiveDiagnosticState === null) {
      return (
        <AdaptiveDiagnosticEntry
          sessionId={session.id}
          concern={session.intake.customerComplaint}
          vehicleName={formatVehicleName(session.intake)}
          coverage={adaptiveCoverage}
        />
      )
    }

    if (
      session.adaptiveDiagnosticState.mode === 'guided'
      && adaptiveCoverage.technicianInstructionsAvailable
      && adaptiveCoverage.instructionProof !== null
      && adaptivePlatformSlug
      && adaptiveSymptomSlug
    ) {
      const adaptiveTopology = await loadSystemTopology({
        db,
        platformSlug: adaptivePlatformSlug,
        symptomSlug: adaptiveSymptomSlug,
        sessionId: session.id,
      })
      if (adaptiveTopology) {
        return (
          <TopologyDiagnostic
            topology={adaptiveTopology}
            layout={layoutTopology(adaptiveTopology)}
            vehicleName={formatVehicleName(session.intake)}
            sessionId={session.id}
            symptoms={[{ slug: adaptiveSymptomSlug, label: symptomLabel(adaptiveSymptomSlug) }]}
            activeSymptomSlug={adaptiveSymptomSlug}
          />
        )
      }
    }

    // Manual mode and proof-open guided state use the current ActiveSession
    // surface until ADC-5 supplies the shared manual evidence workspace.
    const adaptiveEvents = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
      .orderBy(sessionEvents.createdAt)

    const adaptiveRepairAccess = session.treeState?.phase === 'repairing'
      ? await resolveDiagnosticRepairAccess(db, {
          shopId: session.shopId,
          sessionId: session.id,
        })
      : undefined
    return <ActiveSession session={session} events={adaptiveEvents} repairAccess={adaptiveRepairAccess} />
  }

  // ---- Topology diagnostic gate ----------------------------------------
  // When the session's vehicle has graph data, serve the interactive diagram.
  // resolvePlatformSlug is pure (no DB). reconcileSeededSymptom maps the resolver's
  // candidate symptom to an actually-seeded slug (e.g. bare "p0087" → the seeded
  // "p0087-fuel-rail-pressure-too-low") and returns null when nothing seeded matches
  // — so this falls through to AI silently. It runs the IDENTICAL reconcile the
  // intake route ran, so the two can't drift. The reconciled slug feeds the topology
  // load AND every display prop, so the diagram's active symptom + label always match.
  const platformSlug = resolvePlatformSlug({
    year: session.intake.vehicleYear,
    make: session.intake.vehicleMake,
    model: session.intake.vehicleModel,
    engine: session.intake.vehicleEngine ?? '',
  })
  const reconciledSymptomSlug = platformSlug
    ? await reconcileSeededSymptom(db, platformSlug, {
        candidateSlug: resolveSymptomSlug({
          dtcCodes: extractDtcCodes(session.intake.customerComplaint),
          complaintText: session.intake.customerComplaint,
        }),
        complaintText: session.intake.customerComplaint,
      })
    : null

  if (platformSlug && reconciledSymptomSlug) {
    const topology = await loadSystemTopology({
      db,
      platformSlug,
      symptomSlug: reconciledSymptomSlug,
      sessionId: session.id,
    })
    if (topology) {
      return (
        <TopologyDiagnostic
          topology={topology}
          layout={layoutTopology(topology)}
          vehicleName={formatVehicleName(session.intake)}
          sessionId={session.id}
          symptoms={[{ slug: reconciledSymptomSlug, label: symptomLabel(reconciledSymptomSlug) }]}
          activeSymptomSlug={reconciledSymptomSlug}
        />
      )
    }
  }

  // Fetch session_events for the chat-thread render in RepairPhaseView.
  // Cheap query (indexed by session_id) and idempotent for non-repairing
  // sessions — the renderer filters to repair_observation +
  // repair_guidance only.
  const events = await db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, session.id))
    .orderBy(sessionEvents.createdAt)

  const repairAccess = session.treeState?.phase === 'repairing'
    ? await resolveDiagnosticRepairAccess(db, {
        shopId: session.shopId,
        sessionId: session.id,
      })
    : undefined
  return <ActiveSession session={session} events={events} repairAccess={repairAccess} />
}
