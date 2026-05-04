import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  createShop,
  createProfile,
  createSession,
} from '@/lib/db/queries'
import { followUps } from '@/lib/db/schema'
import { surfaceDueFollowUps } from '@/lib/comeback/surface'

const ONE_HOUR_MS = 60 * 60 * 1000

async function seedFollowUp(
  db: TestDb,
  opts: {
    dueAt: Date
    surfacedAt?: Date | null
    resolvedAt?: Date | null
    kind?: '7d' | '30d'
  },
) {
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
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'loss of power',
    },
    treeState: {
      nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
      currentNodeId: 'root',
      message: 'go',
    },
  })
  const [row] = await db
    .insert(followUps)
    .values({
      sessionId: session.id,
      shopId: shop.id,
      techId: tech.id,
      kind: opts.kind ?? '7d',
      dueAt: opts.dueAt,
      surfacedAt: opts.surfacedAt ?? null,
      resolvedAt: opts.resolvedAt ?? null,
    })
    .returning()
  return row
}

describe('surfaceDueFollowUps', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('flips surfaced_at on rows whose due_at has passed and are unsurfaced + unresolved', async () => {
    const due = await seedFollowUp(db, {
      dueAt: new Date(Date.now() - ONE_HOUR_MS),
    })

    const result = await surfaceDueFollowUps(db)
    expect(result.surfaced).toBe(1)

    const [row] = await db.select().from(followUps).where(eq(followUps.id, due.id))
    expect(row.surfacedAt).not.toBeNull()
  })

  it('does not re-surface rows that already have surfaced_at set', async () => {
    const already = await seedFollowUp(db, {
      dueAt: new Date(Date.now() - ONE_HOUR_MS),
      surfacedAt: new Date(Date.now() - 10_000),
    })
    const before = already.surfacedAt

    const result = await surfaceDueFollowUps(db)
    expect(result.surfaced).toBe(0)

    const [row] = await db.select().from(followUps).where(eq(followUps.id, already.id))
    expect(row.surfacedAt?.getTime()).toBe(before?.getTime())
  })

  it('does not surface resolved follow-ups', async () => {
    const resolved = await seedFollowUp(db, {
      dueAt: new Date(Date.now() - ONE_HOUR_MS),
      resolvedAt: new Date(),
    })
    const result = await surfaceDueFollowUps(db)
    expect(result.surfaced).toBe(0)

    const [row] = await db.select().from(followUps).where(eq(followUps.id, resolved.id))
    expect(row.surfacedAt).toBeNull()
  })

  it('does not surface follow-ups whose due_at is still in the future', async () => {
    const futureRow = await seedFollowUp(db, {
      dueAt: new Date(Date.now() + ONE_HOUR_MS),
    })
    const result = await surfaceDueFollowUps(db)
    expect(result.surfaced).toBe(0)

    const [row] = await db.select().from(followUps).where(eq(followUps.id, futureRow.id))
    expect(row.surfacedAt).toBeNull()
  })
})
