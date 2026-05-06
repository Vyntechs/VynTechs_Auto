import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { driftAlerts, profiles, shops, sessions } from '@/lib/db/schema'
import { createTestDb, type TestDb } from '../helpers/db'
import { listPendingDriftAlerts, listHistoryForCell, listDeferredSessions } from '@/lib/curator/queries'

const SHOP = '00000000-0000-0000-0000-000000000001'
const CURATOR_USER = '00000000-0000-0000-0000-000000000020'
const CURATOR_PROFILE = '00000000-0000-0000-0000-000000000021'

describe('listPendingDriftAlerts', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values({ id: CURATOR_PROFILE, userId: CURATOR_USER, shopId: SHOP, role: 'curator' })
  })
  afterEach(async () => { await close() })

  it('flags wasDismissedRecently=true when same cell was dismissed within 90 days', async () => {
    await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.78, comebackRate: 0.21, sampleSize: 14,
      decision: 'dismissed',
      decidedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      decidedByUserId: CURATOR_PROFILE,
    })
    await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.80, comebackRate: 0.24, sampleSize: 16,
    })

    const rows = await listPendingDriftAlerts(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].wasDismissedRecently).toBe(true)
  })

  it('flags wasDismissedRecently=false when last dismissal was >90 days ago', async () => {
    await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.78, comebackRate: 0.21, sampleSize: 14,
      decision: 'dismissed',
      decidedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
      decidedByUserId: CURATOR_PROFILE,
    })
    await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.80, comebackRate: 0.24, sampleSize: 16,
    })

    const rows = await listPendingDriftAlerts(db)
    expect(rows[0].wasDismissedRecently).toBe(false)
  })
})

describe('listHistoryForCell', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values({ id: CURATOR_PROFILE, userId: CURATOR_USER, shopId: SHOP, role: 'curator' })
  })
  afterEach(async () => { await close() })

  it('returns alerts for the matching cell only, newest first', async () => {
    const older = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    const newer = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)

    // Two alerts for the target cell with distinct createdAt values
    await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.70, newThreshold: 0.76, comebackRate: 0.20, sampleSize: 12,
      createdAt: older,
    })
    await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.78, comebackRate: 0.22, sampleSize: 14,
      createdAt: newer,
    })
    // One alert for a different cell — should not appear
    await db.insert(driftAlerts).values({
      riskClass: 'high', vehicleFamily: 'sedan', symptomClass: 'stall',
      oldThreshold: 0.80, newThreshold: 0.85, comebackRate: 0.30, sampleSize: 20,
    })

    const rows = await listHistoryForCell(db, 'medium', 'pickup', 'power_loss')
    expect(rows).toHaveLength(2)
    expect(rows[0].createdAt.getTime()).toBeGreaterThan(rows[1].createdAt.getTime())
  })

  it('respects the limit parameter', async () => {
    // Insert 8 alerts for the same cell
    const base = Date.now() - 10 * 24 * 60 * 60 * 1000
    for (let i = 0; i < 8; i++) {
      await db.insert(driftAlerts).values({
        riskClass: 'low', vehicleFamily: 'suv', symptomClass: 'brake_noise',
        oldThreshold: 0.60, newThreshold: 0.65, comebackRate: 0.15, sampleSize: 10,
        createdAt: new Date(base + i * 60 * 1000),
      })
    }

    const defaultRows = await listHistoryForCell(db, 'low', 'suv', 'brake_noise')
    expect(defaultRows).toHaveLength(6)

    const limitedRows = await listHistoryForCell(db, 'low', 'suv', 'brake_noise', 3)
    expect(limitedRows).toHaveLength(3)
  })

  it('returns empty array for a cell with no history', async () => {
    // Insert an alert for a different cell to confirm the query is filtered
    await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.78, comebackRate: 0.21, sampleSize: 14,
    })

    const rows = await listHistoryForCell(db, 'high', 'van', 'overheating')
    expect(rows).toEqual([])
  })
})

describe('listDeferredSessions', () => {
  let db: TestDb
  let close: () => Promise<void>

  const MINIMAL_INTAKE = {
    vehicleYear: 2020,
    vehicleMake: 'Ford',
    vehicleModel: 'F-150',
    customerComplaint: 'test',
  }
  const MINIMAL_TREE_STATE = {
    nodes: [{ id: 'root', label: 'start', status: 'active' as const }],
    currentNodeId: 'root',
    message: 'go',
  }

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values({ id: CURATOR_PROFILE, userId: CURATOR_USER, shopId: SHOP, role: 'curator' })
  })
  afterEach(async () => { await close() })

  it('returns only deferred sessions, not open/closed/declined', async () => {
    const now = new Date()
    await db.insert(sessions).values([
      { shopId: SHOP, techId: CURATOR_PROFILE, status: 'open',     intake: MINIMAL_INTAKE, treeState: MINIMAL_TREE_STATE },
      { shopId: SHOP, techId: CURATOR_PROFILE, status: 'closed',   intake: MINIMAL_INTAKE, treeState: MINIMAL_TREE_STATE, closedAt: now },
      { shopId: SHOP, techId: CURATOR_PROFILE, status: 'declined', intake: MINIMAL_INTAKE, treeState: MINIMAL_TREE_STATE, closedAt: now },
      { shopId: SHOP, techId: CURATOR_PROFILE, status: 'deferred', intake: MINIMAL_INTAKE, treeState: MINIMAL_TREE_STATE, closedAt: now },
    ])

    const rows = await listDeferredSessions(db)
    expect(rows).toHaveLength(1)
    expect(rows[0].closedAt).toBeInstanceOf(Date)
  })

  it('returns deferred sessions ordered newest-first by closedAt', async () => {
    const t1 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) // 3 days ago
    const t2 = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) // 2 days ago
    const t3 = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) // 1 day ago

    await db.insert(sessions).values([
      { shopId: SHOP, techId: CURATOR_PROFILE, status: 'deferred', intake: MINIMAL_INTAKE, treeState: MINIMAL_TREE_STATE, closedAt: t1 },
      { shopId: SHOP, techId: CURATOR_PROFILE, status: 'deferred', intake: MINIMAL_INTAKE, treeState: MINIMAL_TREE_STATE, closedAt: t2 },
      { shopId: SHOP, techId: CURATOR_PROFILE, status: 'deferred', intake: MINIMAL_INTAKE, treeState: MINIMAL_TREE_STATE, closedAt: t3 },
    ])

    const rows = await listDeferredSessions(db)
    expect(rows).toHaveLength(3)
    expect(rows[0].closedAt!.getTime()).toBeGreaterThan(rows[1].closedAt!.getTime())
    expect(rows[1].closedAt!.getTime()).toBeGreaterThan(rows[2].closedAt!.getTime())
  })

  it('returns empty array when no deferred sessions exist', async () => {
    await db.insert(sessions).values([
      { shopId: SHOP, techId: CURATOR_PROFILE, status: 'open',    intake: MINIMAL_INTAKE, treeState: MINIMAL_TREE_STATE },
      { shopId: SHOP, techId: CURATOR_PROFILE, status: 'closed',  intake: MINIMAL_INTAKE, treeState: MINIMAL_TREE_STATE, closedAt: new Date() },
    ])

    const rows = await listDeferredSessions(db)
    expect(rows).toHaveLength(0)
  })
})
