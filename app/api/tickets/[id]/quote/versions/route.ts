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

const prepareSchema = z.strictObject({
  expectedDraftFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return noStoreJson({ error: 'unauthenticated' }, 401)
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return withNoStore(denied)
  if (!acceptsJson(req)) return noStoreJson({ error: 'unsupported_media_type' }, 415)
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return noStoreJson({ error: 'invalid_json' }, 400)
  }
  const parsedBody = prepareSchema.safeParse(body)
  if (!parsedBody.success) return noStoreJson({ error: 'invalid_input' }, 422)
  const { id } = await params
  const result = await createQuoteVersion(db, {
    actor: quoteActorFromProfile(ctx.profile), ticketId: id,
    expectedDraftFingerprint: parsedBody.data.expectedDraftFingerprint,
  })
  if (!result.ok) {
    return noStoreJson(quoteErrorBody(result), quoteDomainStatus(result))
  }
  return noStoreJson(
    { changed: result.changed, version: result.version },
    result.changed ? 201 : 200,
  )
}
