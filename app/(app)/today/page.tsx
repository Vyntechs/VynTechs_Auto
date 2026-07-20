import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { listSessionsForShop } from '@/lib/db/queries'
import { listDueFollowUpsForTech } from '@/lib/comeback/list'
import { canCurate } from '@/lib/curator/can-curate'
import { hasDiagnostics } from '@/lib/entitlements'
import { TodayHome } from '@/components/screens/today-home'
import { canAssignWork, canCreateTickets } from '@/lib/shop-os/capabilities'
import { listTodayTicketJobs, ticketActorFromProfile } from '@/lib/tickets'

export default async function TodayPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const diagnosticsEntitled = await hasDiagnostics(db, {
    shopId: ctx.profile.shopId,
    isComp: ctx.profile.isComp,
  })
  const [all, dueFollowUps, todayJobs] = await Promise.all([
    diagnosticsEntitled && ctx.profile.shopId
      ? listSessionsForShop(db, ctx.profile.shopId)
      : Promise.resolve([]),
    listDueFollowUpsForTech(db, ctx.profile.id),
    listTodayTicketJobs(db, { actor: ticketActorFromProfile(ctx.profile) }),
  ])
  const mine = all.filter((s) => s.techId === ctx.profile.id)
  const linkedSessionIds = new Set(todayJobs.linkedSessionIds)

  const inProgress = mine.filter(
    (s) => s.status === 'open' && !linkedSessionIds.has(s.id),
  )
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const closedToday = mine.filter(
    (s) =>
      s.status === 'closed' &&
      !linkedSessionIds.has(s.id) &&
      s.closedAt &&
      new Date(s.closedAt) >= startOfToday,
  )

  return (
    <TodayHome
      techName={ctx.profile.fullName ?? 'Tech'}
      inProgress={inProgress}
      closedToday={closedToday}
      dueFollowUps={dueFollowUps}
      canCurate={canCurate(ctx.profile.isCurator, ctx.user.email)}
      canWriteCounterOrder={canAssignWork(ctx.profile.role)}
      canCreateTickets={canCreateTickets(ctx.profile.role)}
      canDispatchWork={canAssignWork(ctx.profile.role)}
      todayJobs={todayJobs}
      diagnosticsEntitled={diagnosticsEntitled}
    />
  )
}
