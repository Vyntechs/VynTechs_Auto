import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
} from '@/lib/db/queries'
import { sessions, sessionEvents } from '@/lib/db/schema'
import { lockDiagnosisForUser } from '@/lib/sessions'

async function seedDoneSession(db: TestDb) {
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
      customerComplaint: 'P0171/P0174',
    },
    treeState: {
      nodes: [{ id: 'replace', label: 'Replace booster + master cyl', status: 'active' }],
      currentNodeId: 'replace',
      message: 'Brake fluid in booster — replace both.',
      done: true,
      rootCauseSummary: 'Brake booster crimp seam vacuum leak.',
      proposedAction: {
        confidence: 0.98,
        description: 'Replace booster + master cyl as a matched pair.',
        expectedSignal: 'Firm pedal; trims within ±5%.',
      },
    },
  })
  return { shop, tech, session }
}

describe('lockDiagnosisForUser', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('flips phase to repairing + sets diagnosisLockedAt + appends tree_update event when done=true', async () => {
    const { tech, session } = await seedDoneSession(db)

    const before = Date.now()
    const result = await lockDiagnosisForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
    })
    const after = Date.now()

    expect(result.ok).toBe(true)

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id))
    expect(row.treeState.phase).toBe('repairing')
    expect(row.treeState.diagnosisLockedAt).toBeTruthy()
    const lockedAt = new Date(row.treeState.diagnosisLockedAt!).getTime()
    expect(lockedAt).toBeGreaterThanOrEqual(before)
    expect(lockedAt).toBeLessThanOrEqual(after)
    expect(row.treeState.rootCauseSummary).toBe('Brake booster crimp seam vacuum leak.')

    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    const treeUpdates = events.filter(e => e.eventType === 'tree_update')
    expect(treeUpdates).toHaveLength(1)
  })

  it('rejects when treeState.done is false (cannot lock incomplete diagnosis)', async () => {
    const { tech, session } = await seedDoneSession(db)
    await db
      .update(sessions)
      .set({
        treeState: { ...session.treeState, done: false },
      })
      .where(eq(sessions.id, session.id))

    const result = await lockDiagnosisForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/not done/i)
  })

  it('rejects when phase is already repairing (already locked)', async () => {
    const { tech, session } = await seedDoneSession(db)
    await db
      .update(sessions)
      .set({
        treeState: {
          ...session.treeState,
          phase: 'repairing',
          diagnosisLockedAt: new Date().toISOString(),
        },
      })
      .where(eq(sessions.id, session.id))

    const result = await lockDiagnosisForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/already locked/i)
  })

  it('rejects when status is not open', async () => {
    const { tech, session } = await seedDoneSession(db)
    await db
      .update(sessions)
      .set({ status: 'closed' })
      .where(eq(sessions.id, session.id))

    const result = await lockDiagnosisForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/not open/i)
  })

  it('rejects non-owning tech (404)', async () => {
    const { session } = await seedDoneSession(db)
    const otherShop = await createShop(db, { name: 'Other' })
    const otherTech = await createProfile(db, {
      userId: crypto.randomUUID(),
      shopId: otherShop.id,
    })

    const result = await lockDiagnosisForUser({
      db,
      userId: otherTech.userId,
      sessionId: session.id,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(404)
  })
})
