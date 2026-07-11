import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { closeSessionForUser } from '@/lib/sessions'
import { getServerSupabase } from '@/lib/supabase-server'
import { paywallReject } from '@/lib/auth-access'
import { validateSpecificity } from '@/lib/ai/outcome-validator'
import { promoteSessionToCorpus } from '@/lib/corpus/promotion'
import { scheduleFollowUps } from '@/lib/comeback/schedule'
import { enqueueIfNovelPattern } from '@/lib/curator/novel-trigger'
import { recordDiagnosticSession } from '@/lib/diagnostics/record-diagnostic-session'
import { getSessionById } from '@/lib/db/queries'

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

  const session = await getSessionById(db, id)
  const maxCorpusSimilarity = session?.maxCorpusSimilarity ?? 0

  const result = await closeSessionForUser({
    db,
    userId: user.id,
    sessionId: id,
    body,
    validateSpecificity,
    promoteToCorpus: promoteSessionToCorpus,
    scheduleFollowUps,
    enqueueNovelPattern: enqueueIfNovelPattern,
    maxCorpusSimilarity,
    recordDiagnosticOutcome: recordDiagnosticSession,
  })

  if (!result.ok) {
    if (result.status === 422) {
      return NextResponse.json(
        { error: result.error, feedback: result.feedback },
        { status: 422 },
      )
    }
    return NextResponse.json(
      { error: result.error, ...(result.retryable ? { retryable: true } : {}) },
      { status: result.status },
    )
  }
  return NextResponse.json({ ok: true })
}
