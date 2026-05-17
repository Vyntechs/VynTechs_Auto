import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import { lookupKnowledge } from '@/lib/knowledge/retrieval'

type SeedScope = {
  yearStart: number
  yearEnd: number
  make: string
  model?: string | null
  engine?: string | null
}

async function seedItem(
  db: TestDb,
  args: {
    shopId: string
    profileId: string
    title: string
    type?:
      | 'cause_fix'
      | 'pinout'
      | 'connector'
      | 'wiring_diagram'
      | 'theory_of_operation'
      | 'bulletin'
      | 'reference_doc'
      | 'note'
    dtcList?: string[]
    systemCodes?: string[]
    symptoms?: string[]
    fireCount?: number
    retired?: boolean
    structuredData?: Record<string, unknown>
    scopes?: SeedScope[]
  },
): Promise<string> {
  const [item] = await db
    .insert(knowledgeItems)
    .values({
      shopId: args.shopId,
      type: args.type ?? 'cause_fix',
      title: args.title,
      dtcList: args.dtcList ?? [],
      systemCodes: args.systemCodes ?? [],
      symptoms: args.symptoms ?? [],
      fireCount: args.fireCount ?? 0,
      retired: args.retired ?? false,
      structuredData: args.structuredData ?? null,
      createdByUserId: args.profileId,
    })
    .returning()
  const scopes: SeedScope[] = args.scopes ?? [
    { yearStart: 2018, yearEnd: 2020, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
  ]
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

const F250_VEHICLE = {
  year: 2019,
  make: 'Ford',
  model: 'F-250',
  engine: '6.7L Powerstroke',
} as const

describe('lookupKnowledge', () => {
  let handle: { db: TestDb; close: () => Promise<void> }
  let shopId: string
  let profileId: string
  let otherShopId: string

  beforeEach(async () => {
    handle = await createTestDb()
    const shop = await createShop(handle.db, { name: 'Test Shop' })
    const profile = await createProfile(handle.db, {
      userId: crypto.randomUUID(),
      shopId: shop.id,
    })
    shopId = shop.id
    profileId = profile.id
    const other = await createShop(handle.db, { name: 'Other Shop' })
    otherShopId = other.id
  })

  afterEach(async () => {
    await handle.close()
  })

  it('ranks DTC overlap above system/symptom overlap', async () => {
    const dtcMatchId = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'DTC match',
      dtcList: ['P0420'],
    })
    await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'System match',
      systemCodes: ['emissions'],
    })
    await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Symptom match',
      symptoms: ['rough_idle'],
    })
    const matches = await lookupKnowledge(handle.db, {
      shopId,
      vehicle: F250_VEHICLE,
      dtcs: ['P0420'],
      systemCodes: ['emissions'],
      symptoms: ['rough_idle'],
      limit: 10,
    })
    expect(matches[0].id).toBe(dtcMatchId)
    expect(matches[0].score).toBe(100)
    // The system-only and symptom-only items each score 25; the DTC-overlap
    // term dominates by 75. Ordering verified by [0].id above.
  })

  it('scopes to shopId — other shops never leak', async () => {
    await seedItem(handle.db, {
      shopId: otherShopId,
      profileId,
      title: 'Other shop match',
      dtcList: ['P0420'],
    })
    const matches = await lookupKnowledge(handle.db, {
      shopId,
      vehicle: F250_VEHICLE,
      dtcs: ['P0420'],
    })
    expect(matches).toHaveLength(0)
  })

  it('excludes retired items', async () => {
    await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Retired',
      dtcList: ['P0420'],
      retired: true,
    })
    const matches = await lookupKnowledge(handle.db, {
      shopId,
      vehicle: F250_VEHICLE,
      dtcs: ['P0420'],
    })
    expect(matches).toHaveLength(0)
  })

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await seedItem(handle.db, {
        shopId,
        profileId,
        title: `Item ${i}`,
        dtcList: ['P0420'],
        fireCount: i,
      })
    }
    const matches = await lookupKnowledge(handle.db, {
      shopId,
      vehicle: F250_VEHICLE,
      dtcs: ['P0420'],
      limit: 2,
    })
    expect(matches).toHaveLength(2)
  })

  it('ties on score break by fire_count DESC', async () => {
    const lowFireId = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Low',
      dtcList: ['P0420'],
      fireCount: 1,
    })
    const highFireId = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'High',
      dtcList: ['P0420'],
      fireCount: 50,
    })
    const matches = await lookupKnowledge(handle.db, {
      shopId,
      vehicle: F250_VEHICLE,
      dtcs: ['P0420'],
      limit: 10,
    })
    expect(matches[0].id).toBe(highFireId)
    expect(matches[1].id).toBe(lowFireId)
  })

  it('filters by typeFilter when provided', async () => {
    await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Note item',
      type: 'note',
      dtcList: ['P0420'],
    })
    const pinoutId = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Pinout item',
      type: 'pinout',
      dtcList: ['P0420'],
      structuredData: {
        connector_ref: 'X',
        pins: [{ pin_number: '1', signal_name: 'V' }],
      },
    })
    const matches = await lookupKnowledge(handle.db, {
      shopId,
      vehicle: F250_VEHICLE,
      dtcs: ['P0420'],
      typeFilter: 'pinout',
    })
    expect(matches).toHaveLength(1)
    expect(matches[0].id).toBe(pinoutId)
  })

  it('normalizes DTC variants (P0420-00 → P0420)', async () => {
    await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'P0420 item',
      dtcList: ['P0420'],
    })
    const matches = await lookupKnowledge(handle.db, {
      shopId,
      vehicle: F250_VEHICLE,
      dtcs: ['P0420-00'],
    })
    expect(matches).toHaveLength(1)
  })

  it('matches when v.engine is NULL (wildcard) regardless of caller engine', async () => {
    await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Any engine',
      dtcList: ['P0420'],
      scopes: [{ yearStart: 2018, yearEnd: 2020, make: 'Ford', model: 'F-250', engine: null }],
    })
    const matches = await lookupKnowledge(handle.db, {
      shopId,
      vehicle: F250_VEHICLE,
      dtcs: ['P0420'],
    })
    expect(matches).toHaveLength(1)
  })
})

// Re-export sql for type-friendly use across test files in this PR (avoid
// re-importing in every block). Not actually needed by lookupKnowledge tests
// — leave for sibling describe blocks added in Task 2 + 3.
export { sql }
