import { notFound, redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { getSessionForUser } from '@/lib/sessions'
import { routeForSession } from '@/lib/session-routing'
import { ActiveSession } from '@/components/screens/active-session'
import { CachedOverview } from '@/components/screens/cached-overview'
import { ClosedCaseSummary } from '@/components/screens/closed-case-summary'
import { TreeGenerating } from '@/components/screens/tree-generating'
import { formatVehicleName } from '@/lib/format'
import { loadCachedDiagnostic } from '@/lib/diagnostics/cached-lookup'
import { sessionEvents, platforms, symptoms } from '@/lib/db/schema'

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
      <TreeGenerating
        vehicle={formatVehicleName(session.intake)}
        elapsed={`T+0:0${Math.min(9, Math.floor((Date.now() - new Date(session.createdAt).getTime()) / 1000))}`}
      />
    )
  }

  if (route.kind === 'redirect') {
    redirect(route.to)
  }

  if (route.kind === 'closed-summary') {
    return <ClosedCaseSummary session={session} />
  }

  if (route.kind === 'cached-overview') {
    const platformRow = session.cacheHitPlatformId
      ? await db.query.platforms.findFirst({
          where: eq(platforms.id, session.cacheHitPlatformId),
          columns: { slug: true },
        })
      : null

    const symptomRow = session.cacheHitSymptomId
      ? await db.query.symptoms.findFirst({
          where: eq(symptoms.id, session.cacheHitSymptomId),
          columns: { slug: true },
        })
      : null

    if (!platformRow || !symptomRow) notFound()

    const diagnostic = await loadCachedDiagnostic({
      db,
      platformSlug: platformRow.slug,
      symptomSlug: symptomRow.slug,
    })
    if (!diagnostic) notFound()

    return (
      <CachedOverview
        diagnostic={diagnostic}
        vehicleName={formatVehicleName(session.intake)}
        vin={null}
        mileage={session.intake.mileage ?? null}
      />
    )
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
