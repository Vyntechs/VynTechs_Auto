import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { triggerCalibrationAnalysis } from '@/lib/calibration/manual-trigger'

async function seedProfile(db: TestDb, role: string) {
  const shop = await createShop(db, { name: 'Test Shop' })
  return createProfile(db, {
    userId: crypto.randomUUID(),
    shopId: shop.id,
    role,
  })
}

describe('triggerCalibrationAnalysis', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns 401 when no userId is provided', async () => {
    const result = await triggerCalibrationAnalysis({ db, userId: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
    }
  })

  it('returns 403 when the user is not a curator', async () => {
    const tech = await seedProfile(db, 'tech')
    const result = await triggerCalibrationAnalysis({ db, userId: tech.userId })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
    }
  })

  it('returns 403 when the user has no profile at all', async () => {
    const result = await triggerCalibrationAnalysis({
      db,
      userId: crypto.randomUUID(),
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
    }
  })

  it('runs the analysis and returns the result when the user is a curator', async () => {
    const curator = await seedProfile(db, 'curator')
    const result = await triggerCalibrationAnalysis({ db, userId: curator.userId })
    expect(result.ok).toBe(true)
    if (result.ok) {
      // No closed sessions seeded → empty result, but the call succeeded.
      expect(result.result).toEqual({
        cellsAnalyzed: 0,
        alertsRaised: 0,
        windowDays: 90,
      })
    }
  })

  it('runs the analysis when the user is an owner (founder is both)', async () => {
    const owner = await seedProfile(db, 'owner')
    const result = await triggerCalibrationAnalysis({ db, userId: owner.userId })
    expect(result.ok).toBe(true)
  })
})
