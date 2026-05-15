import { redirect } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { getServerSupabase } from '@/lib/supabase-server'
import { db } from '@/lib/db/client'
import { profiles } from '@/lib/db/schema'
import { canCurate } from '@/lib/curator/can-curate'
import { CuratorSidebar } from '@/components/curator/sidebar'

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
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(eq(profiles.userId, user.id))
    .limit(1)
  if (!canCurate(profile?.role, user.email)) redirect('/')

  return (
    <div className="vt-curator-shell">
      <div className="vt-curator-grid">
        <CuratorSidebar />
        <main className="vt-curator-main">{children}</main>
      </div>
    </div>
  )
}
