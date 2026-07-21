import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { listDueFollowUpsForTech } from '@/lib/comeback/list'
import { canCurate } from '@/lib/curator/can-curate'
import { TodayHome } from '@/components/screens/today-home'
import { canAssignWork, canBuildQuotes, canCreateTickets } from '@/lib/shop-os/capabilities'
import { getShopTeam } from '@/lib/intake/team'
import { listTodayTicketJobs, ticketActorFromProfile } from '@/lib/tickets'

export default async function TodayPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  // Diagnostics remain deliberately dark until AutoEye is ready. Today still
  // gives the shop a complete ordinary repair-order command surface.
  const diagnosticsEntitled = false
  const canDispatchWork = canAssignWork(ctx.profile.role)
  const [dueFollowUps, todayJobs, shopTeam] = await Promise.all([
    listDueFollowUpsForTech(db, ctx.profile.id),
    listTodayTicketJobs(db, { actor: ticketActorFromProfile(ctx.profile) }),
    canDispatchWork && ctx.profile.shopId
      ? getShopTeam({ db, shopId: ctx.profile.shopId, currentUserId: ctx.profile.id })
      : Promise.resolve({ members: [], workloadFailed: false }),
  ])
  return (
    <TodayHome
      techName={ctx.profile.fullName ?? 'Tech'}
      inProgress={[]}
      closedToday={[]}
      dueFollowUps={dueFollowUps}
      canCurate={canCurate(ctx.profile.isCurator, ctx.user.email)}
      canWriteCounterOrder={canAssignWork(ctx.profile.role)}
      canCreateTickets={canCreateTickets(ctx.profile.role)}
      canDispatchWork={canDispatchWork}
      canBuildQuote={canBuildQuotes(ctx.profile.role)}
      currentProfileId={ctx.profile.id}
      team={shopTeam.members}
      todayJobs={todayJobs}
      diagnosticsEntitled={diagnosticsEntitled}
    />
  )
}
