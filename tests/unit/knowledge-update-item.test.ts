import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import { updateKnowledgeItem } from '@/lib/knowledge/update-item'

describe('updateKnowledgeItem', () => {
  let handle: { db: TestDb; close: () => Promise<void> }

  beforeEach(async () => { handle = await createTestDb() })
  afterEach(async () => { await handle.close() })

  async function seedShop(name: string) {
    const shop = await createShop(handle.db, { name })
    const profile = await createProfile(handle.db, {
      userId: crypto.randomUUID(), shopId: shop.id,
    })
    return { shopId: shop.id, userId: profile.id }
  }

  it('updates the row and replaces vehicle scopes', async () => {
    const { shopId, userId } = await seedShop('A')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'cause_fix', title: 'Original',
      structuredData: { cause: 'old', correction: 'old fix' },
      createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: item.id, yearStart: 2010, yearEnd: 2012, make: 'GM',
    })

    await updateKnowledgeItem(
      handle.db,
      { id: item.id, shopId },
      {
        type: 'cause_fix',
        title: 'Updated title',
        structuredData: { cause: 'new cause', correction: 'new fix' },
        vehicleScopes: [{ yearStart: 2017, yearEnd: 2019, make: 'Ford', model: 'F-250' }],
      },
    )

    const [updated] = await handle.db
      .select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(updated.title).toBe('Updated title')

    const scopes = await handle.db
      .select().from(knowledgeItemVehicles)
      .where(eq(knowledgeItemVehicles.knowledgeItemId, item.id))
    expect(scopes).toHaveLength(1)
    expect(scopes[0].make).toBe('Ford')
    expect(scopes[0].model).toBe('F-250')
  })

  it('throws on cross-shop access', async () => {
    const { shopId: shopA, userId: userA } = await seedShop('A')
    const { shopId: shopB } = await seedShop('B')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId: shopA, type: 'note', title: 'Mine', body: 'old', createdByUserId: userA,
    }).returning()

    await expect(
      updateKnowledgeItem(
        handle.db, { id: item.id, shopId: shopB },
        { type: 'note', title: 'Hijack', body: 'new' },
      ),
    ).rejects.toThrow(/not found/)
  })

  it('bumps updated_at', async () => {
    const { shopId, userId } = await seedShop('A')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b', createdByUserId: userId,
    }).returning()
    const originalUpdatedAt = item.updatedAt
    await new Promise(r => setTimeout(r, 10))

    await updateKnowledgeItem(
      handle.db, { id: item.id, shopId },
      { type: 'note', title: 'T2', body: 'b2' },
    )

    const [refreshed] = await handle.db
      .select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(refreshed.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
  })

  it('rejects invalid input via the save schema', async () => {
    const { shopId, userId } = await seedShop('A')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b', createdByUserId: userId,
    }).returning()

    await expect(
      updateKnowledgeItem(
        handle.db, { id: item.id, shopId },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        { type: 'note', title: '' } as any,
      ),
    ).rejects.toThrow()
  })

  it('clears scopes when vehicleScopes omitted from input', async () => {
    const { shopId, userId } = await seedShop('A')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b', createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: item.id, yearStart: 2017, yearEnd: 2019, make: 'Ford',
    })

    await updateKnowledgeItem(
      handle.db, { id: item.id, shopId },
      { type: 'note', title: 'T', body: 'b' },
    )

    const scopes = await handle.db
      .select().from(knowledgeItemVehicles)
      .where(eq(knowledgeItemVehicles.knowledgeItemId, item.id))
    expect(scopes).toEqual([])
  })
})
