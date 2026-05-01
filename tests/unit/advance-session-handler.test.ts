import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  ensureProfileAndShop,
  createProfile,
  createSession,
  getSessionById,
  appendSessionEvent,
} from '@/lib/db/queries'
import { advanceSession } from '@/lib/sessions'
import type { TreeState } from '@/lib/ai/tree-engine'
import { sessionEvents } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const initialTree: TreeState = {
  nodes: [{ id: 'scan-codes', label: 'Pull DTCs', status: 'active' }],
  currentNodeId: 'scan-codes',
  message: 'pull codes',
}

const updatedTree: TreeState = {
  nodes: [
    { id: 'scan-codes', label: 'Pull DTCs', status: 'resolved' },
    { id: 'inspect-cac', label: 'Inspect CAC pipe', status: 'active' },
  ],
  currentNodeId: 'inspect-cac',
  message: 'inspect cac',
}

const intake = {
  vehicleYear: 2018,
  vehicleMake: 'Ford',
  vehicleModel: 'F-150',
  customerComplaint: 'loss of power going up hills',
}

describe('advanceSession', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  async function seedSession(opts: { userId: string; status?: 'open' | 'closed' | 'declined' | 'deferred' } = { userId: crypto.randomUUID() }) {
    const profile = await ensureProfileAndShop(db, opts.userId, 'mike@joesgarage.com')
    const session = await createSession(db, {
      shopId: profile.shopId!,
      techId: profile.id,
      intake,
      treeState: initialTree,
      status: opts.status ?? 'open',
    })
    return { profile, session }
  }

  it('returns the updated tree on a valid observation', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })
    const updateTree = vi.fn().mockResolvedValue(updatedTree)
    const result = await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'Got P0299 with 3.6 psi underboost' },
      updateTree,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.tree.currentNodeId).toBe('inspect-cac')
  })

  it('persists the new tree_state on the session row', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })
    const updateTree = vi.fn().mockResolvedValue(updatedTree)
    await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'observed' },
      updateTree,
    })
    const fetched = await getSessionById(db, session.id)
    expect(fetched?.treeState.currentNodeId).toBe('inspect-cac')
  })

  it('appends an observation event with the previous nodeId and the observation text', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })
    const updateTree = vi.fn().mockResolvedValue(updatedTree)
    await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'Got P0299' },
      updateTree,
    })
    const events = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, session.id))
    expect(events).toHaveLength(1)
    expect(events[0].nodeId).toBe('scan-codes')
    expect(events[0].eventType).toBe('observation')
    expect(events[0].observationText).toBe('Got P0299')
  })

  it('returns 401 when the userId has no profile', async () => {
    const userId = crypto.randomUUID()
    const otherUser = crypto.randomUUID()
    const { session } = await seedSession({ userId })
    const result = await advanceSession({
      db,
      userId: otherUser,
      sessionId: session.id,
      body: { observation: 'x' },
      updateTree: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('returns 404 when the session does not belong to the caller', async () => {
    const ownerId = crypto.randomUUID()
    const intruderId = crypto.randomUUID()
    const { session } = await seedSession({ userId: ownerId })
    await createProfile(db, { userId: intruderId })
    const result = await advanceSession({
      db,
      userId: intruderId,
      sessionId: session.id,
      body: { observation: 'x' },
      updateTree: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns 404 for an unknown session id', async () => {
    const userId = crypto.randomUUID()
    await ensureProfileAndShop(db, userId, 'mike@joesgarage.com')
    const result = await advanceSession({
      db,
      userId,
      sessionId: crypto.randomUUID(),
      body: { observation: 'x' },
      updateTree: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns 400 when the session is not open', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId, status: 'closed' })
    const result = await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'x' },
      updateTree: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe('session is not open')
    }
  })

  it('returns 400 when the observation body fails validation', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })
    const result = await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: '' },
      updateTree: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('returns 500 when updateTree throws', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })
    const updateTree = vi.fn().mockRejectedValue(new Error('llm down'))
    const result = await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'x' },
      updateTree,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(500)
      expect(result.error).toBe('tree update failed')
    }
  })
})
