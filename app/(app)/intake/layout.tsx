import { notFound, redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { isDesktopIntakeEnabled } from '@/lib/feature-flags'

export default async function IntakeLayout({ children }: { children: ReactNode }) {
  if (!isDesktopIntakeEnabled()) notFound()

  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')
  if (ctx.profile.role !== 'owner') notFound()

  return <>{children}</>
}
