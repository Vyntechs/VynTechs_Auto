import { NextResponse } from 'next/server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { db } from '@/lib/db/client'
import { updateAdaptiveModeForUser } from '@/lib/diagnostics/adaptive/state'
import { getServerSupabase } from '@/lib/supabase-server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied
  if (!ctx.profile.shopId) {
    return NextResponse.json({ error: 'not_eligible' }, { status: 409 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    body = null
  }
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const { id: sessionId } = await params
  const result = await updateAdaptiveModeForUser({
    db,
    actor: {
      userId: ctx.user.id,
      profileId: ctx.profile.id,
      shopId: ctx.profile.shopId,
    },
    sessionId,
    requestKey: typeof record.requestKey === 'string' ? record.requestKey : '',
    expectedRevision: typeof record.expectedRevision === 'number' ? record.expectedRevision : -1,
    body,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ state: result.state, revision: result.revision })
}
