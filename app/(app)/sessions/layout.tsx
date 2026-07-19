import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { checkAccess } from '@/lib/auth-access'
import { isDiagnosticsReleaseEnabled } from '@/lib/release-policy'

export default async function SessionsLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) redirect('/sign-in')

  const access = await checkAccess(db, ctx.user.id)
  if (access.kind === 'deactivated') redirect('/deactivated')
  if (access.kind === 'paywall') redirect('/subscribe')
  if (!isDiagnosticsReleaseEnabled() || !access.entitlements.diagnostics) {
    redirect('/today')
  }

  return children
}
