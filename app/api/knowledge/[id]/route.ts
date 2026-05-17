import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCurator } from '@/lib/curator/route-helpers'
import { requireProfile } from '@/lib/auth/route-helpers'
import { db } from '@/lib/db/client'
import { getKnowledgeItem } from '@/lib/knowledge/get-item'
import { updateKnowledgeItem } from '@/lib/knowledge/update-item'
import { retireKnowledgeItem } from '@/lib/knowledge/retire-item'
import { KnowledgeSaveSchema } from '@/lib/knowledge/save'

type RouteCtx = { params: Promise<{ id: string }> }

const IdSchema = z.string().uuid()

// PR 6: GET is tech-readable so the citation drawer can hydrate by id
// during a live diagnostic session. Shop scope is still enforced by
// getKnowledgeItem (cross-shop returns null → 404). Retired items are
// returned — citations are a historical record of what the AI saw.
export async function GET(_req: Request, ctx: RouteCtx) {
  const auth = await requireProfile()
  if (auth.kind === 'unauthed') return auth.response

  const { id: rawId } = await ctx.params
  if (!IdSchema.safeParse(rawId).success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }

  const item = await getKnowledgeItem(db, { id: rawId, shopId: auth.shopId })
  if (!item) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ item })
}

export async function PATCH(req: Request, ctx: RouteCtx) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const { id: rawId } = await ctx.params
  if (!IdSchema.safeParse(rawId).success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }

  let json: unknown
  try { json = await req.json() } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = KnowledgeSaveSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 422 },
    )
  }

  try {
    await updateKnowledgeItem(db, { id: rawId, shopId: auth.shopId }, parsed.data)
  } catch (err) {
    if (err instanceof Error && /not found/.test(err.message)) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    throw err
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const { id: rawId } = await ctx.params
  if (!IdSchema.safeParse(rawId).success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }

  try {
    await retireKnowledgeItem(db, {
      id: rawId, shopId: auth.shopId, retiredByUserId: auth.profileId,
    })
  } catch (err) {
    if (err instanceof Error && /not found/.test(err.message)) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    throw err
  }
  return new NextResponse(null, { status: 204 })
}
