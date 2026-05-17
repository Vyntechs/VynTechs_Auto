import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import { getKnowledgeItem } from '@/lib/knowledge/get-item'

describe('getKnowledgeItem', () => {
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

  it('returns item with its vehicle scopes', async () => {
    const { shopId, userId } = await seedShop('A')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'cause_fix', title: 'Test',
      structuredData: { cause: 'c', correction: 'fix' },
      createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: item.id, yearStart: 2017, yearEnd: 2019,
      make: 'Ford', model: 'F-250',
    })

    const row = await getKnowledgeItem(handle.db, { id: item.id, shopId })
    expect(row?.id).toBe(item.id)
    expect(row?.vehicleScopes).toHaveLength(1)
    expect(row?.vehicleScopes[0].make).toBe('Ford')
    expect(row?.vehicleScopes[0].model).toBe('F-250')
  })

  it('returns null when item belongs to another shop', async () => {
    const { shopId: shopA, userId: userA } = await seedShop('A')
    const { shopId: shopB } = await seedShop('B')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId: shopA, type: 'note', title: 'Mine', body: 'b', createdByUserId: userA,
    }).returning()

    const row = await getKnowledgeItem(handle.db, { id: item.id, shopId: shopB })
    expect(row).toBeNull()
  })

  it('returns null for non-existent id', async () => {
    const { shopId } = await seedShop('A')
    const row = await getKnowledgeItem(handle.db, {
      id: '00000000-0000-0000-0000-000000000000', shopId,
    })
    expect(row).toBeNull()
  })

  it('returns empty vehicleScopes when no scopes attached', async () => {
    const { shopId, userId } = await seedShop('A')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'No scope', body: 'b', createdByUserId: userId,
    }).returning()

    const row = await getKnowledgeItem(handle.db, { id: item.id, shopId })
    expect(row?.vehicleScopes).toEqual([])
  })
})
