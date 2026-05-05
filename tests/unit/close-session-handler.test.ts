import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
} from '@/lib/db/queries'
import { sessions, sessionEvents, artifacts } from '@/lib/db/schema'
import { closeSessionForUser } from '@/lib/sessions'

function makeOutcome(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    rootCause:
      'Wastegate vacuum line cracked at actuator-can end on driver-side turbo, F-150 3.5L EcoBoost',
    actionType: 'part_replacement',
    partInfo: { name: 'Vacuum line, silicone 4mm', oemNumber: 'BL3Z-9C915-A', cost: 12.5 },
    verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
    diagMinutes: 25,
    repairMinutes: 18,
    notes: 'Confirmed with smoke test',
    ...overrides,
  }
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
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'loss of power',
    },
    treeState: {
      nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
      currentNodeId: 'root',
      message: 'go',
    },
  })
  return { shop, tech, session }
}

describe('closeSessionForUser', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns 422 with feedback when validator rejects vague root cause', async () => {
    const { tech, session } = await seedOpenSession(db)
    const validate = vi.fn().mockResolvedValueOnce({
      ok: false,
      feedback: 'Where exactly was the crack?',
    })
    const result = await closeSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: makeOutcome({ rootCause: 'wire was bad and we fixed it' }),
      validateSpecificity: validate,
    })
    expect(result.ok).toBe(false)
    if (result.ok || result.status !== 422) throw new Error('expected 422')
    expect(result.error).toBe('specificity_required')
    expect(result.feedback).toMatch(/where/i)

    // session must NOT be closed
    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id))
    expect(row.status).toBe('open')
    expect(row.outcome).toBeNull()
  })

  it('closes the session and writes a close event when validator accepts', async () => {
    const { tech, session } = await seedOpenSession(db)
    const validate = vi.fn().mockResolvedValueOnce({ ok: true })
    const result = await closeSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: makeOutcome(),
      validateSpecificity: validate,
    })
    expect(result.ok).toBe(true)

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id))
    expect(row.status).toBe('closed')
    expect(row.outcome?.partInfo?.oemNumber).toBe('BL3Z-9C915-A')
    expect(row.closedAt).not.toBeNull()

    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('close')
    expect(events[0].nodeId).toBe('root')
  })

  it('returns 400 when payload fails zod parse', async () => {
    const { tech, session } = await seedOpenSession(db)
    const validate = vi.fn()
    const result = await closeSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { rootCause: 'too short', actionType: 'unknown' },
      validateSpecificity: validate,
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.status).toBe(400)
    expect(validate).not.toHaveBeenCalled()
  })

  it('returns 404 when the session belongs to another tech', async () => {
    const { session } = await seedOpenSession(db)
    const otherProfile = await createProfile(db, { userId: crypto.randomUUID() })
    const result = await closeSessionForUser({
      db,
      userId: otherProfile.userId,
      sessionId: session.id,
      body: makeOutcome(),
      validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.status).toBe(404)
  })

  it('returns 400 when the session is already closed', async () => {
    const shop = await createShop(db, { name: 'Test Shop' })
    const tech = await createProfile(db, {
      userId: crypto.randomUUID(),
      shopId: shop.id,
    })
    const session = await createSession(db, {
      shopId: shop.id,
      techId: tech.id,
      status: 'closed',
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'loss of power',
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
    })
    const result = await closeSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: makeOutcome(),
      validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/not open/i)
  })

  describe('corpus promotion (Phase K5)', () => {
    it('calls promoteToCorpus with sessionId, shopId, intake, outcome, and inferred symptom tags', async () => {
      const { tech, session } = await seedOpenSession(db)
      const promote = vi.fn().mockResolvedValue('corpus-new')
      const result = await closeSessionForUser({
        db,
        userId: tech.userId,
        sessionId: session.id,
        body: makeOutcome(),
        validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
        promoteToCorpus: promote,
      })
      expect(result.ok).toBe(true)
      expect(promote).toHaveBeenCalledTimes(1)
      const args = promote.mock.calls[0]!
      const input = args[1]
      expect(input.sessionId).toBe(session.id)
      expect(input.shopId).toBe(session.shopId)
      expect(input.intake.vehicleMake).toBe('Ford')
      expect(input.outcome.rootCause).toContain('Wastegate')
      expect(input.extractedSymptomTags).toContain('power_loss')
    })

    it('extracts DTC codes from done scan_screen artifacts and passes them as extractedDtcs', async () => {
      const { tech, session } = await seedOpenSession(db)
      await db.insert(artifacts).values({
        sessionId: session.id,
        nodeId: 'scan-codes',
        kind: 'scan_screen',
        storageKey: 'k1',
        mimeType: 'image/png',
        bytes: 1000,
        extractionStatus: 'done',
        extraction: {
          structured: { dtcs: [{ code: 'P0299' }, { code: 'P0236' }] },
        },
      })
      const promote = vi.fn().mockResolvedValue('c1')
      await closeSessionForUser({
        db,
        userId: tech.userId,
        sessionId: session.id,
        body: makeOutcome(),
        validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
        promoteToCorpus: promote,
      })
      const input = promote.mock.calls[0]![1]
      expect(input.extractedDtcs).toContain('P0299')
      expect(input.extractedDtcs).toContain('P0236')
    })

    it('treats promoteToCorpus failure as non-fatal — session still closes', async () => {
      const { tech, session } = await seedOpenSession(db)
      const promote = vi.fn().mockRejectedValue(new Error('embed boom'))
      const result = await closeSessionForUser({
        db,
        userId: tech.userId,
        sessionId: session.id,
        body: makeOutcome(),
        validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
        promoteToCorpus: promote,
      })
      expect(result.ok).toBe(true)
      expect(promote).toHaveBeenCalledTimes(1)
      const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id))
      expect(row.status).toBe('closed')
    })

    it('does not call corpus promotion when promoteToCorpus is not provided (back-compat)', async () => {
      const { tech, session } = await seedOpenSession(db)
      const result = await closeSessionForUser({
        db,
        userId: tech.userId,
        sessionId: session.id,
        body: makeOutcome(),
        validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
      })
      expect(result.ok).toBe(true)
    })
  })

  describe('comeback follow-up scheduling (Phase R2)', () => {
    it('calls scheduleFollowUps with sessionId, shopId, techId after close', async () => {
      const { shop, tech, session } = await seedOpenSession(db)
      const schedule = vi.fn().mockResolvedValue(['fu-7d', 'fu-30d'])
      const result = await closeSessionForUser({
        db,
        userId: tech.userId,
        sessionId: session.id,
        body: makeOutcome(),
        validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
        scheduleFollowUps: schedule,
      })
      expect(result.ok).toBe(true)
      expect(schedule).toHaveBeenCalledTimes(1)
      const [dbArg, input] = schedule.mock.calls[0]!
      expect(dbArg).toBe(db)
      expect(input).toEqual({
        sessionId: session.id,
        shopId: shop.id,
        techId: tech.id,
      })
    })

    it('treats scheduleFollowUps failure as non-fatal — session still closes', async () => {
      const { tech, session } = await seedOpenSession(db)
      const schedule = vi.fn().mockRejectedValue(new Error('insert boom'))
      const result = await closeSessionForUser({
        db,
        userId: tech.userId,
        sessionId: session.id,
        body: makeOutcome(),
        validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
        scheduleFollowUps: schedule,
      })
      expect(result.ok).toBe(true)
      expect(schedule).toHaveBeenCalledTimes(1)
      const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id))
      expect(row.status).toBe('closed')
    })

    it('does not call scheduleFollowUps when not provided (back-compat)', async () => {
      const { tech, session } = await seedOpenSession(db)
      const result = await closeSessionForUser({
        db,
        userId: tech.userId,
        sessionId: session.id,
        body: makeOutcome(),
        validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
      })
      expect(result.ok).toBe(true)
    })
  })
})
