import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { resolvePartRequest, type PartRequestFailure } from '@/lib/shop-os/part-requests'
import { getServerSupabase } from '@/lib/supabase-server'

type RouteContext = { params: Promise<{ id: string; requestId: string }> }

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
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { id, requestId } = await params
  const result = await resolvePartRequest(db, {
    actor: { profileId: ctx.profile.id, shopId: ctx.profile.shopId },
    ticketId: id,
    requestId,
    body,
  })
  return result.ok
    ? NextResponse.json({ request: result.request }, { status: 200 })
    : failureResponse(result)
}
