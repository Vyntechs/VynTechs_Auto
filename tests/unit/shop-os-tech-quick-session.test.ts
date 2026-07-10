import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { profiles, sessions, shops, ticketJobs, tickets } from '@/lib/db/schema'
import {
  createSessionForUser,
  findCompletedTechQuickSessionForUser,
  type CreateSessionWrapper,
} from '@/lib/sessions'
import { createTechQuickTicketInTransaction } from '@/lib/tickets'
import type { TreeState } from '@/lib/ai/tree-engine'

const treeState: TreeState = {
  nodes: [{ id: 'root', label: 'Initial scan', status: 'pending' }],
  currentNodeId: 'root',
  message: 'starting',
}

const intake = {
  vehicleYear: 2018,
  vehicleMake: 'Ford',
  vehicleModel: 'F-150',
  customerComplaint: 'loss of power going up hills',
}

describe('Shop OS tech-quick session wrapper', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shop: typeof shops.$inferSelect

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    ;[shop] = await db.insert(shops).values({ name: 'North Shop' }).returning()
  })

  afterEach(async () => {
    await close()
  })

  async function seedActor(
    overrides: Partial<typeof profiles.$inferInsert> = {},
  ) {
    const [profile] = await db
      .insert(profiles)
      .values({
        userId: crypto.randomUUID(),
        shopId: shop.id,
        role: 'tech',
        skillTier: 2,
        ...overrides,
      })
      .returning()
    return profile
  }

  async function createFor(
    profile: typeof profiles.$inferSelect,
    requestKey = crypto.randomUUID(),
    createWrapper?: CreateSessionWrapper,
  ) {
    return createSessionForUser({
      db,
      userId: profile.userId,
      body: { ...intake, requestKey },
      treeState,
      createWrapper,
    })
  }

  it('atomically creates one session, one null-identity tech-quick ticket, and one linked diagnostic job', async () => {
    const profile = await seedActor({ role: 'advisor', skillTier: 3 })
    const requestKey = crypto.randomUUID()

    const result = await createFor(profile, requestKey)

    expect(result).toMatchObject({ ok: true, id: requestKey })
    if (!result.ok) throw new Error('create failed')
    const [storedSession] = await db.select().from(sessions)
    const [ticket] = await db.select().from(tickets)
    const [job] = await db.select().from(ticketJobs)
    expect(storedSession).toMatchObject({
      id: requestKey,
      shopId: shop.id,
      techId: profile.id,
      intake,
      treeState,
      status: 'open',
      vehicleId: null,
    })
    expect(ticket).toMatchObject({
      id: result.ticketId,
      shopId: shop.id,
      ticketNumber: 1,
      source: 'tech_quick',
      customerId: null,
      vehicleId: null,
      concern: intake.customerComplaint,
      status: 'open',
      createdByProfileId: profile.id,
      diagnosticAuthorizedCents: null,
      diagnosticAuthorizationNote: null,
    })
    expect(job).toMatchObject({
      id: result.jobId,
      shopId: shop.id,
      ticketId: ticket.id,
      title: intake.customerComplaint,
      kind: 'diagnostic',
      requiredSkillTier: 3,
      assignedTechId: profile.id,
      sessionId: requestKey,
      workStatus: 'open',
      approvalState: 'pending_quote',
      diagnosticStartState: 'idle',
    })
  })

  it('returns the same IDs for the same actor and request key without duplicating rows', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()

    const first = await createFor(profile, requestKey)
    const second = await createFor(profile, requestKey)

    expect(second).toEqual(first)
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(2)
  })

  it('read-only preflight returns canonical IDs for a completed identical key without mutation', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    const created = await createFor(profile, requestKey)
    const before = {
      sessions: await db.select().from(sessions),
      tickets: await db.select().from(tickets),
      jobs: await db.select().from(ticketJobs),
      nextTicketNumber: (await db.select().from(shops))[0].nextTicketNumber,
    }

    const preflight = await findCompletedTechQuickSessionForUser({
      db,
      userId: profile.userId,
      body: { ...intake, requestKey },
    })

    expect(preflight).toEqual(
      created.ok
        ? { ok: true, state: 'match', id: created.id, ticketId: created.ticketId, jobId: created.jobId }
        : created,
    )
    expect(await db.select().from(sessions)).toEqual(before.sessions)
    expect(await db.select().from(tickets)).toEqual(before.tickets)
    expect(await db.select().from(ticketJobs)).toEqual(before.jobs)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(before.nextTicketNumber)
  })

  it('read-only preflight reports missing for a valid new key without mutation', async () => {
    const profile = await seedActor()
    const result = await findCompletedTechQuickSessionForUser({
      db,
      userId: profile.userId,
      body: { ...intake, requestKey: crypto.randomUUID() },
    })
    expect(result).toEqual({ ok: true, state: 'missing' })
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(1)
  })

  it('read-only preflight fails closed for changed, cross-actor, and noncanonical reuse', async () => {
    const profile = await seedActor()
    const other = await seedActor()
    const requestKey = crypto.randomUUID()
    const created = await createFor(profile, requestKey)
    if (!created.ok) throw new Error('initial create failed')

    const changed = await findCompletedTechQuickSessionForUser({
      db,
      userId: profile.userId,
      body: { ...intake, customerComplaint: 'changed complaint text', requestKey },
    })
    const crossActor = await findCompletedTechQuickSessionForUser({
      db,
      userId: other.userId,
      body: { ...intake, requestKey },
    })
    await db.update(ticketJobs).set({ title: 'noncanonical' }).where(eq(ticketJobs.id, created.jobId))
    const noncanonical = await findCompletedTechQuickSessionForUser({
      db,
      userId: profile.userId,
      body: { ...intake, requestKey },
    })

    for (const result of [changed, crossActor, noncanonical]) {
      expect(result).toEqual({ ok: false, status: 400, error: 'request key unavailable' })
    }
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(2)
  })

  it('read-only preflight fails closed for invalid actor state and malformed body', async () => {
    const pending = await seedActor({ membershipStatus: 'pending', membershipActivatedAt: null })
    const unsupported = await seedActor({ role: 'curator' })
    const valid = await seedActor()

    const results = await Promise.all([
      findCompletedTechQuickSessionForUser({
        db,
        userId: pending.userId,
        body: { ...intake, requestKey: crypto.randomUUID() },
      }),
      findCompletedTechQuickSessionForUser({
        db,
        userId: unsupported.userId,
        body: { ...intake, requestKey: crypto.randomUUID() },
      }),
      findCompletedTechQuickSessionForUser({
        db,
        userId: valid.userId,
        body: { ...intake, requestKey: 'not-a-uuid' },
      }),
    ])

    for (const result of results) expect(result).toMatchObject({ ok: false, status: 400 })
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(1)
  })

  it('returns the original wrapper when the same active actor has since changed to another valid tier', async () => {
    const profile = await seedActor({ skillTier: 1 })
    const requestKey = crypto.randomUUID()
    const first = await createFor(profile, requestKey)
    await db
      .update(profiles)
      .set({ skillTier: 3 })
      .where(eq(profiles.id, profile.id))

    const retry = await createFor(profile, requestKey)

    expect(retry).toEqual(first)
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
    expect((await db.select().from(ticketJobs))[0].requiredSkillTier).toBe(1)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(2)
  })

  it('rejects same-actor reuse of a request key with changed normalized intake', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    const first = await createFor(profile, requestKey)

    const changed = await createSessionForUser({
      db,
      userId: profile.userId,
      body: {
        ...intake,
        customerComplaint: 'intermittent no-start after heat soak',
        requestKey,
      },
      treeState,
    })

    expect(first.ok).toBe(true)
    expect(changed).toMatchObject({ ok: false, status: 400, error: 'request key unavailable' })
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
  })

  it('rejects same-actor reuse when the persisted wrapper is not canonical', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    const first = await createFor(profile, requestKey)
    if (!first.ok) throw new Error('initial create failed')
    await db
      .update(ticketJobs)
      .set({ title: 'Unrelated diagnostic', requiredSkillTier: 1 })
      .where(eq(ticketJobs.id, first.jobId))

    const retry = await createFor(profile, requestKey)

    expect(retry).toMatchObject({ ok: false, status: 400, error: 'request key unavailable' })
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
  })

  it('serializes concurrent identical keys to one canonical result in the PGlite harness', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()

    const [first, second] = await Promise.all([
      createFor(profile, requestKey),
      createFor(profile, requestKey),
    ])

    expect(first).toEqual(second)
    expect(first.ok).toBe(true)
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(2)
  })

  it('allows one winner and rejects divergent intake when concurrent calls share a key', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()

    const [first, second] = await Promise.all([
      createFor(profile, requestKey),
      createSessionForUser({
        db,
        userId: profile.userId,
        body: {
          ...intake,
          customerComplaint: 'intermittent no-start after heat soak',
          requestKey,
        },
        treeState,
      }),
    ])

    expect([first.ok, second.ok].filter(Boolean)).toHaveLength(1)
    expect([first, second].find((result) => !result.ok)).toMatchObject({
      ok: false,
      status: 400,
      error: 'request key unavailable',
    })
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(2)
  })

  it.each([
    ['pending', { membershipStatus: 'pending' as const, membershipActivatedAt: null }],
    ['deactivated', { deactivatedAt: new Date('2026-07-10T12:00:00Z') }],
    ['null tier', { skillTier: null }],
  ])('fails closed for a %s wrenching profile', async (_label, overrides) => {
    const profile = await seedActor(overrides)
    const result = await createFor(profile)
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })

  it.each(['curator', 'legacy_tech'])('fails closed for unsupported role %s even with a valid tier', async (role) => {
    const profile = await seedActor({ role, skillTier: 2 })
    const result = await createFor(profile)
    expect(result).toMatchObject({ ok: false, status: 400 })
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(1)
  })

  it('fails closed for missing profile, missing shop, malformed intake, and malformed request key', async () => {
    const missingProfile = await createSessionForUser({
      db,
      userId: crypto.randomUUID(),
      body: { ...intake, requestKey: crypto.randomUUID() },
      treeState,
    })
    const noShop = await seedActor({ shopId: null })
    const valid = await seedActor()

    expect(missingProfile).toMatchObject({ ok: false, status: 400 })
    expect(await createFor(noShop)).toMatchObject({ ok: false, status: 400 })
    expect(
      await createSessionForUser({
        db,
        userId: valid.userId,
        body: { vehicleYear: 2018, requestKey: crypto.randomUUID() },
        treeState,
      }),
    ).toMatchObject({ ok: false, status: 400 })
    expect(await createFor(valid, 'not-a-uuid')).toMatchObject({ ok: false, status: 400 })
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })

  it('rejects a cross-actor request-key collision without exposing or changing the first result', async () => {
    const firstActor = await seedActor()
    const secondActor = await seedActor({ role: 'owner', skillTier: 1 })
    const requestKey = crypto.randomUUID()
    const first = await createFor(firstActor, requestKey)

    const collision = await createFor(secondActor, requestKey)

    expect(first.ok).toBe(true)
    expect(collision).toMatchObject({ ok: false, status: 400 })
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
    expect(
      await db
        .select()
        .from(ticketJobs)
        .where(and(eq(ticketJobs.sessionId, requestKey), eq(ticketJobs.assignedTechId, firstActor.id))),
    ).toHaveLength(1)
  })

  it('rolls back the session, wrapper rows, and ticket-number allocation when wrapper creation fails', async () => {
    const profile = await seedActor()
    const failingWrapper: CreateSessionWrapper = async (tx, wrapperInput) => {
      await createTechQuickTicketInTransaction(tx, wrapperInput)
      throw new Error('injected wrapper failure')
    }

    const result = await createFor(profile, crypto.randomUUID(), failingWrapper)

    expect(result).toMatchObject({ ok: false, status: 500 })
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(1)
  })
})
