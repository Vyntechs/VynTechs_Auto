import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql, type SQL } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'

// Postgres array literal builder. Drizzle's sql template interpolates JS
// arrays as a comma-spread (($1, $2)), which is a row constructor — not a
// text[] value. For the `&&` array-overlap operator we need a real array
// literal. Inputs in these tests are static, so sql.raw is safe.
function arrayLit(arr: string[]): SQL {
  const elements = arr.map((s) => `'${s.replace(/'/g, "''")}'`).join(',')
  return sql.raw(`ARRAY[${elements}]::text[]`)
}

// Exercises the spec's exact retrieval scoring formula
// (docs/superpowers/specs/2026-05-16-vehicle-knowledge-platform-design.md
// lines 415-437). Scoring runs in SQL; this test verifies the formula
// against PGlite against seed data — no AI in the path.
//
//   dtc overlap     -> +100
//   system overlap  -> + 25
//   symptom overlap -> + 25
//   tiebreak: fire_count DESC, then updated_at DESC

type ScoredRow = {
  id: string
  title: string
  score: number
  fire_count: number
}

async function runScoringQuery(
  db: TestDb,
  args: {
    shopId: string
    vehicleYear: number
    vehicleMake: string
    vehicleModel: string
    vehicleEngine: string
    dtcs: string[]
    systemCodes: string[]
    symptoms: string[]
    limit?: number
  },
): Promise<ScoredRow[]> {
  const dtcs = arrayLit(args.dtcs)
  const systems = arrayLit(args.systemCodes)
  const symptoms = arrayLit(args.symptoms)
  const result = await db.execute<ScoredRow>(sql`
    SELECT items.id, items.title, items.fire_count,
      ((CASE WHEN items.dtc_list && ${dtcs} THEN 100 ELSE 0 END) +
       (CASE WHEN items.system_codes && ${systems} THEN 25 ELSE 0 END) +
       (CASE WHEN items.symptoms && ${symptoms} THEN 25 ELSE 0 END))
      AS score
    FROM knowledge_items items
    JOIN knowledge_item_vehicles v ON v.knowledge_item_id = items.id
    WHERE items.shop_id = ${args.shopId}
      AND items.retired = false
      AND v.make = ${args.vehicleMake}
      AND (v.model IS NULL OR v.model = ${args.vehicleModel})
      AND (v.engine IS NULL OR v.engine = ${args.vehicleEngine})
      AND ${args.vehicleYear}::int BETWEEN v.year_start AND v.year_end
      AND (
        items.dtc_list && ${dtcs}
        OR items.system_codes && ${systems}
        OR items.symptoms && ${symptoms}
      )
    ORDER BY score DESC, items.fire_count DESC, items.updated_at DESC
    LIMIT ${args.limit ?? 10}
  `)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((result as any).rows ?? result) as ScoredRow[]
}

async function seedItem(
  db: TestDb,
  args: {
    shopId: string
    profileId: string
    title: string
    dtcList?: string[]
    systemCodes?: string[]
    symptoms?: string[]
    fireCount?: number
  },
): Promise<string> {
  const [item] = await db
    .insert(knowledgeItems)
    .values({
      shopId: args.shopId,
      type: 'cause_fix',
      title: args.title,
      dtcList: args.dtcList ?? [],
      systemCodes: args.systemCodes ?? [],
      symptoms: args.symptoms ?? [],
      fireCount: args.fireCount ?? 0,
      createdByUserId: args.profileId,
    })
    .returning()
  await db.insert(knowledgeItemVehicles).values({
    knowledgeItemId: item.id,
    yearStart: 2017,
    yearEnd: 2022,
    make: 'Ford',
    model: 'F-250',
    engine: '6.7L Powerstroke',
  })
  return item.id
}

const F250_CHARGING_QUERY = {
  vehicleYear: 2018,
  vehicleMake: 'Ford',
  vehicleModel: 'F-250',
  vehicleEngine: '6.7L Powerstroke',
}

describe('knowledge retrieval scoring formula', () => {
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

  it('scores a DTC match higher than a system-only match', async () => {
    const dtcItem = await seedItem(handle.db, {
      shopId, profileId, title: 'dtc-match',
      dtcList: ['P0628'],
    })
    const systemItem = await seedItem(handle.db, {
      shopId, profileId, title: 'system-match',
      systemCodes: ['charging'],
    })
    const rows = await runScoringQuery(handle.db, {
      shopId, ...F250_CHARGING_QUERY,
      dtcs: ['P0628'],
      systemCodes: ['charging'],
      symptoms: [],
    })
    expect(rows.map((r) => r.id)).toEqual([dtcItem, systemItem])
    expect(rows[0].score).toBe(100)
    expect(rows[1].score).toBe(25)
  })

  it('sums scores when an item matches on multiple axes', async () => {
    const triple = await seedItem(handle.db, {
      shopId, profileId, title: 'triple',
      dtcList: ['P0628'],
      systemCodes: ['charging'],
      symptoms: ['battery_drain'],
    })
    const rows = await runScoringQuery(handle.db, {
      shopId, ...F250_CHARGING_QUERY,
      dtcs: ['P0628'],
      systemCodes: ['charging'],
      symptoms: ['battery_drain'],
    })
    expect(rows[0].id).toBe(triple)
    expect(rows[0].score).toBe(150)
  })

  it('orders system match before symptom match equally if tied (equal weights)', async () => {
    const sysItem = await seedItem(handle.db, {
      shopId, profileId, title: 'sys-only',
      systemCodes: ['charging'],
      fireCount: 1,
    })
    const sympItem = await seedItem(handle.db, {
      shopId, profileId, title: 'sym-only',
      symptoms: ['battery_drain'],
      fireCount: 5,
    })
    const rows = await runScoringQuery(handle.db, {
      shopId, ...F250_CHARGING_QUERY,
      dtcs: [],
      systemCodes: ['charging'],
      symptoms: ['battery_drain'],
    })
    // Both score 25; tiebreak by fire_count DESC.
    expect(rows.map((r) => r.id)).toEqual([sympItem, sysItem])
    expect(rows[0].score).toBe(25)
    expect(rows[1].score).toBe(25)
  })

  it('excludes items with no overlap at all', async () => {
    await seedItem(handle.db, {
      shopId, profileId, title: 'unrelated',
      dtcList: ['P0420'],
      systemCodes: ['emissions'],
      symptoms: ['rough_idle'],
    })
    const rows = await runScoringQuery(handle.db, {
      shopId, ...F250_CHARGING_QUERY,
      dtcs: ['P0628'],
      systemCodes: ['charging'],
      symptoms: ['battery_drain'],
    })
    expect(rows).toEqual([])
  })

  it('breaks ties by fire_count DESC', async () => {
    const high = await seedItem(handle.db, {
      shopId, profileId, title: 'high-fire',
      dtcList: ['P0628'],
      fireCount: 17,
    })
    const low = await seedItem(handle.db, {
      shopId, profileId, title: 'low-fire',
      dtcList: ['P0628'],
      fireCount: 2,
    })
    const rows = await runScoringQuery(handle.db, {
      shopId, ...F250_CHARGING_QUERY,
      dtcs: ['P0628'],
      systemCodes: [],
      symptoms: [],
    })
    expect(rows.map((r) => r.id)).toEqual([high, low])
    expect(rows[0].fire_count).toBe(17)
  })

  it('honors limit', async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedItem(handle.db, {
        shopId, profileId, title: `item-${i}`,
        dtcList: ['P0628'],
      })
    }
    const rows = await runScoringQuery(handle.db, {
      shopId, ...F250_CHARGING_QUERY,
      dtcs: ['P0628'],
      systemCodes: [],
      symptoms: [],
      limit: 3,
    })
    expect(rows).toHaveLength(3)
  })

  it('returns multiple DTCs as a single 100-point overlap (set semantics)', async () => {
    // Matching ANY DTC in the array contributes the 100. Even if the item's
    // dtc_list contains two of the queried DTCs, the score doesn't double —
    // the spec uses CASE WHEN ... ELSE 0 END, not COUNT-based weighting.
    const overlapping = await seedItem(handle.db, {
      shopId, profileId, title: 'two-dtcs-matched',
      dtcList: ['P0628', 'P0562'],
    })
    const rows = await runScoringQuery(handle.db, {
      shopId, ...F250_CHARGING_QUERY,
      dtcs: ['P0628', 'P0562'],
      systemCodes: [],
      symptoms: [],
    })
    expect(rows[0].id).toBe(overlapping)
    expect(rows[0].score).toBe(100)
  })
})
