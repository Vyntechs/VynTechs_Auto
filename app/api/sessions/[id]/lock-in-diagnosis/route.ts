import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { lockDiagnosisFromWizard } from '@/lib/sessions'
import type { Finding, WizardState } from '@/lib/flows/types'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  const { id: sessionId } = await params
  const body = (await req.json().catch(() => null)) as {
    finding: Finding
    history: WizardState['history']
    flowVersionId: string
  } | null
  if (!body?.finding?.verdict || !body?.finding?.action || !body?.flowVersionId) {
    return NextResponse.json({ error: 'malformed lock-in payload' }, { status: 400 })
  }

  const result = await lockDiagnosisFromWizard({
    db,
    userId: ctx.user.id,
    sessionId,
    finding: body.finding,
    history: body.history ?? [],
    flowVersionId: body.flowVersionId,
  })

  if (!result.ok) {
    const status = result.error === 'diagnosis already locked' ? 409 : result.status
    return NextResponse.json({ error: result.error }, { status })
  }

  return NextResponse.json({ ok: true, redirectTo: `/sessions/${sessionId}` })
}
