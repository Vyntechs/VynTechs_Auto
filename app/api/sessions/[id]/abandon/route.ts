import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { abandonSessionForUser } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { paywallReject } from '@/lib/auth-access'

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

  const denied = await paywallReject(db, user.id)
  if (denied) return denied

  const body = await req.json().catch(() => null)

  const result = await abandonSessionForUser({
    db,
    userId: user.id,
    sessionId: id,
    body,
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true })
}
