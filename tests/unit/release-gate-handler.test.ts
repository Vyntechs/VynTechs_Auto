import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  ensureProfileAndShop,
  createProfile,
  createSession,
  getSessionById,
} from '@/lib/db/queries'
import { releaseGateForUser } from '@/lib/sessions'
import { sessionEvents, sessions } from '@/lib/db/schema'
import type { TreeState } from '@/lib/ai/tree-engine'

const blockedTree: TreeState = {
  nodes: [{ id: 'n1', label: 'verify 12V at coil', status: 'active' }],
  currentNodeId: 'n1',
  message: 'measure 12V at the clutch coil connector',
  proposedAction: {
    description: 'back-probe the clutch coil for 12V',
    confidence: 0.7,
    confidenceGap: 'no electrical attestation yet',
  },
  gateDecision: {
    allow: false,
    riskClass: 'high',
    threshold: 0.9,
    confidence: 0.7,
    rationale: 'back-probe of high-risk circuit',
    gap: 'Required confidence 90% for risk class "high"; current 70%.',
    options: ['gather_more_low_risk', 'defer'],
  },
}

const intake = {
  vehicleYear: 2008,
  vehicleMake: 'GMC',
  vehicleModel: 'Yukon',
  customerComplaint: 'AC not blowing cold',
}

describe('releaseGateForUser', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  async function seed(opts: { userId?: string } = {}) {
    const userId = opts.userId ?? crypto.randomUUID()
    const profile = await ensureProfileAndShop(db, userId, 'tech@shop.com')
    const session = await createSession(db, {
      shopId: profile.shopId!,
      techId: profile.id,
      intake,
      treeState: blockedTree,
    })
    return { userId, profile, session }
  }

  it('clears gateDecision on the session and returns ok', async () => {
    const { userId, session } = await seed()
    const result = await releaseGateForUser({
      db,
      userId,
      sessionId: session.id,
    })
    expect(result.ok).toBe(true)
    const fetched = await getSessionById(db, session.id)
    expect(fetched?.treeState.gateDecision).toBeUndefined()
    // Other tree state preserved.
    expect(fetched?.treeState.currentNodeId).toBe('n1')
    expect(fetched?.treeState.proposedAction?.description).toBe(
      'back-probe the clutch coil for 12V',
    )
  })

  it('appends a tree_update session_event recording the user-initiated release', async () => {
    const { userId, session } = await seed()
    await releaseGateForUser({ db, userId, sessionId: session.id })
    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('tree_update')
    expect(events[0].nodeId).toBe('n1')
  })

  it('returns 404 when the session belongs to a different tech', async () => {
    const { session } = await seed()
    const intruderId = crypto.randomUUID()
    await createProfile(db, { userId: intruderId })
    const result = await releaseGateForUser({
      db,
      userId: intruderId,
      sessionId: session.id,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns 400 when the session is not open', async () => {
    const { userId, session } = await seed()
    await db
      .update(sessions)
      .set({ status: 'closed' })
      .where(eq(sessions.id, session.id))
    const result = await releaseGateForUser({
      db,
      userId,
      sessionId: session.id,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('is idempotent — re-releasing an already-released gate is still ok', async () => {
    const { userId, session } = await seed()
    await releaseGateForUser({ db, userId, sessionId: session.id })
    const result = await releaseGateForUser({
      db,
      userId,
      sessionId: session.id,
    })
    expect(result.ok).toBe(true)
    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    // Two release events recorded — that's intentional, the second one
    // documents the second click, harmless.
    expect(events.length).toBeGreaterThanOrEqual(2)
  })
})
