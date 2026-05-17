import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import { listKnowledgeItems } from '@/lib/knowledge/list'

describe('listKnowledgeItems', () => {
  let handle: { db: TestDb; close: () => Promise<void> }

  beforeEach(async () => {
    handle = await createTestDb()
  })
  afterEach(async () => {
    await handle.close()
  })

  async function seedShop(name: string) {
    const shop = await createShop(handle.db, { name })
    const profile = await createProfile(handle.db, {
      userId: crypto.randomUUID(),
      shopId: shop.id,
    })
    return { shopId: shop.id, userId: profile.id }
  }

  it('returns active items only by default (no retired older than 24h)', async () => {
    const { shopId, userId } = await seedShop('Shop A')
    const [a] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'cause_fix', title: 'A',
      structuredData: { cause: 'x', correction: 'y' },
      createdByUserId: userId,
    }).returning()
    const [b] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'pinout', title: 'B',
      structuredData: { connector_ref: 'C1', pins: [{ pin_number: '1', signal_name: 's' }] },
      createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'old retired', body: 'b',
      retired: true, retiredAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      createdByUserId: userId,
    })

    const rows = await listKnowledgeItems(handle.db, { shopId, filter: {} })
    expect(rows.map(r => r.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('shows items retired within last 24h under default filter', async () => {
    const { shopId, userId } = await seedShop('Shop A')
    const [recent] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'recently retired', body: 'b',
      retired: true, retiredAt: new Date(Date.now() - 60 * 60 * 1000),
      createdByUserId: userId,
    }).returning()

    const rows = await listKnowledgeItems(handle.db, { shopId, filter: {} })
    expect(rows.map(r => r.id)).toContain(recent.id)
  })

  it('filters by type', async () => {
    const { shopId, userId } = await seedShop('Shop A')
    await handle.db.insert(knowledgeItems).values({
      shopId, type: 'cause_fix', title: 'A',
      structuredData: { cause: 'x', correction: 'y' },
      createdByUserId: userId,
    })
    const [b] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'pinout', title: 'B',
      structuredData: { connector_ref: 'C1', pins: [{ pin_number: '1', signal_name: 's' }] },
      createdByUserId: userId,
    }).returning()

    const rows = await listKnowledgeItems(handle.db, {
      shopId, filter: { type: 'pinout' },
    })
    expect(rows.map(r => r.id)).toEqual([b.id])
  })

  it('filters by dtc', async () => {
    const { shopId, userId } = await seedShop('Shop A')
    const [withDtc] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'With DTC', body: 'b',
      dtcList: ['P0700'], createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'Without', body: 'b',
      createdByUserId: userId,
    })

    const rows = await listKnowledgeItems(handle.db, { shopId, filter: { dtc: 'P0700' } })
    expect(rows.map(r => r.id)).toEqual([withDtc.id])
  })

  it('filters by systemCode', async () => {
    const { shopId, userId } = await seedShop('Shop A')
    const [charging] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'Charging item', body: 'b',
      systemCodes: ['charging'], createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'Transmission item', body: 'b',
      systemCodes: ['transmission'], createdByUserId: userId,
    })

    const rows = await listKnowledgeItems(handle.db, {
      shopId, filter: { systemCode: 'charging' },
    })
    expect(rows.map(r => r.id)).toEqual([charging.id])
  })

  it('filters by symptom', async () => {
    const { shopId, userId } = await seedShop('Shop A')
    const [hardShift] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'Hard shift item', body: 'b',
      symptoms: ['hard_shift'], createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'No start item', body: 'b',
      symptoms: ['no_start'], createdByUserId: userId,
    })

    const rows = await listKnowledgeItems(handle.db, {
      shopId, filter: { symptom: 'hard_shift' },
    })
    expect(rows.map(r => r.id)).toEqual([hardShift.id])
  })

  it('filters by vehicle make', async () => {
    const { shopId, userId } = await seedShop('Shop A')
    const [ford] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'Ford note', body: 'b',
      createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: ford.id, yearStart: 2017, yearEnd: 2019,
      make: 'Ford', model: 'F-250',
    })
    const [gm] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'GM note', body: 'b',
      createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: gm.id, yearStart: 2010, yearEnd: 2012,
      make: 'GM',
    })

    const rows = await listKnowledgeItems(handle.db, {
      shopId, filter: { vehicleMake: 'Ford' },
    })
    expect(rows.map(r => r.id)).toEqual([ford.id])
  })

  it('filters by vehicle year (year falls within scope range)', async () => {
    const { shopId, userId } = await seedShop('Shop A')
    const [match] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'In range', body: 'b',
      createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: match.id, yearStart: 2017, yearEnd: 2019, make: 'Ford',
    })
    const [out] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'Out of range', body: 'b',
      createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: out.id, yearStart: 2020, yearEnd: 2022, make: 'Ford',
    })

    const rows = await listKnowledgeItems(handle.db, {
      shopId, filter: { vehicleYear: 2018 },
    })
    expect(rows.map(r => r.id)).toEqual([match.id])
  })

  it('returns retired items when status = retired', async () => {
    const { shopId, userId } = await seedShop('Shop A')
    const [retired] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'Retired one', body: 'b',
      retired: true, retiredAt: new Date(Date.now() - 60 * 60 * 1000),
      createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'Active', body: 'b',
      createdByUserId: userId,
    })

    const rows = await listKnowledgeItems(handle.db, {
      shopId, filter: { status: 'retired' },
    })
    expect(rows.map(r => r.id)).toEqual([retired.id])
  })

  it('isolates by shop (cannot see other shops)', async () => {
    const { shopId: shopA, userId: userA } = await seedShop('Shop A')
    const { shopId: shopB } = await seedShop('Shop B')
    const [mine] = await handle.db.insert(knowledgeItems).values({
      shopId: shopA, type: 'note', title: 'A item', body: 'b',
      createdByUserId: userA,
    }).returning()

    const rowsB = await listKnowledgeItems(handle.db, { shopId: shopB, filter: {} })
    expect(rowsB.map(r => r.id)).not.toContain(mine.id)

    const rowsA = await listKnowledgeItems(handle.db, { shopId: shopA, filter: {} })
    expect(rowsA.map(r => r.id)).toContain(mine.id)
  })

  it('returns items with attached vehicle scopes', async () => {
    const { shopId, userId } = await seedShop('Shop A')
    const [item] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'With scope', body: 'b',
      createdByUserId: userId,
    }).returning()
    await handle.db.insert(knowledgeItemVehicles).values([
      { knowledgeItemId: item.id, yearStart: 2017, yearEnd: 2019, make: 'Ford', model: 'F-250' },
      { knowledgeItemId: item.id, yearStart: 2020, yearEnd: 2022, make: 'Ford', model: 'F-350' },
    ])

    const rows = await listKnowledgeItems(handle.db, { shopId, filter: {} })
    const row = rows.find(r => r.id === item.id)
    expect(row?.vehicleScopes).toHaveLength(2)
    expect(row?.vehicleScopes[0].make).toBe('Ford')
  })

  it('orders by updatedAt descending', async () => {
    const { shopId, userId } = await seedShop('Shop A')
    const [older] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'Older', body: 'b',
      createdByUserId: userId,
    }).returning()
    await new Promise(r => setTimeout(r, 5))
    const [newer] = await handle.db.insert(knowledgeItems).values({
      shopId, type: 'note', title: 'Newer', body: 'b',
      createdByUserId: userId,
    }).returning()

    const rows = await listKnowledgeItems(handle.db, { shopId, filter: {} })
    const newerIdx = rows.findIndex(r => r.id === newer.id)
    const olderIdx = rows.findIndex(r => r.id === older.id)
    expect(newerIdx).toBeLessThan(olderIdx)
  })
})
