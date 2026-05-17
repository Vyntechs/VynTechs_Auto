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
import { getKnowledgeItem } from '@/lib/knowledge/get-item'
import type { KnowledgeListRow } from '@/lib/knowledge/list'

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ detail?: string }>
}) {
  const { id } = await params
  const { detail } = await searchParams
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

  // Fetch session_events for the chat-thread render in RepairPhaseView.
  // Cheap query (indexed by session_id) and idempotent for non-repairing
  // sessions — the renderer filters to repair_observation +
  // repair_guidance only.
  const eventsPromise = db
    .select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, session.id))
    .orderBy(sessionEvents.createdAt)

  // PR 6: hydrate the active step's cited knowledge items so the
  // citation surface renders server-side (no waterfall). The shop scope
  // on getKnowledgeItem matches the session's user's shop — cross-shop
  // citations (which shouldn't happen today) silently drop.
  const currentNode = session.treeState.nodes.find(
    (n) => n.id === session.treeState.currentNodeId,
  )
  const citationIds = currentNode?.citationItemIds ?? []
  const shopId = ctx.profile.shopId
  const citedItemsPromise: Promise<KnowledgeListRow[]> = shopId
    ? Promise.all(
        citationIds.map((cid) => getKnowledgeItem(db, { id: cid, shopId })),
      ).then((rows) => rows.filter((r): r is KnowledgeListRow => r !== null))
    : Promise.resolve([])

  // PR 6: hydrate the drawer item when ?detail=<id> is in the URL.
  // Same shop scope. Returns null when missing or cross-shop.
  const drawerItemPromise: Promise<KnowledgeListRow | null> =
    detail && shopId ? getKnowledgeItem(db, { id: detail, shopId }) : Promise.resolve(null)

  const [events, citedItems, drawerItem] = await Promise.all([
    eventsPromise,
    citedItemsPromise,
    drawerItemPromise,
  ])

  return (
    <ActiveSession
      session={session}
      events={events}
      citedItems={citedItems}
      drawerItem={drawerItem}
    />
  )
}
