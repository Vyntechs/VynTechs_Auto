import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { triggerCalibrationAnalysis } from '@/lib/calibration/manual-trigger'

const FOUNDER_EMAIL = 'brandon@vyntechs.com'
const NON_FOUNDER_EMAIL = 'tech@example.com'

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
    vi.stubEnv('FOUNDER_EMAILS', FOUNDER_EMAIL)
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await close()
  })

  it('returns 401 when no userId is provided', async () => {
    const result = await triggerCalibrationAnalysis({ db, userId: null, email: null })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(401)
    }
  })

  it('returns 403 when the user is not a curator and not a founder', async () => {
    const tech = await seedProfile(db, 'tech')
    const result = await triggerCalibrationAnalysis({
      db,
      userId: tech.userId,
      email: NON_FOUNDER_EMAIL,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
    }
  })

  it('returns 403 when the user has no profile at all and is not a founder', async () => {
    const result = await triggerCalibrationAnalysis({
      db,
      userId: crypto.randomUUID(),
      email: NON_FOUNDER_EMAIL,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
    }
  })

  it('runs the analysis when the user is a curator (role-based grant)', async () => {
    const curator = await seedProfile(db, 'curator')
    const result = await triggerCalibrationAnalysis({
      db,
      userId: curator.userId,
      email: NON_FOUNDER_EMAIL,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.result).toEqual({
        cellsAnalyzed: 0,
        alertsRaised: 0,
        windowDays: 90,
      })
    }
  })

  it('DENIES an owner WITHOUT founder email (regression guard for auto-owner escalation)', async () => {
    const owner = await seedProfile(db, 'owner')
    const result = await triggerCalibrationAnalysis({
      db,
      userId: owner.userId,
      email: NON_FOUNDER_EMAIL,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.status).toBe(403)
    }
  })

  it('ALLOWS an owner WITH founder email', async () => {
    const owner = await seedProfile(db, 'owner')
    const result = await triggerCalibrationAnalysis({
      db,
      userId: owner.userId,
      email: FOUNDER_EMAIL,
    })
    expect(result.ok).toBe(true)
  })

  it('ALLOWS a tech WITH founder email (founder gate trumps role)', async () => {
    const tech = await seedProfile(db, 'tech')
    const result = await triggerCalibrationAnalysis({
      db,
      userId: tech.userId,
      email: FOUNDER_EMAIL,
    })
    expect(result.ok).toBe(true)
  })
})
