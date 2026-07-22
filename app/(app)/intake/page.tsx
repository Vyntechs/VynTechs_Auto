import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { getRecentIntakeCustomers } from '@/lib/intake/recent-customers'
import { getShopTeam } from '@/lib/intake/team'
import { CounterIntake } from '@/components/screens/counter-intake'
import { cannedJobActorFromProfile, listCannedJobs, publicCannedJob } from '@/lib/shop-os/canned-jobs'

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
    // Intake stays usable for explicit known work; diagnosis fails visibly closed.
  }

  return (
    <CounterIntake
      userEmail={ctx.user.email}
      recentCustomers={recentCustomers}
      team={team.members}
      workloadFailed={team.workloadFailed}
      cannedJobs={cannedJobs}
      cannedTaxRateBps={cannedTaxRateBps}
      cannedCatalogAvailable={cannedCatalogAvailable}
    />
  )
}
