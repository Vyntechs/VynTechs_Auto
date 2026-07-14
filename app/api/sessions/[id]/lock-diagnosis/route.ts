import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { lockDiagnosisForUser } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { entitlementReject } from '@/lib/auth-access'

export async function POST(
  _req: Request,
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

  const result = await lockDiagnosisForUser({
    db,
    userId: user.id,
    sessionId: id,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true })
}
