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
  countOpenSessionsForTech,
  listSessionsForShop,
  closeSession,
  getThreshold,
  createArtifact,
  getArtifactById,
  listArtifactsForSession,
  setArtifactExtraction,
} from '@/lib/db/queries'
import { sessionEvents, confidenceCalibration } from '@/lib/db/schema'

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

describe('countOpenSessionsForTech', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  // Helper for this block — creates N open sessions for a given tech with
  // throwaway intake/tree fields. Mileage gets bumped per session so the
  // intake objects stay distinct.
  async function seedOpen(techId: string, shopId: string, n: number) {
    for (let i = 0; i < n; i++) {
      await createSession(db, {
        shopId,
        techId,
        status: 'open',
        intake: {
          vehicleYear: 2018,
          vehicleMake: 'Ford',
          vehicleModel: 'F-150',
          mileage: 80_000 + i,
          customerComplaint: `complaint #${i}`,
        },
        treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
      })
    }
  }

  it('returns 0 when the tech has no sessions', async () => {
    const tech = await createProfile(db, { userId: crypto.randomUUID() })
    expect(await countOpenSessionsForTech(db, tech.id)).toBe(0)
  })

  it('counts only open sessions, ignoring closed/deferred/declined', async () => {
    const shop = await createShop(db, { name: 'S' })
    const tech = await createProfile(db, { userId: crypto.randomUUID(), shopId: shop.id })
    await seedOpen(tech.id, shop.id, 3)
    // One closed, one deferred — neither should be counted.
    await createSession(db, {
      shopId: shop.id,
      techId: tech.id,
      status: 'closed',
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'closed one',
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
    })
    await createSession(db, {
      shopId: shop.id,
      techId: tech.id,
      status: 'deferred',
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'deferred one',
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'go' },
    })
    expect(await countOpenSessionsForTech(db, tech.id)).toBe(3)
  })

  it('does not count another tech\'s open sessions', async () => {
    const shop = await createShop(db, { name: 'S' })
    const techA = await createProfile(db, { userId: crypto.randomUUID(), shopId: shop.id })
    const techB = await createProfile(db, { userId: crypto.randomUUID(), shopId: shop.id })
    await seedOpen(techA.id, shop.id, 2)
    await seedOpen(techB.id, shop.id, 4)
    expect(await countOpenSessionsForTech(db, techA.id)).toBe(2)
    expect(await countOpenSessionsForTech(db, techB.id)).toBe(4)
  })

  it('handles the cap-boundary cases (4 below, 5 at, 6 over)', async () => {
    const shop = await createShop(db, { name: 'S' })
    const tech = await createProfile(db, { userId: crypto.randomUUID(), shopId: shop.id })
    await seedOpen(tech.id, shop.id, 4)
    expect(await countOpenSessionsForTech(db, tech.id)).toBe(4)
    await seedOpen(tech.id, shop.id, 1)
    expect(await countOpenSessionsForTech(db, tech.id)).toBe(5)
    await seedOpen(tech.id, shop.id, 1)
    expect(await countOpenSessionsForTech(db, tech.id)).toBe(6)
  })
})

describe('closeSession', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('writes the outcome, sets status=closed, and stamps closedAt', async () => {
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
    const updated = await closeSession(db, session.id, {
      rootCause: 'Wastegate vacuum line cracked at actuator-can end',
      actionType: 'part_replacement',
      partInfo: { name: 'Vacuum line, silicone 4mm', oemNumber: 'BL3Z-9C915-A', cost: 12.5 },
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
      diagMinutes: 25,
      repairMinutes: 18,
      notes: 'Smoke test confirmed leak',
    })
    expect(updated.status).toBe('closed')
    expect(updated.outcome?.rootCause).toMatch(/Wastegate/)
    expect(updated.outcome?.partInfo?.oemNumber).toBe('BL3Z-9C915-A')
    expect(updated.closedAt).toBeInstanceOf(Date)
  })

  it('throws when the session is already closed', async () => {
    const shop = await createShop(db, { name: 'Test Shop' })
    const tech = await createProfile(db, { userId: crypto.randomUUID(), shopId: shop.id })
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
    await expect(
      closeSession(db, session.id, {
        rootCause: 'Replaced ignition coil pack on cylinder 3',
        actionType: 'part_replacement',
        partInfo: { name: 'Ignition coil' },
        verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
        diagMinutes: 10,
        repairMinutes: 15,
      }),
    ).rejects.toThrow(/not open/i)
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

describe('getThreshold', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('falls back to spec §8.3 hardcoded values when calibration is empty', async () => {
    expect(await getThreshold(db, { riskClass: 'zero' })).toBe(0)
    expect(await getThreshold(db, { riskClass: 'low' })).toBeCloseTo(0.7)
    expect(await getThreshold(db, { riskClass: 'medium' })).toBeCloseTo(0.8)
    expect(await getThreshold(db, { riskClass: 'high' })).toBeCloseTo(0.9)
    expect(await getThreshold(db, { riskClass: 'destructive' })).toBeCloseTo(0.95)
  })

  it('returns the catch-all row threshold when only catch-all is seeded', async () => {
    await db.insert(confidenceCalibration).values({
      riskClass: 'high',
      vehicleFamily: '*',
      symptomClass: '*',
      thresholdPct: 0.85,
    })
    const t = await getThreshold(db, {
      riskClass: 'high',
      vehicleFamily: 'ford-f-truck',
      symptomClass: 'power_loss',
    })
    expect(t).toBeCloseTo(0.85)
  })

  it('prefers a vehicle+symptom-specific row over the catch-all', async () => {
    await db.insert(confidenceCalibration).values([
      { riskClass: 'high', vehicleFamily: '*', symptomClass: '*', thresholdPct: 0.9 },
      {
        riskClass: 'high',
        vehicleFamily: 'ford-f-truck',
        symptomClass: 'power_loss',
        thresholdPct: 0.97,
      },
    ])
    const t = await getThreshold(db, {
      riskClass: 'high',
      vehicleFamily: 'ford-f-truck',
      symptomClass: 'power_loss',
    })
    expect(t).toBeCloseTo(0.97)
  })
})

describe('artifact queries', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  async function seedSession() {
    const shop = await createShop(db, { name: 'Test Shop' })
    const tech = await createProfile(db, { userId: crypto.randomUUID(), shopId: shop.id })
    const session = await createSession(db, {
      shopId: shop.id,
      techId: tech.id,
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'rough idle',
      },
      treeState: { nodes: [], currentNodeId: 'scan-codes', message: 'pull codes' },
    })
    return session
  }

  it('createArtifact returns a valid uuid that resolves to a row', async () => {
    const session = await seedSession()
    const artifactId = await createArtifact(db, {
      sessionId: session.id,
      nodeId: 'scan-codes',
      kind: 'photo',
      storageKey: 'session-id/photo/test.jpg',
      mimeType: 'image/jpeg',
      bytes: 4096,
      extractionStatus: 'pending',
    })
    // returned id is a valid uuid
    expect(artifactId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
    // row is retrievable
    const row = await getArtifactById(db, artifactId)
    expect(row?.id).toBe(artifactId)
    expect(row?.kind).toBe('photo')
    expect(row?.bytes).toBe(4096)
  })

  it('listArtifactsForSession is scoped to the session and ordered newest-first', async () => {
    const session = await seedSession()
    const otherSession = await seedSession()

    // Insert two artifacts for the target session
    await createArtifact(db, {
      sessionId: session.id,
      nodeId: 'scan-codes',
      kind: 'audio',
      storageKey: 'key-audio',
      mimeType: 'audio/webm',
      bytes: 1024,
      extractionStatus: 'pending',
    })
    await new Promise((r) => setTimeout(r, 5))
    await createArtifact(db, {
      sessionId: session.id,
      nodeId: 'scan-codes',
      kind: 'photo',
      storageKey: 'key-photo',
      mimeType: 'image/jpeg',
      bytes: 2048,
      extractionStatus: 'pending',
    })

    // Insert one artifact for a different session — should not appear
    await createArtifact(db, {
      sessionId: otherSession.id,
      nodeId: 'scan-codes',
      kind: 'video',
      storageKey: 'key-video',
      mimeType: 'video/mp4',
      bytes: 8192,
      extractionStatus: 'pending',
    })

    const list = await listArtifactsForSession(db, session.id)
    expect(list).toHaveLength(2)
    // Newest first — photo inserted second
    expect(list[0].kind).toBe('photo')
    expect(list[1].kind).toBe('audio')
  })

  it('setArtifactExtraction updates extraction payload and extractionStatus', async () => {
    const session = await seedSession()
    const artifactId = await createArtifact(db, {
      sessionId: session.id,
      nodeId: 'scan-codes',
      kind: 'scan_screen',
      storageKey: 'key-scan',
      mimeType: 'image/png',
      bytes: 512,
      extractionStatus: 'pending',
    })
    await setArtifactExtraction(db, artifactId, {
      text: 'P0299 UNDERBOOST',
      structured: { dtcs: ['P0299'] },
      summary: 'Single DTC: boost control underperformance',
    })
    const row = await getArtifactById(db, artifactId)
    expect(row?.extractionStatus).toBe('done')
    expect(row?.extraction?.text).toBe('P0299 UNDERBOOST')
    expect((row?.extraction?.structured as Record<string, unknown>)?.dtcs).toEqual(['P0299'])
  })

  it('setArtifactExtraction can mark status as failed', async () => {
    const session = await seedSession()
    const artifactId = await createArtifact(db, {
      sessionId: session.id,
      nodeId: 'scan-codes',
      kind: 'photo',
      storageKey: 'key-fail',
      mimeType: 'image/jpeg',
      bytes: 100,
      extractionStatus: 'pending',
    })
    await setArtifactExtraction(db, artifactId, null, 'failed')
    const row = await getArtifactById(db, artifactId)
    expect(row?.extractionStatus).toBe('failed')
  })

  it('getArtifactById returns null for an unknown id', async () => {
    const result = await getArtifactById(db, crypto.randomUUID())
    expect(result).toBeNull()
  })
})
