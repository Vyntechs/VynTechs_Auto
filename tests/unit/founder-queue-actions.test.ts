import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { corpusEntries, founderNotesQueue, profiles, shops } from '@/lib/db/schema'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  enqueueFounderNote,
  promoteFounderNote,
  dismissFounderNote,
  FOUNDER_INITIAL_CONFIDENCE,
} from '@/lib/founder/queue-actions'
import type { CuratorCorpusInput } from '@/lib/curator/corpus-actions'

const SHOP = '00000000-0000-0000-0000-000000000001'
const FOUNDER_PROFILE = '00000000-0000-0000-0000-000000000010'
const FOUNDER_USER = '00000000-0000-0000-0000-000000000011'

const SAMPLE_INPUT: CuratorCorpusInput = {
  vehicleYear: 2016,
  vehicleMake: 'Ford',
  vehicleModel: 'F-150',
  vehicleEngine: '5.0L V8',
  symptomTags: ['misfire'],
  dtcs: ['P0316'],
  summary: '2014-2018 5.0L F-150 cold-start misfire — cam phasers',
  freezeFramePattern: {},
  rootCause: 'Cam phasers worn',
  actionType: 'part_replacement',
  partInfo: { name: 'cam phasers' },
  verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
}

describe('founder queue actions', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Founder Shop' })
    await db.insert(profiles).values({
      id: FOUNDER_PROFILE,
      userId: FOUNDER_USER,
      shopId: SHOP,
      role: 'owner',
    })
  })
  afterEach(async () => {
    await close()
  })

  it('enqueueFounderNote stores raw text + structured draft + parse status', async () => {
    const enq = await enqueueFounderNote(db, {
      rawText: 'cam phasers, 5.0 F-150',
      createdByUserId: FOUNDER_PROFILE,
      structureResult: {
        status: 'partial',
        draft: { vehicleMake: 'Ford', vehicleModel: 'F-150' },
        missingFields: ['vehicleYear', 'vehicleEngine', 'rootCause'],
        llmNotes: 'Year missing.',
      },
    })
    const [row] = await db
      .select()
      .from(founderNotesQueue)
      .where(eq(founderNotesQueue.id, enq.id))
    expect(row.rawText).toBe('cam phasers, 5.0 F-150')
    expect(row.parseStatus).toBe('partial')
    expect(row.missingFields).toContain('vehicleYear')
    expect(row.structuredDraft).toMatchObject({ vehicleMake: 'Ford' })
    expect(row.reviewedAt).toBeNull()
  })

  it('promoteFounderNote inserts corpus entry with entry_source=founder and confidence 0.95', async () => {
    const enq = await enqueueFounderNote(db, {
      rawText: 'note',
      createdByUserId: FOUNDER_PROFILE,
      structureResult: {
        status: 'parsed',
        draft: SAMPLE_INPUT,
        missingFields: [],
      },
    })
    const result = await promoteFounderNote(db, enq.id, FOUNDER_PROFILE, SAMPLE_INPUT)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return

    const [entry] = await db
      .select()
      .from(corpusEntries)
      .where(eq(corpusEntries.id, result.corpusEntryId))
    expect(entry.entrySource).toBe('founder')
    expect(entry.confidenceScore).toBeCloseTo(FOUNDER_INITIAL_CONFIDENCE, 5)
    expect(entry.curatedByUserId).toBe(FOUNDER_PROFILE)
    expect(entry.isCuratorEntry).toBe(true)

    const [queueRow] = await db
      .select()
      .from(founderNotesQueue)
      .where(eq(founderNotesQueue.id, enq.id))
    expect(queueRow.reviewedDecision).toBe('promoted')
    expect(queueRow.resultingCorpusEntryId).toBe(result.corpusEntryId)
    expect(queueRow.reviewedAt).not.toBeNull()
  })

  it('promoteFounderNote refuses to act on an already-reviewed row', async () => {
    const enq = await enqueueFounderNote(db, {
      rawText: 'note',
      createdByUserId: FOUNDER_PROFILE,
      structureResult: { status: 'parsed', draft: SAMPLE_INPUT, missingFields: [] },
    })
    const first = await promoteFounderNote(db, enq.id, FOUNDER_PROFILE, SAMPLE_INPUT)
    expect(first.kind).toBe('ok')
    const second = await promoteFounderNote(db, enq.id, FOUNDER_PROFILE, SAMPLE_INPUT)
    expect(second.kind).toBe('already_reviewed')
  })

  it('promoteFounderNote returns not_found for an unknown id', async () => {
    const result = await promoteFounderNote(
      db,
      '00000000-0000-0000-0000-000000000999',
      FOUNDER_PROFILE,
      SAMPLE_INPUT,
    )
    expect(result.kind).toBe('not_found')
  })

  it('dismissFounderNote marks the row dismissed and stores the note', async () => {
    const enq = await enqueueFounderNote(db, {
      rawText: 'unclear note',
      createdByUserId: FOUNDER_PROFILE,
      structureResult: { status: 'failed', draft: {}, missingFields: [] },
    })
    await dismissFounderNote(db, enq.id, FOUNDER_PROFILE, 'duplicate of last week')
    const [row] = await db
      .select()
      .from(founderNotesQueue)
      .where(eq(founderNotesQueue.id, enq.id))
    expect(row.reviewedDecision).toBe('dismissed')
    expect(row.reviewedNote).toBe('duplicate of last week')
    expect(row.resultingCorpusEntryId).toBeNull()
  })
})
