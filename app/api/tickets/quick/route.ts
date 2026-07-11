import { NextResponse } from 'next/server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { createQuickTicket } from '@/lib/intake/quick-ticket'
import { rateLimitReject } from '@/lib/rate-limit'
import { getServerSupabase } from '@/lib/supabase-server'
import { ticketActorFromProfile, ticketDomainStatus } from '@/lib/tickets'

export async function POST(req: Request) {
  const ctx = await requireUserAndProfile({
    supabase: await getServerSupabase(),
    db,
  })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
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

  const result = await createQuickTicket(db, {
    actor: ticketActorFromProfile(ctx.profile),
    body,
  })
  if (!result.ok) {
    const error = {
      error: result.error,
      ...('retryable' in result && result.retryable !== undefined ? { retryable: result.retryable } : {}),
      ...(result.warning ? { warning: result.warning } : {}),
    }
    return NextResponse.json(error, { status: ticketDomainStatus(result, 201) })
  }

  return NextResponse.json({ ticket: { id: result.ticket.id } }, { status: 201 })
}
