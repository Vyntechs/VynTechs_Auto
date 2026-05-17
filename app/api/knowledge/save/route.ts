import { NextResponse } from 'next/server'
import { requireCurator } from '@/lib/curator/route-helpers'
import {
  saveKnowledgeItem,
  SimpleSaveSchema,
  RICH_TYPES_NOT_YET_SUPPORTED,
} from '@/lib/knowledge/save'

// POST /api/knowledge/save — unified save endpoint with `type` discriminator.
// PR 2 wires up the four simple types; PR 3 extends the schema for the rich
// types (pinout, connector, wiring_diagram, theory_of_operation).
export async function POST(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // Distinguish "rich type, deferred" (400) from "actually invalid input" (422)
  // so the UI can show different messages.
  const declaredType =
    typeof json === 'object' && json !== null && 'type' in json
      ? (json as { type: unknown }).type
      : undefined
  if (
    typeof declaredType === 'string' &&
    (RICH_TYPES_NOT_YET_SUPPORTED as readonly string[]).includes(declaredType)
  ) {
    return NextResponse.json(
      {
        error: 'rich_type_not_yet_supported',
        message: `Type "${declaredType}" is handled by structured forms (PR 3).`,
      },
      { status: 400 },
    )
  }

  const parsed = SimpleSaveSchema.safeParse(json)
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
