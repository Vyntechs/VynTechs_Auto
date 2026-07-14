import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { submitRepairObservationForUser } from '@/lib/sessions'
import { getRepairGuidance } from '@/lib/ai/repair-guidance'
import { getServerSupabase } from '@/lib/supabase-server'
import { entitlementReject } from '@/lib/auth-access'

// Repair-guidance AI call can take several seconds on long context.
// Cap at 60s to avoid mid-flight kills on slow turns.
export const maxDuration = 60

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const denied = await entitlementReject(db, user.id)
  if (denied) return denied

  const body = await req.json().catch(() => null)

  const result = await submitRepairObservationForUser({
    db,
    userId: user.id,
    sessionId: id,
    body,
    getGuidance: getRepairGuidance,
  })

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.retryable ? { retryable: true } : {}) },
      { status: result.status },
    )
  }
  return NextResponse.json({ ok: true, guidance: result.guidance })
}
