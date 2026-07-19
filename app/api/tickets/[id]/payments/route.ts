import { NextResponse } from 'next/server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { recordTicketPayment } from '@/lib/shop-os/ring-out'
import { ticketActorFromProfile, ticketDomainStatus } from '@/lib/tickets'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { id } = await params
  const result = await recordTicketPayment(db, {
    actor: ticketActorFromProfile(ctx.profile), ticketId: id, body,
  })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: ticketDomainStatus(result, 200) })
  }
  return NextResponse.json({ ringOut: result.ringOut }, { status: 200 })
}
