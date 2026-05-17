import { and, eq } from 'drizzle-orm'
import { knowledgeItems } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000

export async function restoreKnowledgeItem(
  db: AppDb,
  args: { id: string; shopId: string },
): Promise<void> {
  const [row] = await db
    .select({
      id: knowledgeItems.id,
      retired: knowledgeItems.retired,
      retiredAt: knowledgeItems.retiredAt,
    })
    .from(knowledgeItems)
    .where(and(eq(knowledgeItems.id, args.id), eq(knowledgeItems.shopId, args.shopId)))
    .limit(1)

  if (!row) throw new Error(`knowledge item not found or not owned by shop: ${args.id}`)
  if (!row.retired) throw new Error(`item is not retired: ${args.id}`)
  if (!row.retiredAt || Date.now() - row.retiredAt.getTime() > TWENTY_FOUR_HOURS_MS) {
    throw new Error(`24h restore window has passed: ${args.id}`)
  }

  await db
    .update(knowledgeItems)
    .set({
      retired: false,
      retiredAt: null,
      retiredByUserId: null,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeItems.id, args.id))
}
