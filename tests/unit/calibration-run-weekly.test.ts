import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq, and } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
  closeSession,
} from '@/lib/db/queries'
import { confidenceCalibration, driftAlerts, followUps, sessions } from '@/lib/db/schema'
import { runCalibrationAnalysis } from '@/lib/calibration/run-weekly'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

type SeedOpts = {
  riskClass?: 'low' | 'medium' | 'high' | 'destructive'
  vehicleMake?: string
  vehicleModel?: string
  customerComplaint?: string
  hadComeback: boolean
}

async function seedClosedSession(db: TestDb, opts: SeedOpts) {
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
      gateDecision: {
        allow: true,
        riskClass: opts.riskClass ?? 'high',
        threshold: 0.9,
        confidence: 0.92,
        rationale: 'test seed',
      },
    },
  })
  await closeSession(db, session.id, {
    rootCause: 'test',
    actionType: 'repair',
    verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
    diagMinutes: 30,
    repairMinutes: 15,
  })
  await db.insert(followUps).values({
    sessionId: session.id,
    shopId: shop.id,
    techId: tech.id,
    kind: '7d',
    dueAt: new Date(),
    comebackRecorded: opts.hadComeback,
  })
  return { sessionId: session.id }
}

async function seedManyClosedSessions(
  db: TestDb,
  opts: { successes: number; comebacks: number; riskClass: SeedOpts['riskClass']; vehicleModel?: string },
) {
  for (let i = 0; i < opts.successes; i++) {
    await seedClosedSession(db, { ...opts, hadComeback: false })
  }
  for (let i = 0; i < opts.comebacks; i++) {
    await seedClosedSession(db, { ...opts, hadComeback: true })
  }
}

describe('runCalibrationAnalysis', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns zero counts and writes nothing when there is no data', async () => {
    const result = await runCalibrationAnalysis(db)
    expect(result).toEqual({ cellsAnalyzed: 0, alertsRaised: 0, windowDays: 90 })

    const alerts = await db.select().from(driftAlerts)
    expect(alerts).toHaveLength(0)
  })

  it('writes a drift_alerts row when drift ≥ 0.05 and sampleSize ≥ 10', async () => {
    // 12 sessions on a high-risk Ford F-150 power-loss cell, all comebacks.
    // priorThreshold = 0.9 (spec §8.3 fallback), posterior comeback rate
    // overshoots the 0.1 baseline by ~0.49 → newThreshold clamps to 0.99 →
    // drift ≈ 0.09. Both filters trigger.
    await seedManyClosedSessions(db, { successes: 0, comebacks: 12, riskClass: 'high' })

    const result = await runCalibrationAnalysis(db)
    expect(result.cellsAnalyzed).toBe(1)
    expect(result.alertsRaised).toBe(1)

    const alerts = await db.select().from(driftAlerts)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      riskClass: 'high',
      vehicleFamily: 'ford-f-150',
      symptomClass: 'power_loss',
      sampleSize: 12,
    })
    expect(alerts[0].oldThreshold).toBeCloseTo(0.9, 5)
    expect(alerts[0].newThreshold).toBeGreaterThan(0.9)
    expect(alerts[0].comebackRate).toBeCloseTo(1, 5)
  })

  it('does NOT write a drift_alerts row when sampleSize < 10 (noise floor)', async () => {
    await seedManyClosedSessions(db, { successes: 0, comebacks: 5, riskClass: 'high' })

    const result = await runCalibrationAnalysis(db)
    expect(result.cellsAnalyzed).toBe(1)
    expect(result.alertsRaised).toBe(0)

    const alerts = await db.select().from(driftAlerts)
    expect(alerts).toHaveLength(0)
  })

  it('does NOT mutate confidence_calibration (passive design)', async () => {
    // Seed an existing calibration row, then run the analysis with data
    // that would have triggered an active refit under the old design.
    await db.insert(confidenceCalibration).values({
      riskClass: 'high',
      vehicleFamily: 'ford-f-150',
      symptomClass: 'power_loss',
      thresholdPct: 0.9,
      sampleSize: 0,
      comebackRate: 0,
    })
    await seedManyClosedSessions(db, { successes: 0, comebacks: 12, riskClass: 'high' })

    const before = await db
      .select()
      .from(confidenceCalibration)
      .where(
        and(
          eq(confidenceCalibration.riskClass, 'high'),
          eq(confidenceCalibration.vehicleFamily, 'ford-f-150'),
          eq(confidenceCalibration.symptomClass, 'power_loss'),
        ),
      )

    await runCalibrationAnalysis(db)

    const after = await db
      .select()
      .from(confidenceCalibration)
      .where(
        and(
          eq(confidenceCalibration.riskClass, 'high'),
          eq(confidenceCalibration.vehicleFamily, 'ford-f-150'),
          eq(confidenceCalibration.symptomClass, 'power_loss'),
        ),
      )

    // Threshold, sampleSize, comebackRate, lastRefitAt unchanged.
    expect(after[0].thresholdPct).toBe(before[0].thresholdPct)
    expect(after[0].sampleSize).toBe(before[0].sampleSize)
    expect(after[0].comebackRate).toBe(before[0].comebackRate)
    expect(after[0].lastRefitAt).toEqual(before[0].lastRefitAt)
  })

  it('reads priorThreshold from confidence_calibration when an exact-match row exists', async () => {
    // Seed a non-default threshold for this cell (0.75 instead of high's 0.9).
    // 12 comebacks against priorThreshold=0.75 should still trigger an alert,
    // and oldThreshold on that alert should be 0.75 (not the 0.9 fallback).
    await db.insert(confidenceCalibration).values({
      riskClass: 'high',
      vehicleFamily: 'ford-f-150',
      symptomClass: 'power_loss',
      thresholdPct: 0.75,
      sampleSize: 0,
      comebackRate: 0,
    })
    await seedManyClosedSessions(db, { successes: 0, comebacks: 12, riskClass: 'high' })

    await runCalibrationAnalysis(db)

    const [alert] = await db.select().from(driftAlerts)
    expect(alert.oldThreshold).toBeCloseTo(0.75, 5)
  })
})
