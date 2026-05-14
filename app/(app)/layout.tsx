import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { getShopById } from '@/lib/db/queries'
import { AppHeaderProvider } from '@/components/vt/app-header-context'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const shop = ctx.profile.shopId ? await getShopById(db, ctx.profile.shopId) : null
  const founder = isFounder(ctx.user.email)

  return (
    <AppHeaderProvider shopName={shop?.name ?? null} isFounder={founder}>
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        {children}
      </div>
    </AppHeaderProvider>
  )
}
