import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { releaseGateForUser } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'

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

  const result = await releaseGateForUser({ db, userId: user.id, sessionId: id })
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true })
}
