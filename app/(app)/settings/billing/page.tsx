import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { Module } from '@/components/vt'

export default async function SettingsBillingPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const isAdmin =
    ctx.profile.role === 'owner' || isFounder(ctx.user.email)
  if (!isAdmin) notFound()

  return (
    <Module label="Billing">
      <p className="vt-settings-coming-soon">
        Coming soon — Billing moves here in PR 3.
      </p>
    </Module>
  )
}
