import { and, eq, sql } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import {
  customers,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  sessions,
  shops,
  ticketJobs,
  ticketMutationReceipts,
  tickets,
  vehicles,
  vendorAccounts,
} from '@/lib/db/schema'
import {
  createSessionForUser,
  findCompletedTechQuickSessionForUser,
  replayCompletedTechQuickSessionForUser,
} from '@/lib/sessions'
import type { TreeState } from '@/lib/ai/tree-engine'
import { ShopOsMutationConflict } from '@/lib/shop-os/continuity/mutation-foundation/conflicts'

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
  ) {
    return createSessionForUser({
      db,
      userId: profile.userId,
      body: { ...intake, requestKey },
      treeState,
    })
  }

  async function replayFor(
    profile: typeof profiles.$inferSelect,
    requestKey: string,
    body: unknown = { ...intake, requestKey },
  ) {
    const module = await import('@/lib/sessions')
    const replay = (module as Record<string, unknown>).replayCompletedTechQuickSessionForUser
    if (typeof replay !== 'function') throw new Error('locked replay handler missing')
    return (replay as (input: {
      db: TestDb
      userId: string
      body: unknown
    }) => Promise<unknown>)({ db, userId: profile.userId, body })
  }

  async function seedReplayTuple(
    profile: typeof profiles.$inferSelect,
    requestKey: string,
    shape: Readonly<{
      sequenceNumber: number | null
      createdByProfileId: 'actor' | null
      creatorProvenance: 'ticket_creator_backfill' | 'direct' | null
      jobRevision: bigint
      ticketRevision: bigint
      createdFromJobId?: string | null
      source?: 'counter' | 'tech_quick'
      customerId?: string | null
      vehicleId?: string | null
    }>,
  ) {
    const ticketId = crypto.randomUUID()
    const jobId = crypto.randomUUID()
    await db.update(shops).set({ nextTicketNumber: 2 }).where(eq(shops.id, shop.id))
    await db.insert(sessions).values({
      id: requestKey,
      shopId: shop.id,
      techId: profile.id,
      intake,
      treeState,
    })
    await db.insert(tickets).values({
      id: ticketId,
      shopId: shop.id,
      ticketNumber: 1,
      source: shape.source ?? 'tech_quick',
      customerId: shape.customerId ?? null,
      vehicleId: shape.vehicleId ?? null,
      concern: intake.customerComplaint,
      createdByProfileId: profile.id,
      projectionRevision: shape.ticketRevision,
      continuityRevision: shape.ticketRevision,
    })
    await db.insert(ticketJobs).values({
      id: jobId,
      shopId: shop.id,
      ticketId,
      title: intake.customerComplaint,
      kind: 'diagnostic',
      requiredSkillTier: profile.skillTier!,
      assignedTechId: profile.id,
      sessionId: requestKey,
      sequenceNumber: shape.creatorProvenance === 'ticket_creator_backfill'
        ? null
        : shape.sequenceNumber,
      createdByProfileId: shape.creatorProvenance === 'ticket_creator_backfill'
        ? null
        : shape.createdByProfileId === 'actor' ? profile.id : null,
      creatorProvenance: shape.creatorProvenance === 'ticket_creator_backfill'
        ? null
        : shape.creatorProvenance,
      createdFromJobId: shape.createdFromJobId ?? null,
      revision: shape.jobRevision,
    })
    if (shape.creatorProvenance === 'ticket_creator_backfill') {
      await db.update(ticketJobs).set({
        sequenceNumber: shape.sequenceNumber,
        createdByProfileId: shape.createdByProfileId === 'actor' ? profile.id : null,
        creatorProvenance: 'ticket_creator_backfill',
      }).where(eq(ticketJobs.id, jobId))
    }
    return { ok: true as const, id: requestKey, ticketId, jobId }
  }

  it('uses one bounded foundation chain and removes the legacy wrapper seam', async () => {
    const root = process.cwd()
    const sessionSource = await readFile(path.join(root, 'lib/sessions.ts'), 'utf8')
    const ticketSource = await readFile(path.join(root, 'lib/tickets.ts'), 'utf8')

    expect(sessionSource).toContain('runBoundedShopOsMutationV1')
    expect(sessionSource.match(/createTechQuickTicketOriginV1\(/g)).toHaveLength(1)
    for (const required of [
      'resolveTicketCreationInLockedScopeV1',
      'insertResolvedTicketBatchInTransactionV1',
      'finalizeResolvedTicketCreationInTransactionV1',
      'readFinalizedTicketCreationResultV1',
      'readResolvedTechQuickReplayResultV1',
    ]) expect(sessionSource).toContain(required)
    for (const forbidden of [
      'CreateSessionWrapper',
      'createWrapper',
      'CreateTechQuickTicketInput',
      'createTechQuickTicketInTransaction',
    ]) {
      expect(sessionSource).not.toContain(forbidden)
      expect(ticketSource).not.toContain(forbidden)
    }
    const rawTechQuickSource = /source:\s*['"]tech_quick['"]/
    expect(ticketSource).not.toMatch(rawTechQuickSource)
    const mutationStart = sessionSource.indexOf('async function runTechQuickMutation')
    const mutationEnd = sessionSource.indexOf('async function authorizeTechQuickRequest', mutationStart)
    const mutationSlice = sessionSource.slice(mutationStart, mutationEnd)
    expect(mutationStart).toBeGreaterThan(-1)
    expect(mutationEnd).toBeGreaterThan(mutationStart)
    expect(mutationSlice.match(/\brunBoundedShopOsMutationV1</g)).toHaveLength(1)
    expect(mutationSlice.match(/\breadResolvedTechQuickReplayResultV1\(/g)).toHaveLength(1)
    expect(mutationSlice.match(/\bfinalizeResolvedTicketCreationInTransactionV1\(/g))
      .toHaveLength(1)
    expect(mutationSlice).toContain("allowedConstraints: ['sessions_pkey']")
    expect(mutationSlice).not.toContain('db.transaction')
    expect(mutationSlice).not.toContain('discoveryState')
  })

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
      projectionRevision: 1n,
      continuityRevision: 1n,
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
      sequenceNumber: 1,
      revision: 1n,
      createdByProfileId: profile.id,
      creatorProvenance: 'direct',
      createdFromJobId: null,
    })
    expect(await db.select().from(jobLines)).toEqual([])
    expect(await db.select().from(ticketMutationReceipts)).toEqual([])
  })

  it.each(['tech', 'advisor', 'parts', 'owner'] as const)(
    'creates and locked-replays the same wrapper for an active tiered %s',
    async (role) => {
      const profile = await seedActor({ role, skillTier: 2 })
      const requestKey = crypto.randomUUID()
      const created = await createFor(profile, requestKey)
      expect(created.ok).toBe(true)
      expect(await replayFor(profile, requestKey)).toEqual(created)
      expect(await db.select().from(sessions)).toHaveLength(1)
      expect(await db.select().from(tickets)).toHaveLength(1)
      expect(await db.select().from(ticketJobs)).toHaveLength(1)
      expect((await db.select().from(shops))[0].nextTicketNumber).toBe(2)
    },
  )

  it('owns caller body and tree state before the first await', async () => {
    const profile = await seedActor({ skillTier: 3 })
    const requestKey = crypto.randomUUID()
    const mutableBody = { ...intake, requestKey }
    const mutableTree: TreeState = structuredClone(treeState)
    const pending = createSessionForUser({
      db,
      userId: profile.userId,
      body: mutableBody,
      treeState: mutableTree,
    })

    mutableBody.customerComplaint = 'caller-mutated complaint'
    mutableTree.message = 'caller-mutated tree'
    mutableTree.nodes[0]!.label = 'caller-mutated node'

    const result = await pending
    expect(result.ok).toBe(true)
    const [storedSession] = await db.select().from(sessions)
    const [ticket] = await db.select().from(tickets)
    const [job] = await db.select().from(ticketJobs)
    expect(storedSession.intake).toEqual(intake)
    expect(storedSession.treeState).toEqual(treeState)
    expect(ticket.concern).toBe(intake.customerComplaint)
    expect(job.title).toBe(intake.customerComplaint)
    expect(job.requiredSkillTier).toBe(3)
  })

  it('uses current locked role and tier when the actor changes between profile lookup and lock', async () => {
    const profile = await seedActor({ role: 'tech', skillTier: 1 })
    const requestKey = crypto.randomUUID()
    const dbWithTransactionRace = (
      mutateBeforeTransaction: () => Promise<void>,
    ): TestDb => {
      let mutated = false
      return new Proxy(db, {
        get(target, property, receiver) {
          if (property === 'transaction') {
            return async (...args: unknown[]) => {
              if (!mutated) {
                mutated = true
                await mutateBeforeTransaction()
              }
              return (target.transaction as (...input: unknown[]) => unknown)(...args)
            }
          }
          const value = Reflect.get(target, property, receiver)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }
    const creationDb = dbWithTransactionRace(async () => {
      await db.update(profiles).set({ role: 'owner', skillTier: 3 })
        .where(eq(profiles.id, profile.id))
    })

    const created = await createSessionForUser({
      db: creationDb,
      userId: profile.userId,
      body: { ...intake, requestKey },
      treeState,
    })

    expect(created.ok).toBe(true)
    expect((await db.select().from(ticketJobs))[0]).toMatchObject({
      requiredSkillTier: 3,
      assignedTechId: profile.id,
      createdByProfileId: profile.id,
    })
    await db.update(profiles).set({ role: 'advisor', skillTier: 2 })
      .where(eq(profiles.id, profile.id))
    const replayDb = dbWithTransactionRace(async () => {
      await db.update(profiles).set({ role: 'parts', skillTier: 1 })
        .where(eq(profiles.id, profile.id))
    })
    expect(await replayCompletedTechQuickSessionForUser({
      db: replayDb,
      userId: profile.userId,
      body: { ...intake, requestKey },
    })).toEqual(created)
  })

  it('refuses replay when the locked actor tier becomes null after preflight', async () => {
    const profile = await seedActor({ role: 'tech', skillTier: 2 })
    const requestKey = crypto.randomUUID()
    const created = await createFor(profile, requestKey)
    if (!created.ok) throw new Error('initial create failed')
    const before = {
      sessions: await db.select().from(sessions),
      tickets: await db.select().from(tickets),
      jobs: await db.select().from(ticketJobs),
      number: (await db.select().from(shops))[0].nextTicketNumber,
    }
    let mutated = false
    const raceDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (...args: unknown[]) => {
            if (!mutated) {
              mutated = true
              await db.update(profiles).set({ skillTier: null })
                .where(eq(profiles.id, profile.id))
            }
            return (target.transaction as (...input: unknown[]) => unknown)(...args)
          }
        }
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    expect(await replayCompletedTechQuickSessionForUser({
      db: raceDb,
      userId: profile.userId,
      body: { ...intake, requestKey },
    })).toEqual({ ok: false, status: 400, error: 'request key unavailable' })
    expect(mutated).toBe(true)
    expect(await db.select().from(sessions)).toEqual(before.sessions)
    expect(await db.select().from(tickets)).toEqual(before.tickets)
    expect(await db.select().from(ticketJobs)).toEqual(before.jobs)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(before.number)
  })

  it('allocates fresh ticket and job IDs after a completed first attempt rolls back', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    let attempts = 0
    let firstAttempt: Readonly<{ id: string; ticketId: string; jobId: string }> | undefined
    const retryDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (callback: (tx: TestDb) => Promise<unknown>) => {
            attempts += 1
            const ordinal = attempts
            return target.transaction(async (rawTx) => {
              const result = await callback(rawTx as TestDb)
              if (ordinal === 1) {
                firstAttempt = result as Readonly<{
                  id: string
                  ticketId: string
                  jobId: string
                }>
                throw new ShopOsMutationConflict()
              }
              return result
            })
          }
        }
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    const created = await createSessionForUser({
      db: retryDb,
      userId: profile.userId,
      body: { ...intake, requestKey },
      treeState,
    })

    expect(created.ok).toBe(true)
    if (!created.ok || !firstAttempt) throw new Error('retry creation failed')
    expect(attempts).toBe(2)
    expect(firstAttempt.id).toBe(requestKey)
    expect(created.id).toBe(requestKey)
    expect(firstAttempt.ticketId).not.toBe(created.ticketId)
    expect(firstAttempt.jobId).not.toBe(created.jobId)
    expect((await db.select().from(sessions)).map(({ id }) => id)).toEqual([requestKey])
    expect((await db.select().from(tickets)).map(({ id }) => id)).toEqual([created.ticketId])
    expect((await db.select().from(ticketJobs)).map(({ id }) => id)).toEqual([created.jobId])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(2)
  })

  it('maps an unexpected replay database fault to create failure instead of stable occupation', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    const created = await createFor(profile, requestKey)
    if (!created.ok) throw new Error('initial create failed')
    const faultDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async () => {
            throw new Error('unexpected replay database fault')
          }
        }
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    expect(await replayCompletedTechQuickSessionForUser({
      db: faultDb,
      userId: profile.userId,
      body: { ...intake, requestKey },
    })).toEqual({ ok: false, status: 500, error: 'session create failed' })
  })

  it('keeps bounded replay conflict exhaustion transient instead of stable occupation', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    const created = await createFor(profile, requestKey)
    if (!created.ok) throw new Error('initial create failed')
    let attempts = 0
    const conflictDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async () => {
            attempts += 1
            throw new ShopOsMutationConflict()
          }
        }
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    expect(await replayCompletedTechQuickSessionForUser({
      db: conflictDb,
      userId: profile.userId,
      body: { ...intake, requestKey },
    })).toEqual({ ok: false, status: 500, error: 'session create failed' })
    expect(attempts).toBe(2)
  })

  it('keeps an exact sessions_pkey collision with a persisted cross-shop occupant stable', async () => {
    const profile = await seedActor()
    const [otherShop] = await db.insert(shops).values({ name: 'Other Shop' }).returning()
    const otherProfile = await seedActor({ shopId: otherShop.id })
    const requestKey = crypto.randomUUID()
    let attempts = 0
    const collisionDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (...args: unknown[]) => {
            attempts += 1
            if (attempts === 1) {
              await db.insert(sessions).values({
                id: requestKey,
                shopId: otherShop.id,
                techId: otherProfile.id,
                intake,
                treeState,
              })
              throw Object.assign(new Error('synthetic exact collision'), {
                code: '23505',
                constraint: 'sessions_pkey',
              })
            }
            return (target.transaction as (...input: unknown[]) => unknown)(...args)
          }
        }
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    expect(await createSessionForUser({
      db: collisionDb,
      userId: profile.userId,
      body: { ...intake, requestKey },
      treeState,
    })).toEqual({ ok: false, status: 400, error: 'request key unavailable' })
    expect(attempts).toBe(2)
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops).where(eq(shops.id, shop.id)))[0].nextTicketNumber)
      .toBe(1)
  })

  it('keeps exact sessions_pkey recovery stable when its same-shop winner has no job', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    let attempts = 0
    const collisionDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (...args: unknown[]) => {
            attempts += 1
            if (attempts === 1) {
              await db.insert(sessions).values({
                id: requestKey,
                shopId: shop.id,
                techId: profile.id,
                intake,
                treeState,
              })
              throw Object.assign(new Error('synthetic exact collision'), {
                code: '23505',
                constraint: 'sessions_pkey',
              })
            }
            return (target.transaction as (...input: unknown[]) => unknown)(...args)
          }
        }
        const value = Reflect.get(target, property, receiver)
        return typeof value === 'function' ? value.bind(target) : value
      },
    })

    expect(await createSessionForUser({
      db: collisionDb,
      userId: profile.userId,
      body: { ...intake, requestKey },
      treeState,
    })).toEqual({ ok: false, status: 400, error: 'request key unavailable' })
    expect(attempts).toBe(2)
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(1)
  })

  it('keeps a same-shop occupant with no linked candidate graph stable and write-free', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    await db.insert(sessions).values({
      id: requestKey,
      shopId: shop.id,
      techId: profile.id,
      intake,
      treeState,
    })
    const expected = { ok: false, status: 400, error: 'request key unavailable' } as const

    expect(await replayFor(profile, requestKey)).toEqual(expected)
    expect(await createFor(profile, requestKey)).toEqual(expected)
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(1)
  })

  it('locks a different same-shop occupant actor before refusing its empty graph', async () => {
    const profile = await seedActor()
    const occupant = await seedActor({ role: 'advisor', skillTier: 1 })
    const requestKey = crypto.randomUUID()
    await db.insert(sessions).values({
      id: requestKey,
      shopId: shop.id,
      techId: occupant.id,
      intake,
      treeState,
    })
    const expected = { ok: false, status: 400, error: 'request key unavailable' } as const

    expect(await replayFor(profile, requestKey)).toEqual(expected)
    expect(await createFor(profile, requestKey)).toEqual(expected)
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(1)
  })

  it('locks a same-shop occupant vehicle and customer before refusing its empty graph', async () => {
    const profile = await seedActor()
    const [customer] = await db.insert(customers).values({
      shopId: shop.id,
      name: 'Occupied customer',
      phone: '555-0144',
    }).returning()
    const [vehicle] = await db.insert(vehicles).values({
      customerId: customer.id,
      year: intake.vehicleYear,
      make: intake.vehicleMake,
      model: intake.vehicleModel,
    }).returning()
    const requestKey = crypto.randomUUID()
    await db.insert(sessions).values({
      id: requestKey,
      shopId: shop.id,
      techId: profile.id,
      vehicleId: vehicle.id,
      intake,
      treeState,
    })
    const expected = { ok: false, status: 400, error: 'request key unavailable' } as const

    expect(await replayFor(profile, requestKey)).toEqual(expected)
    expect(await createFor(profile, requestKey)).toEqual(expected)
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(customers)).toHaveLength(1)
    expect(await db.select().from(vehicles)).toHaveLength(1)
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(1)
  })

  it.each([
    'separate ticket',
    'created-from job',
    'approved quote version',
    'approved event',
  ] as const)('classifies a cross-graph %s reference as stable occupation', async (reference) => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    const created = await createFor(profile, requestKey)
    if (!created.ok) throw new Error('initial create failed')
    const [externalTicket] = await db.insert(tickets).values({
      shopId: shop.id,
      ticketNumber: 2,
      source: 'tech_quick',
      customerId: null,
      vehicleId: null,
      concern: 'external graph',
      createdByProfileId: profile.id,
      projectionRevision: 1n,
      continuityRevision: 1n,
    }).returning()
    const [externalJob] = await db.insert(ticketJobs).values({
      shopId: shop.id,
      ticketId: externalTicket.id,
      title: 'External graph job',
      kind: 'diagnostic',
      requiredSkillTier: 1,
      assignedTechId: profile.id,
      sequenceNumber: 1,
      createdByProfileId: profile.id,
      creatorProvenance: 'direct',
      revision: 1n,
    }).returning()
    const [externalVersion] = await db.insert(quoteVersions).values({
      shopId: shop.id,
      ticketId: externalTicket.id,
      versionNumber: 1,
      snapshot: { jobs: [{ id: externalJob.id }] },
      createdByProfileId: profile.id,
    }).returning()
    const [externalEvent] = await db.insert(quoteEvents).values({
      shopId: shop.id,
      ticketId: externalTicket.id,
      jobId: externalJob.id,
      quoteVersionId: externalVersion.id,
      kind: 'approved',
      actorProfileId: profile.id,
      approvedVia: 'in_person',
      requestKey: `external-${crypto.randomUUID()}`,
    }).returning()
    if (reference === 'separate ticket') {
      await db.execute(sql.raw('drop trigger tickets_immutable_identity_update on tickets'))
      await db.update(tickets).set({
        separateFromTicketId: externalTicket.id,
        separateReason: 'comeback',
      })
        .where(eq(tickets.id, created.ticketId))
    } else if (reference === 'created-from job') {
      await db.execute(sql.raw(
        'drop trigger ticket_jobs_immutable_identity_update on ticket_jobs',
      ))
      await db.execute(sql.raw(
        'alter table ticket_jobs drop constraint ticket_jobs_shop_ticket_created_from_fk',
      ))
      await db.update(ticketJobs).set({ createdFromJobId: externalJob.id })
        .where(eq(ticketJobs.id, created.jobId))
    } else if (reference === 'approved quote version') {
      await db.execute(sql.raw(
        'alter table ticket_jobs drop constraint ticket_jobs_approved_quote_version_fk',
      ))
      await db.update(ticketJobs).set({ approvedQuoteVersionId: externalVersion.id })
        .where(eq(ticketJobs.id, created.jobId))
    } else {
      await db.execute(sql.raw(
        'alter table ticket_jobs drop constraint ticket_jobs_approved_approval_event_fk',
      ))
      await db.update(ticketJobs).set({ approvedApprovalEventId: externalEvent.id })
        .where(eq(ticketJobs.id, created.jobId))
    }
    const before = {
      sessions: await db.select().from(sessions),
      tickets: await db.select().from(tickets),
      jobs: await db.select().from(ticketJobs),
      versions: await db.select().from(quoteVersions),
      events: await db.select().from(quoteEvents),
      number: (await db.select().from(shops))[0].nextTicketNumber,
    }
    const expected = { ok: false, status: 400, error: 'request key unavailable' } as const

    expect(await replayFor(profile, requestKey)).toEqual(expected)
    expect(await createFor(profile, requestKey)).toEqual(expected)
    expect(await db.select().from(sessions)).toEqual(before.sessions)
    expect(await db.select().from(tickets)).toEqual(before.tickets)
    expect(await db.select().from(ticketJobs)).toEqual(before.jobs)
    expect(await db.select().from(quoteVersions)).toEqual(before.versions)
    expect(await db.select().from(quoteEvents)).toEqual(before.events)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(before.number)
  })

  it('does not recover an exact structured sessions_pkey collision when no winner exists', async () => {
    const profile = await seedActor()
    await db.execute(sql.raw(`
      create function fail_sessions_pkey_without_winner() returns trigger
      language plpgsql as $$ begin
        raise exception using
          errcode = '23505',
          constraint = 'sessions_pkey',
          message = 'synthetic exact collision without a committed winner';
      end $$
    `))
    await db.execute(sql.raw(`
      create trigger fail_sessions_pkey_without_winner
      before insert on sessions
      for each row execute function fail_sessions_pkey_without_winner()
    `))

    expect(await createFor(profile, crypto.randomUUID())).toEqual({
      ok: false,
      status: 500,
      error: 'session create failed',
    })
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(1)
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

  it('read-only preflight returns an ID-less match hint without mutation', async () => {
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

    expect(created.ok).toBe(true)
    expect(preflight).toEqual({ ok: true, state: 'match' })
    expect(await db.select().from(sessions)).toEqual(before.sessions)
    expect(await db.select().from(tickets)).toEqual(before.tickets)
    expect(await db.select().from(ticketJobs)).toEqual(before.jobs)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(before.nextTicketNumber)
  })

  it('exposes a locked replay handler that returns the exact immutable wrapper', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    const created = await createFor(profile, requestKey)
    const module = await import('@/lib/sessions')
    const replay = (module as Record<string, unknown>).replayCompletedTechQuickSessionForUser
    expect(typeof replay).toBe('function')
    if (typeof replay !== 'function') return
    const before = {
      sessions: await db.select().from(sessions),
      tickets: await db.select().from(tickets),
      jobs: await db.select().from(ticketJobs),
      number: (await db.select().from(shops))[0].nextTicketNumber,
    }

    const result = await replay({
      db,
      userId: profile.userId,
      body: { ...intake, requestKey },
    })

    expect(result).toEqual(created)
    expect(await db.select().from(sessions)).toEqual(before.sessions)
    expect(await db.select().from(tickets)).toEqual(before.tickets)
    expect(await db.select().from(ticketJobs)).toEqual(before.jobs)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(before.number)
  })

  it.each([
    [
      'untouched legacy',
      {
        sequenceNumber: null,
        createdByProfileId: null,
        creatorProvenance: null,
        jobRevision: 0n,
        ticketRevision: 0n,
      },
    ],
    [
      'migrated legacy after later revision bumps',
      {
        sequenceNumber: 1,
        createdByProfileId: 'actor',
        creatorProvenance: 'ticket_creator_backfill',
        jobRevision: 4n,
        ticketRevision: 7n,
      },
    ],
    [
      'modern direct after later revision bumps',
      {
        sequenceNumber: 1,
        createdByProfileId: 'actor',
        creatorProvenance: 'direct',
        jobRevision: 5n,
        ticketRevision: 8n,
      },
    ],
  ] as const)('replays the exact canonical %s continuity tuple without mutation', async (
    _label,
    shape,
  ) => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    const created = await seedReplayTuple(profile, requestKey, shape)
    const before = {
      session: await db.select().from(sessions),
      ticket: await db.select().from(tickets),
      jobs: await db.select().from(ticketJobs),
      number: (await db.select().from(shops))[0].nextTicketNumber,
    }

    expect(await replayFor(profile, requestKey)).toEqual(created)
    expect(await db.select().from(sessions)).toEqual(before.session)
    expect(await db.select().from(tickets)).toEqual(before.ticket)
    expect(await db.select().from(ticketJobs)).toEqual(before.jobs)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(before.number)
  })

  it.each([
    ['migrated sequence other than one', {
      sequenceNumber: 2, provenance: 'ticket_creator_backfill', jobRevision: 0n, ticketRevision: 0n,
    }],
    ['direct with null sequence', {
      sequenceNumber: null, provenance: 'direct', jobRevision: 1n, ticketRevision: 1n,
    }],
    ['direct with legacy revisions', {
      sequenceNumber: 1, provenance: 'direct', jobRevision: 0n, ticketRevision: 0n,
    }],
  ] as const)('rejects the noncanonical continuity tuple: %s', async (_label, shape) => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    await seedReplayTuple(profile, requestKey, {
      ...shape,
      createdByProfileId: 'actor',
      creatorProvenance: shape.provenance,
    })
    const before = {
      sessions: await db.select().from(sessions),
      tickets: await db.select().from(tickets),
      jobs: await db.select().from(ticketJobs),
      number: (await db.select().from(shops))[0].nextTicketNumber,
    }

    expect(await replayFor(profile, requestKey)).toEqual({
      ok: false,
      status: 400,
      error: 'request key unavailable',
    })
    expect(await db.select().from(sessions)).toEqual(before.sessions)
    expect(await db.select().from(tickets)).toEqual(before.tickets)
    expect(await db.select().from(ticketJobs)).toEqual(before.jobs)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(before.number)
  })

  it('locks the complete sibling history reference closure and returns only the original wrapper', async () => {
    const profile = await seedActor()
    const historicalActor = await seedActor({ role: 'advisor', skillTier: 1 })
    const requestKey = crypto.randomUUID()
    const created = await createFor(profile, requestKey)
    if (!created.ok) throw new Error('initial create failed')
    const [customer] = await db.insert(customers).values({
      shopId: shop.id,
      name: 'Historical customer',
      phone: '555-0199',
    }).returning()
    const [vehicle] = await db.insert(vehicles).values({
      customerId: customer.id,
      year: 2017,
      make: 'Honda',
      model: 'Accord',
    }).returning()
    const siblingSessionId = crypto.randomUUID()
    await db.insert(sessions).values({
      id: siblingSessionId,
      shopId: shop.id,
      techId: historicalActor.id,
      vehicleId: vehicle.id,
      intake: {
        vehicleYear: 2017,
        vehicleMake: 'Honda',
        vehicleModel: 'Accord',
        customerComplaint: 'historical sibling concern',
      },
      treeState,
    })
    const [sibling] = await db.insert(ticketJobs).values({
      shopId: shop.id,
      ticketId: created.ticketId,
      title: 'Historical sibling diagnosis',
      kind: 'diagnostic',
      requiredSkillTier: 1,
      assignedTechId: historicalActor.id,
      sessionId: siblingSessionId,
      sequenceNumber: 2,
      createdByProfileId: historicalActor.id,
      creatorProvenance: 'direct',
      revision: 1n,
      workStatement: 'Confirm the historical concern',
      statementSource: 'shop_internal',
      statementReviewState: 'confirmed',
      statementConfirmedByProfileId: historicalActor.id,
      statementConfirmedAt: new Date('2026-07-16T12:00:00.000Z'),
    }).returning()
    const [vendor] = await db.insert(vendorAccounts).values({
      shopId: shop.id,
      vendor: 'history_parts',
      displayName: 'History Parts',
      mode: 'manual',
      enabled: true,
    }).returning()
    await db.insert(jobLines).values({
      shopId: shop.id,
      jobId: sibling.id,
      kind: 'part',
      description: 'Historical vendor part',
      quantity: 1,
      priceCents: 2500,
      taxable: true,
      vendorAccountId: vendor.id,
      partStatus: 'received',
      orderedAt: new Date('2026-07-15T12:00:00.000Z'),
      orderedByProfileId: historicalActor.id,
      receivedAt: new Date('2026-07-16T12:00:00.000Z'),
      receivedByProfileId: historicalActor.id,
    })
    const [version] = await db.insert(quoteVersions).values({
      shopId: shop.id,
      ticketId: created.ticketId,
      versionNumber: 1,
      snapshot: { jobs: [{ id: sibling.id, decision: 'approved' }] },
      createdByProfileId: historicalActor.id,
    }).returning()
    const [event] = await db.insert(quoteEvents).values({
      shopId: shop.id,
      ticketId: created.ticketId,
      jobId: sibling.id,
      quoteVersionId: version.id,
      kind: 'approved',
      actorProfileId: historicalActor.id,
      approvedVia: 'in_person',
      requestKey: `history-${crypto.randomUUID()}`,
    }).returning()
    await db.update(ticketJobs).set({
      approvedQuoteVersionId: version.id,
      approvedApprovalEventId: event.id,
      approvalState: 'approved',
    }).where(eq(ticketJobs.id, sibling.id))
    const before = {
      sessions: await db.select().from(sessions),
      tickets: await db.select().from(tickets),
      jobs: await db.select().from(ticketJobs),
      lines: await db.select().from(jobLines),
      versions: await db.select().from(quoteVersions),
      events: await db.select().from(quoteEvents),
      number: (await db.select().from(shops))[0].nextTicketNumber,
    }

    expect(await replayFor(profile, requestKey)).toEqual(created)
    expect(await db.select().from(sessions)).toEqual(before.sessions)
    expect(await db.select().from(tickets)).toEqual(before.tickets)
    expect(await db.select().from(ticketJobs)).toEqual(before.jobs)
    expect(await db.select().from(jobLines)).toEqual(before.lines)
    expect(await db.select().from(quoteVersions)).toEqual(before.versions)
    expect(await db.select().from(quoteEvents)).toEqual(before.events)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(before.number)
  })

  it('replays a valid later-adopted customer and vehicle pair without changing it', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    const created = await createFor(profile, requestKey)
    if (!created.ok) throw new Error('initial create failed')
    const [customer] = await db.insert(customers).values({
      shopId: shop.id,
      name: 'Adopted customer',
      phone: '555-0111',
    }).returning()
    const [vehicle] = await db.insert(vehicles).values({
      customerId: customer.id,
      year: intake.vehicleYear,
      make: intake.vehicleMake,
      model: intake.vehicleModel,
    }).returning()
    await db.update(tickets).set({
      customerId: customer.id,
      vehicleId: vehicle.id,
    }).where(eq(tickets.id, created.ticketId))
    const before = {
      sessions: await db.select().from(sessions),
      tickets: await db.select().from(tickets),
      jobs: await db.select().from(ticketJobs),
      number: (await db.select().from(shops))[0].nextTicketNumber,
    }

    expect(await replayFor(profile, requestKey)).toEqual(created)
    expect(await db.select().from(sessions)).toEqual(before.sessions)
    expect(await db.select().from(tickets)).toEqual(before.tickets)
    expect(await db.select().from(ticketJobs)).toEqual(before.jobs)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(before.number)
  })

  it('rejects a partial adopted identity even when a corrupt fixture bypasses the schema check', async () => {
    const profile = await seedActor()
    const [customer] = await db.insert(customers).values({
      shopId: shop.id,
      name: 'Partial identity',
      phone: '555-0122',
    }).returning()
    await db.execute(sql.raw(
      'alter table tickets drop constraint tickets_customer_vehicle_pair',
    ))
    const requestKey = crypto.randomUUID()
    await seedReplayTuple(profile, requestKey, {
      sequenceNumber: null,
      createdByProfileId: null,
      creatorProvenance: null,
      jobRevision: 0n,
      ticketRevision: 0n,
      customerId: customer.id,
      vehicleId: null,
    })

    expect(await replayFor(profile, requestKey)).toEqual({
      ok: false,
      status: 400,
      error: 'request key unavailable',
    })
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
  })

  it('rejects a non-Tech-Quick source even when the rest of the locked wrapper is canonical', async () => {
    const profile = await seedActor()
    const [customer] = await db.insert(customers).values({
      shopId: shop.id,
      name: 'Counter identity',
      phone: '555-0133',
    }).returning()
    const [vehicle] = await db.insert(vehicles).values({
      customerId: customer.id,
      year: intake.vehicleYear,
      make: intake.vehicleMake,
      model: intake.vehicleModel,
    }).returning()
    const requestKey = crypto.randomUUID()
    await seedReplayTuple(profile, requestKey, {
      sequenceNumber: null,
      createdByProfileId: null,
      creatorProvenance: null,
      jobRevision: 0n,
      ticketRevision: 0n,
      source: 'counter',
      customerId: customer.id,
      vehicleId: vehicle.id,
    })

    expect(await replayFor(profile, requestKey)).toEqual({
      ok: false,
      status: 400,
      error: 'request key unavailable',
    })
  })

  it('locked replay refuses missing, changed, malformed, inactive, and wrong-job occupation without IDs', async () => {
    const profile = await seedActor()
    const missingKey = crypto.randomUUID()
    expect(await replayFor(profile, missingKey)).toEqual({
      ok: false,
      status: 400,
      error: 'request key unavailable',
    })

    const requestKey = crypto.randomUUID()
    const created = await createFor(profile, requestKey)
    if (!created.ok) throw new Error('initial create failed')
    expect(await replayFor(profile, requestKey, {
      ...intake,
      customerComplaint: 'changed complaint',
      requestKey,
    })).toEqual({ ok: false, status: 400, error: 'request key unavailable' })
    expect(await replayFor(profile, requestKey, {
      ...intake,
      requestKey: 'not-a-uuid',
    })).toMatchObject({ ok: false, status: 400 })

    await db.update(ticketJobs).set({ title: 'corrupt linked title' })
      .where(eq(ticketJobs.id, created.jobId))
    expect(await replayFor(profile, requestKey)).toEqual({
      ok: false,
      status: 400,
      error: 'request key unavailable',
    })
    await db.update(profiles).set({
      membershipStatus: 'pending',
      membershipActivatedAt: null,
    }).where(eq(profiles.id, profile.id))
    expect(await replayFor(profile, requestKey)).toMatchObject({ ok: false, status: 400 })
    expect(await db.select().from(sessions)).toHaveLength(1)
    expect(await db.select().from(tickets)).toHaveLength(1)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(2)
  })

  it('rejects a second session-linked ticket candidate after locking both complete graphs', async () => {
    const profile = await seedActor()
    const requestKey = crypto.randomUUID()
    const created = await createFor(profile, requestKey)
    if (!created.ok) throw new Error('initial create failed')
    await db.execute(sql.raw('drop index ticket_jobs_session_id_uq'))
    const [secondTicket] = await db.insert(tickets).values({
      shopId: shop.id,
      ticketNumber: 2,
      source: 'tech_quick',
      customerId: null,
      vehicleId: null,
      concern: intake.customerComplaint,
      createdByProfileId: profile.id,
      projectionRevision: 1n,
      continuityRevision: 1n,
    }).returning()
    await db.insert(ticketJobs).values({
      shopId: shop.id,
      ticketId: secondTicket.id,
      title: intake.customerComplaint,
      kind: 'diagnostic',
      requiredSkillTier: 2,
      assignedTechId: profile.id,
      sessionId: requestKey,
      sequenceNumber: 1,
      createdByProfileId: profile.id,
      creatorProvenance: 'direct',
      revision: 1n,
    })
    await db.update(shops).set({ nextTicketNumber: 3 }).where(eq(shops.id, shop.id))
    const before = {
      sessions: await db.select().from(sessions),
      tickets: await db.select().from(tickets),
      jobs: await db.select().from(ticketJobs),
      number: (await db.select().from(shops))[0].nextTicketNumber,
    }

    expect(await replayFor(profile, requestKey)).toEqual({
      ok: false,
      status: 400,
      error: 'request key unavailable',
    })
    expect(await db.select().from(sessions)).toEqual(before.sessions)
    expect(await db.select().from(tickets)).toEqual(before.tickets)
    expect(await db.select().from(ticketJobs)).toEqual(before.jobs)
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(before.number)
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

  it('rolls back the session, foundation rows, and ticket number when the batch insert fails', async () => {
    const profile = await seedActor()
    await db.execute(sql.raw(`
      create function fail_tech_quick_job_insert() returns trigger
      language plpgsql as $$ begin raise exception 'injected tech quick batch failure'; end $$
    `))
    await db.execute(sql.raw(`
      create trigger fail_tech_quick_job_insert
      before insert on ticket_jobs
      for each row execute function fail_tech_quick_job_insert()
    `))

    const result = await createFor(profile, crypto.randomUUID())

    expect(result).toMatchObject({ ok: false, status: 500 })
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(1)
  })

  it('rolls back a completed batch when finalization detects a changed created-session binding', async () => {
    const profile = await seedActor()
    const other = await seedActor({ role: 'advisor', skillTier: 1 })
    await db.execute(sql.raw(`
      create function corrupt_created_session_binding() returns trigger
      language plpgsql as $$ begin
        update sessions set tech_id = '${other.id}' where id = new.session_id;
        return new;
      end $$
    `))
    await db.execute(sql.raw(`
      create trigger corrupt_created_session_binding
      after insert on ticket_jobs
      for each row execute function corrupt_created_session_binding()
    `))

    const result = await createFor(profile, crypto.randomUUID())

    expect(result).toMatchObject({ ok: false, status: 500 })
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(1)
  })

  it('rolls back all foundation rows when a deferred failure fires after finalization', async () => {
    const profile = await seedActor()
    await db.execute(sql.raw(`
      create function fail_after_tech_quick_finalization() returns trigger
      language plpgsql as $$ begin
        raise exception 'injected post-finalization failure';
      end $$
    `))
    await db.execute(sql.raw(`
      create constraint trigger fail_after_tech_quick_finalization
      after insert on sessions deferrable initially deferred
      for each row execute function fail_after_tech_quick_finalization()
    `))

    const result = await createFor(profile, crypto.randomUUID())

    expect(result).toMatchObject({ ok: false, status: 500 })
    expect(await db.select().from(sessions)).toEqual([])
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect((await db.select().from(shops))[0].nextTicketNumber).toBe(1)
  })
})
