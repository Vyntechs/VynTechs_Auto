import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { sessions, profiles, shops } from '@/lib/db/schema'
import { createTestDb, type TestDb } from '../helpers/db'
import {
  approveDeferredSession,
  overrideDeferredSession,
  closeDeferredSession,
} from '@/lib/curator/deferred-actions'

const SHOP = '00000000-0000-0000-0000-000000000001'
const CURATOR_USER = '00000000-0000-0000-0000-000000000030'
const CURATOR_PROFILE = '00000000-0000-0000-0000-000000000031'
const TECH_USER = '00000000-0000-0000-0000-000000000040'
const TECH_PROFILE = '00000000-0000-0000-0000-000000000041'
const SESSION_ID = '00000000-0000-0000-0000-000000000050'
const UNKNOWN_ID = '00000000-0000-0000-0000-999999999999'

// Minimal tree state required by the sessions.treeState notNull constraint
const STUB_TREE = {
  nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' as const }],
  currentNodeId: 'root',
  message: 'go',
}

describe('curator deferred-actions handlers', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())

    await db.insert(shops).values({ id: SHOP, name: 'Test Shop' })

    await db.insert(profiles).values([
      { id: CURATOR_PROFILE, userId: CURATOR_USER, shopId: SHOP, role: 'curator' },
      { id: TECH_PROFILE, userId: TECH_USER, shopId: SHOP, role: 'tech' },
    ])

    // Seed a deferred session — closedAt is set (deferred sessions use closedAt
    // as the deferral timestamp, per setSessionTerminalStatus in queries.ts)
    await db.insert(sessions).values({
      id: SESSION_ID,
      shopId: SHOP,
      techId: TECH_PROFILE,
      status: 'deferred',
      intake: {
        vehicleYear: 2019,
        vehicleMake: 'Toyota',
        vehicleModel: 'Tundra',
        customerComplaint: 'intermittent no-start',
      },
      treeState: STUB_TREE,
      closedAt: new Date('2026-05-01T10:00:00Z'),
    })
  })

  afterEach(async () => {
    await close()
  })

  // ── Case 1: approveDeferredSession ───────────────────────────────────────

  it('approveDeferredSession: status→open, closedAt→null, curatorNote stamped, curatorOverrideAction→null', async () => {
    const result = await approveDeferredSession(db, SESSION_ID, CURATOR_PROFILE, 'tech has info now')

    expect(result.kind).toBe('ok')

    const [updated] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, SESSION_ID))

    expect(updated.status).toBe('open')
    expect(updated.closedAt).toBeNull()
    expect(updated.curatorNote).toBe('tech has info now')
    expect(updated.curatorOverrideAction).toBeNull()
  })

  // ── Case 2: overrideDeferredSession ─────────────────────────────────────

  it('overrideDeferredSession: status→open, closedAt→null, curatorOverrideAction stamped, curatorNote stamped', async () => {
    const result = await overrideDeferredSession(
      db,
      SESSION_ID,
      CURATOR_PROFILE,
      'proceed-with-replacement',
      'curator reviewed wiring diagrams',
    )

    expect(result.kind).toBe('ok')

    const [updated] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, SESSION_ID))

    expect(updated.status).toBe('open')
    expect(updated.closedAt).toBeNull()
    expect(updated.curatorOverrideAction).toBe('proceed-with-replacement')
    expect(updated.curatorNote).toBe('curator reviewed wiring diagrams')
  })

  // ── Case 3: closeDeferredSession ─────────────────────────────────────────

  it('closeDeferredSession: status→closed, closedAt→non-null Date, curatorNote stamped', async () => {
    const result = await closeDeferredSession(db, SESSION_ID, CURATOR_PROFILE, 'no action needed')

    expect(result.kind).toBe('ok')

    const [updated] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, SESSION_ID))

    expect(updated.status).toBe('closed')
    expect(updated.closedAt).not.toBeNull()
    expect(updated.closedAt).toBeInstanceOf(Date)
    expect(updated.curatorNote).toBe('no action needed')
  })

  // ── Case 4: not-found guard (shared pattern) ─────────────────────────────

  it('returns not-found for an unknown session id', async () => {
    const approveResult = await approveDeferredSession(db, UNKNOWN_ID, CURATOR_PROFILE, null)
    expect(approveResult.kind).toBe('not-found')

    const overrideResult = await overrideDeferredSession(db, UNKNOWN_ID, CURATOR_PROFILE, 'action', null)
    expect(overrideResult.kind).toBe('not-found')

    const closeResult = await closeDeferredSession(db, UNKNOWN_ID, CURATOR_PROFILE, null)
    expect(closeResult.kind).toBe('not-found')
  })
})
