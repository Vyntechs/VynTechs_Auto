import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { submitRepairObservationForUser } from '@/lib/sessions'
import { getRepairGuidance } from '@/lib/ai/repair-guidance'
import { getServerSupabase } from '@/lib/supabase-server'

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

  const body = await req.json().catch(() => null)

  const result = await submitRepairObservationForUser({
    db,
    userId: user.id,
    sessionId: id,
    body,
    getGuidance: getRepairGuidance,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true, guidance: result.guidance })
}
