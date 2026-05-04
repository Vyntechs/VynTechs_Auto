import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { closeSessionForUser } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { validateSpecificity } from '@/lib/ai/outcome-validator'
import { promoteSessionToCorpus } from '@/lib/corpus/promotion'
import { scheduleFollowUps } from '@/lib/comeback/schedule'

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

  const result = await closeSessionForUser({
    db,
    userId: user.id,
    sessionId: id,
    body,
    validateSpecificity,
    promoteToCorpus: promoteSessionToCorpus,
    scheduleFollowUps,
  })

  if (!result.ok) {
    if (result.status === 422) {
      return NextResponse.json(
        { error: result.error, feedback: result.feedback },
        { status: 422 },
      )
    }
    return NextResponse.json({ error: result.error }, { status: result.status })
  }
  return NextResponse.json({ ok: true })
}
