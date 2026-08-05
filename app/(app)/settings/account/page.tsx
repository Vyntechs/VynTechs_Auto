import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { AccountSection } from '@/components/vt/account-section'
import { isWrenchingSkillTier } from '@/lib/shop-os/capabilities'

export default async function SettingsAccountPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  return (
    <AccountSection
      initialFullName={ctx.profile.fullName ?? ''}
      email={ctx.user.email}
      profileId={ctx.profile.id}
      canTrackJobTime={
        ctx.profile.membershipStatus === 'active' &&
        ctx.profile.deactivatedAt === null &&
        isWrenchingSkillTier(ctx.profile.skillTier)
      }
      initialJobTimerEnabled={ctx.profile.jobTimerEnabled}
    />
  )
}
