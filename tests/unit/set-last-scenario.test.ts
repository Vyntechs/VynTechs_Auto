import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  platforms,
  symptoms,
  systemScenarios,
  sessions,
  shops,
  profiles,
} from '@/lib/db/schema'
import { setLastScenarioForSession } from '@/lib/sessions'

// ---------------------------------------------------------------------------
// Fixture seeding
// ---------------------------------------------------------------------------

let testPlatformId: string
let testSymptomId: string
let testSessionId: string
let testTechId: string

async function seedFixtures(db: TestDb) {
  const [platform] = await db
    .insert(platforms)
    .values({
      slug: 'ford-super-duty-4th-gen-67-psd',
      yearRange: '2017-2022',
      parentMake: 'Ford',
      parentModelFamily: 'Super Duty',
      generation: '4th gen',
    })
    .returning({ id: platforms.id })
  testPlatformId = platform.id

  const [symptom] = await db
    .insert(symptoms)
    .values({ slug: 'p0087', description: 'Fuel rail pressure too low', category: 'dtc', system: 'fuel' })
    .returning({ id: symptoms.id })
  testSymptomId = symptom.id

  await db.insert(systemScenarios).values([
    {
      slug: 'idle',
      platformId: testPlatformId,
      system: 'fuel',
      label: 'Idle',
      sub: 'IDLE',
      kind: 'operation',
      isDefault: true,
      displayOrder: 1,
    },
    {
      slug: 'heavy-load',
      platformId: testPlatformId,
      system: 'fuel',
      label: 'Heavy Load',
      sub: 'LOAD',
      kind: 'operation',
      isDefault: false,
      displayOrder: 2,
    },
  ])

  const [shop] = await db
    .insert(shops)
    .values({ name: 'Test Shop' })
    .returning({ id: shops.id })

  const [profile] = await db
    .insert(profiles)
    .values({ userId: crypto.randomUUID(), shopId: shop.id, role: 'tech' })
    .returning({ id: profiles.id })
  testTechId = profile.id

  const [session] = await db
    .insert(sessions)
    .values({
      shopId: shop.id,
      techId: profile.id,
      intake: {
        vehicleYear: 2019,
        vehicleMake: 'Ford',
        vehicleModel: 'F-350',
        customerComplaint: 'hard start',
      },
      treeState: {
        nodes: [{ id: 'start', label: 'Start', status: 'active' }],
        currentNodeId: 'start',
        message: '',
      },
      cacheHitPlatformId: testPlatformId,
      cacheHitSymptomId: testSymptomId,
    })
    .returning({ id: sessions.id })
  testSessionId = session.id
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('setLastScenarioForSession', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await seedFixtures(db)
  })

  afterEach(async () => {
    await close()
  })

  it('writes last_scenario_slug when slug refers to a real scenario for the session platform+system', async () => {
    const result = await setLastScenarioForSession({
      db: db as never,
      userId: (await db.query.profiles.findFirst({ where: (p, { eq }) => eq(p.id, testTechId) }))!.userId,
      sessionId: testSessionId,
      slug: 'idle',
    })
    expect(result.ok).toBe(true)

    const updated = await db.query.sessions.findFirst({
      where: (s, { eq }) => eq(s.id, testSessionId),
      columns: { lastScenarioSlug: true },
    })
    expect(updated!.lastScenarioSlug).toBe('idle')
  })

  it('returns ok: false / 404 / "not found" when session does not exist', async () => {
    const profile = await db.query.profiles.findFirst({ where: (p, { eq }) => eq(p.id, testTechId) })!
    const result = await setLastScenarioForSession({
      db: db as never,
      userId: profile!.userId,
      sessionId: '00000000-0000-0000-0000-000000000000',
      slug: 'idle',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(404)
      expect(result.error).toBe('not found')
    }
  })

  it('returns ok: false / 404 / "not found" when session belongs to a different user (techId mismatch)', async () => {
    // Create a second profile that does NOT own the session
    const [shop2] = await db.insert(shops).values({ name: 'Other Shop' }).returning({ id: shops.id })
    const otherUserId = crypto.randomUUID()
    await db
      .insert(profiles)
      .values({ userId: otherUserId, shopId: shop2.id, role: 'tech' })

    const result = await setLastScenarioForSession({
      db: db as never,
      userId: otherUserId,
      sessionId: testSessionId,
      slug: 'idle',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(404)
      expect(result.error).toBe('not found')
    }
  })

  it('returns ok: false / 400 / "unknown scenario" when slug does not match a scenario', async () => {
    const profile = await db.query.profiles.findFirst({ where: (p, { eq }) => eq(p.id, testTechId) })
    const result = await setLastScenarioForSession({
      db: db as never,
      userId: profile!.userId,
      sessionId: testSessionId,
      slug: 'nonexistent-scenario',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toContain('unknown scenario')
    }
  })

  it('returns ok: false / 400 when slug is empty string', async () => {
    const profile = await db.query.profiles.findFirst({ where: (p, { eq }) => eq(p.id, testTechId) })
    const result = await setLastScenarioForSession({
      db: db as never,
      userId: profile!.userId,
      sessionId: testSessionId,
      slug: '',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
    }
  })
})
