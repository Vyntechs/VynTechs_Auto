import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { driftAlerts, profiles, shops } from '@/lib/db/schema'
import { createTestDb, type TestDb } from '../helpers/db'
import { listPendingDriftAlerts } from '@/lib/curator/queries'

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
