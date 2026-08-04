import { NextResponse } from 'next/server'
import { z } from 'zod'
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

const linePutSchema = z.strictObject({
  expectedLineFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  line: z.unknown(),
})
const lineDeleteSchema = z.strictObject({
  expectedLineFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
})

function noStoreJson(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function acceptsJson(req: Request): boolean {
  return req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    === 'application/json'
}

async function readJson(req: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    return { ok: true, value: await req.json() }
  } catch {
    return { ok: false }
  }
}

export async function PUT(req: Request, { params }: Params) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return noStoreJson({ error: 'unauthenticated' }, 401)
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return withNoStore(denied)
  if (!acceptsJson(req)) return noStoreJson({ error: 'unsupported_media_type' }, 415)
  const body = await readJson(req)
  if (!body.ok) return noStoreJson({ error: 'invalid_json' }, 400)
  const parsedBody = linePutSchema.safeParse(body.value)
  if (!parsedBody.success) return noStoreJson({ error: 'invalid_input' }, 422)
  const { id, jobId, lineId } = await params
  const result = await replaceDraftLine(db, {
    actor: quoteActorFromProfile(ctx.profile), ticketId: id, jobId, lineId,
    expectedLineFingerprint: parsedBody.data.expectedLineFingerprint,
    body: parsedBody.data.line,
  })
  if (!result.ok) {
    return noStoreJson(quoteErrorBody(result), quoteDomainStatus(result))
  }
  return noStoreJson(
    { changed: result.changed, ...(result.line ? { line: publicManualDraftLine(result.line) } : {}) },
    200,
  )
}

export async function DELETE(req: Request, { params }: Params) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return noStoreJson({ error: 'unauthenticated' }, 401)
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return withNoStore(denied)
  if (!acceptsJson(req)) return noStoreJson({ error: 'unsupported_media_type' }, 415)
  const body = await readJson(req)
  if (!body.ok) return noStoreJson({ error: 'invalid_json' }, 400)
  const parsedBody = lineDeleteSchema.safeParse(body.value)
  if (!parsedBody.success) return noStoreJson({ error: 'invalid_input' }, 422)
  const { id, jobId, lineId } = await params
  const result = await deleteDraftLine(db, {
    actor: quoteActorFromProfile(ctx.profile), ticketId: id, jobId, lineId,
    expectedLineFingerprint: parsedBody.data.expectedLineFingerprint,
  })
  if (!result.ok) {
    return noStoreJson(quoteErrorBody(result), quoteDomainStatus(result))
  }
  return noStoreJson({ changed: result.changed }, 200)
}
