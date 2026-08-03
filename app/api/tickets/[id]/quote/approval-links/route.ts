import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { readBoundedJson } from '@/lib/http/bounded-json'
import { rateLimitReject } from '@/lib/rate-limit'
import { createCustomerApprovalLink } from '@/lib/shop-os/customer-approval'
import { getServerSupabase } from '@/lib/supabase-server'

function statusFor(result: { ok: boolean; error?: string }, changed = false): number {
  if (result.ok) return changed ? 201 : 200
  if (result.error === 'invalid_input') return 422
  if (result.error === 'not_found') return 404
  return 409
}

function acceptsJson(req: Request): boolean {
  return req.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() === 'application/json'
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  const { id } = await params
  if (!ctx.profile.shopId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const limited = await rateLimitReject(
    db,
    `customer-approval-link:${ctx.profile.shopId}:${ctx.profile.id}:${id}`,
    20,
  )
  if (limited) return limited
  if (!acceptsJson(req)) {
    return NextResponse.json({ error: 'unsupported_media_type' }, { status: 415 })
  }
  const body = await readBoundedJson(req, 4 * 1024)
  if (!body.ok) {
    return NextResponse.json(
      { error: body.error },
      { status: body.error === 'payload_too_large' ? 413 : 400 },
    )
  }
  const result = await createCustomerApprovalLink(db, {
    actor: { profileId: ctx.profile.id },
    ticketId: id,
    body: body.value,
  })
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.retryable ? { retryable: true } : {}) },
      { status: statusFor(result) },
    )
  }
  return NextResponse.json(
    { changed: result.changed, link: result.link },
    { status: statusFor(result, result.changed), headers: { 'Cache-Control': 'no-store' } },
  )
}
