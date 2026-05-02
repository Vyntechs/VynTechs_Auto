import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { getSessionForUser } from '@/lib/sessions'
import { ActiveSession } from '@/components/screens/active-session'
import { TreeGenerating } from '@/components/screens/tree-generating'
import { formatVehicleName } from '@/lib/format'

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

  if (!session.treeState || session.treeState.nodes.length === 0) {
    return (
      <TreeGenerating
        vehicle={formatVehicleName(session.intake)}
        elapsed={`T+0:0${Math.min(9, Math.floor((Date.now() - new Date(session.createdAt).getTime()) / 1000))}`}
      />
    )
  }

  if (session.treeState.gateDecision && !session.treeState.gateDecision.allow) {
    redirect(`/sessions/${session.id}/decline`)
  }

  return <ActiveSession session={session} />
}
