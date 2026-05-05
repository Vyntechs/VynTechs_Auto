import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
} from '@/lib/db/queries'
import { followUps } from '@/lib/db/schema'
import { scheduleFollowUps } from '@/lib/comeback/schedule'

async function seedSession(db: TestDb) {
  const shop = await createShop(db, { name: 'Test Shop' })
  const tech = await createProfile(db, {
    userId: crypto.randomUUID(),
    shopId: shop.id,
  })
  const session = await createSession(db, {
    shopId: shop.id,
    techId: tech.id,
    intake: {
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'loss of power',
    },
    treeState: {
      nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
      currentNodeId: 'root',
      message: 'go',
    },
  })
  return { shop, tech, session }
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
const TOLERANCE_MS = 5_000 // 5 seconds for clock drift across the call boundary

describe('scheduleFollowUps', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('inserts 7d and 30d rows pinned to the session/shop/tech', async () => {
    const { shop, tech, session } = await seedSession(db)
    const before = Date.now()

    const ids = await scheduleFollowUps(db, {
      sessionId: session.id,
      shopId: shop.id,
      techId: tech.id,
    })

    expect(ids).toHaveLength(2)

    const rows = await db
      .select()
      .from(followUps)
      .where(eq(followUps.sessionId, session.id))
    expect(rows).toHaveLength(2)

    const byKind = Object.fromEntries(rows.map((r) => [r.kind, r]))
    expect(byKind['7d']).toBeDefined()
    expect(byKind['30d']).toBeDefined()

    const sevenAt = byKind['7d'].dueAt.getTime()
    const thirtyAt = byKind['30d'].dueAt.getTime()
    expect(sevenAt).toBeGreaterThanOrEqual(before + SEVEN_DAYS_MS - TOLERANCE_MS)
    expect(sevenAt).toBeLessThanOrEqual(before + SEVEN_DAYS_MS + TOLERANCE_MS)
    expect(thirtyAt).toBeGreaterThanOrEqual(before + THIRTY_DAYS_MS - TOLERANCE_MS)
    expect(thirtyAt).toBeLessThanOrEqual(before + THIRTY_DAYS_MS + TOLERANCE_MS)

    expect(byKind['7d'].shopId).toBe(shop.id)
    expect(byKind['7d'].techId).toBe(tech.id)
    expect(byKind['7d'].surfacedAt).toBeNull()
    expect(byKind['7d'].resolvedAt).toBeNull()
    expect(byKind['7d'].comebackRecorded).toBeNull()
  })

  it('returns the inserted ids', async () => {
    const { shop, tech, session } = await seedSession(db)
    const ids = await scheduleFollowUps(db, {
      sessionId: session.id,
      shopId: shop.id,
      techId: tech.id,
    })
    const rows = await db.select().from(followUps).where(eq(followUps.sessionId, session.id))
    const dbIds = rows.map((r) => r.id).sort()
    expect(ids.slice().sort()).toEqual(dbIds)
  })
})
