import { NextResponse } from 'next/server'
import { z } from 'zod'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import {
  createQuoteVersion,
  quoteActorFromProfile,
  quoteDomainStatus,
  quoteErrorBody,
} from '@/lib/shop-os/quotes'

const emptyBody = z.strictObject({})

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  const rawBody = await _req.text()
  if (rawBody.trim()) {
    let body: unknown
    try { body = JSON.parse(rawBody) } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }
    if (!emptyBody.safeParse(body).success) {
      return NextResponse.json({ error: 'invalid_input' }, { status: 422 })
    }
  }
  const { id } = await params
  const result = await createQuoteVersion(db, {
    actor: quoteActorFromProfile(ctx.profile), ticketId: id,
  })
  if (!result.ok) {
    return NextResponse.json(quoteErrorBody(result), { status: quoteDomainStatus(result) })
  }
  return NextResponse.json(
    { changed: result.changed, version: result.version },
    { status: result.changed ? 201 : 200 },
  )
}
