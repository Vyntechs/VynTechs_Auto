import { notFound, redirect } from 'next/navigation'
import { TicketDetailScreen } from '@/components/screens/ticket-detail'
import { requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { canBuildQuotes, canCloseTickets } from '@/lib/shop-os/capabilities'
import { getTicketRingOut } from '@/lib/shop-os/ring-out'
import { getServerSupabase } from '@/lib/supabase-server'
import { getTicketDetail, ticketActorFromProfile } from '@/lib/tickets'

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<React.JSX.Element> {
  const ctx = await requireUserAndProfile({
    supabase: await getServerSupabase(),
    db,
  })
  if (!ctx) redirect('/sign-in')

  const access = await checkAccess(db, ctx.user.id)
  if (access.kind === 'deactivated') redirect('/deactivated')
  if (access.kind === 'paywall') redirect('/subscribe')

  const { id } = await params
  const actor = ticketActorFromProfile(ctx.profile)
  const result = await getTicketDetail(db, { actor, ticketId: id })
  if (!result.ok) notFound()

  // Getting paid is an advisor/owner surface — techs never see money. Only load
  // the ring-out state when the viewer can act on it.
  let ringOut = null
  if (canCloseTickets(ctx.profile.role)) {
    const ringOutResult = await getTicketRingOut(db, { actor, ticketId: id })
    if (ringOutResult.ok) ringOut = ringOutResult.ringOut
  }

  return (
    <TicketDetailScreen
      ticket={result.ticket}
      canBuildQuote={canBuildQuotes(ctx.profile.role)}
      currentProfileId={ctx.profile.id}
      ringOut={ringOut}
    />
  )
}
