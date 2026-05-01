import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { createSessionForUser } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'

export async function POST(req: Request) {
  const supabase = await getServerSupabase()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => null)
  const result = await createSessionForUser({ db, userId: user.id, body })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ id: result.id })
}
