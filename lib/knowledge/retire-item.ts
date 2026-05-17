import { and, eq } from 'drizzle-orm'
import { knowledgeItems } from '@/lib/db/schema'
import type { AppDb } from '@/lib/db/queries'

export async function retireKnowledgeItem(
  db: AppDb,
  args: { id: string; shopId: string; retiredByUserId: string },
): Promise<void> {
  const result = await db
    .update(knowledgeItems)
    .set({
      retired: true,
      retiredAt: new Date(),
      retiredByUserId: args.retiredByUserId,
      updatedAt: new Date(),
    })
    .where(and(eq(knowledgeItems.id, args.id), eq(knowledgeItems.shopId, args.shopId)))
    .returning({ id: knowledgeItems.id })

  if (result.length === 0) {
    throw new Error(`knowledge item not found or not owned by shop: ${args.id}`)
  }
}
