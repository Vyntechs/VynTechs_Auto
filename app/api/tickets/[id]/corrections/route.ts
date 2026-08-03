import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { readBoundedJson } from '@/lib/http/bounded-json'
import { checkRateLimit } from '@/lib/rate-limit'
import {
  isTicketCorrectionEnabled,
  TICKET_CORRECTION_UNAVAILABLE,
} from '@/lib/release-policy'
import { correctTicket } from '@/lib/shop-os/ticket-corrections'
import { getServerSupabase } from '@/lib/supabase-server'
import { ticketActorFromProfile } from '@/lib/tickets'

const MAX_BODY_BYTES = 8 * 1024
const ticketIdSchema = z.uuid().transform((value) => value.toLowerCase())

function noStoreJson(body: unknown, status: number, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: { ...Object.fromEntries(new Headers(headers)), 'Cache-Control': 'no-store' },
  })
}

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set('Cache-Control', 'no-store')
  return response
}

function acceptsJson(req: Request): boolean {
  return req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
    === 'application/json'
}

function resultStatus(error: string): number {
  if (error === 'invalid_input') return 400
  if (error === 'unavailable' || error === 'not_found') return 404
  if (error === 'forbidden') return 403
  return 409
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isTicketCorrectionEnabled()) {
    return noStoreJson(
      TICKET_CORRECTION_UNAVAILABLE.body,
      TICKET_CORRECTION_UNAVAILABLE.status,
    )
  }

  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return noStoreJson({ error: 'unauthenticated' }, 401)
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return withNoStore(denied)

  const parsedTicketId = ticketIdSchema.safeParse((await params).id)
  if (!parsedTicketId.success) return noStoreJson({ error: 'invalid_input' }, 400)
  if (!ctx.profile.shopId) return noStoreJson({ error: 'not_found' }, 404)

  let quota: Awaited<ReturnType<typeof checkRateLimit>>
  try {
    quota = await checkRateLimit(
      db,
      `ticket-correction:${ctx.profile.shopId}:${ctx.profile.id}`,
      20,
    )
  } catch {
    return noStoreJson({ error: 'unavailable' }, 503)
  }
  if (!quota.allowed) {
    const retryAfter = Math.max(
      1,
      Math.ceil((quota.resetAt.getTime() - Date.now()) / 1_000),
    )
    return noStoreJson(
      { error: 'rate_limited', resetAt: quota.resetAt.toISOString() },
      429,
      { 'Retry-After': String(retryAfter) },
    )
  }

  if (!acceptsJson(req)) return noStoreJson({ error: 'unsupported_media_type' }, 415)
  const parsedBody = await readBoundedJson(req, MAX_BODY_BYTES)
  if (!parsedBody.ok) {
    return noStoreJson(
      { error: parsedBody.error },
      parsedBody.error === 'payload_too_large' ? 413 : 400,
    )
  }

  const result = await correctTicket(db, {
    actor: ticketActorFromProfile(ctx.profile),
    ticketId: parsedTicketId.data,
    body: parsedBody.value,
  })
  if (!result.ok) {
    return noStoreJson(
      { error: result.error, ...(result.retryable === true ? { retryable: true } : {}) },
      resultStatus(result.error),
    )
  }
  return noStoreJson({
    outcome: result.outcome,
    changed: result.changed,
    scope: result.scope,
    invalidatedVersionNumber: result.invalidatedVersionNumber,
    ticket: result.ticket,
  }, 200)
}
