import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { sql } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { knowledgeItems, knowledgeItemVehicles } from '@/lib/db/schema'
import {
  lookupKnowledge,
  getConnectorPinout,
  getTheoryOfOperation,
  getWiringPath,
  getComponentLocation,
  getSpec,
  incrementFireCount,
} from '@/lib/knowledge/retrieval'

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

describe('getConnectorPinout', () => {
  let handle: { db: TestDb; close: () => Promise<void> }
  let shopId: string
  let profileId: string

  beforeEach(async () => {
    handle = await createTestDb()
    const shop = await createShop(handle.db, { name: 'Shop' })
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

  it('returns the pinout for a matching connector_ref', async () => {
    const id = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Alt 4-pin',
      type: 'pinout',
      structuredData: {
        connector_ref: 'Alternator 4-pin',
        pins: [{ pin_number: '1', signal_name: 'B+' }],
      },
    })
    const matches = await getConnectorPinout(handle.db, {
      shopId,
      connectorRef: 'Alternator 4-pin',
      vehicle: F250_VEHICLE,
    })
    expect(matches.map((m) => m.id)).toContain(id)
  })

  it('only returns pinout type, never other types with the same connector_ref', async () => {
    await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Note about Alternator 4-pin',
      type: 'note',
      structuredData: { connector_ref: 'Alternator 4-pin' },
    })
    const matches = await getConnectorPinout(handle.db, {
      shopId,
      connectorRef: 'Alternator 4-pin',
      vehicle: F250_VEHICLE,
    })
    expect(matches).toHaveLength(0)
  })
})

describe('getTheoryOfOperation', () => {
  let handle: { db: TestDb; close: () => Promise<void> }
  let shopId: string
  let profileId: string

  beforeEach(async () => {
    handle = await createTestDb()
    const shop = await createShop(handle.db, { name: 'Shop' })
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

  it('returns theory_of_operation items matching system code', async () => {
    const id = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Charging theory',
      type: 'theory_of_operation',
      systemCodes: ['charging'],
      structuredData: {
        title: 'Charging system theory',
        sections: [{ heading: 'Overview', body: 'BCM commands the alternator field via LIN.' }],
      },
    })
    const matches = await getTheoryOfOperation(handle.db, {
      shopId,
      systemCode: 'charging',
      vehicle: F250_VEHICLE,
    })
    expect(matches.map((m) => m.id)).toContain(id)
  })

  it('excludes items with mismatched system code', async () => {
    await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Fuel theory',
      type: 'theory_of_operation',
      systemCodes: ['fuel_delivery'],
    })
    const matches = await getTheoryOfOperation(handle.db, {
      shopId,
      systemCode: 'charging',
      vehicle: F250_VEHICLE,
    })
    expect(matches).toHaveLength(0)
  })
})

describe('getWiringPath', () => {
  let handle: { db: TestDb; close: () => Promise<void> }
  let shopId: string
  let profileId: string

  beforeEach(async () => {
    handle = await createTestDb()
    const shop = await createShop(handle.db, { name: 'Shop' })
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

  it('returns the wiring diagram when an A→B connection exists', async () => {
    const id = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'BCM to Alternator',
      type: 'wiring_diagram',
      structuredData: {
        name: 'BCM ↔ Alternator',
        image_ref: 'placeholder',
        connections: [
          { from_component: 'BCM', to_component: 'Alternator', wire_color: 'YEL' },
        ],
      },
    })
    const matches = await getWiringPath(handle.db, {
      shopId,
      fromComponent: 'BCM',
      toComponent: 'Alternator',
      vehicle: F250_VEHICLE,
    })
    expect(matches.map((m) => m.id)).toContain(id)
  })

  it('matches in either direction (A→B or B→A)', async () => {
    const id = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'B to A',
      type: 'wiring_diagram',
      structuredData: {
        name: 'B ↔ A',
        image_ref: 'placeholder',
        connections: [{ from_component: 'B', to_component: 'A' }],
      },
    })
    const matches = await getWiringPath(handle.db, {
      shopId,
      fromComponent: 'A',
      toComponent: 'B',
      vehicle: F250_VEHICLE,
    })
    expect(matches.map((m) => m.id)).toContain(id)
  })

  it('excludes wiring diagrams with no matching connection', async () => {
    await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'BCM to PCM',
      type: 'wiring_diagram',
      structuredData: {
        name: 'BCM ↔ PCM',
        image_ref: 'placeholder',
        connections: [{ from_component: 'BCM', to_component: 'PCM' }],
      },
    })
    const matches = await getWiringPath(handle.db, {
      shopId,
      fromComponent: 'BCM',
      toComponent: 'Alternator',
      vehicle: F250_VEHICLE,
    })
    expect(matches).toHaveLength(0)
  })
})

describe('getComponentLocation', () => {
  let handle: { db: TestDb; close: () => Promise<void> }
  let shopId: string
  let profileId: string

  beforeEach(async () => {
    handle = await createTestDb()
    const shop = await createShop(handle.db, { name: 'Shop' })
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

  it('returns the connector item matching component_name', async () => {
    const id = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Alternator C123',
      type: 'connector',
      structuredData: {
        connector_id: 'C123',
        component_name: 'Alternator',
        location_description: 'Driver-side, front of engine',
      },
    })
    const matches = await getComponentLocation(handle.db, {
      shopId,
      componentName: 'Alternator',
      vehicle: F250_VEHICLE,
    })
    expect(matches.map((m) => m.id)).toContain(id)
  })

  it('only returns connector type', async () => {
    await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Note for Alternator',
      type: 'note',
      structuredData: { component_name: 'Alternator' },
    })
    const matches = await getComponentLocation(handle.db, {
      shopId,
      componentName: 'Alternator',
      vehicle: F250_VEHICLE,
    })
    expect(matches).toHaveLength(0)
  })
})

describe('getSpec', () => {
  let handle: { db: TestDb; close: () => Promise<void> }
  let shopId: string
  let profileId: string

  beforeEach(async () => {
    handle = await createTestDb()
    const shop = await createShop(handle.db, { name: 'Shop' })
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

  it('matches spec by title keyword', async () => {
    const id = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Torque spec: alternator mounting bolt 35 ft-lb',
      type: 'note',
    })
    const matches = await getSpec(handle.db, {
      shopId,
      specName: 'alternator mounting bolt',
      vehicle: F250_VEHICLE,
    })
    expect(matches.map((m) => m.id)).toContain(id)
  })

  it('matches spec by structured_data content', async () => {
    const id = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'Various specs',
      type: 'reference_doc',
      structuredData: { ride_height_front_inches: 36.5 },
    })
    const matches = await getSpec(handle.db, {
      shopId,
      specName: 'ride_height_front_inches',
      vehicle: F250_VEHICLE,
    })
    expect(matches.map((m) => m.id)).toContain(id)
  })

  it('does not leak across shops', async () => {
    const otherShop = await createShop(handle.db, { name: 'Other' })
    await seedItem(handle.db, {
      shopId: otherShop.id,
      profileId,
      title: 'Torque spec stranger',
      type: 'note',
    })
    const matches = await getSpec(handle.db, {
      shopId,
      specName: 'Torque spec stranger',
      vehicle: F250_VEHICLE,
    })
    expect(matches).toHaveLength(0)
  })
})

describe('incrementFireCount', () => {
  let handle: { db: TestDb; close: () => Promise<void> }
  let shopId: string
  let profileId: string

  beforeEach(async () => {
    handle = await createTestDb()
    const shop = await createShop(handle.db, { name: 'Shop' })
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

  it('increments fire_count once per id and counts duplicates in input', async () => {
    const a = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'A',
      dtcList: ['P0420'],
      fireCount: 0,
    })
    const b = await seedItem(handle.db, {
      shopId,
      profileId,
      title: 'B',
      dtcList: ['P0420'],
      fireCount: 5,
    })
    await incrementFireCount(handle.db, [a, b, a]) // a appears twice
    const result = await handle.db.execute<{ id: string; fire_count: number }>(sql`
      SELECT id, fire_count FROM knowledge_items WHERE id IN (${a}, ${b}) ORDER BY id
    `)
    const rowsArr = Array.isArray(result) ? result : (result as { rows: typeof result }).rows
    const map = new Map(rowsArr.map((r) => [r.id, r.fire_count]))
    expect(map.get(a)).toBe(2)
    expect(map.get(b)).toBe(6)
  })

  it('is a no-op for empty input', async () => {
    await incrementFireCount(handle.db, [])
    // No throw; nothing to assert beyond no-error completion.
  })
})

// Re-export sql for type-friendly use across test files in this PR.
export { sql }
