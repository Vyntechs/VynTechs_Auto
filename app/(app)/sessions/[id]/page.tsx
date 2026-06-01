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
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'
import { resolveSymptomSlug } from '@/lib/diagnostics/symptom-resolver'
import { getPublishedFlowFor, getFlowVersionById } from '@/lib/flows/lookup'
import { CuratorGuidedWizard } from '@/components/screens/curator-guided-wizard'

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
  // Only intercept when the session is NOT already locked into repair. Once locked,
  // fall through to ActiveSession, which renders RepairPhaseView for phase==='repairing'.
  const alreadyLocked =
    session.treeState.phase === 'repairing' || Boolean(session.treeState.diagnosisLockedAt)

  if (!alreadyLocked) {
    // Resolve (platform_slug, symptom_slug) from the session's intake — pure, no DB.
    const platformSlug = resolvePlatformSlug({
      year: session.intake.vehicleYear,
      make: session.intake.vehicleMake,
      model: session.intake.vehicleModel,
      engine: session.intake.vehicleEngine ?? '',
    })
    const symptomSlug = resolveSymptomSlug({ complaintText: session.intake.customerComplaint })

    if (platformSlug && symptomSlug) {
      let flowLookup: Awaited<ReturnType<typeof getPublishedFlowFor>> = null
      let newerVersionAvailable = false

      if (session.wizardState?.flowVersionId) {
        // Version-PIN: a session keeps the version it started on. Both reads are
        // independent indexed point-lookups — run them together so this hot path
        // (every returning wizard session) stays a single round-trip.
        const [pinned, current] = await Promise.all([
          getFlowVersionById(db, { flowVersionId: session.wizardState.flowVersionId }),
          getPublishedFlowFor(db, { platformSlug, symptomSlug }),
        ])
        flowLookup = pinned
        newerVersionAvailable = Boolean(current && current.flowVersionId !== session.wizardState.flowVersionId)
      } else {
        // First entry: pin the currently-published version (if any).
        flowLookup = await getPublishedFlowFor(db, { platformSlug, symptomSlug })
      }

      // null flowLookup = uncovered case, or the pinned version was deleted — fall
      // through to ActiveSession silently (the existing AI path serves it unchanged).
      if (flowLookup) {
        return (
          <CuratorGuidedWizard
            sessionId={session.id}
            flowVersionId={flowLookup.flowVersionId}
            versionNumber={flowLookup.versionNumber}
            body={flowLookup.body}
            initialState={session.wizardState ?? null}
            newerVersionAvailable={newerVersionAvailable}
          />
        )
      }
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
