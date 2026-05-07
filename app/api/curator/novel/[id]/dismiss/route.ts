import { NextResponse } from 'next/server'
import { db } from '@/lib/db/client'
import { requireCurator } from '@/lib/curator/route-helpers'
import { dismissNovelPattern } from '@/lib/curator/novel-actions'

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

  const trimmed = typeof body.note === 'string' ? body.note.trim() : ''
  const note = trimmed.length > 0 ? trimmed : null

  await dismissNovelPattern(db, id, auth.profileId, note)
  return NextResponse.json({ ok: true })
}
