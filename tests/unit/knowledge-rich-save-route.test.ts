import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  knowledgeItems,
  knowledgeItemVehicles,
  profiles,
  shops,
} from '@/lib/db/schema'

let currentDb: TestDb
vi.mock('@/lib/db/client', () => ({
  db: new Proxy({} as TestDb, {
    get: (_t, prop) => {
      const value = (currentDb as unknown as Record<PropertyKey, unknown>)[prop as PropertyKey]
      return typeof value === 'function' ? value.bind(currentDb) : value
    },
  }),
}))

vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(),
}))

async function mockUser(userId: string | null, email: string | null = 'owner@shop.test') {
  const { getServerSupabase } = await import('@/lib/supabase-server')
  vi.mocked(getServerSupabase).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: userId ? { id: userId, email } : null },
      }),
    },
  } as unknown as Awaited<ReturnType<typeof getServerSupabase>>)
}

const OWNER_USER_ID = '00000000-0000-0000-0000-000000000001'

describe('POST /api/knowledge/save — rich types', () => {
  let close: () => Promise<void>
  let shopId: string

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close

    const [shop] = await currentDb.insert(shops).values({ name: 'Shop' }).returning()
    shopId = shop.id
    await currentDb.insert(profiles).values({
      userId: OWNER_USER_ID,
      role: 'owner',
      shopId,
      fullName: 'Owner',
    })
  })

  afterEach(async () => {
    await close()
    vi.clearAllMocks()
  })

  it('saves a pinout with structured pins + vehicle scope', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'pinout',
          title: 'Alternator 4-pin pinout — 6.7L Powerstroke',
          systemCodes: ['charging'],
          vehicleScopes: [
            { yearStart: 2017, yearEnd: 2019, make: 'Ford', model: 'F-250', engine: '6.7L Powerstroke' },
          ],
          structuredData: {
            connector_ref: 'Alternator 4-pin',
            pins: [
              { pin_number: '1', signal_name: '12V SUPPLY', wire_color: 'RED' },
              { pin_number: '2', signal_name: 'GROUND', wire_color: 'BLK' },
              { pin_number: '3', signal_name: 'LIN BUS', wire_color: 'GRN/WHT', expected_voltage_or_waveform: 'Steady 5V' },
              { pin_number: '4', signal_name: 'IGNITION ENABLE', wire_color: 'YEL' },
            ],
          },
        }),
      }),
    )
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }

    const [row] = await currentDb.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))
    expect(row.type).toBe('pinout')
    expect(row.shopId).toBe(shopId)
    expect(row.structuredData).toMatchObject({
      connector_ref: 'Alternator 4-pin',
      pins: expect.arrayContaining([
        expect.objectContaining({ pin_number: '3', signal_name: 'LIN BUS' }),
      ]),
    })

    const scopes = await currentDb
      .select()
      .from(knowledgeItemVehicles)
      .where(eq(knowledgeItemVehicles.knowledgeItemId, id))
    expect(scopes).toHaveLength(1)
    expect(scopes[0].engine).toBe('6.7L Powerstroke')
  })

  it('saves a connector with image refs', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'connector',
          title: 'BCM C2280',
          structuredData: {
            connector_id: 'C2280',
            component_name: 'Body Control Module',
            location_description: 'Behind driver kick panel',
            image_ref: 'knowledge/shop1/connector/abc.jpg',
            mating_end_image_ref: 'knowledge/shop1/connector/def.jpg',
          },
        }),
      }),
    )
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }

    const [row] = await currentDb.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))
    expect(row.type).toBe('connector')
    expect(row.structuredData).toMatchObject({
      connector_id: 'C2280',
      image_ref: 'knowledge/shop1/connector/abc.jpg',
    })
  })

  it('saves a wiring_diagram with image and connections', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'wiring_diagram',
          title: 'BCM <-> Alternator',
          structuredData: {
            name: 'BCM to Alternator charging circuit',
            image_ref: 'knowledge/shop1/wiring_diagram/xyz.png',
            connections: [
              { from_component: 'BCM', from_pin: '3', to_component: 'Alternator', to_pin: '3', wire_color: 'GRN' },
            ],
          },
        }),
      }),
    )
    expect(res.status).toBe(201)
  })

  it('saves a theory_of_operation with sections', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'theory_of_operation',
          title: '6.7L charging system theory',
          systemCodes: ['charging'],
          structuredData: {
            title: '6.7L Powerstroke Charging System',
            sections: [
              { heading: 'Overview', body: 'The 6.7L uses a smart alternator controlled via LIN bus.' },
              { heading: 'LIN bus control', body: 'BCM commands the field via LIN messages.' },
            ],
          },
        }),
      }),
    )
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    const [row] = await currentDb.select().from(knowledgeItems).where(eq(knowledgeItems.id, id))
    const sd = row.structuredData as { sections: Array<{ heading: string }> }
    expect(sd.sections).toHaveLength(2)
    expect(sd.sections[0].heading).toBe('Overview')
  })

  it('returns 422 for a pinout with duplicate pin numbers', async () => {
    await mockUser(OWNER_USER_ID)
    const { POST } = await import('@/app/api/knowledge/save/route')
    const res = await POST(
      new Request('http://localhost/api/knowledge/save', {
        method: 'POST',
        body: JSON.stringify({
          type: 'pinout',
          title: 'Bad pinout',
          structuredData: {
            connector_ref: 'C1',
            pins: [
              { pin_number: '1', signal_name: 'A' },
              { pin_number: '1', signal_name: 'B' },
            ],
          },
        }),
      }),
    )
    expect(res.status).toBe(422)
  })
})
