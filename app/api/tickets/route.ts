import { NextResponse } from 'next/server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import {
  createTicket,
  ticketActorFromProfile,
  ticketDomainStatus,
} from '@/lib/tickets'

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

  const result = await createTicket(db, {
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
