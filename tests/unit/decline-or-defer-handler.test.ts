import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile, createSession } from '@/lib/db/queries'
import { sessions, sessionEvents } from '@/lib/db/schema'
import { declineOrDeferSessionForUser } from '@/lib/sessions'
import type { DeclineLanguage } from '@/lib/gating/decline-language'

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
      customerComplaint: 'loss of power under boost',
    },
    treeState: {
      nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
      currentNodeId: 'root',
      message: 'go',
    },
  })
  return { shop, tech, session }
}

const validBody = {
  reason: 'decline' as const,
  gap: 'Required confidence 95% for risk class "destructive"; current 80%.',
  riskClass: 'destructive' as const,
}

const fakeLanguage: DeclineLanguage = {
  customerMessage:
    "We've completed the diagnostic and recommend referring this to a specialty shop.",
  internalNote: 'Confidence below destructive-class gate after Rung-2 exhaustion.',
  recommendedReferral: 'transmission specialist',
}

describe('declineOrDeferSessionForUser', () => {
  let db: TestDb
  let close: () => Promise<void>
  let generateLanguage: ReturnType<typeof vi.fn<() => Promise<DeclineLanguage>>>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    generateLanguage = vi.fn(async () => fakeLanguage)
  })

  afterEach(async () => {
    await close()
  })

  it('declines an open session and returns generated language', async () => {
    const { tech, session } = await seedOpenSession(db)
    const result = await declineOrDeferSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: validBody,
      generateLanguage,
    })
    expect(result).toEqual({ ok: true, status: 'declined', language: fakeLanguage })
    const updated = await db.select().from(sessions).where(eq(sessions.id, session.id))
    expect(updated[0].status).toBe('declined')
    expect(updated[0].closedAt).toBeInstanceOf(Date)
  })

  it('defers an open session', async () => {
    const { tech, session } = await seedOpenSession(db)
    const result = await declineOrDeferSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { ...validBody, reason: 'defer' as const },
      generateLanguage,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.status).toBe('deferred')
    const updated = await db.select().from(sessions).where(eq(sessions.id, session.id))
    expect(updated[0].status).toBe('deferred')
  })

  it('appends a close event with the decline payload', async () => {
    const { tech, session } = await seedOpenSession(db)
    await declineOrDeferSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: validBody,
      generateLanguage,
    })
    const events = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, session.id))
    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe('close')
    expect(events[0].aiResponse?.declineOrDefer).toMatchObject({
      reason: 'decline',
      riskClass: 'destructive',
      language: fakeLanguage,
    })
  })

  it('returns 400 when body fails zod validation', async () => {
    const { tech, session } = await seedOpenSession(db)
    const result = await declineOrDeferSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { reason: 'decline', gap: 'x', riskClass: 'destructive' },
      generateLanguage,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
    expect(generateLanguage).not.toHaveBeenCalled()
  })

  it('returns 404 when session belongs to another tech', async () => {
    const { session } = await seedOpenSession(db)
    const otherUserId = crypto.randomUUID()
    await createProfile(db, { userId: otherUserId })
    const result = await declineOrDeferSessionForUser({
      db,
      userId: otherUserId,
      sessionId: session.id,
      body: validBody,
      generateLanguage,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns 400 when session is not open', async () => {
    const { tech, session } = await seedOpenSession(db)
    await db.update(sessions).set({ status: 'closed' }).where(eq(sessions.id, session.id))
    const result = await declineOrDeferSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: validBody,
      generateLanguage,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })
})
