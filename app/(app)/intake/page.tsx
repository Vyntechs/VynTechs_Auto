import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'
import { CounterIntake } from '@/components/screens/counter-intake'

export default async function IntakePage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const recentCustomers = ctx.profile.shopId
    ? await getRecentIntakeCustomers({
        db,
        shopId: ctx.profile.shopId,
        withinHours: 12,
        limit: 8,
      })
    : []

  return <CounterIntake userEmail={ctx.user.email} recentCustomers={recentCustomers} />
}
