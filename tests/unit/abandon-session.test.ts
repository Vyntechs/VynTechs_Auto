import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
} from '@/lib/db/queries'
import { sessions, sessionEvents } from '@/lib/db/schema'
import { abandonSessionForUser } from '@/lib/sessions'

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
      customerComplaint: 'check engine light',
    },
    treeState: {
      nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
      currentNodeId: 'root',
      message: 'go',
    },
  })
  return { shop, tech, session }
}

describe('abandonSessionForUser', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('marks session deferred with a close event when called by the owning tech', async () => {
    const { tech, session } = await seedOpenSession(db)

    const result = await abandonSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { reason: 'mistake' },
    })

    expect(result.ok).toBe(true)

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id))
    expect(row.status).toBe('deferred')
    expect(row.closedAt).not.toBeNull()
    expect(row.outcome).toBeNull()

    const events = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, session.id))
    const closeEvents = events.filter(e => e.eventType === 'close')
    expect(closeEvents).toHaveLength(1)
    expect(closeEvents[0].aiResponse).toEqual({
      abandon: { reason: 'mistake' },
    })
  })

  it('accepts an empty body and defaults reason to mistake', async () => {
    const { tech, session } = await seedOpenSession(db)

    const result = await abandonSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: {},
    })

    expect(result.ok).toBe(true)

    const events = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, session.id))
    const closeEvents = events.filter(e => e.eventType === 'close')
    expect(closeEvents[0].aiResponse).toEqual({
      abandon: { reason: 'mistake' },
    })
  })

  it('preserves the optional note when provided', async () => {
    const { tech, session } = await seedOpenSession(db)

    const result = await abandonSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { reason: 'wrong_vehicle', note: 'Wrong VIN entered' },
    })

    expect(result.ok).toBe(true)

    const events = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, session.id))
    const closeEvents = events.filter(e => e.eventType === 'close')
    expect(closeEvents[0].aiResponse).toEqual({
      abandon: { reason: 'wrong_vehicle', note: 'Wrong VIN entered' },
    })
  })

  it('rejects when the caller is not the owning tech', async () => {
    const { session } = await seedOpenSession(db)
    const otherShop = await createShop(db, { name: 'Other' })
    const otherTech = await createProfile(db, {
      userId: crypto.randomUUID(),
      shopId: otherShop.id,
    })

    const result = await abandonSessionForUser({
      db,
      userId: otherTech.userId,
      sessionId: session.id,
      body: {},
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(404)

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id))
    expect(row.status).toBe('open')
  })

  it('rejects when the session is already closed', async () => {
    const { tech, session } = await seedOpenSession(db)

    await abandonSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: {},
    })

    const result = await abandonSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: {},
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)
    expect(result.error).toMatch(/not open/i)
  })

  it('rejects an invalid reason', async () => {
    const { tech, session } = await seedOpenSession(db)

    const result = await abandonSessionForUser({
      db,
      userId: tech.userId,
      sessionId: session.id,
      body: { reason: 'pizza' },
    })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected error')
    expect(result.status).toBe(400)

    const [row] = await db.select().from(sessions).where(eq(sessions.id, session.id))
    expect(row.status).toBe('open')
  })
})
