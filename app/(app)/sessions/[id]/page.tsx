import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
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
import { loadSystemTopology } from '@/lib/diagnostics/load-system-topology'
import { layoutTopology } from '@/lib/diagnostics/topology-layout'
import { TopologyDiagnostic } from '@/components/screens/topology-diagnostic'
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

    const topology = await loadSystemTopology({
      db,
      platformSlug: platformRow.slug,
      symptomSlug: symptomRow.slug,
    })

    // Spec §10: a null topology (no system tagged, or no components) renders
    // a clean empty state — never a 500, never notFound().
    if (!topology) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            minHeight: '100dvh',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '24px',
            fontFamily: 'var(--vt-font-serif)',
            fontSize: 'var(--vt-fs-18)',
            color: 'var(--vt-fg-3)',
          }}
        >
          A system diagram is not available for this vehicle yet.
          <Link
            href="/today"
            style={{
              fontFamily: 'var(--vt-font-mono)',
              fontSize: 11,
              letterSpacing: '0.08em',
              color: 'var(--vt-fg-3)',
              textDecoration: 'none',
            }}
          >
            ← Sessions
          </Link>
        </div>
      )
    }

    return (
      <TopologyDiagnostic
        topology={topology}
        layout={layoutTopology(topology)}
        vehicleName={formatVehicleName(session.intake)}
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
