import { NextResponse } from 'next/server'
import { requireCurator } from '@/lib/curator/route-helpers'
import { saveKnowledgeItem, KnowledgeSaveSchema } from '@/lib/knowledge/save'

// POST /api/knowledge/save — unified save endpoint with `type` discriminator.
// Covers all 8 knowledge types (4 simple from PR 2 + 4 rich added in PR 3).
export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = KnowledgeSaveSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const result = await saveKnowledgeItem(parsed.data, {
    shopId: auth.shopId,
    createdByUserId: auth.profileId,
  })
  return NextResponse.json({ id: result.id }, { status: 201 })
}
