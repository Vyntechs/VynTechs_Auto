import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requireCurator } from '@/lib/curator/route-helpers'
import { db } from '@/lib/db/client'
import { listKnowledgeItems, type KnowledgeListFilter } from '@/lib/knowledge/list'
import { SAVE_ALL_TYPES } from '@/lib/knowledge/save'

const FilterSchema = z.object({
  type: z.enum(SAVE_ALL_TYPES).optional(),
  dtc: z.string().min(1).max(40).optional(),
  systemCode: z.string().min(1).max(40).optional(),
  symptom: z.string().min(1).max(120).optional(),
  vehicleMake: z.string().min(1).max(60).optional(),
  vehicleModel: z.string().min(1).max(60).optional(),
  vehicleYear: z.coerce.number().int().min(1980).max(2100).optional(),
  status: z.enum(['active', 'retired', 'all']).optional(),
})

export async function GET(req: Request) {
  const auth = await requireCurator()
  if (auth.kind === 'forbidden') return auth.response

  const url = new URL(req.url)
  const raw = Object.fromEntries(url.searchParams.entries())
  const parsed = FilterSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_input', issues: parsed.error.issues },
      { status: 422 },
    )
  }

  const items = await listKnowledgeItems(db, {
    shopId: auth.shopId,
    filter: parsed.data as KnowledgeListFilter,
  })

  return NextResponse.json({ items })
}
