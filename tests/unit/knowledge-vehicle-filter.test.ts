import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'

// Exercises the knowledge_item_vehicles join semantics used by retrieval
// (lib/knowledge/retrieval.ts in PR 4). NULL model / engine = wildcard.
// Year clause is `vehicleYear BETWEEN year_start AND year_end`. Multi-row
// scopes mean the item matches if ANY of its scope rows matches.

type VehicleQuery = {
  year: number
  make: string
  model?: string
  engine?: string
}

async function seedItem(
  db: TestDb,
  shopId: string,
  profileId: string,
  title: string,
  scopes: Array<{
    yearStart: number
    yearEnd: number
    make: string
    model?: string | null
    engine?: string | null
  }>,
): Promise<string> {
  const [item] = await db
    .insert(knowledgeItems)
    .values({
      shopId,
      type: 'cause_fix',
      title,
      createdByUserId: profileId,
    })
    .returning()
  for (const s of scopes) {
    await db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: item.id,
      yearStart: s.yearStart,
      yearEnd: s.yearEnd,
      make: s.make,
      model: s.model ?? null,
      engine: s.engine ?? null,
    })
  }
  return item.id
}

async function queryMatches(
  db: TestDb,
  shopId: string,
  q: VehicleQuery,
): Promise<string[]> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT DISTINCT items.id AS id
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${shopId}
      AND items.retired = false
      AND v.make = ${q.make}
      AND (v.model IS NULL OR v.model = ${q.model ?? null})
      AND (v.engine IS NULL OR v.engine = ${q.engine ?? null})
      AND ${q.year}::int BETWEEN v.year_start AND v.year_end
    ORDER BY items.id
  `)
  // PGlite returns rows under .rows
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = (rows as any).rows ?? rows
  return (result as Array<{ id: string }>).map((r) => r.id)
}

describe('knowledge_item_vehicles filter', () => {
  let handle: { db: TestDb; close: () => Promise<void> }
  let shopId: string
  let profileId: string
  beforeEach(async () => {
    handle = await createTestDb()
    const shop = await createShop(handle.db, { name: 'Test Shop' })
    const profile = await createProfile(handle.db, {
      userId: crypto.randomUUID(),
      shopId: shop.id,
    })
    shopId = shop.id
    profileId = profile.id
  })
  afterEach(async () => {
    await handle.close()
  })

  it('matches a vehicle within a year range', async () => {
    const id = await seedItem(handle.db, shopId, profileId, 'in-range', [
      { yearStart: 2017, yearEnd: 2022, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
    ])
    const matches = await queryMatches(handle.db, shopId, {
      year: 2018,
      make: 'Ford',
      model: 'F-250',
      engine: '6.7L Powerstroke',
    })
    expect(matches).toContain(id)
  })

  it('excludes vehicles outside the year range', async () => {
    await seedItem(handle.db, shopId, profileId, 'out-of-range', [
      { yearStart: 2017, yearEnd: 2022, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
    ])
    const matches = await queryMatches(handle.db, shopId, {
      year: 2023,
      make: 'Ford',
      model: 'F-250',
      engine: '6.7L Powerstroke',
    })
    expect(matches).toEqual([])
  })

  it('excludes mismatched make', async () => {
    await seedItem(handle.db, shopId, profileId, 'ford-only', [
      { yearStart: 2017, yearEnd: 2022, make: 'Ford' },
    ])
    const matches = await queryMatches(handle.db, shopId, {
      year: 2018,
      make: 'Honda',
    })
    expect(matches).toEqual([])
  })

  it('NULL model is a wildcard (matches any model)', async () => {
    const id = await seedItem(handle.db, shopId, profileId, 'all-ford-models', [
      { yearStart: 2017, yearEnd: 2022, make: 'Ford', model: null, engine: null },
    ])
    const f250 = await queryMatches(handle.db, shopId, {
      year: 2018,
      make: 'Ford',
      model: 'F-250',
    })
    const explorer = await queryMatches(handle.db, shopId, {
      year: 2018,
      make: 'Ford',
      model: 'Explorer',
    })
    expect(f250).toContain(id)
    expect(explorer).toContain(id)
  })

  it('NULL engine is a wildcard (matches any engine)', async () => {
    const id = await seedItem(handle.db, shopId, profileId, 'all-engines', [
      { yearStart: 2017, yearEnd: 2022, make: 'Ford', model: 'F-250', engine: null },
    ])
    const psd = await queryMatches(handle.db, shopId, {
      year: 2018,
      make: 'Ford',
      model: 'F-250',
      engine: '6.7L Powerstroke',
    })
    const v8 = await queryMatches(handle.db, shopId, {
      year: 2018,
      make: 'Ford',
      model: 'F-250',
      engine: '7.3L V8',
    })
    expect(psd).toContain(id)
    expect(v8).toContain(id)
  })

  it('engine is a strict equality match when both sides are specified', async () => {
    await seedItem(handle.db, shopId, profileId, 'psd-only', [
      { yearStart: 2017, yearEnd: 2022, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
    ])
    const v8 = await queryMatches(handle.db, shopId, {
      year: 2018,
      make: 'Ford',
      model: 'F-250',
      engine: '7.3L V8',
    })
    expect(v8).toEqual([])
  })

  it('matches when any scope row matches (multi-row scope)', async () => {
    const id = await seedItem(handle.db, shopId, profileId, 'f250-and-f350', [
      { yearStart: 2017, yearEnd: 2022, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
      { yearStart: 2017, yearEnd: 2022, make: 'Ford', model: 'F-350', engine: '6.7L Powerstroke' },
    ])
    const f250 = await queryMatches(handle.db, shopId, {
      year: 2018,
      make: 'Ford',
      model: 'F-250',
      engine: '6.7L Powerstroke',
    })
    const f350 = await queryMatches(handle.db, shopId, {
      year: 2018,
      make: 'Ford',
      model: 'F-350',
      engine: '6.7L Powerstroke',
    })
    expect(f250).toContain(id)
    expect(f350).toContain(id)
  })

  it('matches a single-year scope (year_start = year_end)', async () => {
    const id = await seedItem(handle.db, shopId, profileId, '2020-only', [
      { yearStart: 2020, yearEnd: 2020, make: 'Ford', model: 'F-250' },
    ])
    const matches2020 = await queryMatches(handle.db, shopId, {
      year: 2020,
      make: 'Ford',
      model: 'F-250',
    })
    const matches2019 = await queryMatches(handle.db, shopId, {
      year: 2019,
      make: 'Ford',
      model: 'F-250',
    })
    expect(matches2020).toContain(id)
    expect(matches2019).toEqual([])
  })

  it('excludes items belonging to other shops', async () => {
    const otherShop = await createShop(handle.db, { name: 'Other Shop' })
    const otherProfile = await createProfile(handle.db, {
      userId: crypto.randomUUID(),
      shopId: otherShop.id,
    })
    await seedItem(handle.db, otherShop.id, otherProfile.id, 'other-shop', [
      { yearStart: 2017, yearEnd: 2022, make: 'Ford', model: 'F-250' },
    ])
    const matches = await queryMatches(handle.db, shopId, {
      year: 2018,
      make: 'Ford',
      model: 'F-250',
    })
    expect(matches).toEqual([])
  })

  it('excludes retired items', async () => {
    const id = await seedItem(handle.db, shopId, profileId, 'retired-item', [
      { yearStart: 2017, yearEnd: 2022, make: 'Ford', model: 'F-250' },
    ])
    await handle.db.execute(
      sql`UPDATE knowledge_items SET retired = true, retired_at = now() WHERE id = ${id}`,
    )
    const matches = await queryMatches(handle.db, shopId, {
      year: 2018,
      make: 'Ford',
      model: 'F-250',
    })
    expect(matches).toEqual([])
  })

  it('rejects year_start outside CHECK range (< 1980)', async () => {
    const [item] = await handle.db
      .insert(knowledgeItems)
      .values({
        shopId,
        type: 'cause_fix',
        title: 'bad year',
        createdByUserId: profileId,
      })
      .returning()
    await expect(
      handle.db.insert(knowledgeItemVehicles).values({
        knowledgeItemId: item.id,
        yearStart: 1850,
        yearEnd: 1900,
        make: 'Phaeton',
      }),
    ).rejects.toThrow()
  })

  it('rejects year_end < year_start via CHECK', async () => {
    const [item] = await handle.db
      .insert(knowledgeItems)
      .values({
        shopId,
        type: 'cause_fix',
        title: 'reversed years',
        createdByUserId: profileId,
      })
      .returning()
    await expect(
      handle.db.insert(knowledgeItemVehicles).values({
        knowledgeItemId: item.id,
        yearStart: 2020,
        yearEnd: 2019,
        make: 'Ford',
      }),
    ).rejects.toThrow()
  })
})
