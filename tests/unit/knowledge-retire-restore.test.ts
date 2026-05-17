import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { knowledgeItems } from '@/lib/db/schema'
import { retireKnowledgeItem } from '@/lib/knowledge/retire-item'
import { restoreKnowledgeItem } from '@/lib/knowledge/restore-item'

describe('retireKnowledgeItem', () => {
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

  it('marks the item retired with timestamp + user', async () => {
    const { shopId, userId } = await seedShop('A')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b', createdByUserId: userId,
    }).returning()

    await retireKnowledgeItem(handle.db, {
      id: item.id, shopId, retiredByUserId: userId,
    })

    const [row] = await handle.db
      .select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(row.retired).toBe(true)
    expect(row.retiredAt).toBeTruthy()
    expect(row.retiredByUserId).toBe(userId)
  })

  it('throws on cross-shop access', async () => {
    const { shopId: shopA, userId: userA } = await seedShop('A')
    const { shopId: shopB, userId: userB } = await seedShop('B')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId: shopA, type: 'note', title: 'Mine', body: 'b', createdByUserId: userA,
    }).returning()

    await expect(
      retireKnowledgeItem(handle.db, {
        id: item.id, shopId: shopB, retiredByUserId: userB,
      }),
    ).rejects.toThrow(/not found/)
  })

  it('bumps updated_at on retire', async () => {
    const { shopId, userId } = await seedShop('A')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b', createdByUserId: userId,
    }).returning()
    const originalUpdated = item.updatedAt
    await new Promise(r => setTimeout(r, 10))

    await retireKnowledgeItem(handle.db, {
      id: item.id, shopId, retiredByUserId: userId,
    })

    const [row] = await handle.db
      .select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(row.updatedAt.getTime()).toBeGreaterThan(originalUpdated.getTime())
  })
})

describe('restoreKnowledgeItem', () => {
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

  it('clears retired flag + timestamp + retiredBy when within 24h window', async () => {
    const { shopId, userId } = await seedShop('A')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b',
      retired: true, retiredAt: new Date(Date.now() - 60 * 60 * 1000),
      retiredByUserId: userId, createdByUserId: userId,
    }).returning()

    await restoreKnowledgeItem(handle.db, { id: item.id, shopId })

    const [row] = await handle.db
      .select().from(knowledgeItems).where(eq(knowledgeItems.id, item.id))
    expect(row.retired).toBe(false)
    expect(row.retiredAt).toBeNull()
    expect(row.retiredByUserId).toBeNull()
  })

  it('throws when retired more than 24h ago', async () => {
    const { shopId, userId } = await seedShop('A')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b',
      retired: true, retiredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      retiredByUserId: userId, createdByUserId: userId,
    }).returning()

    await expect(
      restoreKnowledgeItem(handle.db, { id: item.id, shopId }),
    ).rejects.toThrow(/24h restore window/)
  })

  it('throws when item is not retired', async () => {
    const { shopId, userId } = await seedShop('A')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'T', body: 'b', createdByUserId: userId,
    }).returning()

    await expect(
      restoreKnowledgeItem(handle.db, { id: item.id, shopId }),
    ).rejects.toThrow(/not retired/)
  })

  it('throws on cross-shop access', async () => {
    const { shopId: shopA, userId: userA } = await seedShop('A')
    const { shopId: shopB } = await seedShop('B')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId: shopA, type: 'note', title: 'Mine', body: 'b',
      retired: true, retiredAt: new Date(Date.now() - 60 * 60 * 1000),
      retiredByUserId: userA, createdByUserId: userA,
    }).returning()

    await expect(
      restoreKnowledgeItem(handle.db, { id: item.id, shopId: shopB }),
    ).rejects.toThrow(/not found/)
  })
})
