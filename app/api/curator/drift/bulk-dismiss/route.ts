import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { requireCurator } from '@/lib/curator/route-helpers'
import { bulkDismissDriftAlerts } from '@/lib/curator/drift-resolution'

export async function POST(request: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  let body: Record<string, unknown> = {}
  try {
    body = await request.json()
  } catch {
    // missing or malformed body — treat as empty
  }

  const ids = body.ids
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id) => typeof id === 'string')
  ) {
    return NextResponse.json(
      { error: 'ids must be a non-empty array of strings' },
      { status: 400 },
    )
  }

  const trimmed = typeof body.note === 'string' ? body.note.trim() : ''
  const note = trimmed.length > 0 ? trimmed : null

  const result = await bulkDismissDriftAlerts(db, ids, auth.profileId, note)

  return NextResponse.json({ ok: true, dismissedCount: result.dismissedCount })
}
