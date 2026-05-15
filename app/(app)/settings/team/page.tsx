import { notFound, redirect } from 'next/navigation'
import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile, isFounder } from '@/lib/auth'
import { profiles } from '@/lib/db/schema'
import { Module } from '@/components/vt'
import { TeamSection, type TeamMemberRow } from '@/components/vt/team-section'

export default async function SettingsTeamPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  const isAdmin =
    ctx.profile.role === 'owner' || isFounder(ctx.user.email)
  if (!isAdmin) notFound()

  if (!ctx.profile.shopId) {
    return (
      <Module label="Team">
        <p className="vt-settings-coming-soon">
          No shop is assigned to your account yet.
        </p>
      </Module>
    )
  }

  const rows = await db
    .select({
      userId: profiles.userId,
      profileId: profiles.id,
      fullName: profiles.fullName,
      role: profiles.role,
      deactivatedAt: profiles.deactivatedAt,
    })
    .from(profiles)
    .where(eq(profiles.shopId, ctx.profile.shopId))
    .orderBy(asc(profiles.fullName))

  // Pin the current user to the top so they always see their own row first
  // (matches the convention in getShopTeam used by intake).
  const members: TeamMemberRow[] = rows.map((r) => ({
    userId: r.userId,
    profileId: r.profileId,
    fullName: r.fullName,
    role: r.role,
    deactivated: r.deactivatedAt !== null,
  }))
  const selfIdx = members.findIndex((m) => m.userId === ctx.user.id)
  if (selfIdx > 0) {
    const [self] = members.splice(selfIdx, 1)
    members.unshift(self)
  }

  return <TeamSection members={members} currentUserId={ctx.user.id} />
}
