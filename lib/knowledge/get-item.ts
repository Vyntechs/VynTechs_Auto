import { and, eq } from 'drizzle-orm'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'
import type { KnowledgeListRow } from './list'

export async function getKnowledgeItem(
  db: AppDb,
  args: { id: string; shopId: string },
): Promise<KnowledgeListRow | null> {
  const [item] = await db
    .select()
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, args.id), eq(knowledgeItems.shopId, args.shopId)))
    .limit(1)

  if (!item) return null

  const scopes = await db
    .select()
    .from(knowledgeItemVehicles)
    .where(eq(knowledgeItemVehicles.knowledgeItemId, item.id))

  return {
    ...item,
    vehicleScopes: scopes.map(s => ({
      yearStart: s.yearStart,
      yearEnd: s.yearEnd,
      make: s.make,
      model: s.model,
      engine: s.engine,
      trim: s.trim,
    })),
  }
}
