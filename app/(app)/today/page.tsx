import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { listSessionsForShop } from '@/lib/db/queries'
import { TodayHome } from '@/components/screens/today-home'

export default async function TodayPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const all = ctx.profile.shopId
    ? await listSessionsForShop(db, ctx.profile.shopId)
    : []
  const mine = all.filter((s) => s.techId === ctx.profile.id)

  const inProgress = mine.filter((s) => s.status === 'open')
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const closedToday = mine.filter(
    (s) => s.status === 'closed' && s.closedAt && new Date(s.closedAt) >= startOfToday,
  )

  return (
    <TodayHome
      techName={ctx.profile.fullName ?? 'Tech'}
      inProgress={inProgress}
      queued={[]}
      closedToday={closedToday}
    />
  )
}
