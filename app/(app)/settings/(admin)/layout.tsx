import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { canManageTeam } from '@/lib/shop-os/capabilities'

export default async function SettingsAdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const isAdmin = canManageTeam(ctx.profile.role, isFounder(ctx.user.email))
  if (!isAdmin) notFound()

  return <>{children}</>
}
