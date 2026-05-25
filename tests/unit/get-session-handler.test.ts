import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  ensureProfileAndShop,
  createProfile,
  createSession,
} from '@/lib/db/queries'
import { getSessionForUser } from '@/lib/sessions'
import type { TreeState } from '@/lib/ai/tree-engine'

const stubTree: TreeState = {
  nodes: [{ id: 'root', label: 'Initial scan', status: 'pending' }],
  currentNodeId: 'root',
  message: 'starting',
}

const intake = {
  vehicleYear: 2018,
  vehicleMake: 'Ford',
  vehicleModel: 'F-150',
  customerComplaint: 'loss of power going up hills',
}

describe('getSessionForUser', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns the session when the caller owns it', async () => {
    const userId = crypto.randomUUID()
    const profile = await ensureProfileAndShop(db, userId, 'mike@joesgarage.com')
    const session = await createSession(db, {
      shopId: profile.shopId!,
      techId: profile.id,
      intake,
      treeState: stubTree,
    })
    const result = await getSessionForUser({ db, userId, sessionId: session.id })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.session.id).toBe(session.id)
      expect(result.session.intake.vehicleMake).toBe('Ford')
    }
  })

  it('returns 400 when the userId has no profile', async () => {
    const userId = crypto.randomUUID()
    const result = await getSessionForUser({
      db,
      userId,
      sessionId: crypto.randomUUID(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe('no profile')
    }
  })

  it('returns 404 when the session is owned by a different tech', async () => {
    const ownerId = crypto.randomUUID()
    const intruderId = crypto.randomUUID()
    const owner = await ensureProfileAndShop(db, ownerId, 'mike@joesgarage.com')
    await createProfile(db, { userId: intruderId })
    const session = await createSession(db, {
      shopId: owner.shopId!,
      techId: owner.id,
      intake,
      treeState: stubTree,
    })
    const result = await getSessionForUser({
      db,
      userId: intruderId,
      sessionId: session.id,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  it('returns 404 for an unknown session id', async () => {
    const userId = crypto.randomUUID()
    await ensureProfileAndShop(db, userId, 'mike@joesgarage.com')
    const result = await getSessionForUser({
      db,
      userId,
      sessionId: crypto.randomUUID(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })

  // Without the UUID guard the DB rejects malformed input with "invalid input
  // syntax for type uuid" which Next.js surfaces as a 500. The guard turns it
  // into a clean 404 so a typo in a URL doesn't crash the page.
  it.each([
    'not-a-uuid',
    '681de115-5de9-474e-9721-2%20%20%2063f65066e08',
    '   ',
    '',
  ])('returns 404 (not throws) for malformed session id: %s', async (badId) => {
    const userId = crypto.randomUUID()
    await ensureProfileAndShop(db, userId, 'mike@joesgarage.com')
    const result = await getSessionForUser({ db, userId, sessionId: badId })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(404)
  })
})
