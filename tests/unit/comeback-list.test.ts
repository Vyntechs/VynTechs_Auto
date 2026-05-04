import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
} from '@/lib/db/queries'
import { followUps } from '@/lib/db/schema'
import { listDueFollowUpsForTech } from '@/lib/comeback/list'
import type { Profile } from '@/lib/db/schema'

const ONE_HOUR_MS = 60 * 60 * 1000

async function seedShopAndTech(db: TestDb): Promise<{
  shopId: string
  tech: Profile
}> {
  const shop = await createShop(db, { name: 'Test Shop' })
  const tech = await createProfile(db, {
    userId: crypto.randomUUID(),
    shopId: shop.id,
  })
  return { shopId: shop.id, tech }
}

async function seedSessionFor(
  db: TestDb,
  shopId: string,
  techId: string,
  vehicle: { year: number; make: string; model: string; engine?: string },
) {
  return createSession(db, {
    shopId,
    techId,
    intake: {
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      vehicleEngine: vehicle.engine,
      customerComplaint: 'loss of power',
    },
    treeState: {
      nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
      currentNodeId: 'root',
      message: 'go',
    },
  })
}

describe('listDueFollowUpsForTech', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('returns surfaced + unresolved follow-ups for the given tech with vehicle info', async () => {
    const { shopId, tech } = await seedShopAndTech(db)
    const session = await seedSessionFor(db, shopId, tech.id, {
      year: 2013,
      make: 'Ford',
      model: 'F-150',
      engine: '3.5L EcoBoost',
    })

    const now = new Date()
    await db.insert(followUps).values({
      sessionId: session.id,
      shopId,
      techId: tech.id,
      kind: '7d',
      dueAt: new Date(now.getTime() - ONE_HOUR_MS),
      surfacedAt: now,
    })

    const items = await listDueFollowUpsForTech(db, tech.id)
    expect(items).toHaveLength(1)
    expect(items[0].sessionId).toBe(session.id)
    expect(items[0].kind).toBe('7d')
    expect(items[0].intake.vehicleYear).toBe(2013)
    expect(items[0].intake.vehicleMake).toBe('Ford')
    expect(items[0].intake.vehicleModel).toBe('F-150')
    expect(items[0].intake.vehicleEngine).toBe('3.5L EcoBoost')
  })

  it('excludes resolved follow-ups', async () => {
    const { shopId, tech } = await seedShopAndTech(db)
    const session = await seedSessionFor(db, shopId, tech.id, {
      year: 2018,
      make: 'Ford',
      model: 'Escape',
    })
    const now = new Date()
    await db.insert(followUps).values({
      sessionId: session.id,
      shopId,
      techId: tech.id,
      kind: '7d',
      dueAt: new Date(now.getTime() - ONE_HOUR_MS),
      surfacedAt: now,
      resolvedAt: now,
    })

    const items = await listDueFollowUpsForTech(db, tech.id)
    expect(items).toHaveLength(0)
  })

  it('excludes follow-ups that have not yet been surfaced by the cron', async () => {
    const { shopId, tech } = await seedShopAndTech(db)
    const session = await seedSessionFor(db, shopId, tech.id, {
      year: 2018,
      make: 'Ford',
      model: 'Escape',
    })
    await db.insert(followUps).values({
      sessionId: session.id,
      shopId,
      techId: tech.id,
      kind: '7d',
      dueAt: new Date(Date.now() - ONE_HOUR_MS),
      // surfacedAt: null
    })
    const items = await listDueFollowUpsForTech(db, tech.id)
    expect(items).toHaveLength(0)
  })

  it('does not return follow-ups assigned to other techs in the same shop', async () => {
    const { shopId, tech: techA } = await seedShopAndTech(db)
    const techB = await createProfile(db, {
      userId: crypto.randomUUID(),
      shopId,
    })
    const sessionA = await seedSessionFor(db, shopId, techA.id, {
      year: 2013,
      make: 'Ford',
      model: 'F-150',
    })
    const sessionB = await seedSessionFor(db, shopId, techB.id, {
      year: 2018,
      make: 'Ford',
      model: 'Escape',
    })
    const now = new Date()
    await db.insert(followUps).values([
      {
        sessionId: sessionA.id,
        shopId,
        techId: techA.id,
        kind: '7d',
        dueAt: new Date(now.getTime() - ONE_HOUR_MS),
        surfacedAt: now,
      },
      {
        sessionId: sessionB.id,
        shopId,
        techId: techB.id,
        kind: '7d',
        dueAt: new Date(now.getTime() - ONE_HOUR_MS),
        surfacedAt: now,
      },
    ])

    const items = await listDueFollowUpsForTech(db, techA.id)
    expect(items).toHaveLength(1)
    expect(items[0].sessionId).toBe(sessionA.id)
  })

  it('orders results by dueAt ascending (most overdue first)', async () => {
    const { shopId, tech } = await seedShopAndTech(db)
    const sessions = await Promise.all([
      seedSessionFor(db, shopId, tech.id, { year: 2013, make: 'Ford', model: 'F-150' }),
      seedSessionFor(db, shopId, tech.id, { year: 2018, make: 'Ford', model: 'Escape' }),
      seedSessionFor(db, shopId, tech.id, { year: 2021, make: 'Toyota', model: 'Tacoma' }),
    ])
    const now = new Date()
    await db.insert(followUps).values([
      {
        sessionId: sessions[0].id,
        shopId,
        techId: tech.id,
        kind: '7d',
        dueAt: new Date(now.getTime() - 3 * ONE_HOUR_MS),
        surfacedAt: now,
      },
      {
        sessionId: sessions[1].id,
        shopId,
        techId: tech.id,
        kind: '7d',
        dueAt: new Date(now.getTime() - 5 * ONE_HOUR_MS),
        surfacedAt: now,
      },
      {
        sessionId: sessions[2].id,
        shopId,
        techId: tech.id,
        kind: '7d',
        dueAt: new Date(now.getTime() - 1 * ONE_HOUR_MS),
        surfacedAt: now,
      },
    ])

    const items = await listDueFollowUpsForTech(db, tech.id)
    expect(items.map((i) => i.intake.vehicleModel)).toEqual([
      'Escape', // -5h, most overdue
      'F-150', // -3h
      'Tacoma', // -1h, least overdue
    ])
  })
})
