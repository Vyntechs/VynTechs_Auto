import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import {
  mutateTicketLifecycle,
  type TicketLifecycleResult,
} from '@/lib/shop-os/interruption'
import { getServerSupabase } from '@/lib/supabase-server'

type RouteContext = { params: Promise<{ id: string }> }

function failureResponse(result: Extract<TicketLifecycleResult, { ok: false }>) {
  const status = result.error === 'invalid_input' ? 400
    : result.error === 'not_found' ? 404
      : 409
  return NextResponse.json(
    { error: result.error, ...(result.retryable ? { retryable: true } : {}) },
    { status },
  )
}

export async function POST(req: Request, { params }: RouteContext) {
  const auth = await requireUserAndProfile({
    supabase: await getServerSupabase(),
    db,
  })
  if (!auth) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const denied = await paywallReject(db, auth.user.id)
  if (denied) return denied
  if (!auth.profile.shopId) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { id } = await params
  const result = await mutateTicketLifecycle(db, {
    actor: {
      profileId: auth.profile.id,
      shopId: auth.profile.shopId,
      role: auth.profile.role,
      membershipStatus: auth.profile.membershipStatus,
      deactivatedAt: auth.profile.deactivatedAt,
    },
    ticketId: id,
    body,
  })
  return result.ok
    ? NextResponse.json({ changed: result.changed, ticket: result.ticket }, { status: 200 })
    : failureResponse(result)
}
