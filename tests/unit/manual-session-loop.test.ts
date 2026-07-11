import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { ensureProfileAndShop } from '@/lib/db/queries'
import { createSessionForUser, closeSessionForUser } from '@/lib/sessions'
import { promoteSessionToCorpus } from '@/lib/corpus/promotion'
import { corpusEntries, profiles, ticketJobs } from '@/lib/db/schema'
import type { TreeState } from '@/lib/ai/tree-engine'

// Voyage voyage-3 emits 1024-dim vectors; corpus_entries.embedding is vector(1024).
const embedMock = vi.fn().mockResolvedValue(Array(1024).fill(0.1))
vi.mock('@/lib/ai/embeddings', () => ({
  embed: (...args: unknown[]) => embedMock(...args),
}))

const stubTree: TreeState = {
  nodes: [{ id: 'root', label: 'Pull DTCs', status: 'active' }],
  currentNodeId: 'root',
  message: 'starting',
}

describe('legacy ticketless manual session loop', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    embedMock.mockClear()
  })

  afterEach(async () => {
    await close()
  })

  it('preserves legacy close → corpus behavior without Shop OS authorization', async () => {
    // ─── Step A: Brandon taps "New diagnosis" and fills intake ─────────────
    const userId = crypto.randomUUID()
    const profile = await ensureProfileAndShop(db, userId, 'brandon@vyntechs.test')
    await db.update(profiles).set({ skillTier: 2 }).where(eq(profiles.id, profile.id))

    const created = await createSessionForUser({
      db,
      userId,
      body: {
        requestKey: crypto.randomUUID(),
        vehicleYear: 2013,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        vehicleEngine: '3.5L EcoBoost',
        customerComplaint: 'loss of power going up hills',
      },
      treeState: stubTree,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error('intake create failed')
    const sessionId = created.id

    // Row 12 now wraps every new session. Clear only the outward job link to
    // model a pre-Shop-OS ticketless session and pin its unchanged close path.
    await db.update(ticketJobs).set({ sessionId: null }).where(eq(ticketJobs.sessionId, sessionId))

    // ─── Step B: Brandon taps "Close case" and submits outcome ────────────
    // Skipping the AI tree advance — irrelevant for proving the close loop.
    // The whole point of the manual Close case button is that you don't
    // need treeState.done to close.
    const closeResult = await closeSessionForUser({
      db,
      userId,
      sessionId,
      body: {
        rootCause:
          'Wastegate vacuum line cracked at actuator-can end on driver-side turbo',
        actionType: 'part_replacement',
        partInfo: {
          name: 'Vacuum line, silicone 4mm',
          oemNumber: 'BL3Z-9C915-A',
          cost: 12.5,
        },
        verification: {
          codesCleared: true,
          testDrive: true,
          symptomsResolved: 'yes',
        },
        diagMinutes: 25,
        repairMinutes: 18,
        notes: 'Confirmed with smoke test',
      },
      validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
      promoteToCorpus: promoteSessionToCorpus,
    })
    expect(closeResult.ok).toBe(true)

    // ─── Step C: Verify the brain learned ─────────────────────────────────
    const rows = await db
      .select()
      .from(corpusEntries)
      .where(eq(corpusEntries.sourceSessionId, sessionId))

    expect(rows).toHaveLength(1)
    expect(rows[0].rootCause).toContain('Wastegate')
    expect(rows[0].actionType).toBe('part_replacement')
    expect(rows[0].vehicleMake).toBe('Ford')
    expect(rows[0].vehicleModel).toBe('F-150')
    expect(rows[0].sourceSessionId).toBe(sessionId)

    // Embed was called for the promotion vector.
    expect(embedMock).toHaveBeenCalled()
  })
})
