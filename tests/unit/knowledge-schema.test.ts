import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { knowledgeItems, knowledgeItemVehicles, symptoms } from '@/lib/db/schema'

describe('knowledge_items schema', () => {
  let handle: { db: TestDb; close: () => Promise<void> }
  beforeEach(async () => {
    handle = await createTestDb()
  })
  afterEach(async () => {
    await handle.close()
  })

  async function seedShopAndProfile() {
    const shop = await createShop(handle.db, { name: 'Test Shop' })
    const profile = await createProfile(handle.db, {
      userId: crypto.randomUUID(),
      shopId: shop.id,
    })
    return { shop, profile }
  }

  it('inserts and reads back a cause_fix item with all defaults', async () => {
    const { shop, profile } = await seedShopAndProfile()
    const structuredData = {
      complaint: 'Hard-shift on 6.4 Powerstroke',
      cause: 'TCM C171 connector corrosion',
      correction: 'Replace TCM C171 connector',
      first_check: 'Inspect TCM C171 connector for corrosion',
      dtcs_common: ['P0700', 'P0775'],
    }
    const [item] = await handle.db
      .insert(knowledgeItems)
      .values({
        shopId: shop.id,
        type: 'cause_fix',
        title: 'Hard-shift cause/fix',
        structuredData,
        dtcList: ['P0700'],
        systemCodes: ['transmission'],
        symptoms: ['no_shift'],
        createdByUserId: profile.id,
      })
      .returning()

    expect(item.id).toBeDefined()
    expect(item.shopId).toBe(shop.id)
    expect(item.type).toBe('cause_fix')
    expect(item.title).toBe('Hard-shift cause/fix')
    expect(item.body).toBeNull()
    expect(item.structuredData).toEqual(structuredData)
    expect(item.dtcList).toEqual(['P0700'])
    expect(item.systemCodes).toEqual(['transmission'])
    expect(item.symptoms).toEqual(['no_shift'])
    expect(item.retired).toBe(false)
    expect(item.retiredAt).toBeNull()
    expect(item.retiredByUserId).toBeNull()
    expect(item.fireCount).toBe(0)
    expect(item.createdAt).toBeInstanceOf(Date)
    expect(item.updatedAt).toBeInstanceOf(Date)
  })

  it('accepts all 8 type discriminator values', async () => {
    const { shop, profile } = await seedShopAndProfile()
    const allTypes = [
      'cause_fix',
      'reference_doc',
      'bulletin',
      'note',
      'pinout',
      'connector',
      'wiring_diagram',
      'theory_of_operation',
    ] as const

    for (const t of allTypes) {
      const [item] = await handle.db
        .insert(knowledgeItems)
        .values({
          shopId: shop.id,
          type: t,
          title: `${t} item`,
          createdByUserId: profile.id,
        })
        .returning()
      expect(item.type).toBe(t)
    }
  })

  it('rejects an invalid type value via the CHECK constraint', async () => {
    const { shop, profile } = await seedShopAndProfile()
    await expect(
      handle.db.execute(sql`
        INSERT INTO knowledge_items (shop_id, type, title, created_by_user_id)
        VALUES (${shop.id}, 'not_a_real_type', 't', ${profile.id})
      `),
    ).rejects.toThrow()
  })

  it('round-trips a pinout structured_data shape', async () => {
    const { shop, profile } = await seedShopAndProfile()
    const structuredData = {
      connector_ref: 'C2280',
      pins: [
        { pin_number: 1, signal_name: 'B+', wire_color: 'red', expected_voltage_or_waveform: '12V battery', notes: '' },
        { pin_number: 2, signal_name: 'GND', wire_color: 'black', expected_voltage_or_waveform: '0V', notes: '' },
        { pin_number: 3, signal_name: 'LIN', wire_color: 'green/white', expected_voltage_or_waveform: '5V idle, LIN bus when active', notes: 'pull-up failure pattern' },
      ],
    }
    const [item] = await handle.db
      .insert(knowledgeItems)
      .values({
        shopId: shop.id,
        type: 'pinout',
        title: 'Alternator 4-pin pinout',
        structuredData,
        systemCodes: ['charging'],
        createdByUserId: profile.id,
      })
      .returning()
    expect(item.structuredData).toEqual(structuredData)
  })

  it('round-trips a theory_of_operation structured_data shape', async () => {
    const { shop, profile } = await seedShopAndProfile()
    const structuredData = {
      title: '6.7L Powerstroke charging system theory',
      sections: [
        { heading: 'Alternator construction', body: '...prose...' },
        { heading: 'BCM control', body: '...prose...' },
        { heading: 'LIN bus communication', body: '...prose...' },
      ],
    }
    const [item] = await handle.db
      .insert(knowledgeItems)
      .values({
        shopId: shop.id,
        type: 'theory_of_operation',
        title: '6.7L Powerstroke charging theory',
        structuredData,
        systemCodes: ['charging'],
        createdByUserId: profile.id,
      })
      .returning()
    expect(item.structuredData).toEqual(structuredData)
  })

  it('round-trips a wiring_diagram structured_data shape', async () => {
    const { shop, profile } = await seedShopAndProfile()
    const structuredData = {
      image_ref: 'wiring/charging-circuit.png',
      name: 'BCM ↔ alternator charging circuit',
      connections: [
        { from_component: 'BCM', from_pin: '12', to_component: 'alternator', to_pin: '3', wire_color: 'green/white', splice_id: 'S101', notes: '' },
      ],
    }
    const [item] = await handle.db
      .insert(knowledgeItems)
      .values({
        shopId: shop.id,
        type: 'wiring_diagram',
        title: 'Charging circuit diagram',
        structuredData,
        systemCodes: ['charging'],
        createdByUserId: profile.id,
      })
      .returning()
    expect(item.structuredData).toEqual(structuredData)
  })

  it('round-trips a connector structured_data shape', async () => {
    const { shop, profile } = await seedShopAndProfile()
    const structuredData = {
      connector_id: 'C2280',
      component_name: 'BCM',
      location_description: 'driver kick panel behind fuse box',
      image_ref: 'connectors/bcm-c2280.jpg',
      mating_end_image_ref: 'connectors/bcm-c2280-mating.jpg',
    }
    const [item] = await handle.db
      .insert(knowledgeItems)
      .values({
        shopId: shop.id,
        type: 'connector',
        title: 'BCM C2280 connector',
        structuredData,
        systemCodes: ['body_electrical'],
        createdByUserId: profile.id,
      })
      .returning()
    expect(item.structuredData).toEqual(structuredData)
  })

  it('round-trips a bulletin structured_data shape', async () => {
    const { shop, profile } = await seedShopAndProfile()
    const structuredData = {
      source: 'NHTSA',
      bulletin_id: 'TSB 21-2229',
      summary: 'Hard-shift on cold start',
      body: '...bulletin body...',
      link: 'https://example.com/tsb-21-2229',
    }
    const [item] = await handle.db
      .insert(knowledgeItems)
      .values({
        shopId: shop.id,
        type: 'bulletin',
        title: 'TSB 21-2229 hard-shift',
        structuredData,
        createdByUserId: profile.id,
      })
      .returning()
    expect(item.structuredData).toEqual(structuredData)
  })

  it('uses array empty-default for tag columns when omitted', async () => {
    const { shop, profile } = await seedShopAndProfile()
    const [item] = await handle.db
      .insert(knowledgeItems)
      .values({
        shopId: shop.id,
        type: 'note',
        title: 'Just a note',
        body: 'free text',
        createdByUserId: profile.id,
      })
      .returning()
    expect(item.dtcList).toEqual([])
    expect(item.systemCodes).toEqual([])
    expect(item.symptoms).toEqual([])
  })

  it('cascades knowledge_item_vehicles delete when its knowledge_item is deleted', async () => {
    const { shop, profile } = await seedShopAndProfile()
    const [item] = await handle.db
      .insert(knowledgeItems)
      .values({
        shopId: shop.id,
        type: 'cause_fix',
        title: 'Item to delete',
        createdByUserId: profile.id,
      })
      .returning()
    await handle.db.insert(knowledgeItemVehicles).values({
      knowledgeItemId: item.id,
      yearStart: 2017,
      yearEnd: 2022,
      make: 'Ford',
      model: 'F-250',
      engine: '6.7L Powerstroke',
    })

    await handle.db.delete(knowledgeItems).where(eq(knowledgeItems.id, item.id))

    const remaining = await handle.db
      .select()
      .from(knowledgeItemVehicles)
      .where(eq(knowledgeItemVehicles.knowledgeItemId, item.id))
    expect(remaining).toEqual([])
  })

  it('stores symptoms lookup entries', async () => {
    await handle.db.insert(symptoms).values({
      name: 'no_shift',
      displayLabel: 'No shift',
    })
    const rows = await handle.db.select().from(symptoms).where(eq(symptoms.name, 'no_shift'))
    expect(rows).toHaveLength(1)
    expect(rows[0].displayLabel).toBe('No shift')
    expect(rows[0].usageCount).toBe(0)
  })
})
