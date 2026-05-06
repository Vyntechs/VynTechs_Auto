import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq, and, isNull } from 'drizzle-orm'
import { driftAlerts, confidenceCalibration, profiles, shops } from '@/lib/db/schema'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  applyDriftAlert,
  dismissDriftAlert,
  bulkDismissDriftAlerts,
} from '@/lib/curator/drift-resolution'

const SHOP = '00000000-0000-0000-0000-000000000001'
const CURATOR_USER = '00000000-0000-0000-0000-000000000030'
const CURATOR_PROFILE = '00000000-0000-0000-0000-000000000031'

describe('drift-resolution handlers', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await db.insert(profiles).values({
      id: CURATOR_PROFILE,
      userId: CURATOR_USER,
      shopId: SHOP,
      role: 'curator',
    })
    // Seed a matching calibration row for apply tests
    await db.insert(confidenceCalibration).values({
      riskClass: 'medium',
      vehicleFamily: 'pickup',
      symptomClass: 'power_loss',
      thresholdPct: 0.72,
      sampleSize: 14,
      comebackRate: 0.21,
    })
  })

  afterEach(async () => {
    await close()
  })

  // ── Case 1: apply with note — bumps threshold + lastRefitAt ──────────────

  it('applyDriftAlert with note: sets decision=applied and bumps calibration threshold', async () => {
    const [alert] = await db.insert(driftAlerts).values({
      riskClass: 'medium',
      vehicleFamily: 'pickup',
      symptomClass: 'power_loss',
      oldThreshold: 0.72,
      newThreshold: 0.78,
      comebackRate: 0.21,
      sampleSize: 14,
    }).returning()

    const result = await applyDriftAlert(db, alert.id, CURATOR_PROFILE, 'looks good')

    expect(result.kind).toBe('ok')

    // Verify drift alert was updated
    const [updated] = await db.select().from(driftAlerts).where(eq(driftAlerts.id, alert.id))
    expect(updated.decision).toBe('applied')
    expect(updated.decidedByUserId).toBe(CURATOR_PROFILE)
    expect(updated.decisionNote).toBe('looks good')
    expect(updated.decidedAt).not.toBeNull()

    // Verify calibration threshold was bumped
    const [cal] = await db.select().from(confidenceCalibration).where(
      and(
        eq(confidenceCalibration.riskClass, 'medium'),
        eq(confidenceCalibration.vehicleFamily, 'pickup'),
        eq(confidenceCalibration.symptomClass, 'power_loss'),
      )
    )
    expect(cal.thresholdPct).toBeCloseTo(0.78)
    expect(cal.lastRefitAt).not.toBeNull()
  })

  // ── Case 2: apply without note ───────────────────────────────────────────

  it('applyDriftAlert without note: sets decision=applied with null note', async () => {
    const [alert] = await db.insert(driftAlerts).values({
      riskClass: 'medium',
      vehicleFamily: 'pickup',
      symptomClass: 'power_loss',
      oldThreshold: 0.72,
      newThreshold: 0.78,
      comebackRate: 0.21,
      sampleSize: 14,
    }).returning()

    const result = await applyDriftAlert(db, alert.id, CURATOR_PROFILE, null)

    expect(result.kind).toBe('ok')

    const [updated] = await db.select().from(driftAlerts).where(eq(driftAlerts.id, alert.id))
    expect(updated.decision).toBe('applied')
    expect(updated.decisionNote).toBeNull()
  })

  // ── Case 3: dismiss with note ────────────────────────────────────────────

  it('dismissDriftAlert with note: sets decision=dismissed, no calibration write', async () => {
    const [alert] = await db.insert(driftAlerts).values({
      riskClass: 'medium',
      vehicleFamily: 'pickup',
      symptomClass: 'power_loss',
      oldThreshold: 0.72,
      newThreshold: 0.78,
      comebackRate: 0.21,
      sampleSize: 14,
    }).returning()

    const result = await dismissDriftAlert(db, alert.id, CURATOR_PROFILE, 'not enough data')

    expect(result.kind).toBe('ok')

    const [updated] = await db.select().from(driftAlerts).where(eq(driftAlerts.id, alert.id))
    expect(updated.decision).toBe('dismissed')
    expect(updated.decidedByUserId).toBe(CURATOR_PROFILE)
    expect(updated.decisionNote).toBe('not enough data')
    expect(updated.decidedAt).not.toBeNull()

    // Calibration threshold must NOT change
    const [cal] = await db.select().from(confidenceCalibration).where(
      and(
        eq(confidenceCalibration.riskClass, 'medium'),
        eq(confidenceCalibration.vehicleFamily, 'pickup'),
        eq(confidenceCalibration.symptomClass, 'power_loss'),
      )
    )
    expect(cal.thresholdPct).toBeCloseTo(0.72)
    expect(cal.lastRefitAt).toBeNull()
  })

  // ── Case 4: dismiss without note ─────────────────────────────────────────

  it('dismissDriftAlert without note: sets decision=dismissed with null note', async () => {
    const [alert] = await db.insert(driftAlerts).values({
      riskClass: 'medium',
      vehicleFamily: 'pickup',
      symptomClass: 'power_loss',
      oldThreshold: 0.72,
      newThreshold: 0.78,
      comebackRate: 0.21,
      sampleSize: 14,
    }).returning()

    const result = await dismissDriftAlert(db, alert.id, CURATOR_PROFILE, null)

    expect(result.kind).toBe('ok')

    const [updated] = await db.select().from(driftAlerts).where(eq(driftAlerts.id, alert.id))
    expect(updated.decision).toBe('dismissed')
    expect(updated.decisionNote).toBeNull()
  })

  // ── Case 5: bulk dismiss — skips already-decided rows ───────────────────

  it('bulkDismissDriftAlerts: dismisses pending rows, skips already-decided', async () => {
    const [pendingA] = await db.insert(driftAlerts).values({
      riskClass: 'medium', vehicleFamily: 'pickup', symptomClass: 'power_loss',
      oldThreshold: 0.72, newThreshold: 0.78, comebackRate: 0.21, sampleSize: 14,
    }).returning()

    const [pendingB] = await db.insert(driftAlerts).values({
      riskClass: 'high', vehicleFamily: 'suv', symptomClass: 'brake_fade',
      oldThreshold: 0.65, newThreshold: 0.70, comebackRate: 0.15, sampleSize: 20,
    }).returning()

    const [alreadyDecided] = await db.insert(driftAlerts).values({
      riskClass: 'low', vehicleFamily: 'sedan', symptomClass: 'oil_leak',
      oldThreshold: 0.50, newThreshold: 0.55, comebackRate: 0.10, sampleSize: 8,
      decision: 'applied',
      decidedAt: new Date(),
      decidedByUserId: CURATOR_PROFILE,
    }).returning()

    const result = await bulkDismissDriftAlerts(
      db,
      [pendingA.id, pendingB.id, alreadyDecided.id],
      CURATOR_PROFILE,
      'batch clear',
    )

    expect(result.kind).toBe('ok')
    expect(result.dismissedCount).toBe(2)

    // Pending rows got dismissed
    const [updA] = await db.select().from(driftAlerts).where(eq(driftAlerts.id, pendingA.id))
    expect(updA.decision).toBe('dismissed')

    const [updB] = await db.select().from(driftAlerts).where(eq(driftAlerts.id, pendingB.id))
    expect(updB.decision).toBe('dismissed')

    // Already-decided row must stay as-is
    const [updC] = await db.select().from(driftAlerts).where(eq(driftAlerts.id, alreadyDecided.id))
    expect(updC.decision).toBe('applied')
  })
})
