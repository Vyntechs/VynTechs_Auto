import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  getShopById,
  createProfile,
  getProfileByUserId,
  createSession,
  getSessionById,
  ensureProfileAndShop,
  appendSessionEvent,
  updateSessionTreeState,
  getOpenSessionForTech,
  listSessionsForShop,
} from '@/lib/db/queries'
import { sessionEvents } from '@/lib/db/schema'

describe('shops queries', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('createShop persists a shop with the given name', async () => {
    const shop = await createShop(db, { name: "Joe's Garage" })
    expect(shop.name).toBe("Joe's Garage")
  })

  it('getShopById returns the shop matching the given id', async () => {
    const created = await createShop(db, { name: 'Test Shop' })
    const fetched = await getShopById(db, created.id)
    expect(fetched?.name).toBe('Test Shop')
  })
})

describe('profiles queries', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('createProfile persists a profile with the given user_id', async () => {
    const userId = crypto.randomUUID()
    const profile = await createProfile(db, { userId:userId })
    expect(profile.userId).toBe(userId)
  })

  it('getProfileByUserId returns the profile matching the given user_id', async () => {
    const userId = crypto.randomUUID()
    await createProfile(db, { userId:userId, fullName:'Mike Smith' })
    const fetched = await getProfileByUserId(db, userId)
    expect(fetched?.fullName).toBe('Mike Smith')
  })
})

describe('sessions queries', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('createSession persists a session and roundtrips its intake payload', async () => {
    const shop = await createShop(db, { name: 'Test Shop' })
    const tech = await createProfile(db, {
      userId:crypto.randomUUID(),
      shopId:shop.id,
    })
    const session = await createSession(db, {
      shopId: shop.id,
      techId: tech.id,
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'loss of power on hills',
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
    })
    expect(session.intake.vehicleMake).toBe('Ford')
  })

  it('ensureProfileAndShop creates a shop and owner profile when userId has none', async () => {
    const userId = crypto.randomUUID()
    const profile = await ensureProfileAndShop(db, userId, 'mike@joesgarage.com')
    expect(profile.userId).toBe(userId)
    expect(profile.role).toBe('owner')
    expect(profile.shopId).not.toBeNull()
  })

  it('ensureProfileAndShop returns the existing profile without duplicating on second call', async () => {
    const userId = crypto.randomUUID()
    const first = await ensureProfileAndShop(db, userId, 'mike@joesgarage.com')
    const second = await ensureProfileAndShop(db, userId, 'mike@joesgarage.com')
    expect(second.id).toBe(first.id)
    expect(second.shopId).toBe(first.shopId)
  })

  it('getSessionById returns the session with eager-loaded shop and tech', async () => {
    const shop = await createShop(db, { name: "Joe's Garage" })
    const tech = await createProfile(db, {
      userId:crypto.randomUUID(),
      shopId:shop.id,
      fullName:'Mike Smith',
    })
    const created = await createSession(db, {
      shopId: shop.id,
      techId: tech.id,
      intake: {
        vehicleYear: 2020,
        vehicleMake: 'Toyota',
        vehicleModel: 'Camry',
        customerComplaint: 'noise on braking',
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
    })
    const fetched = await getSessionById(db, created.id)
    expect(fetched?.shop.name).toBe("Joe's Garage")
    expect(fetched?.tech.fullName).toBe('Mike Smith')
  })
})

describe('session_events queries', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('appendSessionEvent persists an observation event for the given session', async () => {
    const shop = await createShop(db, { name: 'Test Shop' })
    const tech = await createProfile(db, { userId: crypto.randomUUID(), shopId: shop.id })
    const session = await createSession(db, {
      shopId: shop.id,
      techId: tech.id,
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'loss of power',
      },
      treeState: { nodes: [], currentNodeId: 'scan-codes', message: 'pull codes' },
    })
    const event = await appendSessionEvent(db, {
      sessionId: session.id,
      nodeId: 'scan-codes',
      eventType: 'observation',
      observationText: 'Got P0299 with 3.6 psi underboost',
      aiResponse: { nextNodeId: 'inspect-cac' },
    })
    expect(event.sessionId).toBe(session.id)
    expect(event.nodeId).toBe('scan-codes')
    expect(event.observationText).toBe('Got P0299 with 3.6 psi underboost')
    const rows = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, session.id))
    expect(rows).toHaveLength(1)
  })

  it('updateSessionTreeState replaces the tree_state on the given session row', async () => {
    const shop = await createShop(db, { name: 'Test Shop' })
    const tech = await createProfile(db, { userId: crypto.randomUUID(), shopId: shop.id })
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
        nodes: [{ id: 'scan-codes', label: 'Pull DTCs', status: 'active' }],
        currentNodeId: 'scan-codes',
        message: 'pull codes',
      },
    })
    const newTree = {
      nodes: [
        { id: 'scan-codes', label: 'Pull DTCs', status: 'resolved' as const },
        { id: 'inspect-cac', label: 'Inspect CAC pipe', status: 'active' as const },
      ],
      currentNodeId: 'inspect-cac',
      message: 'inspect cac',
    }
    await updateSessionTreeState(db, session.id, newTree)
    const fetched = await getSessionById(db, session.id)
    expect(fetched?.treeState.currentNodeId).toBe('inspect-cac')
    expect(fetched?.treeState.nodes).toHaveLength(2)
  })
})

describe('getOpenSessionForTech', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns null when the tech has no sessions at all', async () => {
    const tech = await createProfile(db, { userId: crypto.randomUUID() })
    const open = await getOpenSessionForTech(db, tech.id)
    expect(open).toBeNull()
  })

  it('returns the open session when the tech has one', async () => {
    const shop = await createShop(db, { name: 'Test Shop' })
    const tech = await createProfile(db, { userId: crypto.randomUUID(), shopId: shop.id })
    const session = await createSession(db, {
      shopId: shop.id,
      techId: tech.id,
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'loss of power',
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
    })
    const open = await getOpenSessionForTech(db, tech.id)
    expect(open?.id).toBe(session.id)
  })

  it('returns null when all of the tech sessions are closed', async () => {
    const shop = await createShop(db, { name: 'Test Shop' })
    const tech = await createProfile(db, { userId: crypto.randomUUID(), shopId: shop.id })
    await createSession(db, {
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
    const open = await getOpenSessionForTech(db, tech.id)
    expect(open).toBeNull()
  })
})

describe('listSessionsForShop', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns an empty array when the shop has no sessions', async () => {
    const shop = await createShop(db, { name: 'Empty Shop' })
    const items = await listSessionsForShop(db, shop.id)
    expect(items).toEqual([])
  })

  it('returns sessions belonging to the given shop only', async () => {
    const shopA = await createShop(db, { name: 'Shop A' })
    const shopB = await createShop(db, { name: 'Shop B' })
    const techA = await createProfile(db, { userId: crypto.randomUUID(), shopId: shopA.id })
    const techB = await createProfile(db, { userId: crypto.randomUUID(), shopId: shopB.id })
    await createSession(db, {
      shopId: shopA.id,
      techId: techA.id,
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'a problem',
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
    })
    await createSession(db, {
      shopId: shopB.id,
      techId: techB.id,
      intake: {
        vehicleYear: 2020,
        vehicleMake: 'Toyota',
        vehicleModel: 'Camry',
        customerComplaint: 'b problem',
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
    })
    const items = await listSessionsForShop(db, shopA.id)
    expect(items).toHaveLength(1)
    expect(items[0].intake.vehicleMake).toBe('Ford')
  })

  it('returns sessions in newest-first order', async () => {
    const shop = await createShop(db, { name: 'Shop' })
    const tech = await createProfile(db, { userId: crypto.randomUUID(), shopId: shop.id })
    const older = await createSession(db, {
      shopId: shop.id,
      techId: tech.id,
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'older',
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
    })
    await new Promise((r) => setTimeout(r, 5))
    const newer = await createSession(db, {
      shopId: shop.id,
      techId: tech.id,
      intake: {
        vehicleYear: 2020,
        vehicleMake: 'Toyota',
        vehicleModel: 'Camry',
        customerComplaint: 'newer',
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
    })
    const items = await listSessionsForShop(db, shop.id)
    expect(items[0].id).toBe(newer.id)
    expect(items[1].id).toBe(older.id)
  })
})
