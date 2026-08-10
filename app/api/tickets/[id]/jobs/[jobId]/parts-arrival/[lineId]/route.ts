import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { readBoundedJson } from '@/lib/http/bounded-json'
import {
  advancePartArrival,
  partsArrivalErrorBody,
} from '@/lib/shop-os/parts-arrival'
import { rateLimitReject } from '@/lib/rate-limit'
import { getServerSupabase } from '@/lib/supabase-server'

type RouteContext = { params: Promise<{ id: string; jobId: string; lineId: string }> }

const MAX_BODY_BYTES = 4 * 1024
const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function POST(req: Request, { params }: RouteContext) {
  const ctx = await requireUserAndProfile({ supabase: await getServerSupabase(), db })
  if (!ctx) return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: NO_STORE_HEADERS })
  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  if (!ctx.profile.shopId) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: NO_STORE_HEADERS })
  const limited = await rateLimitReject(
    db,
    `parts-arrival:${ctx.profile.shopId}:${ctx.profile.id}`,
    60,
  )
  if (limited) return limited
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? ''
  if (!contentType.startsWith('application/json')) {
    return NextResponse.json({ error: 'unsupported_media_type' }, { status: 415, headers: NO_STORE_HEADERS })
  }
  const body = await readBoundedJson(req, MAX_BODY_BYTES)
  if (!body.ok) {
    return NextResponse.json(
      { error: body.error },
      { status: body.error === 'payload_too_large' ? 413 : 400, headers: NO_STORE_HEADERS },
    )
  }
  const { id, jobId, lineId } = await params
  const result = await advancePartArrival(db, {
    actor: { profileId: ctx.profile.id },
    ticketId: id,
    jobId,
    lineId,
    body: body.value,
  })
  if (!result.ok) {
    const status = result.error === 'invalid_input' ? 400
      : result.error === 'not_found' ? 404 : 409
    return NextResponse.json(partsArrivalErrorBody(result), { status, headers: NO_STORE_HEADERS })
  }
  return NextResponse.json(
    { changed: result.changed, job: result.job },
    { status: result.changed ? 201 : 200, headers: NO_STORE_HEADERS },
  )
}
