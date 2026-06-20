import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db/client'
import { getServerSupabase } from '@/lib/supabase-server'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { getSessionForUser } from '@/lib/sessions'
import { sessions } from '@/lib/db/schema'
import { getFlowVersionById } from '@/lib/flows/lookup'
import type { WizardState } from '@/lib/flows/types'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await getServerSupabase()
  const ctx = await requireUserAndProfile({ supabase, db })
  if (!ctx) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const denied = await paywallReject(db, ctx.user.id)
  if (denied) return denied

  const { id: sessionId } = await params
  const body = (await req.json().catch(() => null)) as WizardState | null
  if (!body || typeof body.flowVersionId !== 'string' || typeof body.stepId !== 'string') {
    return NextResponse.json({ error: 'malformed wizard state' }, { status: 400 })
  }

  const result = await getSessionForUser({ db, userId: ctx.user.id, sessionId })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  const { session } = result
  if (session.treeState.phase === 'repairing' || session.treeState.diagnosisLockedAt) {
    return NextResponse.json({ error: 'session already locked' }, { status: 409 })
  }

  // Version-pin invariant (spec §3.2): once a session pins a flow version it never
  // changes mid-session. Reject a save that tries to switch to a different version.
  if (
    session.wizardState?.flowVersionId &&
    session.wizardState.flowVersionId !== body.flowVersionId
  ) {
    return NextResponse.json({ error: 'version pin mismatch' }, { status: 409 })
  }

  const flowLookup = await getFlowVersionById(db, { flowVersionId: body.flowVersionId })
  if (!flowLookup) return NextResponse.json({ error: 'unknown flow version' }, { status: 400 })
  if (!flowLookup.body.steps[body.stepId]) {
    return NextResponse.json({ error: 'stepId not in flow' }, { status: 400 })
  }

  await db.update(sessions).set({ wizardState: body }).where(eq(sessions.id, sessionId))
  return NextResponse.json({ ok: true })
}
