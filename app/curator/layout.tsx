import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from '@/lib/curator/can-curate'
import { CuratorShell } from '@/components/curator/curator-shell'

export const metadata = { title: 'Vyntechs Curator' }

export default async function CuratorLayout({
  children,
}: { children: React.ReactNode }) {
  // Defense-in-depth: middleware already gated this, but layout double-checks
  // so a misconfigured middleware can't expose curator data.
  const supabase = await getServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')
  const [profile] = await db
    .select({ id: profiles.id, isCurator: profiles.isCurator, fullName: profiles.fullName })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1)
  if (!canCurate(profile?.isCurator, user.email)) redirect('/')

  // Real display name for the top-bar avatar — name first, email as the
  // honest fallback, never a fabricated placeholder.
  const userName = profile?.fullName?.trim() || user.email || 'Curator'

  return <CuratorShell userName={userName}>{children}</CuratorShell>
}
