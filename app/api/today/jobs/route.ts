import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { listTodayTicketJobs, ticketActorFromProfile } from '@/lib/tickets'

// This is deliberately a narrow projection, not a generic ticket feed. It
// gives the mounted Today board fresh, server-authorized truth without a page
// transition or a client-side copy of the shop database.
export async function GET() {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  const todayJobs = await listTodayTicketJobs(db, {
    actor: ticketActorFromProfile(ctx.profile),
  })
  return NextResponse.json({ todayJobs })
}
