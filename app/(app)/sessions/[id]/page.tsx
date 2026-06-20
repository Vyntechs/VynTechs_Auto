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
import { resolveSymptomSlug } from '@/lib/diagnostics/symptom-resolver'
import { symptomLabel } from '@/lib/diagnostics/symptom-label'

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

  // ---- Topology diagnostic gate ----------------------------------------
  // When the session's vehicle has graph data, serve the interactive diagram.
  // resolvePlatformSlug + resolveSymptomSlug are pure (no DB). loadSystemTopology
  // returns null when no data exists for the pair — falls through to AI silently.
  const platformSlug = resolvePlatformSlug({
    year: session.intake.vehicleYear,
    make: session.intake.vehicleMake,
    model: session.intake.vehicleModel,
    engine: session.intake.vehicleEngine ?? '',
  })
  const symptomSlug = resolveSymptomSlug({ complaintText: session.intake.customerComplaint })

  if (platformSlug && symptomSlug) {
    const topology = await loadSystemTopology({
      db,
      platformSlug,
      symptomSlug,
      sessionId: session.id,
    })
    if (topology) {
      return (
        <TopologyDiagnostic
          topology={topology}
          layout={layoutTopology(topology)}
          vehicleName={formatVehicleName(session.intake)}
          sessionId={session.id}
          symptoms={[{ slug: symptomSlug, label: symptomLabel(symptomSlug) }]}
          activeSymptomSlug={symptomSlug}
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

  return <ActiveSession session={session} events={events} />
}
