import { NextResponse } from 'next/server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { createCounterTicket } from '@/lib/intake/counter-ticket'
import { isDesktopIntakeEnabled } from '@/lib/feature-flags'
import { rateLimitReject } from '@/lib/rate-limit'
import { getServerSupabase } from '@/lib/supabase-server'
import { ticketActorFromProfile, ticketDomainStatus } from '@/lib/tickets'

export async function POST(req: Request) {
  if (!isDesktopIntakeEnabled()) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const ctx = await requireUserAndProfile({
    supabase: await getServerSupabase(),
    db,
  })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }
  if (ctx.profile.role !== 'owner') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const limited = await rateLimitReject(db, `intake:${ctx.user.id}`, 10)
  if (limited) return limited

  const result = await createCounterTicket(db, {
    actor: ticketActorFromProfile(ctx.profile),
    body,
  })
  if (!result.ok) {
    const error = result.warning
      ? { error: result.error, warning: result.warning }
      : { error: result.error }
    return NextResponse.json(error, { status: ticketDomainStatus(result, 201) })
  }

  return NextResponse.json({ ticket: result.ticket }, { status: 201 })
}
