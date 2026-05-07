import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { corpusEntries, novelPatternQueue, sessions, profiles, shops } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createCuratorCorpusEntry } from '@/lib/curator/corpus-actions'

const SHOP    = '00000000-0000-0000-0000-000000000001'
const TECH    = '00000000-0000-0000-0000-000000000020'
const CURATOR = '00000000-0000-0000-0000-000000000010'
const SESSION = '00000000-0000-0000-0000-000000000030'

describe('createCuratorCorpusEntry', () => {
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

  it('inserts entry with isCuratorEntry=true and source ids null', async () => {
    const result = await createCuratorCorpusEntry(db, CURATOR, {
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      vehicleEngine: '5.0L',
      symptomTags: ['power_loss'],
      dtcs: ['P0420'],
      summary: 'rpm dips at idle',
      freezeFramePattern: { rpm: 'low' },
      rootCause: 'failed catalyst monitor',
      actionType: 'part_replacement',
      partInfo: { name: 'catalyst' },
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
    })
    expect(result.kind).toBe('ok')

    if (result.kind !== 'ok') return  // narrow union for TS

    const [entry] = await db.select().from(corpusEntries).where(eq(corpusEntries.id, result.id))
    expect(entry.isCuratorEntry).toBe(true)
    expect(entry.sourceSessionId).toBeNull()
    expect(entry.sourceShopId).toBeNull()
    expect(entry.curatedByUserId).toBe(CURATOR)
  })

  it('when fromQueueEntryId provided, marks the novel-pattern queue entry as reviewed=corpus', async () => {
    const [queueEntry] = await db.insert(novelPatternQueue).values({
      sessionId: SESSION,
      maxRetrievalSimilarity: 0.42,
    }).returning()

    await createCuratorCorpusEntry(db, CURATOR, {
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      vehicleEngine: '5.0L',
      symptomTags: ['power_loss'],
      dtcs: ['P0420'],
      summary: '...',
      freezeFramePattern: {},
      rootCause: 'X',
      actionType: 'repair',
      partInfo: null,
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'partial' },
    }, { fromQueueEntryId: queueEntry.id })

    const [updated] = await db.select().from(novelPatternQueue).where(eq(novelPatternQueue.id, queueEntry.id))
    expect(updated.reviewedDecision).toBe('corpus')
    expect(updated.reviewedAt).not.toBeNull()
    expect(updated.reviewedByUserId).toBe(CURATOR)
  })
})
