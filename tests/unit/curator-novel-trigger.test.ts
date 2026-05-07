import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { sessions, shops, profiles, novelPatternQueue } from '@/lib/db/schema'
import { enqueueIfNovelPattern } from '@/lib/curator/novel-trigger'

const SHOP = '00000000-0000-0000-0000-000000000001'
const TECH_USER = '00000000-0000-0000-0000-000000000040'
const TECH_PROFILE = '00000000-0000-0000-0000-000000000041'
const SESSION_ID = '00000000-0000-0000-0000-000000000050'

const STUB_TREE = {
  nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' as const }],
  currentNodeId: 'root',
  message: 'go',
}

describe('enqueueIfNovelPattern', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())

    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values({
      id: TECH_PROFILE,
      userId: TECH_USER,
      shopId: SHOP,
      role: 'tech',
    })
    await db.insert(sessions).values({
      id: SESSION_ID,
      shopId: SHOP,
      techId: TECH_PROFILE,
      status: 'open',
      intake: {
        vehicleYear: 2019,
        vehicleMake: 'Toyota',
        vehicleModel: 'Tacoma',
        customerComplaint: 'intermittent no-start',
      },
      treeState: STUB_TREE,
    })
  })

  afterEach(async () => {
    await close()
  })

  it('enqueues when maxSimilarity is below the 0.6 threshold', async () => {
    await enqueueIfNovelPattern(db, SESSION_ID, 0.42)

    const rows = await db
      .select()
      .from(novelPatternQueue)
      .where(eq(novelPatternQueue.sessionId, SESSION_ID))

    expect(rows).toHaveLength(1)
    expect(rows[0].sessionId).toBe(SESSION_ID)
    expect(rows[0].maxRetrievalSimilarity).toBeCloseTo(0.42, 5)
    expect(rows[0].reviewedAt).toBeNull()
    expect(rows[0].reviewedDecision).toBeNull()
  })

  it('does NOT enqueue when maxSimilarity is at or above the 0.6 threshold', async () => {
    await enqueueIfNovelPattern(db, SESSION_ID, 0.6)

    const rows = await db
      .select()
      .from(novelPatternQueue)
      .where(eq(novelPatternQueue.sessionId, SESSION_ID))

    expect(rows).toHaveLength(0)
  })
})
