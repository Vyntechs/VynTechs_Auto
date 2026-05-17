import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCurator } from '@/lib/curator/route-helpers'
import { db } from '@/lib/db/client'
import { restoreKnowledgeItem } from '@/lib/knowledge/restore-item'

type RouteCtx = { params: Promise<{ id: string }> }
const IdSchema = z.string().uuid()

export async function POST(_req: Request, ctx: RouteCtx) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const { id: rawId } = await ctx.params
  if (!IdSchema.safeParse(rawId).success) {
    return NextResponse.json({ error: 'invalid_id' }, { status: 400 })
  }

  try {
    await restoreKnowledgeItem(db, { id: rawId, shopId: auth.shopId })
  } catch (err) {
    if (err instanceof Error) {
      if (/not found/.test(err.message)) {
        return NextResponse.json({ error: 'not_found' }, { status: 404 })
      }
      if (/24h restore window/.test(err.message) || /not retired/.test(err.message)) {
        return NextResponse.json({ error: 'cannot_restore', message: err.message }, { status: 409 })
      }
    }
    throw err
  }
  return NextResponse.json({ ok: true })
}
