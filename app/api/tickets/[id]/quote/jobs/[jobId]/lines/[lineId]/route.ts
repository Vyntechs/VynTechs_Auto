import { NextResponse } from 'next/server'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import {
  deleteDraftLine,
  publicManualDraftLine,
  quoteActorFromProfile,
  quoteDomainStatus,
  quoteErrorBody,
  replaceDraftLine,
} from '@/lib/shop-os/quotes'

type Params = { params: Promise<{ id: string; jobId: string; lineId: string }> }

export async function PUT(req: Request, { params }: Params) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { id, jobId, lineId } = await params
  const result = await replaceDraftLine(db, {
    actor: quoteActorFromProfile(ctx.profile), ticketId: id, jobId, lineId, body,
  })
  if (!result.ok) {
    return NextResponse.json(quoteErrorBody(result), { status: quoteDomainStatus(result) })
  }
  return NextResponse.json(
    { changed: result.changed, ...(result.line ? { line: publicManualDraftLine(result.line) } : {}) },
    { status: 200 },
  )
}

export async function DELETE(_req: Request, { params }: Params) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  const { id, jobId, lineId } = await params
  const result = await deleteDraftLine(db, {
    actor: quoteActorFromProfile(ctx.profile), ticketId: id, jobId, lineId,
  })
  if (!result.ok) {
    return NextResponse.json(quoteErrorBody(result), { status: quoteDomainStatus(result) })
  }
  return NextResponse.json({ changed: result.changed }, { status: 200 })
}
