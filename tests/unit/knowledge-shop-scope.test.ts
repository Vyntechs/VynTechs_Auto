import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import { defaultBuildKnowledgeDispatcher } from '@/lib/retrieval/wire-into-tree'

// Cross-shop scoping is enforced at retrieval time via items.shop_id = $caller.
// A failure here would let Shop A's AI see Shop B's vetted knowledge — a hard
// privacy/correctness violation. PRoperly scoped retrieval is the foundation
// of the multi-tenant vetted knowledge product.
describe('knowledge dispatcher — cross-shop scope', () => {
  let handle: { db: TestDb; close: () => Promise<void> }
  let shopAId: string
  let shopBId: string
  let profAId: string

  beforeEach(async () => {
    handle = await createTestDb()
    const a = await createShop(handle.db, { name: 'Shop A' })
    shopAId = a.id
    const b = await createShop(handle.db, { name: 'Shop B' })
    shopBId = b.id
    const profile = await createProfile(handle.db, {
      userId: crypto.randomUUID(),
      shopId: shopAId,
    })
    profAId = profile.id

    // Seed a matching item in Shop B that Shop A's caller must NOT see.
    const [item] = await handle.db
      .insert(knowledgeItems)
      .values({
        shopId: shopBId,
        type: 'cause_fix',
        title: 'B-only — should never reach A',
        dtcList: ['P0420'],
        systemCodes: [],
        symptoms: [],
        createdByUserId: profAId,
      })
      .returning()
    await handle.db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: item.id,
      yearStart: 2019,
      yearEnd: 2019,
      make: 'Ford',
      model: 'F-250',
      engine: '6.7L Powerstroke',
    })
  })

  afterEach(async () => {
    await handle.close()
  })

  it('lookup_knowledge for Shop A returns 0 items even when Shop B has matches', async () => {
    const dispatcher = defaultBuildKnowledgeDispatcher({ db: handle.db, shopId: shopAId })
    const result = await dispatcher('lookup_knowledge', {
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
      dtcs: ['P0420'],
    })
    expect(result.items).toHaveLength(0)
  })

  it('lookup_knowledge for Shop B returns the seeded item', async () => {
    const dispatcher = defaultBuildKnowledgeDispatcher({ db: handle.db, shopId: shopBId })
    const result = await dispatcher('lookup_knowledge', {
      vehicle: { year: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
      dtcs: ['P0420'],
    })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].title).toBe('B-only — should never reach A')
  })

  it('unknown tool name returns empty items rather than throwing', async () => {
    const dispatcher = defaultBuildKnowledgeDispatcher({ db: handle.db, shopId: shopAId })
    const result = await dispatcher('not_a_real_tool', { vehicle: {} })
    expect(result.items).toEqual([])
  })
})
