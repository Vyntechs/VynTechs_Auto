import { NextResponse } from 'next/server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import {
  quoteActorFromProfile,
  quoteDomainStatus,
  quoteErrorBody,
  recordQuoteDecision,
} from '@/lib/shop-os/quotes'

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
  const result = await recordQuoteDecision(db, {
    actor: quoteActorFromProfile(ctx.profile), ticketId: id, body,
  })
  if (!result.ok) {
    return NextResponse.json(quoteErrorBody(result), { status: quoteDomainStatus(result) })
  }
  return NextResponse.json(
    { changed: result.changed, event: result.event, projection: result.projection },
    { status: result.changed ? 201 : 200 },
  )
}
