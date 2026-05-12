import { redirect } from 'next/navigation'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { listWhatsNewEntries, markWhatsNewSeen } from '@/lib/db/queries'
import { WhatsNew } from '@/components/screens/whats-new'

export const dynamic = 'force-dynamic'

export default async function WhatsNewPage() {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) redirect('/sign-in')

  // Capture the previous lastSeen BEFORE marking — the page should render
  // "New" pills against the user's state at entry, not after the mark.
  const previousLastSeen = ctx.profile.lastSeenWhatsNewAt
  const entries = await listWhatsNewEntries(db)
  await markWhatsNewSeen(db, ctx.user.id)

  return <WhatsNew entries={entries} lastSeenAt={previousLastSeen} />
}
