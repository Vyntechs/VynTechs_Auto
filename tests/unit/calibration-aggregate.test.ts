import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
  closeSession,
} from '@/lib/db/queries'
import { followUps, sessions } from '@/lib/db/schema'
import { aggregateOutcomesByCell } from '@/lib/calibration/aggregate'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

type SeedOpts = {
  riskClass?: 'zero' | 'low' | 'medium' | 'high' | 'destructive' | null
  vehicleMake?: string
  vehicleModel?: string
  customerComplaint?: string
  closedDaysAgo?: number
  status?: 'closed' | 'open' | 'declined' | 'deferred'
  hadComeback?: boolean
}

async function seedSession(db: TestDb, opts: SeedOpts = {}) {
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
      vehicleMake: opts.vehicleMake ?? 'Ford',
      vehicleModel: opts.vehicleModel ?? 'F-150',
      customerComplaint: opts.customerComplaint ?? 'loss of power going up hills',
    },
    treeState: {
      nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
      currentNodeId: 'root',
      message: 'go',
      ...(opts.riskClass !== null
        ? {
            gateDecision: {
              allow: true,
              riskClass: opts.riskClass ?? 'high',
              threshold: 0.9,
              confidence: 0.92,
              rationale: 'test seed',
            },
          }
        : {}),
    },
  })
  if (opts.status === 'closed' || opts.status === undefined) {
    await closeSession(db, session.id, {
      rootCause: 'test',
      actionType: 'repair',
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
      diagMinutes: 30,
      repairMinutes: 15,
    })
    if (opts.closedDaysAgo !== undefined) {
      const closedAt = new Date(Date.now() - opts.closedDaysAgo * ONE_DAY_MS)
      await db.update(sessions).set({ closedAt }).where(eq(sessions.id, session.id))
    }
  }
  if (opts.hadComeback !== undefined) {
    await db.insert(followUps).values({
      sessionId: session.id,
      shopId: shop.id,
      techId: tech.id,
      kind: '7d',
      dueAt: new Date(),
      comebackRecorded: opts.hadComeback,
    })
  }
  return { sessionId: session.id, shopId: shop.id, techId: tech.id }
}

describe('aggregateOutcomesByCell', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns one row per (riskClass × vehicleFamily × symptomClass) cell, deriving riskClass from tree_state.gateDecision', async () => {
    await seedSession(db, {
      riskClass: 'high',
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'loss of power going up hills',
      hadComeback: false,
    })

    const cutoff = new Date(Date.now() - 90 * ONE_DAY_MS)
    const rows = await aggregateOutcomesByCell(db, cutoff)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      riskClass: 'high',
      vehicleFamily: 'ford-f-150',
      symptomClass: 'power_loss',
      successes: 1,
      comebacks: 0,
    })
  })

  it('counts a comeback when a follow_up has comeback_recorded=true', async () => {
    await seedSession(db, {
      riskClass: 'medium',
      vehicleMake: 'BMW',
      vehicleModel: '3-Series',
      customerComplaint: "won't start in cold weather",
      hadComeback: true,
    })

    const cutoff = new Date(Date.now() - 90 * ONE_DAY_MS)
    const rows = await aggregateOutcomesByCell(db, cutoff)

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      riskClass: 'medium',
      vehicleFamily: 'bmw-3-series',
      symptomClass: 'no_start',
      successes: 0,
      comebacks: 1,
    })
  })

  it('groups sessions in the same cell and separates distinct cells', async () => {
    // Cell A — three Ford F-150 high-risk power-loss sessions, one comeback.
    await seedSession(db, { riskClass: 'high', customerComplaint: 'sluggish acceleration', hadComeback: false })
    await seedSession(db, { riskClass: 'high', customerComplaint: 'stalls at idle', hadComeback: false })
    await seedSession(db, { riskClass: 'high', customerComplaint: 'hesitation under load', hadComeback: true })
    // Cell B — one BMW misfire session, success.
    await seedSession(db, {
      riskClass: 'low',
      vehicleMake: 'BMW',
      vehicleModel: '3-Series',
      customerComplaint: 'rough idle and misfire',
      hadComeback: false,
    })

    const cutoff = new Date(Date.now() - 90 * ONE_DAY_MS)
    const rows = await aggregateOutcomesByCell(db, cutoff)

    expect(rows).toHaveLength(2)
    const fordCell = rows.find((r) => r.vehicleFamily === 'ford-f-150')
    const bmwCell = rows.find((r) => r.vehicleFamily === 'bmw-3-series')
    expect(fordCell).toMatchObject({
      riskClass: 'high',
      symptomClass: 'power_loss',
      successes: 2,
      comebacks: 1,
    })
    expect(bmwCell).toMatchObject({
      riskClass: 'low',
      symptomClass: 'misfire',
      successes: 1,
      comebacks: 0,
    })
  })

  it('filters out sessions outside the window, non-closed sessions, and sessions with no gateDecision', async () => {
    // In-window, closed, with gate — should appear.
    await seedSession(db, { riskClass: 'high', customerComplaint: 'power loss', hadComeback: false })
    // Outside the cutoff (200 days ago) — should NOT appear.
    await seedSession(db, {
      riskClass: 'high',
      customerComplaint: 'power loss',
      vehicleModel: 'Ranger',
      closedDaysAgo: 200,
      hadComeback: false,
    })
    // Open session — should NOT appear.
    await seedSession(db, {
      riskClass: 'high',
      customerComplaint: 'power loss',
      vehicleModel: 'Bronco',
      status: 'open',
      hadComeback: false,
    })
    // Closed but no gateDecision — should NOT appear (no calibration signal).
    await seedSession(db, {
      riskClass: null,
      customerComplaint: 'power loss',
      vehicleModel: 'Mustang',
      hadComeback: false,
    })

    const cutoff = new Date(Date.now() - 90 * ONE_DAY_MS)
    const rows = await aggregateOutcomesByCell(db, cutoff)

    expect(rows).toHaveLength(1)
    expect(rows[0].vehicleFamily).toBe('ford-f-150')
  })
})
