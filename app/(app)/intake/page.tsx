import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'
import { getShopTeam } from '@/lib/intake/team'
import { CounterIntake } from '@/components/screens/counter-intake'

export default async function IntakePage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const [recentCustomers, team] = await Promise.all([
    ctx.profile.shopId
      ? getRecentIntakeCustomers({
          db,
          shopId: ctx.profile.shopId,
          withinHours: 12,
          limit: 8,
        })
      : Promise.resolve([]),
    ctx.profile.shopId
      ? getShopTeam({ db, shopId: ctx.profile.shopId, currentUserId: ctx.profile.id })
      : Promise.resolve({ members: [], workloadFailed: false }),
  ])

  return (
    <CounterIntake
      userEmail={ctx.user.email}
      recentCustomers={recentCustomers}
      team={team.members}
      workloadFailed={team.workloadFailed}
    />
  )
}
