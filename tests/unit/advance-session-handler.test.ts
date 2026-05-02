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
import type { Artifact } from '@/lib/db/schema'
import { sessionEvents, techAssistRequests } from '@/lib/db/schema'
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

  it('records a tech-assist request when the tree asks for a wiring_diagram (Rung 2)', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })
    const treeWithRung2: TreeState = {
      ...updatedTree,
      requestedArtifact: { kind: 'wiring_diagram', prompt: 'Photograph the K-CAN bus diagram' },
    }
    await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'No diagram in the corpus' },
      updateTree: vi.fn().mockResolvedValue(treeWithRung2),
    })
    const rows = await db.select().from(techAssistRequests).where(eq(techAssistRequests.sessionId, session.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].requestedArtifactKind).toBe('wiring_diagram')
    expect(rows[0].followUpCount).toBe(0)
    expect(rows[0].nodeId).toBe('scan-codes')
  })

  it('does not record an audit row for Rung-1 artifacts (photo)', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })
    const treeWithRung1: TreeState = {
      ...updatedTree,
      requestedArtifact: { kind: 'photo', prompt: 'Photograph the cracked pipe' },
    }
    await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'I see a crack' },
      updateTree: vi.fn().mockResolvedValue(treeWithRung1),
    })
    const rows = await db.select().from(techAssistRequests).where(eq(techAssistRequests.sessionId, session.id))
    expect(rows).toHaveLength(0)
  })

  it('computes a gateDecision when the new tree carries a proposedAction', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })
    const treeWithAction: TreeState = {
      ...updatedTree,
      proposedAction: { description: 'back-probe CAN bus', confidence: 0.6 },
    }
    const gateAction = vi.fn().mockResolvedValue({
      allow: false,
      riskClass: 'high',
      threshold: 0.9,
      confidence: 0.6,
      rationale: 'back-probe of CAN bus',
      gap: 'Required confidence 90%; current 60%.',
      options: ['gather_more_low_risk', 'decline', 'defer'],
    })
    const result = await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'corpus is thin' },
      updateTree: vi.fn().mockResolvedValue(treeWithAction),
      gateAction,
    })
    expect(gateAction).toHaveBeenCalledTimes(1)
    expect(gateAction.mock.calls[0][0].vehicleFamily).toBe('ford-f-150')
    expect(gateAction.mock.calls[0][0].symptomClass).toBe('power_loss')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tree.gateDecision?.allow).toBe(false)
      expect(result.tree.gateDecision?.options).toEqual(['gather_more_low_risk', 'decline', 'defer'])
    }
  })

  it('does not compute gateDecision when no proposedAction is present', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })
    const gateAction = vi.fn()
    await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'x' },
      updateTree: vi.fn().mockResolvedValue(updatedTree),
      gateAction,
    })
    expect(gateAction).not.toHaveBeenCalled()
  })

  it('strips requestedArtifact and appends Rung-2 exhausted notice on the third follow-up', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })
    // Pre-seed an existing open Rung-2 request with 2 follow-ups
    await db.insert(techAssistRequests).values({
      sessionId: session.id,
      nodeId: 'scan-codes',
      gapDescription: 'previous gap',
      requestedArtifactKind: 'wiring_diagram',
      requestPrompt: 'previous request',
      followUpCount: 2,
    })
    const treeWithRung2: TreeState = {
      ...updatedTree,
      message: 'Need the diagram once more',
      requestedArtifact: { kind: 'wiring_diagram', prompt: 'Try again' },
    }
    const result = await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'tried but no luck' },
      updateTree: vi.fn().mockResolvedValue(treeWithRung2),
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.tree.requestedArtifact).toBeUndefined()
      expect(result.tree.message).toMatch(/Rung-2 budget exhausted/)
    }
    const rows = await db.select().from(techAssistRequests).where(eq(techAssistRequests.sessionId, session.id))
    expect(rows).toHaveLength(1)
    expect(rows[0].followUpCount).toBe(3)
  })

  it('fetches done artifacts for the current node and passes them to updateTree', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })

    // Stub artifact for current node with extraction done
    const fakeArtifact: Artifact = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      nodeId: 'scan-codes',
      kind: 'scan_screen',
      storageKey: 'test/key',
      mimeType: 'image/jpeg',
      bytes: 1024,
      durationMs: null,
      extraction: { summary: 'P0299 active', text: 'P0299 underboost', structured: { dtcs: ['P0299'] } },
      extractionStatus: 'done',
      storageTier: 'hot',
      createdAt: new Date(),
    }

    const updateTree = vi.fn().mockResolvedValue(updatedTree)
    await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'screen captured' },
      updateTree,
      listArtifacts: vi.fn().mockResolvedValue([fakeArtifact]),
    })

    expect(updateTree).toHaveBeenCalledTimes(1)
    const callArgs = updateTree.mock.calls[0][0]
    expect(callArgs.artifacts).toHaveLength(1)
    expect(callArgs.artifacts[0].kind).toBe('scan_screen')
    expect(callArgs.artifacts[0].summary).toBe('P0299 active')
    expect(callArgs.artifacts[0].text).toBe('P0299 underboost')
  })

  it('passes undefined artifacts to updateTree when no done artifacts exist for the current node', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })

    // Artifact for a different node — should be filtered out
    const otherNodeArtifact: Artifact = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      nodeId: 'other-node',
      kind: 'photo',
      storageKey: 'test/key2',
      mimeType: 'image/jpeg',
      bytes: 512,
      durationMs: null,
      extraction: { summary: 'cracked pipe' },
      extractionStatus: 'done',
      storageTier: 'hot',
      createdAt: new Date(),
    }

    const updateTree = vi.fn().mockResolvedValue(updatedTree)
    await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'x' },
      updateTree,
      listArtifacts: vi.fn().mockResolvedValue([otherNodeArtifact]),
    })

    const callArgs = updateTree.mock.calls[0][0]
    expect(callArgs.artifacts).toBeUndefined()
  })

  it('ignores artifacts with extractionStatus !== done', async () => {
    const userId = crypto.randomUUID()
    const { session } = await seedSession({ userId })

    const pendingArtifact: Artifact = {
      id: crypto.randomUUID(),
      sessionId: session.id,
      nodeId: 'scan-codes',
      kind: 'scan_screen',
      storageKey: 'test/key3',
      mimeType: 'image/jpeg',
      bytes: 512,
      durationMs: null,
      extraction: null,
      extractionStatus: 'pending',
      storageTier: 'hot',
      createdAt: new Date(),
    }

    const updateTree = vi.fn().mockResolvedValue(updatedTree)
    await advanceSession({
      db,
      userId,
      sessionId: session.id,
      body: { observation: 'x' },
      updateTree,
      listArtifacts: vi.fn().mockResolvedValue([pendingArtifact]),
    })

    const callArgs = updateTree.mock.calls[0][0]
    expect(callArgs.artifacts).toBeUndefined()
  })
})
