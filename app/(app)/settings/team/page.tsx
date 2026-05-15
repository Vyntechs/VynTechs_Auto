import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { Module } from '@/components/vt'

export default async function SettingsTeamPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const isAdmin =
    ctx.profile.role === 'owner' || isFounder(ctx.user.email)
  if (!isAdmin) notFound()

  return (
    <Module label="Team">
      <p className="vt-settings-coming-soon">
        Coming soon — Team settings land in PR 6.
      </p>
    </Module>
  )
}
