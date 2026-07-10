import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { canManageTeam } from '@/lib/shop-os/capabilities'
import { getShopById } from '@/lib/db/queries'
import { Module } from '@/components/vt'
import { ShopSection } from '@/components/vt/shop-section'

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

  return <ShopSection initialName={shop.name} />
}
