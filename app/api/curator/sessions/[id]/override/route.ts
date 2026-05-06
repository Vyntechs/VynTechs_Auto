import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { requireCurator } from '@/lib/curator/route-helpers'
import { overrideDeferredSession } from '@/lib/curator/deferred-actions'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const { id } = await params

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    // missing or malformed body — treat as empty
  }

  // overrideAction is required — return 400 if missing or empty
  const overrideAction =
    typeof body.overrideAction === 'string' ? body.overrideAction.trim() : ''
  if (overrideAction.length === 0) {
    return NextResponse.json({ error: 'overrideAction is required' }, { status: 400 })
  }

  const trimmed = typeof body.note === 'string' ? body.note.trim() : ''
  const note = trimmed.length > 0 ? trimmed : null

  const result = await overrideDeferredSession(db, id, auth.profileId, overrideAction, note)

  if (result.kind === 'not-found') {
    return NextResponse.json({ error: 'not-found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true })
}
