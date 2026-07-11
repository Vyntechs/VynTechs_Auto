import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'
import { canCreateTickets } from '@/lib/shop-os/capabilities'
import { cannedJobActorFromProfile, listCannedJobs, publicCannedJob } from '@/lib/shop-os/canned-jobs'
import { getServerSupabase } from '@/lib/supabase-server'
import { QuickTicket } from '@/components/screens/quick-ticket'

export default async function QuickTicketPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')
  const access = await checkAccess(db, ctx.user.id)
  if (access.kind === 'deactivated') redirect('/deactivated')
  if (access.kind === 'paywall') redirect('/subscribe')
  if (!ctx.profile.shopId || !canCreateTickets(ctx.profile.role)) redirect('/today')

  const recentCustomers = await getRecentIntakeCustomers({
    db,
    shopId: ctx.profile.shopId,
    withinHours: 12,
    limit: 8,
  })
  let cannedJobs: ReturnType<typeof publicCannedJob>[] = []
  let cannedTaxRateBps: number | null = null
  let cannedCatalogAvailable = false
  try {
    const library = await listCannedJobs(db, { actor: cannedJobActorFromProfile(ctx.profile) })
    if (library.ok) {
      cannedJobs = library.cannedJobs.map(publicCannedJob)
      cannedTaxRateBps = library.taxRateBps
      cannedCatalogAvailable = true
    }
  } catch {
    // Canned work is optional; manual Quick Quote remains available.
  }

  return (
    <QuickTicket
      userEmail={ctx.user.email}
      recentCustomers={recentCustomers}
      cannedJobs={cannedJobs}
      cannedTaxRateBps={cannedTaxRateBps}
      cannedCatalogAvailable={cannedCatalogAvailable}
    />
  )
}
