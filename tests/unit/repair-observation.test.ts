import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
} from '@/lib/db/queries'
import { sessions, sessionEvents } from '@/lib/db/schema'
import { submitRepairObservationForUser } from '@/lib/sessions'

async function seedRepairingSession(db: TestDb) {
  const shop = await createShop(db, { name: 'Test Shop' })
  const tech = await createProfile(db, {
    userId: crypto.randomUUID(),
    shopId: shop.id,
    skillTier: 3,
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
      message: 'Brake fluid in booster.',
      done: true,
      phase: 'repairing',
      diagnosisLockedAt: '2026-05-07T10:21:12Z',
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

describe('submitRepairObservationForUser', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('happy path: appends observation event, calls AI, appends guidance event, returns guidance', async () => {
    const { tech, session } = await seedRepairingSession(db)
    const getGuidance = vi.fn().mockResolvedValueOnce({
      text: 'Yes, replace those bolts. Corrosion suggests prior moisture exposure.',
      tangentialConcerns: ['Inspect proportioning valve while you have the system open'],
    })

    const result = await submitRepairObservationForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { observation: 'Master cyl bolts are corroded — should I replace?' },
      getGuidance,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.guidance.text).toMatch(/replace those bolts/i)
    expect(result.guidance.tangentialConcerns).toContain(
      'Inspect proportioning valve while you have the system open',
    )

    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    const obs = events.filter(e => e.eventType === 'repair_observation')
    const guid = events.filter(e => e.eventType === 'repair_guidance')
    expect(obs).toHaveLength(1)
    expect(obs[0].observationText).toBe('Master cyl bolts are corroded — should I replace?')
    expect(guid).toHaveLength(1)
    expect(
      (guid[0].aiResponse as { repairGuidance?: { text: string } } | null)?.repairGuidance?.text,
    ).toMatch(/replace those bolts/i)

    expect(getGuidance).toHaveBeenCalledTimes(1)
  })

  it('AI failure: observation persisted, guidance NOT persisted, returns 502', async () => {
    const { tech, session } = await seedRepairingSession(db)
    const getGuidance = vi.fn().mockRejectedValueOnce(new Error('Anthropic timed out'))

    const result = await submitRepairObservationForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { observation: 'will the AI fail?' },
      getGuidance,
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result).toEqual({
      ok: false,
      status: 502,
      error: 'repair_guidance_unavailable',
    })

    const events = await db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, session.id))
    expect(events.filter(e => e.eventType === 'repair_observation')).toHaveLength(1)
    expect(events.filter(e => e.eventType === 'repair_guidance')).toHaveLength(0)
  })

  it('rejects when phase is not repairing', async () => {
    const { tech, session } = await seedRepairingSession(db)
    await db
      .update(sessions)
      .set({
        treeState: {
          ...session.treeState,
          phase: 'diagnosing' as const,
          diagnosisLockedAt: undefined,
        },
      })
      .where(eq(sessions.id, session.id))

    const result = await submitRepairObservationForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { observation: 'q' },
      getGuidance: vi.fn(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/repair phase/i)
  })

  it('rejects empty observation', async () => {
    const { tech, session } = await seedRepairingSession(db)

    const result = await submitRepairObservationForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { observation: '' },
      getGuidance: vi.fn(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
  })

  it('rejects observation longer than 2000 chars', async () => {
    const { tech, session } = await seedRepairingSession(db)
    const longText = 'x'.repeat(2001)

    const result = await submitRepairObservationForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { observation: longText },
      getGuidance: vi.fn(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
  })

  it('rejects non-owning tech (404)', async () => {
    const { session } = await seedRepairingSession(db)
    const otherShop = await createShop(db, { name: 'Other' })
    const otherTech = await createProfile(db, {
      userId: crypto.randomUUID(),
      shopId: otherShop.id,
    })

    const result = await submitRepairObservationForUser({
      db,
      userId: otherTech.userId,
      sessionId: session.id,
      body: { observation: 'q' },
      getGuidance: vi.fn(),
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(404)
  })
})
