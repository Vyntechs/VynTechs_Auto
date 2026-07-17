import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mutateTicketJobAssignment,
  type TicketActor,
  type TicketJobAssignmentDependencies,
} from '@/lib/tickets'
import {
  customers,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  sessions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
  vendorAccounts,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { ShopOsMutationConflict } from '@/lib/shop-os/continuity/mutation-foundation/conflicts'

const userId = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

function withLockedAssignmentRows(
  sourceDb: TestDb,
  transforms: Readonly<{
    profiles?: (
      rows: readonly (typeof profiles.$inferSelect)[],
    ) => readonly (typeof profiles.$inferSelect)[]
    jobs?: (
      rows: readonly (typeof ticketJobs.$inferSelect)[],
    ) => readonly (typeof ticketJobs.$inferSelect)[]
    tickets?: (
      rows: readonly (typeof tickets.$inferSelect)[],
    ) => readonly (typeof tickets.$inferSelect)[]
  }>,
): TestDb {
  const wrapBuilder = (builder: object, source: unknown): object => new Proxy(builder, {
    get(target, property) {
      const member = Reflect.get(target, property, target)
      if (typeof member !== 'function') return member
      if (property === 'from') {
        return (nextSource: unknown, ...args: unknown[]) => wrapBuilder(
          Reflect.apply(member, target, [nextSource, ...args]) as object,
          nextSource,
        )
      }
      if (
        property === 'for' &&
        (source === profiles || source === ticketJobs || source === tickets)
      ) {
        return async (...args: unknown[]) => {
          const rows = await Reflect.apply(member, target, args) as never[]
          if (source === profiles) return transforms.profiles?.(rows) ?? rows
          if (source === ticketJobs) return transforms.jobs?.(rows) ?? rows
          return transforms.tickets?.(rows) ?? rows
        }
      }
      return (...args: unknown[]) => {
        const result = Reflect.apply(member, target, args) as unknown
        return typeof result === 'object' && result !== null
          ? wrapBuilder(result, source)
          : result
      }
    },
  })

  return new Proxy(sourceDb, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return async (callback: (tx: TestDb) => Promise<unknown>) =>
          target.transaction(async (rawTx) => {
            const tx = rawTx as TestDb
            const wrappedTx = new Proxy(tx, {
              get(txTarget, txProperty, txReceiver) {
                if (txProperty === 'select') {
                  return (...args: unknown[]) => wrapBuilder(
                    Reflect.apply(
                      Reflect.get(txTarget, txProperty, txReceiver) as
                        (...values: unknown[]) => unknown,
                      txTarget,
                      args,
                    ) as object,
                    null,
                  )
                }
                const value = Reflect.get(txTarget, txProperty, txReceiver)
                return typeof value === 'function' ? value.bind(txTarget) : value
              },
            })
            return callback(wrappedTx)
          })
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

describe('atomic ticket-job assignment SQL contract', () => {
  it('uses the bounded complete-graph coordinator, locked policy, one conditional update, and sole finalizer', async () => {
    const source = await readFile(path.join(process.cwd(), 'lib/tickets.ts'), 'utf8')
    const discoveryStart = source.indexOf(
      'async function discoverTicketJobAssignmentMutation',
    )
    const mutationStart = source.indexOf('export async function mutateTicketJobAssignment')
    const nextExport = source.indexOf('export type ResolveTicketCreationInputV1', mutationStart)
    const body = source.slice(discoveryStart, nextExport).replace(/\s+/g, ' ')

    expect(discoveryStart).toBeGreaterThan(-1)
    expect(mutationStart).toBeGreaterThan(-1)
    expect(nextExport).toBeGreaterThan(mutationStart)
    expect(body).toContain('runBoundedShopOsMutationV1')
    expect(body).toContain('assertLiveLockedMutationScopeV1')
    expect(body).toContain('resolveLockedAddTicketJobTarget')
    expect(source).toContain('graph.ticket.separateFromTicketId !== expectedParentId')
    expect(body.match(/\.update\(ticketJobs\)/g)).toHaveLength(1)
    expect(body.match(/finalizeMutationRevisionsV1/g)).toHaveLength(1)
    expect(body).not.toContain('db.transaction')
    expect(body).not.toContain('validateAssignment')
    expect(body).not.toMatch(/revision:\s*sql/)
    expect(body).toContain('exactJobId: jobId')
    expect(body).toContain("body.action === 'reassign' ? [body.assignedTechId] : []")
    expect(body).toContain('lockShop: false')
    expect(body).toContain('jobInsertionIntent: null')
    expect(body).toContain('await afterDiscovery?.()')
    expect(body).toContain('priorAssignmentPredicate')
    expect(body).toContain('eq(ticketJobs.revision, job.revision)')
    expect(body).toContain("ne(ticketJobs.diagnosticStartState, 'initializing')")
    expect(body).toContain('isNull(ticketJobs.diagnosticStartLeaseUntil)')
    expect(body).toContain('lte(ticketJobs.diagnosticStartLeaseUntil, sql`now()`)')
    expect(source).not.toContain('async function loadAssignmentContext')
    expect(source).not.toContain('async function persistedActorError')
    expect(source).not.toContain('async function claimTicketJob')
    expect(source).not.toContain('async function unclaimTicketJob')
    expect(source).not.toContain('async function reassignTicketJob')
  })
})

describe('ticket-job assignment mutations', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let ticketId: string
  let jobId: string
  let actor: Record<'tech' | 'otherTech' | 'advisor' | 'owner' | 'parts', TicketActor>

  const call = (
    who: TicketActor,
    body: unknown,
    ids: { ticketId?: unknown; jobId?: unknown } = {},
    dependencies?: TicketJobAssignmentDependencies,
    sourceDb: TestDb = db,
  ) =>
    mutateTicketJobAssignment(sourceDb, {
      actor: who,
      ticketId: ids.ticketId ?? ticketId,
      jobId: ids.jobId ?? jobId,
      body,
    }, dependencies)

  const assignmentState = async () => ({
    ticket: (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0],
    job: (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0],
  })

  beforeEach(async () => {
    const testDb = await createTestDb()
    db = testDb.db
    close = testDb.close
    const [shop, otherShop] = await db
      .insert(shops)
      .values([{ name: 'North Shop' }, { name: 'South Shop' }])
      .returning()
    shopId = shop.id
    otherShopId = otherShop.id

    const seeded = await db.insert(profiles).values([
      { userId: userId(1), shopId, fullName: 'Taylor Tech', role: 'tech', skillTier: 2 },
      { userId: userId(2), shopId, fullName: 'Terry Tech', role: 'tech', skillTier: 2 },
      { userId: userId(3), shopId, fullName: 'Alex Advisor', role: 'advisor', skillTier: null },
      { userId: userId(4), shopId, fullName: 'Owen Owner', role: 'owner', skillTier: 3 },
      { userId: userId(5), shopId, fullName: 'Pat Parts', role: 'parts', skillTier: null },
    ]).returning()

    actor = Object.fromEntries(
      (['tech', 'otherTech', 'advisor', 'owner', 'parts'] as const).map((key, index) => [
        key,
        {
          profileId: seeded[index].id,
          shopId: seeded[index].shopId,
          role: seeded[index].role,
          skillTier: seeded[index].skillTier,
          membershipStatus: seeded[index].membershipStatus,
          deactivatedAt: seeded[index].deactivatedAt,
        },
      ]),
    ) as typeof actor

    const [ticket] = await db.insert(tickets).values({
      shopId,
      ticketNumber: 1,
      source: 'tech_quick',
      concern: 'No start',
      createdByProfileId: actor.owner.profileId,
    }).returning()
    ticketId = ticket.id
    const [job] = await db.insert(ticketJobs).values({
      shopId,
      ticketId,
      title: 'Diagnose no start',
      kind: 'diagnostic',
      requiredSkillTier: 2,
    }).returning()
    jobId = job.id
  })

  afterEach(async () => close())

  it('self-claims an eligible open job with a database timestamp and returns the safe ticket', async () => {
    const [ticketBefore] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [jobBefore] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const before = new Date()
    const result = await call(actor.tech, { action: 'claim' })
    const after = new Date()
    const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const [ticketAfter] = await db.select().from(tickets).where(eq(tickets.id, ticketId))

    expect(result).toMatchObject({
      ok: true,
      ticket: { id: ticketId, jobs: [{ id: jobId, assignedTechId: actor.tech.profileId }] },
    })
    expect(row.claimedAt).toBeInstanceOf(Date)
    expect(row.claimedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(row.claimedAt!.getTime()).toBeLessThanOrEqual(after.getTime())
    expect(row.revision).toBe(jobBefore.revision + 1n)
    expect(ticketAfter.projectionRevision).toBe(ticketBefore.projectionRevision + 1n)
    expect(ticketAfter.continuityRevision).toBe(ticketBefore.continuityRevision)
    if (!result.ok) return
    expect(result.ticket).not.toHaveProperty('shopId')
    expect(result.ticket.jobs[0]).not.toHaveProperty('claimedAt')
    expect(result.ticket.jobs[0].assignedTech).toEqual({
      id: actor.tech.profileId,
      fullName: 'Taylor Tech',
      role: 'tech',
      skillTier: 2,
    })
  })

  it('finalizes unclaim and reassign at bigint-safe job/projection revisions without changing continuity', async () => {
    const hugeProjection = 9_007_199_254_740_993n
    const hugeContinuity = 9_007_199_254_741_993n
    const hugeJobRevision = 9_007_199_254_742_993n
    for (const [who, body] of [
      [actor.tech, { action: 'unclaim' as const }],
      [actor.owner, {
        action: 'reassign' as const,
        assignedTechId: actor.otherTech.profileId,
      }],
    ] as const) {
      await db.update(tickets).set({
        projectionRevision: hugeProjection,
        continuityRevision: hugeContinuity,
      }).where(eq(tickets.id, ticketId))
      await db.update(ticketJobs).set({
        assignedTechId: actor.tech.profileId,
        claimedAt: new Date('2026-07-10T12:00:00Z'),
        revision: hugeJobRevision,
      }).where(eq(ticketJobs.id, jobId))

      await expect(call(who, body)).resolves.toMatchObject({ ok: true })

      const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
      const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
      expect(ticket.projectionRevision).toBe(hugeProjection + 1n)
      expect(ticket.continuityRevision).toBe(hugeContinuity)
      expect(job.revision).toBe(hugeJobRevision + 1n)
    }
  })

  it('blocks claim under a live diagnostic initialization lease without revisions or disclosure', async () => {
    await db.update(ticketJobs).set({
      diagnosticStartState: 'initializing',
      diagnosticStartAttemptKey: userId(89),
      diagnosticStartLeaseUntil: new Date('2099-01-01T00:00:00Z'),
    }).where(eq(ticketJobs.id, jobId))
    const [beforeTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [beforeJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))

    const result = await call(actor.tech, { action: 'claim' })

    expect(result).toEqual({ ok: false, error: 'job_not_open' })
    expect(result).not.toHaveProperty('currentAssignee')
    const [afterTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [afterJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(afterTicket).toEqual(beforeTicket)
    expect(afterJob).toEqual(beforeJob)
  })

  it('accepts privileged unclaim of an already-open slot and reassign to the current target', async () => {
    const first = await call(actor.owner, { action: 'unclaim' })
    expect(first).toMatchObject({ ok: true })
    let [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    let [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(ticket.projectionRevision).toBe(1n)
    expect(ticket.continuityRevision).toBe(0n)
    expect(job.revision).toBe(1n)

    await db.update(ticketJobs).set({ assignedTechId: actor.otherTech.profileId })
      .where(eq(ticketJobs.id, jobId))
    const second = await call(actor.owner, {
      action: 'reassign',
      assignedTechId: actor.otherTech.profileId,
    })
    expect(second).toMatchObject({ ok: true })
    ;[ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    ;[job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(ticket.projectionRevision).toBe(2n)
    expect(ticket.continuityRevision).toBe(0n)
    expect(job.revision).toBe(2n)
  })

  it('owns uppercase caller actor, IDs, and reassign body before the first await', async () => {
    const mutableActor = {
      ...actor.owner,
      profileId: actor.owner.profileId.toUpperCase(),
      shopId: actor.owner.shopId?.toUpperCase() ?? null,
    }
    const mutableBody: {
      action: string
      assignedTechId: string
      confirmBelowTier?: boolean
    } = {
      action: 'reassign',
      assignedTechId: actor.otherTech.profileId.toUpperCase(),
    }
    const pending = mutateTicketJobAssignment(db, {
      actor: mutableActor,
      ticketId: ticketId.toUpperCase(),
      jobId: jobId.toUpperCase(),
      body: mutableBody,
    })
    mutableActor.profileId = userId(990)
    mutableActor.shopId = userId(991)
    mutableActor.role = 'tech'
    mutableBody.action = 'claim'
    mutableBody.assignedTechId = userId(992)
    mutableBody.confirmBelowTier = true

    await expect(pending).resolves.toMatchObject({
      ok: true,
      ticket: { jobs: [{ assignedTechId: actor.otherTech.profileId }] },
    })
  })

  it.each(['afterWrite', 'afterFinalization'] as const)(
    'rolls back assignment and both revision layers when %s fails',
    async (seam) => {
      const marker = new Error(seam)
      const [beforeTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
      const [beforeJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))

      await expect(call(actor.tech, { action: 'claim' }, {}, {
        [seam]: async () => { throw marker },
      })).rejects.toBe(marker)

      const [afterTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
      const [afterJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
      expect(afterTicket).toEqual(beforeTicket)
      expect(afterJob).toEqual(beforeJob)
    },
  )

  it('retries a rolled-back complete write once and finalizes exactly one result', async () => {
    let attempts = 0
    const result = await call(actor.tech, { action: 'claim' }, {}, {
      afterFinalization: async () => {
        attempts += 1
        if (attempts === 1) throw new ShopOsMutationConflict()
      },
    })

    expect(result).toMatchObject({ ok: true })
    expect(attempts).toBe(2)
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(ticket.projectionRevision).toBe(1n)
    expect(ticket.continuityRevision).toBe(0n)
    expect(job).toMatchObject({
      assignedTechId: actor.tech.profileId,
      revision: 1n,
    })
  })

  it('rolls back both exhausted attempts and returns only a retryable conflict', async () => {
    const [beforeTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [beforeJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    let attempts = 0

    const result = await call(actor.tech, { action: 'claim' }, {}, {
      afterWrite: async () => {
        attempts += 1
        throw new ShopOsMutationConflict()
      },
    })

    expect(result).toEqual({ ok: false, error: 'conflict', retryable: true })
    expect(attempts).toBe(2)
    expect((await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toEqual(beforeTicket)
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0])
      .toEqual(beforeJob)
  })

  it('fails closed when the persisted prior assignment differs from locked validation', async () => {
    await db.update(ticketJobs).set({
      assignedTechId: actor.tech.profileId,
      claimedAt: new Date('2026-07-10T12:00:00Z'),
    }).where(eq(ticketJobs.id, jobId))
    const [beforeTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [beforeJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const raceDb = withLockedAssignmentRows(db, {
      jobs: (rows) => rows.map((row) => row.id === jobId
        ? { ...row, assignedTechId: null, claimedAt: null }
        : row),
    })

    const result = await call(actor.owner, { action: 'unclaim' }, {}, undefined, raceDb)

    expect(result).toEqual({ ok: false, error: 'conflict', retryable: true })
    expect((await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toEqual(beforeTicket)
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0])
      .toEqual(beforeJob)
  })

  it('fails closed when locked ticket ancestry differs from discovery', async () => {
    const [unexpectedParent] = await db.insert(tickets).values({
      shopId,
      ticketNumber: 2,
      source: 'tech_quick',
      concern: 'Unexpected locked parent',
      createdByProfileId: actor.owner.profileId,
    }).returning()
    const [beforeTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [beforeJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const raceDb = withLockedAssignmentRows(db, {
      tickets: (rows) => rows.map((row) => row.id === ticketId
        ? { ...row, separateFromTicketId: unexpectedParent.id }
        : row),
    })

    const result = await call(actor.tech, { action: 'claim' }, {}, undefined, raceDb)

    expect(result).toEqual({ ok: false, error: 'conflict', retryable: true })
    expect((await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toEqual(beforeTicket)
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0])
      .toEqual(beforeJob)
  })

  it('uses the locked actor role when reassign authority drifts after discovery', async () => {
    const before = await assignmentState()
    const raceDb = withLockedAssignmentRows(db, {
      profiles: (rows) => rows.map((row) => row.id === actor.owner.profileId
        ? { ...row, role: 'tech' }
        : row),
    })

    const result = await call(actor.owner, {
      action: 'reassign',
      assignedTechId: actor.otherTech.profileId,
    }, {}, undefined, raceDb)

    expect(result).toEqual({ ok: false, error: 'forbidden' })
    expect(result).not.toHaveProperty('currentAssignee')
    expect(await assignmentState()).toEqual(before)
  })

  it('uses locked unclaim authority when an owner becomes a non-assigned tech', async () => {
    await db.update(ticketJobs).set({
      assignedTechId: actor.otherTech.profileId,
      claimedAt: new Date('2026-07-16T13:00:00Z'),
    }).where(eq(ticketJobs.id, jobId))
    const before = await assignmentState()
    const raceDb = withLockedAssignmentRows(db, {
      profiles: (rows) => rows.map((row) => row.id === actor.owner.profileId
        ? { ...row, role: 'tech' }
        : row),
    })

    const result = await call(actor.owner, { action: 'unclaim' }, {}, undefined, raceDb)

    expect(result).toEqual({ ok: false, error: 'forbidden' })
    expect(result).not.toHaveProperty('currentAssignee')
    expect(await assignmentState()).toEqual(before)
  })

  it('checks locked claim tier before disclosing an existing safe assignee', async () => {
    await db.update(ticketJobs).set({
      assignedTechId: actor.otherTech.profileId,
      claimedAt: new Date('2026-07-16T13:00:00Z'),
    }).where(eq(ticketJobs.id, jobId))
    const before = await assignmentState()
    const raceDb = withLockedAssignmentRows(db, {
      profiles: (rows) => rows.map((row) => row.id === actor.tech.profileId
        ? { ...row, skillTier: 1 }
        : row),
    })

    const result = await call(actor.tech, { action: 'claim' }, {}, undefined, raceDb)

    expect(result).toEqual({ ok: false, error: 'invalid_assignee' })
    expect(result).not.toHaveProperty('currentAssignee')
    expect(await assignmentState()).toEqual(before)
  })

  it.each(['membership', 'deactivation', 'shop'] as const)(
    'hides an existing assignee when locked claiming actor %s truth becomes invalid',
    async (drift) => {
      await db.update(ticketJobs).set({
        assignedTechId: actor.otherTech.profileId,
        claimedAt: new Date('2026-07-16T13:00:00Z'),
      }).where(eq(ticketJobs.id, jobId))
      const before = await assignmentState()
      const raceDb = withLockedAssignmentRows(db, {
        profiles: (rows) => rows.map((row) => {
          if (row.id !== actor.tech.profileId) return row
          if (drift === 'membership') {
            return { ...row, membershipStatus: 'pending' }
          }
          if (drift === 'deactivation') {
            return { ...row, deactivatedAt: new Date('2026-07-16T13:00:00Z') }
          }
          return { ...row, shopId: otherShopId }
        }),
      })

      const result = await call(actor.tech, { action: 'claim' }, {}, undefined, raceDb)

      expect(result).toEqual({ ok: false, error: 'not_found' })
      expect(result).not.toHaveProperty('currentAssignee')
      expect(await assignmentState()).toEqual(before)
    },
  )

  it.each(['membership', 'deactivation', 'shop'] as const)(
    'hides locked actor %s drift behind generic not-found with no writes',
    async (drift) => {
      const before = await assignmentState()
      const raceDb = withLockedAssignmentRows(db, {
        profiles: (rows) => rows.map((row) => {
          if (row.id !== actor.owner.profileId) return row
          if (drift === 'membership') {
            return { ...row, membershipStatus: 'pending' }
          }
          if (drift === 'deactivation') {
            return { ...row, deactivatedAt: new Date('2026-07-16T13:00:00Z') }
          }
          return { ...row, shopId: otherShopId }
        }),
      })

      const result = await call(actor.owner, {
        action: 'reassign',
        assignedTechId: actor.otherTech.profileId,
      }, {}, undefined, raceDb)

      expect(result).toEqual({ ok: false, error: 'not_found' })
      expect(result).not.toHaveProperty('currentAssignee')
      expect(await assignmentState()).toEqual(before)
    },
  )

  it.each([1, null] as const)(
    'uses locked claim tier %s instead of the stale caller tier',
    async (skillTier) => {
      const before = await assignmentState()
      const raceDb = withLockedAssignmentRows(db, {
        profiles: (rows) => rows.map((row) => row.id === actor.tech.profileId
          ? { ...row, skillTier }
          : row),
      })

      const result = await call(actor.tech, { action: 'claim' }, {}, undefined, raceDb)

      expect(result).toEqual({ ok: false, error: 'invalid_assignee' })
      expect(result).not.toHaveProperty('currentAssignee')
      expect(await assignmentState()).toEqual(before)
    },
  )

  it('uses the locked terminal ticket state with zero partial writes', async () => {
    const before = await assignmentState()
    const raceDb = withLockedAssignmentRows(db, {
      tickets: (rows) => rows.map((row) => row.id === ticketId
        ? { ...row, status: 'closed' }
        : row),
    })

    const result = await call(actor.tech, { action: 'claim' }, {}, undefined, raceDb)

    expect(result).toEqual({ ok: false, error: 'ticket_not_open' })
    expect(result).not.toHaveProperty('currentAssignee')
    expect(await assignmentState()).toEqual(before)
  })

  it('uses the locked terminal job state with zero partial writes', async () => {
    const before = await assignmentState()
    const raceDb = withLockedAssignmentRows(db, {
      jobs: (rows) => rows.map((row) => row.id === jobId
        ? { ...row, workStatus: 'done' }
        : row),
    })

    const result = await call(actor.tech, { action: 'claim' }, {}, undefined, raceDb)

    expect(result).toEqual({ ok: false, error: 'job_not_open' })
    expect(result).not.toHaveProperty('currentAssignee')
    expect(await assignmentState()).toEqual(before)
  })

  it('returns only the locked safe assignee when an open slot becomes assigned', async () => {
    const before = await assignmentState()
    const raceDb = withLockedAssignmentRows(db, {
      jobs: (rows) => rows.map((row) => row.id === jobId
        ? {
            ...row,
            assignedTechId: actor.owner.profileId,
            claimedAt: new Date('2026-07-16T13:00:00Z'),
          }
        : row),
    })

    const result = await call(actor.tech, { action: 'claim' }, {}, undefined, raceDb)

    expect(result).toEqual({
      ok: false,
      error: 'assignment_conflict',
      currentAssignee: {
        id: actor.owner.profileId,
        fullName: 'Owen Owner',
        role: 'owner',
        skillTier: 3,
      },
    })
    expect(Object.keys((result as { currentAssignee: object }).currentAssignee).sort())
      .toEqual(['fullName', 'id', 'role', 'skillTier'])
    expect(await assignmentState()).toEqual(before)
  })

  it('returns retryable conflict without disclosure when an assignment disappears', async () => {
    await db.update(ticketJobs).set({
      assignedTechId: actor.tech.profileId,
      claimedAt: new Date('2026-07-16T13:00:00Z'),
    }).where(eq(ticketJobs.id, jobId))
    const before = await assignmentState()
    const raceDb = withLockedAssignmentRows(db, {
      jobs: (rows) => rows.map((row) => row.id === jobId
        ? { ...row, assignedTechId: null, claimedAt: null }
        : row),
    })

    const result = await call(actor.otherTech, { action: 'claim' }, {}, undefined, raceDb)

    expect(result).toEqual({ ok: false, error: 'conflict', retryable: true })
    expect(result).not.toHaveProperty('currentAssignee')
    expect(await assignmentState()).toEqual(before)
  })

  it.each(['membership', 'deactivation', 'shop'] as const)(
    'uses locked target %s truth with no partial reassign',
    async (drift) => {
      const before = await assignmentState()
      const raceDb = withLockedAssignmentRows(db, {
        profiles: (rows) => rows.map((row) => {
          if (row.id !== actor.otherTech.profileId) return row
          if (drift === 'membership') {
            return { ...row, membershipStatus: 'pending' }
          }
          if (drift === 'deactivation') {
            return { ...row, deactivatedAt: new Date('2026-07-16T13:00:00Z') }
          }
          return { ...row, shopId: otherShopId }
        }),
      })

      const result = await call(actor.owner, {
        action: 'reassign',
        assignedTechId: actor.otherTech.profileId,
      }, {}, undefined, raceDb)

      expect(result).toEqual({ ok: false, error: 'invalid_assignee' })
      expect(result).not.toHaveProperty('currentAssignee')
      expect(await assignmentState()).toEqual(before)
    },
  )

  it('allows self-unclaim and privileged unclaim while clearing both assignment fields', async () => {
    for (const who of [actor.tech, actor.advisor]) {
      await db.update(ticketJobs).set({
        assignedTechId: actor.tech.profileId,
        claimedAt: new Date('2026-07-10T12:00:00Z'),
      }).where(eq(ticketJobs.id, jobId))

      const result = await call(who, { action: 'unclaim' })
      expect(result).toMatchObject({ ok: true, ticket: { id: ticketId } })
      const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
      expect(row.assignedTechId).toBeNull()
      expect(row.claimedAt).toBeNull()
    }
  })

  it('blocks self and privileged unclaim while a diagnostic provider lease is initializing', async () => {
    for (const who of [actor.tech, actor.advisor, actor.owner]) {
      await db.update(ticketJobs).set({
        assignedTechId: actor.tech.profileId,
        claimedAt: new Date('2026-07-10T12:00:00Z'),
        diagnosticStartState: 'initializing',
        diagnosticStartAttemptKey: userId(90),
        diagnosticStartLeaseUntil: new Date('2099-01-01T00:00:00Z'),
      }).where(eq(ticketJobs.id, jobId))

      await expect(call(who, { action: 'unclaim' }))
        .resolves.toEqual({ ok: false, error: 'job_not_open' })
      expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0])
        .toMatchObject({
          assignedTechId: actor.tech.profileId,
          diagnosticStartState: 'initializing',
          diagnosticStartAttemptKey: userId(90),
        })
    }
  })

  it('lets an advisor reassign an active same-shop sufficient-tier profile and clears claimedAt', async () => {
    await db.update(ticketJobs).set({
      assignedTechId: actor.tech.profileId,
      claimedAt: new Date('2026-07-10T12:00:00Z'),
    }).where(eq(ticketJobs.id, jobId))

    const result = await call(actor.advisor, {
      action: 'reassign',
      assignedTechId: actor.otherTech.profileId,
    })
    expect(result).toMatchObject({
      ok: true,
      ticket: { jobs: [{ assignedTechId: actor.otherTech.profileId }] },
    })
    const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(row.claimedAt).toBeNull()
  })

  it('blocks advisor and owner reassign while a diagnostic provider lease is initializing', async () => {
    for (const who of [actor.advisor, actor.owner]) {
      await db.update(ticketJobs).set({
        assignedTechId: actor.tech.profileId,
        diagnosticStartState: 'initializing',
        diagnosticStartAttemptKey: userId(91),
        diagnosticStartLeaseUntil: new Date('2099-01-01T00:00:00Z'),
      }).where(eq(ticketJobs.id, jobId))

      await expect(call(who, {
        action: 'reassign',
        assignedTechId: actor.otherTech.profileId,
      })).resolves.toEqual({ ok: false, error: 'job_not_open' })
      expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0])
        .toMatchObject({
          assignedTechId: actor.tech.profileId,
          diagnosticStartState: 'initializing',
          diagnosticStartAttemptKey: userId(91),
        })
    }
  })

  it('loses a reassign race when the diagnostic lease starts after prevalidation', async () => {
    for (const who of [actor.advisor, actor.owner]) {
      await db.update(ticketJobs).set({
        assignedTechId: actor.tech.profileId,
        diagnosticStartState: 'idle',
        diagnosticStartAttemptKey: null,
        diagnosticStartLeaseUntil: null,
      }).where(eq(ticketJobs.id, jobId))

      const raceDb = withLockedAssignmentRows(db, {
        jobs: (rows) => rows.map((row) => row.id === jobId
          ? {
              ...row,
              diagnosticStartState: 'initializing',
              diagnosticStartAttemptKey: userId(92),
              diagnosticStartLeaseUntil: new Date('2099-01-01T00:00:00Z'),
            }
          : row),
      })
      const result = await call(
        who,
        { action: 'reassign', assignedTechId: actor.otherTech.profileId },
        {},
        undefined,
        raceDb,
      )

      expect(result).toEqual({ ok: false, error: 'job_not_open' })
      expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0])
        .toMatchObject({
          assignedTechId: actor.tech.profileId,
          diagnosticStartState: 'idle',
          diagnosticStartAttemptKey: null,
        })
    }
  })

  it('keeps idle, failed, and ambiguous diagnostic jobs assignable', async () => {
    for (const diagnosticStartState of ['idle', 'failed', 'ambiguous'] as const) {
      await db.update(ticketJobs).set({
        assignedTechId: actor.tech.profileId,
        diagnosticStartState,
      }).where(eq(ticketJobs.id, jobId))
      expect((await call(actor.tech, { action: 'unclaim' })).ok).toBe(true)

      await db.update(ticketJobs).set({ assignedTechId: actor.tech.profileId })
        .where(eq(ticketJobs.id, jobId))
      expect((await call(actor.advisor, {
        action: 'reassign',
        assignedTechId: actor.otherTech.profileId,
      })).ok).toBe(true)
    }
  })

  it.each([
    ['expired', new Date('2000-01-01T00:00:00Z')],
    ['missing', null],
  ] as const)('keeps %s initializing leases assignable', async (_leaseKind, leaseUntil) => {
    await db.update(ticketJobs).set({
      assignedTechId: actor.tech.profileId,
      diagnosticStartState: 'initializing',
      diagnosticStartAttemptKey: userId(93),
      diagnosticStartLeaseUntil: leaseUntil,
    }).where(eq(ticketJobs.id, jobId))
    expect((await call(actor.tech, { action: 'unclaim' })).ok).toBe(true)

    await db.update(ticketJobs).set({ assignedTechId: actor.tech.profileId })
      .where(eq(ticketJobs.id, jobId))
    expect((await call(actor.advisor, {
      action: 'reassign',
      assignedTechId: actor.otherTech.profileId,
    })).ok).toBe(true)
  })

  it('warns before a below-tier reassign and changes nothing until explicitly confirmed', async () => {
    const [tierOne] = await db.insert(profiles).values({
      userId: userId(9), shopId, fullName: 'Casey C-Tech', role: 'tech', skillTier: 1,
    }).returning()
    await db.update(ticketJobs).set({ assignedTechId: actor.tech.profileId }).where(eq(ticketJobs.id, jobId))

    await expect(call(actor.owner, {
      action: 'reassign', assignedTechId: tierOne.id,
    })).resolves.toEqual({
      ok: false,
      error: 'tier_confirmation_required',
      warning: {
        code: 'below_required_tier',
        assignedTechId: tierOne.id,
        assignedSkillTier: 1,
        requiredSkillTier: 2,
      },
    })
    expect((await db.select().from(ticketJobs))[0].assignedTechId).toBe(actor.tech.profileId)

    const confirmed = await call(actor.owner, {
      action: 'reassign', assignedTechId: tierOne.id, confirmBelowTier: true,
    })
    expect(confirmed).toMatchObject({ ok: true, ticket: { jobs: [{ assignedTechId: tierOne.id }] } })
  })

  it('rejects an unconfirmed reassign when the target is downgraded after prevalidation', async () => {
    await db.update(ticketJobs).set({ assignedTechId: actor.tech.profileId })
      .where(eq(ticketJobs.id, jobId))

    const raceDb = withLockedAssignmentRows(db, {
      profiles: (rows) => rows.map((row) => row.id === actor.otherTech.profileId
        ? { ...row, skillTier: 1 }
        : row),
    })
    const result = await call(
      actor.owner,
      { action: 'reassign', assignedTechId: actor.otherTech.profileId },
      {},
      undefined,
      raceDb,
    )

    expect(result).toEqual({
      ok: false,
      error: 'tier_confirmation_required',
      warning: {
        code: 'below_required_tier',
        assignedTechId: actor.otherTech.profileId,
        assignedSkillTier: 1,
        requiredSkillTier: 2,
      },
    })
    expect((await db.select().from(ticketJobs))[0].assignedTechId).toBe(actor.tech.profileId)
  })

  it('rejects reassign when the target role becomes unsupported after prevalidation', async () => {
    await db.update(ticketJobs).set({ assignedTechId: actor.tech.profileId })
      .where(eq(ticketJobs.id, jobId))

    const raceDb = withLockedAssignmentRows(db, {
      profiles: (rows) => rows.map((row) => row.id === actor.otherTech.profileId
        ? { ...row, role: 'curator' }
        : row),
    })
    const result = await call(
      actor.owner,
      { action: 'reassign', assignedTechId: actor.otherTech.profileId },
      {},
      undefined,
      raceDb,
    )

    expect(result).toEqual({ ok: false, error: 'invalid_assignee' })
    expect((await db.select().from(ticketJobs))[0].assignedTechId).toBe(actor.tech.profileId)
  })

  it('returns only the safe current assignee to sequential and concurrent losing claimers', async () => {
    const first = await call(actor.tech, { action: 'claim' })
    expect(first.ok).toBe(true)
    const loser = await call(actor.otherTech, { action: 'claim' })
    expect(loser).toEqual({
      ok: false,
      error: 'assignment_conflict',
      currentAssignee: { id: actor.tech.profileId, fullName: 'Taylor Tech', role: 'tech', skillTier: 2 },
    })
    expect(loser).not.toHaveProperty('ticket')
    expect(JSON.stringify(loser)).not.toMatch(/userId|shopId/)

    await db.update(ticketJobs).set({ assignedTechId: null, claimedAt: null }).where(eq(ticketJobs.id, jobId))
    const raced = await Promise.all([
      call(actor.tech, { action: 'claim' }),
      call(actor.otherTech, { action: 'claim' }),
    ])
    expect(raced.filter((result) => result.ok)).toHaveLength(1)
    const conflict = raced.find((result) => !result.ok)
    expect(conflict).toMatchObject({ ok: false, error: 'assignment_conflict' })
    const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(row.assignedTechId).toBe((conflict as { currentAssignee: { id: string } }).currentAssignee.id)
  })

  it('rejects malformed IDs and strict action bodies before any write', async () => {
    const invalid: Array<[unknown, unknown, unknown]> = [
      ['bad-id', jobId, { action: 'claim' }],
      [ticketId, 'bad-id', { action: 'claim' }],
      [ticketId, jobId, null],
      [ticketId, jobId, { action: 'claim', assignedTechId: actor.tech.profileId }],
      [ticketId, jobId, { action: 'unclaim', extra: true }],
      [ticketId, jobId, { action: 'reassign' }],
      [ticketId, jobId, { action: 'reassign', assignedTechId: 'bad-id' }],
      [ticketId, jobId, { action: 'other' }],
    ]
    for (const [badTicketId, badJobId, body] of invalid) {
      await expect(call(actor.owner, body, { ticketId: badTicketId, jobId: badJobId }))
        .resolves.toEqual({ ok: false, error: 'invalid_input' })
    }
    expect((await db.select().from(ticketJobs))[0].assignedTechId).toBeNull()
  })

  it('fails closed without writes for actor role, membership, deactivation, or claim tier defects', async () => {
    const denied: Array<[TicketActor, string]> = [
      [{ ...actor.tech, role: 'curator' }, 'forbidden'],
      [{ ...actor.tech, membershipStatus: 'pending' }, 'inactive_profile'],
      [{ ...actor.tech, deactivatedAt: new Date() }, 'inactive_profile'],
      [{ ...actor.tech, shopId: null }, 'no_shop'],
      [actor.parts, 'invalid_assignee'],
    ]
    for (const [who, error] of denied) {
      await expect(call(who, { action: 'claim' })).resolves.toEqual({ ok: false, error })
      expect((await db.select().from(ticketJobs))[0].assignedTechId).toBeNull()
    }

    for (const skillTier of [null, 1]) {
      await db.update(profiles).set({ skillTier }).where(eq(profiles.id, actor.tech.profileId))
      await expect(call(actor.tech, { action: 'claim' }))
        .resolves.toEqual({ ok: false, error: 'invalid_assignee' })
      expect((await db.select().from(ticketJobs))[0].assignedTechId).toBeNull()
    }
  })

  it('uses current persisted actor state rather than stale actor input', async () => {
    await db.update(ticketJobs).set({ assignedTechId: actor.otherTech.profileId })
      .where(eq(ticketJobs.id, jobId))
    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null })
      .where(eq(profiles.id, actor.tech.profileId))
    const result = await call(actor.tech, { action: 'claim' })
    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(result).not.toHaveProperty('currentAssignee')
    expect((await db.select().from(ticketJobs))[0].assignedTechId).toBe(actor.otherTech.profileId)
  })

  it('hides cross-shop and mismatched ticket/job identities and never reveals an assignee', async () => {
    const [crossProfile] = await db.insert(profiles).values({
      userId: userId(20), shopId: otherShopId, fullName: 'Hidden Tech', role: 'tech', skillTier: 3,
    }).returning()
    const [crossTicket] = await db.insert(tickets).values({
      shopId: otherShopId, ticketNumber: 1, source: 'tech_quick', concern: 'Hidden', createdByProfileId: crossProfile.id,
    }).returning()
    const [crossJob] = await db.insert(ticketJobs).values({
      shopId: otherShopId, ticketId: crossTicket.id, title: 'Hidden', kind: 'repair',
      requiredSkillTier: 1, assignedTechId: crossProfile.id,
    }).returning()

    const actions: Array<[TicketActor, unknown]> = [
      [actor.tech, { action: 'claim' }],
      [actor.tech, { action: 'unclaim' }],
      [actor.owner, { action: 'reassign', assignedTechId: actor.otherTech.profileId }],
    ]
    for (const ids of [
      { ticketId: crossTicket.id, jobId: crossJob.id },
      { ticketId, jobId: crossJob.id },
      { ticketId: crossTicket.id, jobId },
    ]) {
      for (const [who, action] of actions) {
        const result = await call(who, action, ids)
        expect(result).toEqual({ ok: false, error: 'not_found' })
        expect(JSON.stringify(result)).not.toContain('Hidden Tech')
      }
    }
  })

  it('locks only the actor when the same-shop ticket/job pair is mismatched', async () => {
    const [otherTicket] = await db.insert(tickets).values({
      shopId,
      ticketNumber: 3,
      source: 'tech_quick',
      concern: 'Other same-shop ticket',
      createdByProfileId: actor.owner.profileId,
    }).returning()
    const [otherJob] = await db.insert(ticketJobs).values({
      shopId,
      ticketId: otherTicket.id,
      title: 'Other same-shop job',
      kind: 'repair',
      requiredSkillTier: 1,
      assignedTechId: actor.otherTech.profileId,
    }).returning()
    let lockedProfileIds: string[] = []
    const observedDb = withLockedAssignmentRows(db, {
      profiles: (rows) => {
        lockedProfileIds = rows.map(({ id }) => id)
        return rows
      },
    })

    const result = await call(
      actor.owner,
      { action: 'reassign', assignedTechId: actor.otherTech.profileId },
      { ticketId, jobId: otherJob.id },
      undefined,
      observedDb,
    )

    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(lockedProfileIds).toEqual([actor.owner.profileId])
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, otherJob.id)))[0])
      .toMatchObject({ assignedTechId: actor.otherTech.profileId, revision: 0n })
  })

  it('assigns through complete separated, session, vendor, and approval reference closure', async () => {
    const terminalAt = new Date('2026-07-16T12:00:00.000Z')
    const referenceProfiles = await db.insert(profiles).values([
      { userId: userId(701), shopId, fullName: 'Parent Creator', role: 'advisor' },
      { userId: userId(702), shopId, fullName: 'Delivery Actor', role: 'advisor' },
      { userId: userId(703), shopId, fullName: 'Closing Actor', role: 'owner', skillTier: 3 },
      { userId: userId(704), shopId, fullName: 'Target Creator', role: 'advisor' },
      { userId: userId(705), shopId, fullName: 'Current Assignee', role: 'tech', skillTier: 2 },
      { userId: userId(706), shopId, fullName: 'Target Job Creator', role: 'advisor' },
      { userId: userId(707), shopId, fullName: 'Statement Confirmer', role: 'owner', skillTier: 3 },
      { userId: userId(708), shopId, fullName: 'Sibling Job Creator', role: 'tech', skillTier: 2 },
      { userId: userId(709), shopId, fullName: 'Line Orderer', role: 'parts' },
      { userId: userId(710), shopId, fullName: 'Line Receiver', role: 'advisor' },
      { userId: userId(711), shopId, fullName: 'Session Technician', role: 'tech', skillTier: 2 },
      { userId: userId(712), shopId, fullName: 'Quote Creator', role: 'advisor' },
      { userId: userId(713), shopId, fullName: 'Approval Actor', role: 'owner', skillTier: 3 },
    ]).returning()
    const [
      parentCreator,
      deliveryActor,
      closingActor,
      targetCreator,
      currentAssignee,
      targetJobCreator,
      statementConfirmer,
      siblingJobCreator,
      lineOrderer,
      lineReceiver,
      sessionTechnician,
      quoteCreator,
      approvalActor,
    ] = referenceProfiles
    expect(new Set([
      ...referenceProfiles.map(({ id }) => id),
      actor.owner.profileId,
      actor.otherTech.profileId,
    ]).size).toBe(referenceProfiles.length + 2)
    const seededCustomers = await db.insert(customers).values([
      { shopId, name: 'Parent Customer', phone: '555-0301' },
      { shopId, name: 'Target Customer', phone: '555-0302' },
      { shopId, name: 'Session Customer', phone: '555-0303' },
    ]).returning()
    const seededVehicles = await db.insert(vehicles).values(
      seededCustomers.map((customer, index) => ({
        customerId: customer.id,
        year: 2020 + index,
        make: 'Closure',
        model: `Vehicle ${index + 1}`,
      })),
    ).returning()
    const [parent] = await db.insert(tickets).values({
      shopId,
      ticketNumber: 30,
      source: 'counter',
      customerId: seededCustomers[0].id,
      vehicleId: seededVehicles[0].id,
      concern: 'Delivered parent',
      status: 'closed',
      createdByProfileId: parentCreator.id,
      deliveredAt: terminalAt,
      deliveredByProfileId: deliveryActor.id,
      closedAt: terminalAt,
      closedByProfileId: closingActor.id,
      closeDisposition: 'delivered',
    }).returning()
    const [targetTicket] = await db.insert(tickets).values({
      shopId,
      ticketNumber: 31,
      source: 'counter',
      customerId: seededCustomers[1].id,
      vehicleId: seededVehicles[1].id,
      concern: 'Complete closure target',
      createdByProfileId: targetCreator.id,
      separateFromTicketId: parent.id,
      separateReason: 'comeback',
    }).returning()
    const [linkedSession] = await db.insert(sessions).values({
      shopId,
      techId: sessionTechnician.id,
      vehicleId: seededVehicles[2].id,
      intake: {
        vehicleYear: seededVehicles[2].year,
        vehicleMake: seededVehicles[2].make,
        vehicleModel: seededVehicles[2].model,
        customerComplaint: 'Closure session',
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'Open', done: false },
    }).returning()
    const [targetJob] = await db.insert(ticketJobs).values({
      shopId,
      ticketId: targetTicket.id,
      title: 'Approved closure job',
      kind: 'repair',
      requiredSkillTier: 2,
      assignedTechId: currentAssignee.id,
      createdByProfileId: targetJobCreator.id,
      creatorProvenance: 'direct',
      workStatement: 'Complete the approved closure repair',
      statementSource: 'customer_request',
      statementReviewState: 'confirmed',
      statementConfirmedByProfileId: statementConfirmer.id,
      statementConfirmedAt: terminalAt,
      sequenceNumber: 1,
      revision: 7n,
    }).returning()
    await db.insert(ticketJobs).values({
      shopId,
      ticketId: targetTicket.id,
      title: 'Linked diagnostic sibling',
      kind: 'diagnostic',
      requiredSkillTier: 2,
      sessionId: linkedSession.id,
      createdByProfileId: siblingJobCreator.id,
      creatorProvenance: 'direct',
      createdFromJobId: targetJob.id,
      sequenceNumber: 2,
      revision: 5n,
    })
    const [vendor] = await db.insert(vendorAccounts).values({
      shopId,
      vendor: 'closure_parts',
      displayName: 'Closure Parts',
      mode: 'manual',
      enabled: true,
    }).returning()
    await db.insert(jobLines).values({
      shopId,
      jobId: targetJob.id,
      kind: 'part',
      description: 'Received closure part',
      quantity: 1,
      priceCents: 2000,
      taxable: true,
      vendorAccountId: vendor.id,
      partStatus: 'received',
      orderedAt: terminalAt,
      orderedByProfileId: lineOrderer.id,
      receivedAt: terminalAt,
      receivedByProfileId: lineReceiver.id,
    })
    const [version] = await db.insert(quoteVersions).values({
      shopId,
      ticketId: targetTicket.id,
      versionNumber: 1,
      snapshot: { jobs: [{ id: targetJob.id, decision: 'approved' }] },
      createdByProfileId: quoteCreator.id,
    }).returning()
    const [event] = await db.insert(quoteEvents).values({
      shopId,
      ticketId: targetTicket.id,
      jobId: targetJob.id,
      quoteVersionId: version.id,
      kind: 'approved',
      actorProfileId: approvalActor.id,
      approvedVia: 'in_person',
      requestKey: `closure-${userId(600)}`,
    }).returning()
    await db.update(ticketJobs).set({
      approvalState: 'approved',
      approvedQuoteVersionId: version.id,
      approvedApprovalEventId: event.id,
    }).where(eq(ticketJobs.id, targetJob.id))
    const [beforeTicket] = await db.select().from(tickets)
      .where(eq(tickets.id, targetTicket.id))

    const result = await call(actor.owner, {
      action: 'reassign',
      assignedTechId: actor.otherTech.profileId,
    }, { ticketId: targetTicket.id, jobId: targetJob.id })

    expect(result).toMatchObject({ ok: true })
    const [afterTicket] = await db.select().from(tickets)
      .where(eq(tickets.id, targetTicket.id))
    const [afterJob] = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.id, targetJob.id))
    expect(afterTicket.projectionRevision).toBe(beforeTicket.projectionRevision + 1n)
    expect(afterTicket.continuityRevision).toBe(beforeTicket.continuityRevision)
    expect(afterJob).toMatchObject({
      assignedTechId: actor.otherTech.profileId,
      revision: 8n,
      approvedQuoteVersionId: version.id,
      approvedApprovalEventId: event.id,
    })
  })

  it('rejects closed tickets and every non-open job state without writes', async () => {
    const terminalAt = new Date('2026-07-15T12:00:00Z')
    const [closedTicket] = await db.insert(tickets).values({
      shopId,
      ticketNumber: 2,
      source: 'tech_quick',
      concern: 'Already closed',
      createdByProfileId: actor.owner.profileId,
      status: 'closed',
      closedAt: terminalAt,
      closedByProfileId: actor.owner.profileId,
      closeDisposition: 'customer_declined',
    }).returning()
    const [closedJob] = await db.insert(ticketJobs).values({
      shopId,
      ticketId: closedTicket.id,
      title: 'Closed ticket job',
      kind: 'repair',
      requiredSkillTier: 1,
    }).returning()
    const actions: Array<[TicketActor, unknown]> = [
      [actor.tech, { action: 'claim' }],
      [actor.tech, { action: 'unclaim' }],
      [actor.owner, { action: 'reassign', assignedTechId: actor.otherTech.profileId }],
    ]
    for (const [who, action] of actions) {
      await expect(call(who, action, {
        ticketId: closedTicket.id,
        jobId: closedJob.id,
      }))
        .resolves.toEqual({ ok: false, error: 'ticket_not_open' })
    }

    for (const workStatus of ['in_progress', 'blocked', 'done', 'canceled'] as const) {
      await db.update(ticketJobs).set({ workStatus }).where(eq(ticketJobs.id, jobId))
      for (const [who, action] of actions) {
        await expect(call(who, action))
          .resolves.toEqual({ ok: false, error: 'job_not_open' })
      }
      expect((await db.select().from(ticketJobs))[0].assignedTechId).toBeNull()
    }
  })

  it('restricts unclaim and reassign authority and validates target tenant/activity/tier', async () => {
    await db.update(ticketJobs).set({ assignedTechId: actor.tech.profileId }).where(eq(ticketJobs.id, jobId))
    await expect(call(actor.otherTech, { action: 'unclaim' }))
      .resolves.toEqual({ ok: false, error: 'forbidden' })
    await expect(call(actor.tech, { action: 'reassign', assignedTechId: actor.otherTech.profileId }))
      .resolves.toEqual({ ok: false, error: 'forbidden' })

    const targets = await db.insert(profiles).values([
      { userId: userId(30), shopId: otherShopId, role: 'tech', skillTier: 3 },
      { userId: userId(31), shopId, role: 'tech', skillTier: 3, membershipStatus: 'pending', membershipActivatedAt: null },
      { userId: userId(32), shopId, role: 'tech', skillTier: 3, deactivatedAt: new Date() },
      { userId: userId(33), shopId, role: 'tech', skillTier: null },
      { userId: userId(34), shopId, role: 'curator', skillTier: 3 },
    ]).returning()
    const expectations = [
      'not_found',
      'invalid_assignee',
      'invalid_assignee',
      'invalid_assignee',
      'invalid_assignee',
    ]
    for (let index = 0; index < targets.length; index += 1) {
      await expect(call(actor.owner, { action: 'reassign', assignedTechId: targets[index].id }))
        .resolves.toEqual({ ok: false, error: expectations[index] })
    }
    expect((await db.select().from(ticketJobs))[0].assignedTechId).toBe(actor.tech.profileId)
  })
})
