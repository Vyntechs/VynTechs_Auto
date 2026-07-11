import { NextResponse } from 'next/server'
import { z } from 'zod'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import {
  createDraftLine,
  publicManualDraftLine,
  quoteActorFromProfile,
  quoteDomainStatus,
  quoteErrorBody,
} from '@/lib/shop-os/quotes'

const createLineEnvelope = z.strictObject({ clientKey: z.unknown(), line: z.unknown() })

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; jobId: string }> },
) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  let body: unknown
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = createLineEnvelope.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'invalid_input' }, { status: 422 })

  const { id, jobId } = await params
  const result = await createDraftLine(db, {
    actor: quoteActorFromProfile(ctx.profile), ticketId: id, jobId,
    clientKey: parsed.data.clientKey, body: parsed.data.line,
  })
  if (!result.ok) {
    return NextResponse.json(quoteErrorBody(result), { status: quoteDomainStatus(result) })
  }
  return NextResponse.json(
    { changed: result.changed, ...(result.line ? { line: publicManualDraftLine(result.line) } : {}) },
    { status: result.changed ? 201 : 200 },
  )
}
