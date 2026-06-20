import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
  setSessionTerminalStatus,
} from '@/lib/db/queries'
import { sessions, sessionEvents } from '@/lib/db/schema'
import { lockDiagnosisFromWizard } from '@/lib/sessions'
import type { Finding } from '@/lib/flows/types'

const FLOW_VERSION_ID = '00000000-0000-0000-0000-0000000000bb'

const finding: Finding = {
  verdict: 'HPO leak',
  action: 'Air test',
  expectedSignal: 'audible leak',
  severity: 'fixable',
}

async function seedOpenSession(db: TestDb) {
  const shop = await createShop(db, { name: 'Test Shop' })
  const tech = await createProfile(db, {
    userId: crypto.randomUUID(),
    shopId: shop.id,
  })
  const session = await createSession(db, {
    shopId: shop.id,
    techId: tech.id,
    intake: {
      vehicleYear: 2009,
      vehicleMake: 'ram',
      vehicleModel: '1500',
      customerComplaint: 'cranks no start',
    },
    treeState: {
      phase: 'diagnosing',
      done: false,
      nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
      currentNodeId: 'root',
      message: 'go',
    },
  })
  return { shop, tech, session }
}

describe('lockDiagnosisFromWizard', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('merges the finding onto the existing treeState and writes one lock-in event', async () => {
    const { tech, session } = await seedOpenSession(db)

    const result = await lockDiagnosisFromWizard({
      db,
      userId: tech.userId,
      sessionId: session.id,
      finding,
      history: [],
      flowVersionId: FLOW_VERSION_ID,
    })

    expect(result.ok).toBe(true)

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id))
    expect(row.treeState.phase).toBe('repairing')
    expect(row.treeState.rootCauseSummary).toBe('HPO leak')
    expect(row.treeState.proposedAction?.description).toBe('Air test')
    expect(row.treeState.proposedAction?.confidence).toBe(1)
    expect(row.treeState.diagnosisLockedAt).toBeTruthy()
    // The real treeState is PRESERVED, not fabricated (#98): node + currentNodeId
    // survive the merge so RepairPhaseView renders a real tree.
    expect(row.treeState.currentNodeId).toBe('root')
    expect(row.treeState.nodes).toHaveLength(1)
    expect(row.wizardState).toBeNull()

    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    const lockEvents = events.filter((e) => e.eventType === 'wizard_lock_in')
    expect(lockEvents).toHaveLength(1)
    expect(lockEvents[0].nodeId).toBe('root')
    expect(lockEvents[0].observationText).toBe('HPO leak')
    expect(lockEvents[0].aiResponse?.wizardLockIn?.flowVersionId).toBe(FLOW_VERSION_ID)
  })

  it('is idempotent: a second lock-in is rejected and writes no duplicate event', async () => {
    const { tech, session } = await seedOpenSession(db)

    await lockDiagnosisFromWizard({
      db,
      userId: tech.userId,
      sessionId: session.id,
      finding,
      history: [],
      flowVersionId: FLOW_VERSION_ID,
    })

    const result = await lockDiagnosisFromWizard({
      db,
      userId: tech.userId,
      sessionId: session.id,
      finding,
      history: [],
      flowVersionId: FLOW_VERSION_ID,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
    expect(result.error).toBe('diagnosis already locked')

    // A double lock-in would double-count first-time-fix metrics in PR-N5.
    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    const lockEvents = events.filter((e) => e.eventType === 'wizard_lock_in')
    expect(lockEvents).toHaveLength(1)
  })

  it('returns 404 when the caller is not the owning tech', async () => {
    const { session } = await seedOpenSession(db)
    const otherShop = await createShop(db, { name: 'Other' })
    const otherTech = await createProfile(db, {
      userId: crypto.randomUUID(),
      shopId: otherShop.id,
    })

    const result = await lockDiagnosisFromWizard({
      db,
      userId: otherTech.userId,
      sessionId: session.id,
      finding,
      history: [],
      flowVersionId: FLOW_VERSION_ID,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(404)
    expect(result.error).toBe('not found')

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id))
    expect(row.treeState.phase).toBe('diagnosing')
    expect(row.status).toBe('open')
  })

  it('returns 400 when the session is not open', async () => {
    const { tech, session } = await seedOpenSession(db)
    await setSessionTerminalStatus(db, session.id, 'deferred')

    const result = await lockDiagnosisFromWizard({
      db,
      userId: tech.userId,
      sessionId: session.id,
      finding,
      history: [],
      flowVersionId: FLOW_VERSION_ID,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
    expect(result.error).toBe('session is not open')
  })
})
