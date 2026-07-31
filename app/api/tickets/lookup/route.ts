import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { isIntakeSearchQueryWithinLimits } from '@/lib/intake/search-limits'
import { rateLimitReject } from '@/lib/rate-limit'
import { lookupTickets } from '@/lib/shop-os/ticket-lookup'
import { ticketActorFromProfile } from '@/lib/tickets'

type Body = { q?: string }

export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  if (!ctx.profile.shopId) {
    return NextResponse.json({ error: 'no_shop' }, { status: 403 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const q = typeof body.q === 'string' ? body.q : ''
  if (!isIntakeSearchQueryWithinLimits(q)) {
    return NextResponse.json({ error: 'query_too_complex' }, { status: 400 })
  }

  const limited = await rateLimitReject(db, `ticket-lookup:${ctx.user.id}`, 60)
  if (limited) return limited

  // An empty box is not a request to list the shop. Intake answers a blank
  // query with recent customers; there is no equivalent here, because the
  // whole point of this door is that you already know what you are looking for.
  if (q.trim() === '') {
    return NextResponse.json({ tickets: [] }, { status: 200 })
  }

  const start = performance.now()
  const hits = await lookupTickets(db, { actor: ticketActorFromProfile(ctx.profile), q })
  return NextResponse.json(
    { tickets: hits, latencyMs: Math.round(performance.now() - start) },
    { status: 200 },
  )
}
