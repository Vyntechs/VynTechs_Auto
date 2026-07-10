import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { AppHeader } from '@/components/vt'
import { SettingsGrid } from '@/components/vt/settings-grid'
import { SettingsList } from '@/components/vt/settings-list'
import { canManageTeam } from '@/lib/shop-os/capabilities'

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const isAdmin = canManageTeam(ctx.profile.role, isFounder(ctx.user.email))

  return (
    <div className="app">
      <AppHeader title="Settings" back={{ href: '/today', label: 'My Jobs' }} />
      <SettingsGrid list={<SettingsList isAdmin={isAdmin} />}>
        {children}
      </SettingsGrid>
    </div>
  )
}
