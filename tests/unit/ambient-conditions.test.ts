import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  ensureProfileAndShop,
  createProfile,
  createSession,
  getSessionById,
} from '@/lib/db/queries'
import { recordAmbientConditions } from '@/lib/sessions'
import { fetchAmbientConditions } from '@/lib/external/weather'
import { ambientConditionsBlock } from '@/lib/ai/tree-engine'
import type { TreeState } from '@/lib/ai/tree-engine'
import { sessionEvents } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const initialTree: TreeState = {
  nodes: [{ id: 'verify-ambient', label: 'Verify ambient temp', status: 'active' }],
  currentNodeId: 'verify-ambient',
  message: 'capture ambient',
}

const updatedTree: TreeState = {
  nodes: [
    { id: 'verify-ambient', label: 'Verify ambient temp', status: 'resolved' },
    { id: 'static-pressure', label: 'Compare static pressure', status: 'active' },
  ],
  currentNodeId: 'static-pressure',
  message: 'static pressure now interpretable against ambient',
}

const intake = {
  vehicleYear: 2007,
  vehicleMake: 'Chevrolet',
  vehicleModel: 'Tahoe',
  customerComplaint: 'AC not blowing cold',
}

describe('recordAmbientConditions', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  async function seed(opts: { userId: string } = { userId: crypto.randomUUID() }) {
    const profile = await ensureProfileAndShop(db, opts.userId, 'tech@shop.com')
    const session = await createSession(db, {
      shopId: profile.shopId!,
      techId: profile.id,
      intake,
      treeState: initialTree,
      status: 'open',
    })
    return { profile, session }
  }

  it('geolocation path: looks up weather, stores conditions on intake, advances tree', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seed({ userId })
    const lookupAmbient = vi.fn().mockResolvedValue({
      temperatureC: 25,
      temperatureF: 77,
      humidityPct: 45,
      windKph: 8,
      conditions: 'partly cloudy',
    })
    const updateTree = vi.fn().mockResolvedValue(updatedTree)

    const result = await recordAmbientConditions({
      db,
      userId,
      sessionId: session.id,
      body: { source: 'geolocation', latitude: 35.123456, longitude: -97.654321 },
      lookupAmbient,
      updateTree,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.conditions.source).toBe('geolocation')
    expect(result.conditions.temperatureF).toBe(77)
    expect(result.conditions.humidityPct).toBe(45)
    expect(result.conditions.approxLat).toBe(35.1)
    expect(result.conditions.approxLon).toBe(-97.7)
    expect(result.tree.currentNodeId).toBe('static-pressure')

    const fetched = await getSessionById(db, session.id)
    expect(fetched?.intake.ambientConditions?.temperatureF).toBe(77)
    expect(fetched?.intake.ambientConditions?.source).toBe('geolocation')
  })

  it('manual path: skips lookup, stores tech-entered temp, advances tree', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seed({ userId })
    const lookupAmbient = vi.fn()
    const updateTree = vi.fn().mockResolvedValue(updatedTree)

    const result = await recordAmbientConditions({
      db,
      userId,
      sessionId: session.id,
      body: { source: 'manual', temperatureF: 92, humidityPct: 30 },
      lookupAmbient,
      updateTree,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(lookupAmbient).not.toHaveBeenCalled()
    expect(result.conditions.source).toBe('manual')
    expect(result.conditions.temperatureF).toBe(92)
    expect(result.conditions.humidityPct).toBe(30)
    expect(result.conditions.approxLat).toBeUndefined()
  })

  it('passes the ambient observation into the next tree update', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seed({ userId })
    const lookupAmbient = vi.fn().mockResolvedValue({
      temperatureC: 30,
      temperatureF: 86,
      humidityPct: 50,
    })
    const updateTree = vi.fn().mockResolvedValue(updatedTree)

    await recordAmbientConditions({
      db,
      userId,
      sessionId: session.id,
      body: { source: 'geolocation', latitude: 30, longitude: -90 },
      lookupAmbient,
      updateTree,
    })

    expect(updateTree).toHaveBeenCalledTimes(1)
    const call = updateTree.mock.calls[0][0] as {
      observation: string
      intake: { ambientConditions?: { temperatureF: number } }
    }
    expect(call.intake.ambientConditions?.temperatureF).toBe(86)
    expect(call.observation).toMatch(/86°F/)
    expect(call.observation).toMatch(/geolocation lookup/)
  })

  it('appends an observation event when ambient conditions are captured', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seed({ userId })

    await recordAmbientConditions({
      db,
      userId,
      sessionId: session.id,
      body: { source: 'manual', temperatureF: 70 },
      lookupAmbient: vi.fn(),
      updateTree: vi.fn().mockResolvedValue(updatedTree),
    })

    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('observation')
    expect(events[0].observationText).toMatch(/70°F/)
    expect(events[0].observationText).toMatch(/tech-entered/)
  })

  it('returns 502 when the weather lookup fails', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seed({ userId })
    const lookupAmbient = vi.fn().mockRejectedValue(new Error('open-meteo 503'))
    const updateTree = vi.fn().mockResolvedValue(updatedTree)

    const result = await recordAmbientConditions({
      db,
      userId,
      sessionId: session.id,
      body: { source: 'geolocation', latitude: 30, longitude: -90 },
      lookupAmbient,
      updateTree,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(502)
    }
    expect(updateTree).not.toHaveBeenCalled()
  })

  it('rejects out-of-range coordinates', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seed({ userId })

    const result = await recordAmbientConditions({
      db,
      userId,
      sessionId: session.id,
      body: { source: 'geolocation', latitude: 999, longitude: 0 },
      lookupAmbient: vi.fn(),
      updateTree: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('rejects unrealistic manual temperatures', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seed({ userId })

    const result = await recordAmbientConditions({
      db,
      userId,
      sessionId: session.id,
      body: { source: 'manual', temperatureF: 999 },
      lookupAmbient: vi.fn(),
      updateTree: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('returns 404 when the session belongs to a different tech', async () => {
    const ownerId = crypto.randomUUID()
    const intruderId = crypto.randomUUID()
    const { session } = await seed({ userId: ownerId })
    await createProfile(db, { userId: intruderId })

    const result = await recordAmbientConditions({
      db,
      userId: intruderId,
      sessionId: session.id,
      body: { source: 'manual', temperatureF: 70 },
      lookupAmbient: vi.fn(),
      updateTree: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})

describe('fetchAmbientConditions (Open-Meteo)', () => {
  it('parses a normal current-weather response into temperatureC + temperatureF', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          current: {
            temperature_2m: 25,
            relative_humidity_2m: 45,
            wind_speed_10m: 8,
            weather_code: 2,
          },
        }),
        { status: 200 },
      ),
    )

    const got = await fetchAmbientConditions({
      latitude: 35.5,
      longitude: -97.5,
      fetchFn,
    })

    expect(got.temperatureC).toBe(25)
    expect(got.temperatureF).toBeCloseTo(77, 5)
    expect(got.humidityPct).toBe(45)
    expect(got.windKph).toBe(8)
    expect(got.conditions).toBe('partly cloudy')

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const calledUrl = String(fetchFn.mock.calls[0][0])
    expect(calledUrl).toContain('latitude=35.5000')
    expect(calledUrl).toContain('longitude=-97.5000')
    expect(calledUrl).toContain('temperature_2m')
  })

  it('throws on non-2xx upstream responses', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('upstream down', { status: 503 }))
    await expect(
      fetchAmbientConditions({ latitude: 30, longitude: -90, fetchFn }),
    ).rejects.toThrow(/503/)
  })

  it('throws on a payload missing temperature_2m', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ current: {} }), { status: 200 }))
    await expect(
      fetchAmbientConditions({ latitude: 30, longitude: -90, fetchFn }),
    ).rejects.toThrow(/temperature_2m/)
  })

  it('rejects out-of-range coordinates before any fetch', async () => {
    const fetchFn = vi.fn()
    await expect(
      fetchAmbientConditions({ latitude: 200, longitude: 0, fetchFn }),
    ).rejects.toThrow(/coordinates/)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('ambientConditionsBlock (AI prompt rendering)', () => {
  it('returns empty string when no conditions are present', () => {
    expect(ambientConditionsBlock(undefined)).toBe('')
  })

  it('renders a one-line prose block the AI can read', () => {
    const block = ambientConditionsBlock({
      temperatureF: 86,
      humidityPct: 50,
      windKph: 8,
      conditions: 'partly cloudy',
      source: 'geolocation',
      capturedAt: '2026-05-09T20:00:00Z',
    })
    expect(block).toContain('86°F')
    expect(block).toContain('50% humidity')
    expect(block).toContain('partly cloudy')
    expect(block).toContain('geolocation lookup')
  })

  it('flags manual entries differently so the AI knows the source', () => {
    const block = ambientConditionsBlock({
      temperatureF: 92,
      source: 'manual',
      capturedAt: '2026-05-09T20:00:00Z',
    })
    expect(block).toContain('92°F')
    expect(block).toContain('tech-entered')
  })
})
