import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { requireUserAndProfile } from '@/lib/auth'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'
import { canCreateTickets } from '@/lib/shop-os/capabilities'
import { getServerSupabase } from '@/lib/supabase-server'
import { QuickTicket } from '@/components/screens/quick-ticket'

export default async function QuickTicketPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')
  if (!ctx.profile.shopId || !canCreateTickets(ctx.profile.role)) redirect('/today')

  const recentCustomers = await getRecentIntakeCustomers({
    db,
    shopId: ctx.profile.shopId,
    withinHours: 12,
    limit: 8,
  })

  return (
    <QuickTicket
      userEmail={ctx.user.email}
      recentCustomers={recentCustomers}
    />
  )
}
