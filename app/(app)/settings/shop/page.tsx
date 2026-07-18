import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { canManageTeam } from '@/lib/shop-os/capabilities'
import { getShopById } from '@/lib/db/queries'
import { Module } from '@/components/vt'
import { ShopSection } from '@/components/vt/shop-section'
import { RatesSection } from '@/components/vt/rates-section'
import { CannedJobsSection } from '@/components/vt/canned-jobs-section'
import { SuppliersSection } from '@/components/vt/suppliers-section'
import { cannedJobActorFromProfile, listCannedJobs, publicCannedJob } from '@/lib/shop-os/canned-jobs'
import { listVendorAccounts, publicVendorAccount, vendorAccountActorFromProfile } from '@/lib/shop-os/parts'

export default async function SettingsShopPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const isAdmin = canManageTeam(ctx.profile.role, isFounder(ctx.user.email))
  if (!isAdmin) notFound()

  const shop = ctx.profile.shopId ? await getShopById(db, ctx.profile.shopId) : null
  if (!shop) {
    return (
      <Module label="Shop">
        <p className="vt-settings-coming-soon">
          No shop is assigned to your account yet.
        </p>
      </Module>
    )
  }

  const founderOverride = isFounder(ctx.user.email)
  const library = await listCannedJobs(db, {
    actor: cannedJobActorFromProfile(ctx.profile, founderOverride),
  })
  const suppliers = await listVendorAccounts(db, {
    actor: vendorAccountActorFromProfile(ctx.profile, founderOverride),
    scope: 'all',
  })

  return <>
    <ShopSection initialName={shop.name} />
    <RatesSection
      initialTaxRateBps={shop.taxRateBps}
      initialLaborRateCents={shop.laborRateCents}
      initialPartsMarkupBps={shop.partsMarkupBps}
    />
    {library.ok ? (
      <CannedJobsSection
        initialJobs={library.cannedJobs.map(publicCannedJob)}
        initialTaxRateBps={library.taxRateBps}
      />
    ) : (
      <Module num="03" label="Canned jobs">
        <p className="vt-settings-coming-soon">The canned-job library could not be loaded. Refresh the page to try again.</p>
      </Module>
    )}
    {suppliers.ok ? (
      <SuppliersSection initialAccounts={suppliers.vendorAccounts.map(publicVendorAccount)} />
    ) : (
      <Module num="04" label="Suppliers">
        <p className="vt-settings-coming-soon">The supplier list could not be loaded. Refresh the page to try again.</p>
      </Module>
    )}
  </>
}
