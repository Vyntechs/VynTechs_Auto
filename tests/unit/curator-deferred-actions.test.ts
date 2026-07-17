import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import {
  customers,
  profiles,
  sessions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
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
const CUSTOMER_ID = '00000000-0000-0000-0000-000000000060'
const VEHICLE_ID = '00000000-0000-0000-0000-000000000061'
const TICKET_ID = '00000000-0000-0000-0000-000000000062'
const JOB_ID = '00000000-0000-0000-0000-000000000063'

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

  async function linkSessionToTicket() {
    await db.insert(customers).values({
      id: CUSTOMER_ID,
      shopId: SHOP,
      name: 'Linked customer',
      phone: '5550100060',
    })
    await db.insert(vehicles).values({
      id: VEHICLE_ID,
      customerId: CUSTOMER_ID,
      year: 2020,
      make: 'Ford',
      model: 'F-250',
    })
    await db.insert(tickets).values({
      id: TICKET_ID,
      shopId: SHOP,
      ticketNumber: 1,
      source: 'counter',
      customerId: CUSTOMER_ID,
      vehicleId: VEHICLE_ID,
      concern: 'Linked curator boundary proof',
      createdByProfileId: CURATOR_PROFILE,
    })
    await db.insert(ticketJobs).values({
      id: JOB_ID,
      shopId: SHOP,
      ticketId: TICKET_ID,
      title: 'Linked diagnostic job',
      kind: 'diagnostic',
      requiredSkillTier: 1,
      assignedTechId: TECH_PROFILE,
      sessionId: SESSION_ID,
    })
  }

  // ── Case 1: approveDeferredSession ───────────────────────────────────────

  it('approveDeferredSession: status→open, closedAt→null, curatorNote stamped, curatorOverrideAction→null', async () => {
    const result = await approveDeferredSession(db, SESSION_ID, 'tech has info now')

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
    const result = await closeDeferredSession(db, SESSION_ID, 'no action needed')

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
    const approveResult = await approveDeferredSession(db, UNKNOWN_ID, null)
    expect(approveResult.kind).toBe('not-found')

    const overrideResult = await overrideDeferredSession(db, UNKNOWN_ID, 'action', null)
    expect(overrideResult.kind).toBe('not-found')

    const closeResult = await closeDeferredSession(db, UNKNOWN_ID, null)
    expect(closeResult.kind).toBe('not-found')
  })

  it('locks and refuses a ticket-linked session identically for every curator action', async () => {
    await linkSessionToTicket()

    expect(await approveDeferredSession(db, SESSION_ID, 'approve')).toEqual({ kind: 'not-found' })
    expect(await overrideDeferredSession(db, SESSION_ID, 'override', 'note')).toEqual({ kind: 'not-found' })
    expect(await closeDeferredSession(db, SESSION_ID, 'close')).toEqual({ kind: 'not-found' })

    const [unchanged] = await db.select().from(sessions).where(eq(sessions.id, SESSION_ID))
    expect(unchanged).toMatchObject({
      status: 'deferred',
      curatorNote: null,
      curatorOverrideAction: null,
    })
  })

  it('refuses non-deferred lifecycle drift identically and leaves the row unchanged', async () => {
    await db.update(sessions).set({ status: 'open', closedAt: null }).where(eq(sessions.id, SESSION_ID))

    expect(await approveDeferredSession(db, SESSION_ID, 'approve')).toEqual({ kind: 'not-found' })
    expect(await overrideDeferredSession(db, SESSION_ID, 'override', 'note')).toEqual({ kind: 'not-found' })
    expect(await closeDeferredSession(db, SESSION_ID, 'close')).toEqual({ kind: 'not-found' })

    const [unchanged] = await db.select().from(sessions).where(eq(sessions.id, SESSION_ID))
    expect(unchanged).toMatchObject({
      status: 'open',
      curatorNote: null,
      curatorOverrideAction: null,
    })
  })

  it('rolls back a failed curator update without partially changing the session', async () => {
    await db.execute(sql`
      create function fail_curator_deferred_update() returns trigger
      language plpgsql as $$ begin raise exception 'injected curator update failure'; end $$
    `)
    await db.execute(sql`
      create trigger fail_curator_deferred_update
      before update on sessions
      for each row execute function fail_curator_deferred_update()
    `)

    await expect(approveDeferredSession(db, SESSION_ID, 'must roll back'))
      .rejects.toBeDefined()

    const [unchanged] = await db.select().from(sessions).where(eq(sessions.id, SESSION_ID))
    expect(unchanged).toMatchObject({
      status: 'deferred',
      curatorNote: null,
      curatorOverrideAction: null,
    })
  })

  it('owns the session lock and ticket-link check inside each action transaction', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'lib/curator/deferred-actions.ts'),
      'utf8',
    )

    expect(source).toContain('db.transaction(')
    expect(source).toContain(".for('update')")
    expect(source).toContain('ticketJobs')
    expect(source).toContain('eq(ticketJobs.sessionId, sessionId)')
    expect(source).toContain("eq(sessions.status, 'deferred')")
  })
})
