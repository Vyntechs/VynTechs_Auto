import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { novelPatternQueue, sessions, profiles, shops } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { dismissNovelPattern } from '@/lib/curator/novel-actions'

const SHOP    = '00000000-0000-0000-0000-000000000001'
const TECH    = '00000000-0000-0000-0000-000000000020'
const CURATOR = '00000000-0000-0000-0000-000000000010'
const SESSION = '00000000-0000-0000-0000-000000000030'

describe('dismissNovelPattern', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values({ id: TECH,    userId: '00000000-0000-0000-0000-000000000021', shopId: SHOP, role: 'tech' })
    await db.insert(profiles).values({ id: CURATOR, userId: '00000000-0000-0000-0000-000000000011', shopId: SHOP, role: 'curator' })
    await db.insert(sessions).values({
      id: SESSION,
      shopId: SHOP,
      techId: TECH,
      status: 'closed',
      intake: { vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', customerComplaint: 'rough idle' },
      treeState: { nodes: [], currentNodeId: 'root', message: 'start', proposedAction: { description: 'inspect coils', confidence: 0.5 } },
    })
  })
  afterEach(async () => { await close() })

  it('marks queue entry reviewed with decision=dismissed', async () => {
    const [entry] = await db.insert(novelPatternQueue).values({
      sessionId: SESSION,
      maxRetrievalSimilarity: 0.42,
    }).returning()

    const result = await dismissNovelPattern(db, entry.id, CURATOR, 'unique noise')
    expect(result.kind).toBe('ok')

    const [updated] = await db.select().from(novelPatternQueue).where(eq(novelPatternQueue.id, entry.id))
    expect(updated.reviewedAt).not.toBeNull()
    expect(updated.reviewedDecision).toBe('dismissed')
    expect(updated.reviewedByUserId).toBe(CURATOR)
    expect(updated.reviewedNote).toBe('unique noise')
  })
})
