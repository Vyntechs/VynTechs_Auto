import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { createPartRequest, type PartRequestFailure } from '@/lib/shop-os/part-requests'
import { getServerSupabase } from '@/lib/supabase-server'
import { rateLimitReject } from '@/lib/rate-limit'
import { readBoundedJson } from '@/lib/http/bounded-json'

type RouteContext = { params: Promise<{ id: string; jobId: string }> }

function failureResponse(result: PartRequestFailure) {
  const status = result.error === 'invalid_input' ? 400
    : result.error === 'not_found' ? 404
      : result.error === 'not_authorized' ? 403
        : 409
  return NextResponse.json(
    { error: result.error, ...(result.retryable ? { retryable: true } : {}) },
    { status },
  )
}

export async function POST(req: Request, { params }: RouteContext) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  if (!ctx.profile.shopId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const limited = await rateLimitReject(
    db,
    `part-request:${ctx.profile.shopId}:${ctx.profile.id}`,
    20,
  )
  if (limited) return limited
  const body = await readBoundedJson(req, 16 * 1024)
  if (!body.ok) {
    return NextResponse.json({ error: body.error }, { status: body.error === 'payload_too_large' ? 413 : 400 })
  }
  const { id, jobId } = await params
  const result = await createPartRequest(db, {
    actor: { profileId: ctx.profile.id, shopId: ctx.profile.shopId },
    ticketId: id,
    jobId,
    body: body.value,
  })
  return result.ok
    ? NextResponse.json({ request: result.request }, { status: 201 })
    : failureResponse(result)
}
