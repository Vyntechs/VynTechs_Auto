import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  ensureProfileAndShop,
  createProfile,
  createSession,
  getSessionById,
} from '@/lib/db/queries'
import { createSessionForUser } from '@/lib/sessions'
import type { TreeState } from '@/lib/ai/tree-engine'

const stubTree: TreeState = {
  nodes: [{ id: 'root', label: 'Initial scan', status: 'pending' }],
  currentNodeId: 'root',
  message: 'starting',
}

const validIntake = {
  vehicleYear: 2018,
  vehicleMake: 'Ford',
  vehicleModel: 'F-150',
  customerComplaint: 'loss of power going up hills',
}

describe('createSessionForUser', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('creates a session and returns its id given a valid intake body', async () => {
    const userId = crypto.randomUUID()
    await ensureProfileAndShop(db, userId, 'mike@joesgarage.com')
    const result = await createSessionForUser({
      db,
      userId,
      body: validIntake,
      treeState: stubTree,
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.id).toBeTruthy()
  })

  it('persists the caller-provided treeState on the created session row', async () => {
    const userId = crypto.randomUUID()
    await ensureProfileAndShop(db, userId, 'mike@joesgarage.com')
    const customTree: TreeState = {
      nodes: [{ id: 'unique-node-xyz', label: 'foo', status: 'active' }],
      currentNodeId: 'unique-node-xyz',
      message: 'unique-marker',
    }
    const result = await createSessionForUser({
      db,
      userId,
      body: validIntake,
      treeState: customTree,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      const fetched = await getSessionById(db, result.id)
      expect(fetched?.treeState).toEqual(customTree)
    }
  })

  it('returns a 400 "no profile" error when the userId has no profile', async () => {
    const userId = crypto.randomUUID()
    const result = await createSessionForUser({
      db,
      userId,
      body: validIntake,
      treeState: stubTree,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(400)
      expect(result.error).toBe('no profile')
    }
  })

  it('returns a 400 "no shop" error when the user has a profile but no shop', async () => {
    const userId = crypto.randomUUID()
    await createProfile(db, { userId })
    const result = await createSessionForUser({
      db,
      userId,
      body: validIntake,
      treeState: stubTree,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('no shop')
  })

  it('returns a 400 error when the intake body fails validation', async () => {
    const userId = crypto.randomUUID()
    await ensureProfileAndShop(db, userId, 'mike@joesgarage.com')
    const result = await createSessionForUser({
      db,
      userId,
      body: { vehicleYear: 2018, vehicleMake: 'Ford' },
      treeState: stubTree,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('creates a session even when the tech already has an open session (lock-out is the route layer concern)', async () => {
    const userId = crypto.randomUUID()
    const profile = await ensureProfileAndShop(db, userId, 'mike@joesgarage.com')
    await createSession(db, {
      shopId: profile.shopId!,
      techId: profile.id,
      intake: validIntake,
      treeState: stubTree,
    })
    const result = await createSessionForUser({
      db,
      userId,
      body: validIntake,
      treeState: stubTree,
    })
    expect(result.ok).toBe(true)
  })
})
