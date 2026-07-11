import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireDiagnosticStart,
  finalizeDiagnosticStart,
  recordDiagnosticStartFailure,
  type DiagnosticStartActor,
} from '@/lib/shop-os/diagnostic-start'
import {
  customers,
  profiles,
  sessions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
  type TreeState,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const treeState: TreeState = {
  nodes: [{ id: 'root', label: 'Verify the concern', status: 'active' }],
  currentNodeId: 'root',
  message: 'Begin with a visual inspection.',
}

const acquiredContext = {
  vehicleId: uuid(21),
  intake: {
    vehicleYear: 2018,
    vehicleMake: 'Ford',
    vehicleModel: 'F-150',
    vehicleEngine: '3.5L EcoBoost',
    mileage: 84_000,
    customerComplaint: 'Intermittent no-start after heat soak',
  },
}

describe('Shop OS leased diagnostic start', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let ticketId: string
  let jobId: string
  let vehicleId: string
  let actor: DiagnosticStartActor
  let otherTechId: string

  const acquire = (
    attemptKey = uuid(100),
    overrides: Partial<Parameters<typeof acquireDiagnosticStart>[1]> = {},
  ) => acquireDiagnosticStart(db, {
    actor,
    ticketId,
    jobId,
    attemptKey,
    ...overrides,
  })

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North Shop' },
      { name: 'South Shop' },
    ]).returning()
    shopId = shop.id
    otherShopId = otherShop.id

    const [tech, otherTech, owner] = await db.insert(profiles).values([
      {
        id: uuid(1),
        userId: uuid(11),
        shopId,
        fullName: 'Taylor Tech',
        role: 'tech',
        skillTier: 2,
      },
      {
        id: uuid(2),
        userId: uuid(12),
        shopId,
        fullName: 'Terry Tech',
        role: 'tech',
        skillTier: 3,
      },
      {
        id: uuid(3),
        userId: uuid(13),
        shopId,
        fullName: 'Owen Owner',
        role: 'owner',
        skillTier: 3,
      },
    ]).returning()
    actor = { profileId: tech.id, shopId }
    otherTechId = otherTech.id

    const [customer] = await db.insert(customers).values({
      id: uuid(20),
      shopId,
      name: 'Maria Lopez',
      phone: '555-0100',
    }).returning()
    const [vehicle] = await db.insert(vehicles).values({
      id: uuid(21),
      customerId: customer.id,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
      engine: '3.5L EcoBoost',
      mileage: 84_000,
    }).returning()
    vehicleId = vehicle.id

    const [ticket] = await db.insert(tickets).values({
      id: uuid(30),
      shopId,
      ticketNumber: 1,
      source: 'counter',
      customerId: customer.id,
      vehicleId,
      concern: 'Intermittent no-start after heat soak',
      whenStarted: 'Last week',
      howOften: 'Twice daily',
      createdByProfileId: owner.id,
    }).returning()
    ticketId = ticket.id

    const [job] = await db.insert(ticketJobs).values({
      id: uuid(40),
      shopId,
      ticketId,
      title: 'Diagnose no-start',
      kind: 'diagnostic',
      requiredSkillTier: 2,
      assignedTechId: actor.profileId,
      claimedAt: new Date('2026-07-10T12:00:00Z'),
    }).returning()
    jobId = job.id
  })

  afterEach(async () => close())

  it('returns the owned linked session without acquiring another lease', async () => {
    await db.insert(sessions).values({
      id: uuid(50),
      shopId,
      techId: actor.profileId,
      vehicleId,
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'Intermittent no-start after heat soak',
      },
      treeState,
    })
    await db.update(ticketJobs).set({
      sessionId: uuid(50),
      diagnosticStartState: 'ready',
      workStatus: 'in_progress',
    }).where(eq(ticketJobs.id, jobId))

    await expect(acquire()).resolves.toEqual({
      ok: true,
      state: 'ready',
      sessionId: uuid(50),
    })
  })

  it('allows one conditional lease winner and makes a concurrent tap wait on the live lease', async () => {
    const results = await Promise.all([
      acquire(uuid(100)),
      acquire(uuid(101)),
    ])
    const first = results.find(
      (result) => result.ok && result.state === 'initializing' && result.leaseAcquired,
    )
    const second = results.find(
      (result) => result.ok && result.state === 'initializing' && !result.leaseAcquired,
    )
    const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const databaseResult = await db.execute<{ databaseNow: string }>(sql`
      select now() as "databaseNow"
    `)
    const databaseNow = databaseResult.rows[0].databaseNow

    expect(first).toMatchObject({
      ok: true,
      state: 'initializing',
      leaseAcquired: true,
      context: {
        vehicleId,
        intake: {
          vehicleYear: 2018,
          vehicleMake: 'Ford',
          vehicleModel: 'F-150',
          vehicleEngine: '3.5L EcoBoost',
          mileage: 84_000,
          customerComplaint: 'Intermittent no-start after heat soak',
        },
      },
    })
    expect(second).toEqual({ ok: true, state: 'initializing', leaseAcquired: false })
    expect(row.diagnosticStartAttemptKey).toBe(first?.ok && first.state === 'initializing'
      ? first.attemptKey
      : null)
    expect(row.diagnosticStartLeaseUntil!.getTime()).toBeGreaterThan(new Date(databaseNow).getTime())
  })

  it('returns a safe conflict when the attempt key already belongs to another job', async () => {
    const [otherTicket] = await db.insert(tickets).values({
      id: uuid(31),
      shopId,
      ticketNumber: 2,
      source: 'counter',
      customerId: (await db.select().from(customers))[0].id,
      vehicleId,
      concern: 'Second concern',
      createdByProfileId: actor.profileId,
    }).returning()
    const [otherJob] = await db.insert(ticketJobs).values({
      id: uuid(41),
      shopId,
      ticketId: otherTicket.id,
      title: 'Second diagnosis',
      kind: 'diagnostic',
      requiredSkillTier: 1,
      assignedTechId: actor.profileId,
    }).returning()
    await acquireDiagnosticStart(db, {
      actor,
      ticketId: otherTicket.id,
      jobId: otherJob.id,
      attemptKey: uuid(100),
    })

    await expect(acquire(uuid(100))).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'start unavailable',
    })
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0]
      .diagnosticStartState).toBe('idle')
  })

  it('uses database time to turn an expired lease ambiguous and never auto-acquires it', async () => {
    await db.update(ticketJobs).set({
      diagnosticStartState: 'initializing',
      diagnosticStartAttemptKey: uuid(99),
      diagnosticStartLeaseUntil: new Date('2000-01-01T00:00:00Z'),
    }).where(eq(ticketJobs.id, jobId))

    expect(await acquire(uuid(100))).toEqual({ ok: true, state: 'ambiguous' })
    const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(row.diagnosticStartState).toBe('ambiguous')
    expect(row.diagnosticStartAttemptKey).toBe(uuid(99))
    expect(row.diagnosticStartLeaseUntil).toBeNull()
  })

  it('requires explicit confirmation and a fresh key before leasing an ambiguous retry', async () => {
    await db.update(ticketJobs).set({
      diagnosticStartState: 'ambiguous',
      diagnosticStartAttemptKey: uuid(99),
      diagnosticStartErrorCode: 'provider_outcome_uncertain',
    }).where(eq(ticketJobs.id, jobId))

    expect(await acquire(uuid(100))).toEqual({ ok: true, state: 'ambiguous' })
    expect(await acquire(uuid(99), { confirmAmbiguousRetry: true })).toEqual({
      ok: true,
      state: 'ambiguous',
    })
    expect(await acquire(uuid(100), { confirmAmbiguousRetry: true })).toMatchObject({
      ok: true,
      state: 'initializing',
      leaseAcquired: true,
      attemptKey: uuid(100),
    })
  })

  it('uniformly rejects every role, tenant, tier, ownership, kind, and status gate', async () => {
    const expected = { ok: false, status: 404, error: 'not found' }
    const assertRejected = async (
      mutate: () => Promise<void>,
      call: () => Promise<unknown> = () => acquire(),
    ) => {
      await mutate()
      expect(await call()).toEqual(expected)
      await db.update(ticketJobs).set({
        kind: 'diagnostic',
        requiredSkillTier: 2,
        assignedTechId: actor.profileId,
        workStatus: 'open',
      }).where(eq(ticketJobs.id, jobId))
      await db.update(tickets).set({ status: 'open' }).where(eq(tickets.id, ticketId))
      await db.update(profiles).set({
        role: 'tech',
        skillTier: 2,
        membershipStatus: 'active',
        membershipActivatedAt: new Date(),
        deactivatedAt: null,
      }).where(eq(profiles.id, actor.profileId))
    }

    await assertRejected(
      async () => {},
      () => acquire(uuid(100), { actor: { ...actor, shopId: otherShopId } }),
    )
    await assertRejected(async () => {
      await db.update(ticketJobs).set({ assignedTechId: otherTechId }).where(eq(ticketJobs.id, jobId))
    })
    await assertRejected(async () => {
      await db.update(ticketJobs).set({ requiredSkillTier: 3 }).where(eq(ticketJobs.id, jobId))
    })
    await assertRejected(async () => {
      await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null })
        .where(eq(profiles.id, actor.profileId))
    })
    await assertRejected(async () => {
      await db.update(profiles).set({ deactivatedAt: new Date() })
        .where(eq(profiles.id, actor.profileId))
    })
    await assertRejected(async () => {
      await db.update(profiles).set({ role: 'customer' }).where(eq(profiles.id, actor.profileId))
    })
    await assertRejected(async () => {
      await db.update(ticketJobs).set({ kind: 'repair' }).where(eq(ticketJobs.id, jobId))
    })
    await assertRejected(async () => {
      await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticketId))
    })
    for (const workStatus of ['in_progress', 'blocked', 'done', 'canceled'] as const) {
      await assertRejected(async () => {
        await db.update(ticketJobs).set({ workStatus }).where(eq(ticketJobs.id, jobId))
      })
    }
  })

  it('atomically inserts and links the owned session with the persisted vehicle and intake snapshot', async () => {
    await acquire(uuid(100))
    const result = await finalizeDiagnosticStart(db, {
      actor,
      ticketId,
      jobId,
      attemptKey: uuid(100),
      sessionId: uuid(60),
      treeState,
      context: acquiredContext,
      maxCorpusSimilarity: 0.78,
    })

    expect(result).toEqual({ ok: true, state: 'ready', sessionId: uuid(60) })
    const [session] = await db.select().from(sessions).where(eq(sessions.id, uuid(60)))
    expect(session).toMatchObject({
      shopId,
      techId: actor.profileId,
      vehicleId,
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        vehicleEngine: '3.5L EcoBoost',
        mileage: 84_000,
        customerComplaint: 'Intermittent no-start after heat soak',
      },
      treeState,
      maxCorpusSimilarity: 0.78,
    })
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(job).toMatchObject({
      sessionId: uuid(60),
      workStatus: 'in_progress',
      diagnosticStartState: 'ready',
      diagnosticStartAttemptKey: null,
      diagnosticStartLeaseUntil: null,
      diagnosticStartErrorCode: null,
    })
  })

  it.each([
    ['concern', async (testDb: TestDb, currentTicketId: string) => {
      await testDb.update(tickets).set({ concern: 'Concern changed during generation' })
        .where(eq(tickets.id, currentTicketId))
    }],
    ['vehicle ID', async (testDb: TestDb, currentTicketId: string) => {
      const [customer] = await testDb.select().from(customers)
      const [replacement] = await testDb.insert(vehicles).values({
        id: uuid(22),
        customerId: customer.id,
        year: 2018,
        make: 'Ford',
        model: 'F-150',
        engine: '3.5L EcoBoost',
        mileage: 84_000,
      }).returning()
      await testDb.update(tickets).set({ vehicleId: replacement.id })
        .where(eq(tickets.id, currentTicketId))
    }],
    ['year', async (testDb: TestDb) => {
      await testDb.update(vehicles).set({ year: 2019 }).where(eq(vehicles.id, uuid(21)))
    }],
    ['make', async (testDb: TestDb) => {
      await testDb.update(vehicles).set({ make: 'Lincoln' }).where(eq(vehicles.id, uuid(21)))
    }],
    ['model', async (testDb: TestDb) => {
      await testDb.update(vehicles).set({ model: 'Navigator' }).where(eq(vehicles.id, uuid(21)))
    }],
    ['engine', async (testDb: TestDb) => {
      await testDb.update(vehicles).set({ engine: '5.0L' }).where(eq(vehicles.id, uuid(21)))
    }],
    ['mileage', async (testDb: TestDb) => {
      await testDb.update(vehicles).set({ mileage: 85_000 }).where(eq(vehicles.id, uuid(21)))
    }],
  ] as const)('settles ambiguous without persistence when acquired %s drifts', async (_field, mutate) => {
    await acquire(uuid(100))
    await mutate(db, ticketId)

    expect(await finalizeDiagnosticStart(db, {
      actor,
      ticketId,
      jobId,
      attemptKey: uuid(100),
      sessionId: uuid(60),
      treeState,
      context: acquiredContext,
    })).toEqual({ ok: true, state: 'ambiguous' })
    expect(await db.select().from(sessions)).toHaveLength(0)
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0])
      .toMatchObject({ sessionId: null, diagnosticStartState: 'ambiguous' })
  })

  it('rejects an empty generated tree without inserting or linking a session', async () => {
    await acquire(uuid(100))

    expect(await finalizeDiagnosticStart(db, {
      actor,
      ticketId,
      jobId,
      attemptKey: uuid(100),
      sessionId: uuid(60),
      treeState: { nodes: [], currentNodeId: '', message: '' },
      context: acquiredContext,
    })).toEqual({ ok: true, state: 'ambiguous' })
    expect(await db.select().from(sessions)).toHaveLength(0)
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0])
      .toMatchObject({ sessionId: null, diagnosticStartState: 'ambiguous' })
  })

  it('makes repeated and competing finalizers recover the one canonical linked session', async () => {
    await acquire(uuid(100))
    const first = await finalizeDiagnosticStart(db, {
      actor,
      ticketId,
      jobId,
      attemptKey: uuid(100),
      sessionId: uuid(60),
      treeState,
      context: acquiredContext,
    })
    const competing = await finalizeDiagnosticStart(db, {
      actor,
      ticketId,
      jobId,
      attemptKey: uuid(100),
      sessionId: uuid(61),
      treeState,
      context: acquiredContext,
    })

    expect(first).toEqual({ ok: true, state: 'ready', sessionId: uuid(60) })
    expect(competing).toEqual({ ok: true, state: 'ready', sessionId: uuid(60) })
    expect(await db.select().from(sessions)).toHaveLength(1)
  })

  it('rolls back an inserted session when the conditional link loses ownership', async () => {
    await acquire(uuid(100))
    const result = await finalizeDiagnosticStart(db, {
      actor,
      ticketId,
      jobId,
      attemptKey: uuid(100),
      sessionId: uuid(60),
      treeState,
      context: acquiredContext,
    }, {
      beforeLink: async (tx) => {
        await tx.update(ticketJobs).set({ diagnosticStartAttemptKey: uuid(101) })
          .where(eq(ticketJobs.id, jobId))
      },
    })

    expect(result).toEqual({ ok: true, state: 'ambiguous' })
    expect(await db.select().from(sessions)).toHaveLength(0)
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0])
      .toMatchObject({ diagnosticStartState: 'ambiguous', sessionId: null })
  })

  it('never links the old technician after assignment changes during provider work', async () => {
    await acquire(uuid(100))
    await db.update(ticketJobs).set({ assignedTechId: otherTechId })
      .where(eq(ticketJobs.id, jobId))

    expect(await finalizeDiagnosticStart(db, {
      actor,
      ticketId,
      jobId,
      attemptKey: uuid(100),
      sessionId: uuid(60),
      treeState,
      context: acquiredContext,
    })).toEqual({ ok: true, state: 'ambiguous' })

    expect(await db.select().from(sessions)).toHaveLength(0)
    const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(row).toMatchObject({
      assignedTechId: otherTechId,
      sessionId: null,
      workStatus: 'open',
      diagnosticStartState: 'ambiguous',
      diagnosticStartAttemptKey: uuid(100),
    })
  })

  it('records certain pre-provider failure as failed and uncertain outcomes as ambiguous', async () => {
    await acquire(uuid(100))
    expect(await recordDiagnosticStartFailure(db, {
      actor,
      ticketId,
      jobId,
      attemptKey: uuid(100),
      certainty: 'certain',
      errorCode: 'initialization_failed',
    })).toEqual({ ok: true, state: 'failed' })

    await acquire(uuid(101))
    expect(await recordDiagnosticStartFailure(db, {
      actor,
      ticketId,
      jobId,
      attemptKey: uuid(101),
      certainty: 'uncertain',
      errorCode: 'provider_outcome_uncertain',
    })).toEqual({ ok: true, state: 'ambiguous' })
    const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(row).toMatchObject({
      diagnosticStartState: 'ambiguous',
      diagnosticStartAttemptKey: uuid(101),
      diagnosticStartLeaseUntil: null,
      diagnosticStartErrorCode: 'provider_outcome_uncertain',
    })
  })

  it('turns an expired finalize ambiguous instead of persisting a late provider result', async () => {
    await acquire(uuid(100))
    await db.update(ticketJobs).set({
      diagnosticStartLeaseUntil: new Date('2000-01-01T00:00:00Z'),
    }).where(eq(ticketJobs.id, jobId))

    expect(await finalizeDiagnosticStart(db, {
      actor,
      ticketId,
      jobId,
      attemptKey: uuid(100),
      sessionId: uuid(60),
      treeState,
      context: acquiredContext,
    })).toEqual({ ok: true, state: 'ambiguous' })
    expect(await db.select().from(sessions)).toHaveLength(0)
  })

  it('fences a stale worker after an expired attempt is explicitly replaced', async () => {
    await acquire(uuid(100))
    await db.update(ticketJobs).set({
      diagnosticStartLeaseUntil: new Date('2000-01-01T00:00:00Z'),
    }).where(eq(ticketJobs.id, jobId))
    expect(await acquire(uuid(101))).toEqual({ ok: true, state: 'ambiguous' })
    expect(await acquire(uuid(101), { confirmAmbiguousRetry: true })).toMatchObject({
      ok: true,
      state: 'initializing',
      leaseAcquired: true,
      attemptKey: uuid(101),
    })

    expect(await finalizeDiagnosticStart(db, {
      actor,
      ticketId,
      jobId,
      attemptKey: uuid(100),
      sessionId: uuid(60),
      treeState,
      context: acquiredContext,
    })).toEqual({ ok: true, state: 'initializing', leaseAcquired: false })
    expect(await recordDiagnosticStartFailure(db, {
      actor,
      ticketId,
      jobId,
      attemptKey: uuid(100),
      certainty: 'uncertain',
      errorCode: 'provider_outcome_uncertain',
    })).toEqual({ ok: true, state: 'initializing', leaseAcquired: false })

    expect(await db.select().from(sessions)).toHaveLength(0)
    const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(row).toMatchObject({
      sessionId: null,
      workStatus: 'open',
      diagnosticStartState: 'initializing',
      diagnosticStartAttemptKey: uuid(101),
      diagnosticStartErrorCode: null,
    })
  })
})
