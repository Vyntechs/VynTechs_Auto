import { NextResponse } from 'next/server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import {
  getQuoteBuilder,
  quoteActorFromProfile,
  quoteDomainStatus,
  quoteErrorBody,
} from '@/lib/shop-os/quotes'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  const { id } = await params
  const result = await getQuoteBuilder(db, {
    actor: quoteActorFromProfile(ctx.profile),
    ticketId: id,
  })
  if (!result.ok) {
    return NextResponse.json(quoteErrorBody(result), { status: quoteDomainStatus(result) })
  }
  return NextResponse.json({ builder: result.builder }, { status: 200 })
}
