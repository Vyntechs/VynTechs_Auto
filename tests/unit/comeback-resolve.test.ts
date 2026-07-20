import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
  closeSession,
} from '@/lib/db/queries'
import { followUps, profiles } from '@/lib/db/schema'
import { resolveFollowUp } from '@/lib/comeback/resolve'
import type { OutcomePayload } from '@/lib/db/schema'

const ONE_HOUR_MS = 60 * 60 * 1000

const baseOutcome: OutcomePayload = {
  rootCause:
    'Wastegate vacuum line cracked at actuator-can end on driver-side turbo',
  actionType: 'part_replacement',
  partInfo: { name: 'Vacuum line, 4mm silicone', oemNumber: 'BL3Z-9C915-A' },
  verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
  diagMinutes: 25,
  repairMinutes: 18,
}

async function seedClosedSessionWithSurfacedFollowUp(db: TestDb) {
  const shop = await createShop(db, { name: 'Test Shop' })
  const tech = await createProfile(db, {
    userId: crypto.randomUUID(),
    shopId: shop.id,
  })
  const session = await createSession(db, {
    shopId: shop.id,
    techId: tech.id,
    intake: {
      vehicleYear: 2013,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      vehicleEngine: '3.5L EcoBoost',
      customerComplaint: 'lost power on highway',
    },
    treeState: {
      nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
      currentNodeId: 'root',
      message: 'go',
    },
  })
  await closeSession(db, session.id, baseOutcome)

  const now = new Date()
  const [followUp] = await db
    .insert(followUps)
    .values({
      sessionId: session.id,
      shopId: shop.id,
      techId: tech.id,
      kind: '7d',
      dueAt: new Date(now.getTime() - ONE_HOUR_MS),
      surfacedAt: now,
    })
    .returning()
  return { shop, tech, session, followUp }
}

describe('resolveFollowUp', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('marks the follow-up resolved with comebackRecorded=true and notes', async () => {
    const { tech, followUp } = await seedClosedSessionWithSurfacedFollowUp(db)
    const decay = vi.fn().mockResolvedValue({ decayed: 0, retired: 0 })

    const result = await resolveFollowUp({
      db,
      userId: tech.userId,
      followUpId: followUp.id,
      body: { comebackRecorded: true, notes: 'BPV cracked again at 800 mi' },
      recordCorpusComeback: decay,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('unreachable')
    expect(result.comebackRecorded).toBe(true)

    const [row] = await db.select().from(followUps).where(eq(followUps.id, followUp.id))
    expect(row.resolvedAt).not.toBeNull()
    expect(row.comebackRecorded).toBe(true)
    expect(row.notes).toBe('BPV cracked again at 800 mi')
  })

  it('invokes recordCorpusComeback with vehicle + rootCause when comebackRecorded=true', async () => {
    const { tech, followUp } = await seedClosedSessionWithSurfacedFollowUp(db)
    const decay = vi.fn().mockResolvedValue({ decayed: 1, retired: 0 })

    await resolveFollowUp({
      db,
      userId: tech.userId,
      followUpId: followUp.id,
      body: { comebackRecorded: true },
      recordCorpusComeback: decay,
    })
    expect(decay).toHaveBeenCalledTimes(1)
    const [dbArg, input] = decay.mock.calls[0]!
    expect(dbArg).toBe(db)
    expect(input.vehicleYear).toBe(2013)
    expect(input.vehicleMake).toBe('Ford')
    expect(input.vehicleModel).toBe('F-150')
    expect(input.rootCause).toContain('Wastegate')
    expect(input.shopId).toBe(tech.shopId)
  })

  it('uses the claimed follow-up shop even if the technician later moves shops', async () => {
    const { shop, tech, followUp } = await seedClosedSessionWithSurfacedFollowUp(db)
    const laterShop = await createShop(db, { name: 'Technician moved shop' })
    await db.update(profiles).set({ shopId: laterShop.id }).where(eq(profiles.id, tech.id))
    const decay = vi.fn().mockResolvedValue({ decayed: 1, retired: 0 })

    await expect(resolveFollowUp({
      db,
      userId: tech.userId,
      followUpId: followUp.id,
      body: { comebackRecorded: true },
      recordCorpusComeback: decay,
    })).resolves.toEqual({ ok: true, comebackRecorded: true })

    expect(decay).toHaveBeenCalledWith(db, expect.objectContaining({ shopId: shop.id }))
    expect(decay).not.toHaveBeenCalledWith(db, expect.objectContaining({ shopId: laterShop.id }))
  })

  it('allows exactly one decay winner for concurrent resolutions of one follow-up', async () => {
    const { tech, followUp } = await seedClosedSessionWithSurfacedFollowUp(db)
    const decay = vi.fn().mockResolvedValue({ decayed: 1, retired: 0 })

    const results = await Promise.all([
      resolveFollowUp({
        db,
        userId: tech.userId,
        followUpId: followUp.id,
        body: { comebackRecorded: true, notes: 'first' },
        recordCorpusComeback: decay,
      }),
      resolveFollowUp({
        db,
        userId: tech.userId,
        followUpId: followUp.id,
        body: { comebackRecorded: true, notes: 'second' },
        recordCorpusComeback: decay,
      }),
    ])

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toHaveLength(1)
    expect(decay).toHaveBeenCalledTimes(1)
  })

  it('does not invoke decay when comebackRecorded=false', async () => {
    const { tech, followUp } = await seedClosedSessionWithSurfacedFollowUp(db)
    const decay = vi.fn()

    const result = await resolveFollowUp({
      db,
      userId: tech.userId,
      followUpId: followUp.id,
      body: { comebackRecorded: false },
      recordCorpusComeback: decay,
    })
    expect(result.ok).toBe(true)
    expect(decay).not.toHaveBeenCalled()

    const [row] = await db.select().from(followUps).where(eq(followUps.id, followUp.id))
    expect(row.resolvedAt).not.toBeNull()
    expect(row.comebackRecorded).toBe(false)
  })

  it('treats decay failure as non-fatal — follow-up still resolves', async () => {
    const { tech, followUp } = await seedClosedSessionWithSurfacedFollowUp(db)
    const decay = vi.fn().mockRejectedValue(new Error('embed boom'))

    const result = await resolveFollowUp({
      db,
      userId: tech.userId,
      followUpId: followUp.id,
      body: { comebackRecorded: true },
      recordCorpusComeback: decay,
    })
    expect(result.ok).toBe(true)
    expect(decay).toHaveBeenCalledTimes(1)
    const [row] = await db.select().from(followUps).where(eq(followUps.id, followUp.id))
    expect(row.resolvedAt).not.toBeNull()
  })

  it('returns 404 when the follow-up belongs to another tech', async () => {
    const { followUp } = await seedClosedSessionWithSurfacedFollowUp(db)
    const otherTech = await createProfile(db, { userId: crypto.randomUUID() })

    const result = await resolveFollowUp({
      db,
      userId: otherTech.userId,
      followUpId: followUp.id,
      body: { comebackRecorded: false },
      recordCorpusComeback: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.status).toBe(404)
  })

  it('returns 404 when the follow-up does not exist', async () => {
    const { tech } = await seedClosedSessionWithSurfacedFollowUp(db)
    const result = await resolveFollowUp({
      db,
      userId: tech.userId,
      followUpId: '00000000-0000-0000-0000-000000000000',
      body: { comebackRecorded: false },
      recordCorpusComeback: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.status).toBe(404)
  })

  it('returns 400 on invalid body', async () => {
    const { tech, followUp } = await seedClosedSessionWithSurfacedFollowUp(db)
    const result = await resolveFollowUp({
      db,
      userId: tech.userId,
      followUpId: followUp.id,
      body: { somethingElse: 'wrong' },
      recordCorpusComeback: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.status).toBe(400)
  })

  it('returns 400 when the follow-up is already resolved', async () => {
    const { tech, followUp } = await seedClosedSessionWithSurfacedFollowUp(db)
    await db
      .update(followUps)
      .set({ resolvedAt: new Date(), comebackRecorded: false })
      .where(eq(followUps.id, followUp.id))

    const result = await resolveFollowUp({
      db,
      userId: tech.userId,
      followUpId: followUp.id,
      body: { comebackRecorded: true },
      recordCorpusComeback: vi.fn(),
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.status).toBe(400)
  })
})
