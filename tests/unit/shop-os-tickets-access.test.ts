import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addTicketJob,
  createTicket,
  getTicketDetail,
  type TicketActor,
} from '@/lib/tickets'
import type { AppDb } from '@/lib/db/queries'
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
  type Profile,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { ShopOsMutationConflict } from '@/lib/shop-os/continuity/mutation-foundation/conflicts'

type SeededProfile = Pick<
  Profile,
  'id' | 'shopId' | 'role' | 'skillTier' | 'membershipStatus' | 'deactivatedAt'
>

const uuid = (suffix: number) =>
  `00000000-0000-0000-0000-${suffix.toString().padStart(12, '0')}`

function actorFrom(profile: SeededProfile): TicketActor {
  return {
    profileId: profile.id,
    shopId: profile.shopId,
    role: profile.role,
    skillTier: profile.skillTier,
    membershipStatus: profile.membershipStatus,
    deactivatedAt: profile.deactivatedAt,
  }
}

function withLockedTicketRows(
  sourceDb: TestDb,
  transform: (
    rows: readonly (typeof tickets.$inferSelect)[],
  ) => readonly (typeof tickets.$inferSelect)[],
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
      if (property === 'for' && source === tickets) {
        return async (...args: unknown[]) => transform(
          await Reflect.apply(member, target, args) as (typeof tickets.$inferSelect)[],
        )
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
                      Reflect.get(txTarget, txProperty, txReceiver) as (...values: unknown[]) => unknown,
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

describe('ticket job lock contract', () => {
  it('uses the bounded complete-graph coordinator, shared sequence reservation, and sole finalizer', async () => {
    const source = await readFile(path.join(process.cwd(), 'lib/tickets.ts'), 'utf8')
    const normalized = source.replace(/\s+/g, ' ')
    const validatorStart = normalized.indexOf('function resolveLockedAddTicketJobTarget')
    const discoveryStart = normalized.indexOf('async function discoverAddTicketJobMutation')
    const mutationStart = normalized.indexOf('export async function addTicketJob')
    const nextExport = normalized.indexOf('export type SafeTicketAssignee', mutationStart)
    const validatorSource = normalized.slice(validatorStart, discoveryStart)
    const discoverySource = normalized.slice(discoveryStart, mutationStart)
    const mutationSource = normalized.slice(mutationStart, nextExport)

    expect(validatorStart).toBeGreaterThan(-1)
    expect(discoveryStart).toBeGreaterThan(-1)
    expect(mutationStart).toBeGreaterThan(-1)
    expect(nextExport).toBeGreaterThan(mutationStart)
    expect(mutationSource).toContain('runBoundedShopOsMutationV1')
    expect(mutationSource).toContain('discoverAddTicketJobMutation')
    expect(mutationSource).toContain('reserveJobSequencesForInsertionV1')
    expect(mutationSource.match(/finalizeMutationRevisionsV1/g) ?? []).toHaveLength(1)
    expect(mutationSource).not.toContain('db.transaction')
    expect(mutationSource).not.toContain('validateAssignment')
    expect(mutationSource).not.toMatch(/max\s*\(|count\s*\(/i)
    expect(mutationSource).not.toMatch(/sequenceNumber:\s*\d/)
    expect(discoverySource.match(/randomUUID\(\)/g) ?? []).toHaveLength(1)
    expect(discoverySource.indexOf('const jobId = randomUUID()'))
      .toBeLessThan(discoverySource.indexOf('await tx.select()'))
    expect(discoverySource).toContain('proposedAssigneeId')
    expect(discoverySource).toContain('...ticketRows.map(({ customerId }) => customerId)')
    expect(discoverySource).toContain('...ticketRows.map(({ vehicleId }) => vehicleId)')
    expect(discoverySource).toContain('...sessionVehicleRows.map(({ customerId }) => customerId)')
    expect(discoverySource).toContain('...sessionVehicleIds')
    expect(discoverySource).toContain(
      'separateChainIds: Object.freeze(ticketRows.map(({ id }) => id))',
    )
    expect(discoverySource).toContain('ticket.createdByProfileId')
    expect(discoverySource).toContain('job.statementConfirmedByProfileId')
    expect(discoverySource).toContain('lines.map(({ vendorAccountId }) => vendorAccountId)')
    expect(discoverySource).toContain('sessionRows.map(({ techId }) => techId)')
    expect(discoverySource).toContain('job.approvedApprovalEventId')
    expect(discoverySource).toContain(
      'jobs: Object.freeze([Object.freeze({ id: jobId, ticketId })])',
    )
    expect(mutationSource).toContain('createdByProfileId: scope.actor.id')
    expect(mutationSource).toContain('resolveLockedAddTicketJobTarget(')
    expect(mutationSource).toContain('discovery.separateChainIds')
    expect(validatorSource).toContain('expectedChainIds.length > 64')
    expect(validatorSource).toContain(
      'new Set(expectedChainIds).size !== expectedChainIds.length',
    )
    expect(validatorSource).toContain(
      'scope.tickets.length !== expectedChainIds.length',
    )
    expect(validatorSource).toContain(
      'graph.ticket.separateFromTicketId !== expectedParentId',
    )
    expect(mutationSource).toContain("creatorProvenance: 'direct'")
    expect(mutationSource).toContain("inserted.workStatus !== 'open'")
    expect(mutationSource).toContain("inserted.approvalState !== 'pending_quote'")
    expect(mutationSource).toContain("inserted.diagnosticStartState !== 'idle'")
    expect(mutationSource).toContain('await seams.afterInsert?.()')
    expect(mutationSource).toContain('await seams.afterFinalization?.()')
  })
})

describe('ticket detail access and job mutation', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopA: typeof shops.$inferSelect
  let shopB: typeof shops.$inferSelect
  let actors: Record<'tech' | 'advisor' | 'parts' | 'owner', TicketActor>
  let tierOneTech: SeededProfile
  let ticketId: string

  beforeEach(async () => {
    const created = await createTestDb()
    db = created.db
    close = created.close

    ;[shopA, shopB] = await db
      .insert(shops)
      .values([{ name: 'North Shop' }, { name: 'South Shop' }])
      .returning()
    const [customer] = await db
      .insert(customers)
      .values({
        shopId: shopA.id,
        name: 'Ada Driver',
        phone: '555-0101',
        email: 'ada@example.com',
      })
      .returning()
    const [vehicle] = await db
      .insert(vehicles)
      .values({
        customerId: customer.id,
        year: 2020,
        make: 'Honda',
        model: 'Civic',
        engine: '2.0L',
        vin: 'VIN-A',
        mileage: 42000,
        plate: 'NORTH1',
      })
      .returning()
    const seeded = await db
      .insert(profiles)
      .values([
        { userId: uuid(1), shopId: shopA.id, role: 'tech', skillTier: 2, fullName: 'Taylor Tech' },
        { userId: uuid(2), shopId: shopA.id, role: 'advisor', skillTier: 2, fullName: 'Alex Advisor' },
        { userId: uuid(3), shopId: shopA.id, role: 'parts', skillTier: null, fullName: 'Pat Parts' },
        { userId: uuid(4), shopId: shopA.id, role: 'owner', skillTier: 3, fullName: 'Owen Owner' },
        { userId: uuid(5), shopId: shopA.id, role: 'tech', skillTier: 1, fullName: 'Terry Tier One' },
      ])
      .returning()

    actors = {
      tech: actorFrom(seeded[0]),
      advisor: actorFrom(seeded[1]),
      parts: actorFrom(seeded[2]),
      owner: actorFrom(seeded[3]),
    }
    tierOneTech = seeded[4]

    const ticket = await createTicket(db, {
      actor: actors.owner,
      body: {
        customerId: customer.id,
        vehicleId: vehicle.id,
        concern: 'Intermittent front-end noise',
        jobs: [
          {
            title: 'Initial diagnosis',
            kind: 'diagnostic',
            requiredSkillTier: 2,
          },
        ],
      },
    })
    if (!ticket.ok) throw new Error(`ticket seed failed: ${ticket.error}`)
    ticketId = ticket.ticket.id
  })

  afterEach(async () => {
    await close()
  })

  it('lets every active Shop OS role read a same-shop ticket and add a job', async () => {
    for (const role of ['tech', 'advisor', 'parts', 'owner'] as const) {
      await expect(
        getTicketDetail(db, { actor: actors[role], ticketId }),
      ).resolves.toMatchObject({
        ok: true,
        ticket: {
          id: ticketId,
          customer: { name: 'Ada Driver' },
          vehicle: { make: 'Honda', model: 'Civic' },
        },
      })

      const added = await addTicketJob(db, {
        actor: actors[role],
        ticketId,
        body: {
          title: `  ${role} follow-up  `,
          kind: 'maintenance',
          requiredSkillTier: 1,
        },
      })
      expect(added).toMatchObject({ ok: true })
      if (!added.ok) continue
      expect(
        added.ticket.jobs.find((job) => job.title === `${role} follow-up`),
      ).toMatchObject({
        title: `${role} follow-up`,
        kind: 'maintenance',
        requiredSkillTier: 1,
        assignedTechId: null,
      })
    }

    expect(await db.select().from(ticketJobs)).toHaveLength(5)
  })

  it('persists one directly-created revision-1 job and advances only the parent revisions once', async () => {
    const [ticketBefore] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const existingBefore = await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId))
    expect(existingBefore).toHaveLength(1)

    const result = await addTicketJob(db, {
      actor: actors.owner,
      ticketId,
      body: {
        title: '  Verify exact append  ',
        kind: 'repair',
        requiredSkillTier: 2,
      },
    })

    expect(result.ok).toBe(true)
    const [ticketAfter] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const jobsAfter = await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId))
    const created = jobsAfter.find(({ title }) => title === 'Verify exact append')
    expect(created).toMatchObject({
      shopId: shopA.id,
      ticketId,
      title: 'Verify exact append',
      kind: 'repair',
      requiredSkillTier: 2,
      assignedTechId: null,
      claimedAt: null,
      workStatus: 'open',
      approvalState: 'pending_quote',
      sequenceNumber: 2,
      revision: 1n,
      createdByProfileId: actors.owner.profileId,
      creatorProvenance: 'direct',
      createdFromJobId: null,
      sessionId: null,
      workStatement: null,
      approvedQuoteVersionId: null,
      approvedApprovalEventId: null,
      diagnosticStartState: 'idle',
      diagnosticStartAttemptKey: null,
      diagnosticStartLeaseUntil: null,
      diagnosticStartErrorCode: null,
    })
    expect(ticketAfter.projectionRevision).toBe(ticketBefore.projectionRevision + 1n)
    expect(ticketAfter.continuityRevision).toBe(ticketBefore.continuityRevision + 1n)
    const existingAfter = jobsAfter.find(({ id }) => id === existingBefore[0].id)
    expect(existingAfter?.revision).toBe(existingBefore[0].revision)
    expect(existingAfter?.approvedQuoteVersionId).toBe(existingBefore[0].approvedQuoteVersionId)
    expect(existingAfter?.approvedApprovalEventId).toBe(existingBefore[0].approvedApprovalEventId)
  })

  it('appends across legacy null and mixed immutable sequence histories', async () => {
    const sourceTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    const [legacyTicket] = await db.insert(tickets).values({
      shopId: shopA.id,
      ticketNumber: 100,
      source: 'counter',
      customerId: sourceTicket.customerId,
      vehicleId: sourceTicket.vehicleId,
      concern: 'Legacy sequence history',
      createdByProfileId: actors.owner.profileId,
    }).returning()
    await db.insert(ticketJobs).values({
      shopId: shopA.id,
      ticketId: legacyTicket.id,
      title: 'Legacy null job',
      kind: 'diagnostic',
      requiredSkillTier: 1,
      sequenceNumber: null,
    })

    for (const title of ['First legacy append', 'Second legacy append']) {
      await expect(addTicketJob(db, {
        actor: actors.owner,
        ticketId: legacyTicket.id,
        body: { title, kind: 'repair', requiredSkillTier: 1 },
      })).resolves.toMatchObject({ ok: true })
    }

    const rows = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.ticketId, legacyTicket.id))
    expect(rows.find(({ title }) => title === 'Legacy null job')?.sequenceNumber).toBeNull()
    expect(rows.find(({ title }) => title === 'First legacy append')?.sequenceNumber).toBe(2)
    expect(rows.find(({ title }) => title === 'Second legacy append')?.sequenceNumber).toBe(3)
  })

  it('fails closed on a corrupt populated sequence suffix without changing rows or revisions', async () => {
    const sourceTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    const [corruptTicket] = await db.insert(tickets).values({
      shopId: shopA.id,
      ticketNumber: 101,
      source: 'counter',
      customerId: sourceTicket.customerId,
      vehicleId: sourceTicket.vehicleId,
      concern: 'Corrupt sequence history',
      createdByProfileId: actors.owner.profileId,
    }).returning()
    await db.insert(ticketJobs).values({
      shopId: shopA.id,
      ticketId: corruptTicket.id,
      title: 'Corrupt suffix job',
      kind: 'repair',
      requiredSkillTier: 1,
      sequenceNumber: 2,
    })
    const beforeTicket = (await db.select().from(tickets)
      .where(eq(tickets.id, corruptTicket.id)))[0]
    const beforeJobs = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.ticketId, corruptTicket.id))

    await expect(addTicketJob(db, {
      actor: actors.owner,
      ticketId: corruptTicket.id,
      body: { title: 'Must not persist', kind: 'repair', requiredSkillTier: 1 },
    })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })

    expect(await db.select().from(ticketJobs)
      .where(eq(ticketJobs.ticketId, corruptTicket.id)))
      .toEqual(beforeJobs)
    expect((await db.select().from(tickets)
      .where(eq(tickets.id, corruptTicket.id)))[0])
      .toEqual(beforeTicket)
  })

  it('owns canonical caller input before awaiting and ignores later mutations', async () => {
    const mutableActor = {
      ...actors.owner,
      profileId: actors.owner.profileId.toUpperCase(),
      shopId: actors.owner.shopId?.toUpperCase() ?? null,
    }
    const mutableBody = {
      title: '  Owned caller body  ',
      kind: 'repair' as const,
      requiredSkillTier: 1 as const,
      assignedTechId: actors.owner.profileId.toUpperCase(),
    }
    const pending = addTicketJob(db, {
      actor: mutableActor,
      ticketId: ticketId.toUpperCase(),
      body: mutableBody,
    })
    mutableActor.profileId = uuid(991)
    mutableActor.shopId = uuid(992)
    mutableActor.role = 'tech'
    mutableBody.title = 'Mutated too late'
    mutableBody.assignedTechId = uuid(993)

    await expect(pending).resolves.toMatchObject({ ok: true })
    const created = (await db.select().from(ticketJobs))
      .find(({ title }) => title === 'Owned caller body')
    expect(created).toMatchObject({
      assignedTechId: actors.owner.profileId,
      createdByProfileId: actors.owner.profileId,
    })
  })

  it('uses current locked actor and assignee truth instead of stale caller authority', async () => {
    await db.update(profiles).set({ role: 'tech' })
      .where(eq(profiles.id, actors.owner.profileId))
    await expect(addTicketJob(db, {
      actor: actors.owner,
      ticketId,
      body: {
        title: 'Stale owner cannot assign',
        kind: 'repair',
        requiredSkillTier: 1,
        assignedTechId: tierOneTech.id,
      },
    })).resolves.toEqual({ ok: false, error: 'invalid_assignee' })

    await db.update(profiles).set({ role: 'owner' })
      .where(eq(profiles.id, actors.owner.profileId))
    await db.update(profiles).set({ skillTier: 3 })
      .where(eq(profiles.id, tierOneTech.id))
    await expect(addTicketJob(db, {
      actor: actors.owner,
      ticketId,
      body: {
        title: 'Current tier wins',
        kind: 'repair',
        requiredSkillTier: 3,
        assignedTechId: tierOneTech.id,
      },
    })).resolves.toMatchObject({ ok: true })

    await db.update(profiles).set({ deactivatedAt: new Date() })
      .where(eq(profiles.id, tierOneTech.id))
    await expect(addTicketJob(db, {
      actor: actors.owner,
      ticketId,
      body: {
        title: 'Inactive assignee rejected',
        kind: 'repair',
        requiredSkillTier: 1,
        assignedTechId: tierOneTech.id,
      },
    })).resolves.toEqual({ ok: false, error: 'invalid_assignee' })
  })

  it.each([
    ['pending membership', {
      membershipStatus: 'pending' as const,
      membershipActivatedAt: null,
    }],
    ['deactivation', { deactivatedAt: new Date('2026-07-16T12:00:00.000Z') }],
  ])('rejects stale caller activity after persisted %s without changing state', async (
    _label,
    persistedActivity,
  ) => {
    const beforeTicket = (await db.select().from(tickets)
      .where(eq(tickets.id, ticketId)))[0]
    const beforeJobs = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.ticketId, ticketId))
    await db.update(profiles).set(persistedActivity)
      .where(eq(profiles.id, actors.owner.profileId))

    await expect(addTicketJob(db, {
      actor: actors.owner,
      ticketId,
      body: { title: 'Stale activity must not append', kind: 'repair', requiredSkillTier: 1 },
    })).resolves.toEqual({ ok: false, error: 'not_found' })

    expect(await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId)))
      .toEqual(beforeJobs)
    expect((await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toEqual(beforeTicket)
  })

  it('rejects stale caller shop truth without changing state', async () => {
    const [movableProfile] = await db.insert(profiles).values({
      userId: uuid(30),
      shopId: shopA.id,
      role: 'owner',
      skillTier: 3,
      fullName: 'Movable Owner',
    }).returning()
    const staleActor = actorFrom(movableProfile)
    const beforeTicket = (await db.select().from(tickets)
      .where(eq(tickets.id, ticketId)))[0]
    const beforeJobs = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.ticketId, ticketId))
    await db.update(profiles).set({ shopId: shopB.id })
      .where(eq(profiles.id, movableProfile.id))

    await expect(addTicketJob(db, {
      actor: staleActor,
      ticketId,
      body: { title: 'Stale shop must not append', kind: 'repair', requiredSkillTier: 1 },
    })).resolves.toEqual({ ok: false, error: 'not_found' })

    expect(await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId)))
      .toEqual(beforeJobs)
    expect((await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toEqual(beforeTicket)
  })

  it('accepts a complete historical separated, session, vendor, and approval closure', async () => {
    const terminalAt = new Date('2026-07-16T12:00:00.000Z')
    const historicalCustomers = await db.insert(customers).values([
      { shopId: shopA.id, name: 'Grandparent Customer', phone: '555-0200' },
      { shopId: shopA.id, name: 'Parent Customer', phone: '555-0201' },
      { shopId: shopA.id, name: 'Target Customer', phone: '555-0202' },
      { shopId: shopA.id, name: 'Session Customer', phone: '555-0203' },
    ]).returning()
    const historicalVehicles = await db.insert(vehicles).values(
      historicalCustomers.map((customer, index) => ({
        customerId: customer.id,
        year: 2017 + index,
        make: 'Historical',
        model: `Vehicle ${index + 1}`,
      })),
    ).returning()
    expect(new Set(historicalCustomers.map(({ id }) => id)).size).toBe(4)
    expect(new Set(historicalVehicles.map(({ id }) => id)).size).toBe(4)
    const [grandparent] = await db.insert(tickets).values({
      shopId: shopA.id,
      ticketNumber: 200,
      source: 'counter',
      customerId: historicalCustomers[0].id,
      vehicleId: historicalVehicles[0].id,
      concern: 'Historical delivered parent',
      status: 'closed',
      createdByProfileId: actors.owner.profileId,
      deliveredAt: terminalAt,
      deliveredByProfileId: actors.advisor.profileId,
      closedAt: terminalAt,
      closedByProfileId: actors.advisor.profileId,
      closeDisposition: 'delivered',
    }).returning()
    const [parent] = await db.insert(tickets).values({
      shopId: shopA.id,
      ticketNumber: 201,
      source: 'counter',
      customerId: historicalCustomers[1].id,
      vehicleId: historicalVehicles[1].id,
      concern: 'Historical canceled parent',
      status: 'canceled',
      createdByProfileId: actors.owner.profileId,
      canceledAt: terminalAt,
      canceledByProfileId: actors.parts.profileId,
      cancelReasonCode: 'administrative_error',
      separateFromTicketId: grandparent.id,
      separateReason: 'comeback',
    }).returning()
    const [historicalTicket] = await db.insert(tickets).values({
      shopId: shopA.id,
      ticketNumber: 202,
      source: 'counter',
      customerId: historicalCustomers[2].id,
      vehicleId: historicalVehicles[2].id,
      concern: 'Historical closure target',
      createdByProfileId: actors.advisor.profileId,
      separateFromTicketId: parent.id,
      separateReason: 'future_or_scheduled_work',
    }).returning()
    const [session] = await db.insert(sessions).values({
      shopId: shopA.id,
      techId: tierOneTech.id,
      vehicleId: historicalVehicles[3].id,
      intake: {
        vehicleYear: historicalVehicles[3].year,
        vehicleMake: historicalVehicles[3].make,
        vehicleModel: historicalVehicles[3].model,
        customerComplaint: 'Historical concern',
      },
      treeState: { nodes: [], currentNodeId: 'root', message: 'Open', done: false },
    }).returning()
    const [originJob] = await db.insert(ticketJobs).values({
      shopId: shopA.id,
      ticketId: historicalTicket.id,
      title: 'Historical source job',
      kind: 'repair',
      requiredSkillTier: 1,
      assignedTechId: tierOneTech.id,
      sequenceNumber: 1,
      revision: 7n,
      createdByProfileId: actors.advisor.profileId,
      creatorProvenance: 'direct',
      workStatement: 'Complete the historical customer request',
      statementSource: 'customer_request',
      statementReviewState: 'confirmed',
      statementConfirmedByProfileId: actors.owner.profileId,
      statementConfirmedAt: terminalAt,
    }).returning()
    await db.insert(ticketJobs).values({
      shopId: shopA.id,
      ticketId: historicalTicket.id,
      title: 'Historical session sibling',
      kind: 'diagnostic',
      requiredSkillTier: 1,
      sessionId: session.id,
      sequenceNumber: 2,
      revision: 5n,
      createdByProfileId: actors.tech.profileId,
      creatorProvenance: 'direct',
      createdFromJobId: originJob.id,
    })
    const [vendor] = await db.insert(vendorAccounts).values({
      shopId: shopA.id,
      vendor: 'historical_parts',
      displayName: 'Historical Parts',
      mode: 'manual',
      enabled: true,
    }).returning()
    await db.insert(jobLines).values({
      shopId: shopA.id,
      jobId: originJob.id,
      kind: 'part',
      description: 'Historical vendor part',
      quantity: 1,
      priceCents: 2500,
      taxable: true,
      vendorAccountId: vendor.id,
      partStatus: 'received',
      orderedAt: terminalAt,
      orderedByProfileId: actors.parts.profileId,
      receivedAt: terminalAt,
      receivedByProfileId: actors.advisor.profileId,
    })
    const [version] = await db.insert(quoteVersions).values({
      shopId: shopA.id,
      ticketId: historicalTicket.id,
      versionNumber: 1,
      snapshot: { jobs: [{ id: originJob.id, decision: 'approved' }] },
      createdByProfileId: actors.advisor.profileId,
    }).returning()
    const [event] = await db.insert(quoteEvents).values({
      shopId: shopA.id,
      ticketId: historicalTicket.id,
      jobId: originJob.id,
      quoteVersionId: version.id,
      kind: 'approved',
      actorProfileId: actors.owner.profileId,
      approvedVia: 'in_person',
      requestKey: `historical-${uuid(555)}`,
    }).returning()
    await db.update(ticketJobs).set({
      approvalState: 'approved',
      approvedQuoteVersionId: version.id,
      approvedApprovalEventId: event.id,
    }).where(eq(ticketJobs.id, originJob.id))

    await expect(addTicketJob(db, {
      actor: actors.owner,
      ticketId: historicalTicket.id,
      body: { title: 'Append through closure', kind: 'repair', requiredSkillTier: 1 },
    })).resolves.toMatchObject({ ok: true })

    const rows = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.ticketId, historicalTicket.id))
    expect(rows.find(({ title }) => title === 'Append through closure'))
      .toMatchObject({ sequenceNumber: 3, revision: 1n })
    expect(rows.find(({ id }) => id === originJob.id))
      .toMatchObject({ revision: 7n, approvedQuoteVersionId: version.id,
        approvedApprovalEventId: event.id })
  })

  it('rejects a discovery-to-lock separate-chain cycle inside the discovered footprint', async () => {
    const sourceTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    const [root] = await db.insert(tickets).values({
      shopId: shopA.id,
      ticketNumber: 300,
      source: 'counter',
      customerId: sourceTicket.customerId,
      vehicleId: sourceTicket.vehicleId,
      concern: 'Separate-chain root',
      createdByProfileId: actors.owner.profileId,
    }).returning()
    const [parent] = await db.insert(tickets).values({
      shopId: shopA.id,
      ticketNumber: 301,
      source: 'counter',
      customerId: sourceTicket.customerId,
      vehicleId: sourceTicket.vehicleId,
      concern: 'Separate-chain parent',
      createdByProfileId: actors.owner.profileId,
      separateFromTicketId: root.id,
      separateReason: 'comeback',
    }).returning()
    const [target] = await db.insert(tickets).values({
      shopId: shopA.id,
      ticketNumber: 302,
      source: 'counter',
      customerId: sourceTicket.customerId,
      vehicleId: sourceTicket.vehicleId,
      concern: 'Separate-chain target',
      createdByProfileId: actors.owner.profileId,
      separateFromTicketId: parent.id,
      separateReason: 'future_or_scheduled_work',
    }).returning()
    const beforeTicket = (await db.select().from(tickets).where(eq(tickets.id, target.id)))[0]
    const raceDb = withLockedTicketRows(db, (rows) => rows.map((row) =>
      row.id === root.id ? { ...row, separateFromTicketId: target.id } : row))

    await expect(addTicketJob(raceDb, {
      actor: actors.owner,
      ticketId: target.id,
      body: { title: 'Must not survive chain race', kind: 'repair', requiredSkillTier: 1 },
    })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })

    expect(await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, target.id)))
      .toEqual([])
    expect((await db.select().from(tickets).where(eq(tickets.id, target.id)))[0])
      .toEqual(beforeTicket)
  })

  it('rejects a ticket that becomes terminal between discovery and locked execution', async () => {
    const beforeTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    const beforeJobs = await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId))
    const raceDb = withLockedTicketRows(db, (rows) => rows.map((row) =>
      row.id === ticketId ? { ...row, status: 'closed' as const } : row))

    await expect(addTicketJob(raceDb, {
      actor: actors.owner,
      ticketId,
      body: { title: 'Must not survive terminal race', kind: 'repair', requiredSkillTier: 1 },
    })).resolves.toEqual({ ok: false, error: 'ticket_not_open' })

    expect(await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId)))
      .toEqual(beforeJobs)
    expect((await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toEqual(beforeTicket)
  })

  it('retries a rolled-back contention attempt and leaves one complete append', async () => {
    let attempts = 0
    let firstAttemptJobId: string | undefined
    const retryDb = new Proxy(db, {
      get(target, property, receiver) {
        if (property === 'transaction') {
          return async (callback: (tx: TestDb) => Promise<unknown>) => {
            attempts += 1
            const ordinal = attempts
            return target.transaction(async (rawTx) => {
              const result = await callback(rawTx as TestDb) as Readonly<{
                ok: true
                ticket: { jobs: readonly Readonly<{ id: string; title: string }>[] }
              }>
              if (ordinal === 1) {
                firstAttemptJobId = result.ticket.jobs
                  .find(({ title }) => title === 'Retry once')?.id
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
    const result = await addTicketJob(retryDb, {
      actor: actors.owner,
      ticketId,
      body: { title: 'Retry once', kind: 'repair', requiredSkillTier: 1 },
    })

    expect(result.ok).toBe(true)
    if (!result.ok || !firstAttemptJobId) throw new Error('retry append failed')
    const committedJobId = result.ticket.jobs
      .find(({ title }) => title === 'Retry once')?.id
    expect(attempts).toBe(2)
    expect(committedJobId).toBeDefined()
    expect(committedJobId).not.toBe(firstAttemptJobId)
    const matches = (await db.select().from(ticketJobs))
      .filter(({ title }) => title === 'Retry once')
    expect(matches).toHaveLength(1)
    expect(matches[0]).toMatchObject({
      id: committedJobId,
      sequenceNumber: 2,
      revision: 1n,
    })
  })

  it('returns retryable conflict after two attempts with zero row or revision change', async () => {
    const beforeTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    const beforeJobs = await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId))
    let attempts = 0

    await expect(addTicketJob(db, {
      actor: actors.owner,
      ticketId,
      body: { title: 'Never committed', kind: 'repair', requiredSkillTier: 1 },
    }, {
      afterInsert: async () => {
        attempts += 1
        throw new ShopOsMutationConflict()
      },
    })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })

    expect(attempts).toBe(2)
    expect(await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId)))
      .toEqual(beforeJobs)
    expect((await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toEqual(beforeTicket)
  })

  it.each(['afterInsert', 'afterFinalization'] as const)(
    'rolls back the job and both parent revisions when %s fails',
    async (failurePoint) => {
      const beforeTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
      const beforeJobs = await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId))
      const fail = async () => { throw new Error(`forced_${failurePoint}`) }

      await expect(addTicketJob(db, {
        actor: actors.owner,
        ticketId,
        body: { title: `Rollback ${failurePoint}`, kind: 'repair', requiredSkillTier: 1 },
      }, { [failurePoint]: fail })).rejects.toThrow(`forced_${failurePoint}`)

      expect(await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId)))
        .toEqual(beforeJobs)
      expect((await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
        .toEqual(beforeTicket)
    },
  )

  it('serializes two queued appends into contiguous ordinals and exact parent increments', async () => {
    const before = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    const [left, right] = await Promise.all([
      addTicketJob(db, {
        actor: actors.owner,
        ticketId,
        body: { title: 'Queued left', kind: 'repair', requiredSkillTier: 1 },
      }),
      addTicketJob(db, {
        actor: actors.owner,
        ticketId,
        body: { title: 'Queued right', kind: 'repair', requiredSkillTier: 1 },
      }),
    ])

    expect(left.ok).toBe(true)
    expect(right.ok).toBe(true)
    const appended = (await db.select().from(ticketJobs))
      .filter(({ title }) => title.startsWith('Queued'))
      .sort((a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0))
    expect(appended.map(({ sequenceNumber }) => sequenceNumber)).toEqual([2, 3])
    const after = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    expect(after.projectionRevision).toBe(before.projectionRevision + 2n)
    expect(after.continuityRevision).toBe(before.continuityRevision + 2n)
  })

  it('increments bigint revisions exactly above Number.MAX_SAFE_INTEGER', async () => {
    const hugeProjection = 9_007_199_254_740_995n
    const hugeContinuity = 9_007_199_254_740_997n
    await db.update(tickets).set({
      projectionRevision: hugeProjection,
      continuityRevision: hugeContinuity,
    }).where(eq(tickets.id, ticketId))

    await expect(addTicketJob(db, {
      actor: actors.owner,
      ticketId,
      body: { title: 'Bigint append', kind: 'repair', requiredSkillTier: 1 },
    })).resolves.toMatchObject({ ok: true })

    const after = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    expect(after.projectionRevision).toBe(hugeProjection + 1n)
    expect(after.continuityRevision).toBe(hugeContinuity + 1n)
  })

  it('rejects unsupported and inactive actors before any data access', async () => {
    const inaccessibleDb = new Proxy(
      {},
      {
        get() {
          throw new Error('database must not be accessed')
        },
      },
    ) as AppDb
    const denied: Array<[TicketActor, string]> = [
      [{ ...actors.tech, role: 'curator' }, 'forbidden'],
      [{ ...actors.tech, membershipStatus: 'pending' }, 'inactive_profile'],
      [{ ...actors.tech, deactivatedAt: new Date() }, 'inactive_profile'],
      [{ ...actors.tech, shopId: null }, 'no_shop'],
    ]

    for (const [actor, error] of denied) {
      await expect(
        getTicketDetail(inaccessibleDb, { actor, ticketId }),
      ).resolves.toEqual({ ok: false, error })
      await expect(
        addTicketJob(inaccessibleDb, {
          actor,
          ticketId,
          body: { title: 'Job', kind: 'repair', requiredSkillTier: 1 },
        }),
      ).resolves.toEqual({ ok: false, error })
    }
  })

  it('validates IDs and add-job input without mutation', async () => {
    for (const malformedId of [null, '', 'not-a-uuid', 42]) {
      await expect(
        getTicketDetail(db, { actor: actors.owner, ticketId: malformedId }),
      ).resolves.toEqual({ ok: false, error: 'invalid_input' })
      await expect(
        addTicketJob(db, {
          actor: actors.owner,
          ticketId: malformedId,
          body: { title: 'Job', kind: 'repair', requiredSkillTier: 1 },
        }),
      ).resolves.toEqual({ ok: false, error: 'invalid_input' })
    }

    const invalidBodies: unknown[] = [
      null,
      { title: ' ', kind: 'repair', requiredSkillTier: 1 },
      { title: 'x'.repeat(201), kind: 'repair', requiredSkillTier: 1 },
      { title: 'Job', kind: 'inspection', requiredSkillTier: 1 },
      { title: 'Job', kind: 'repair', requiredSkillTier: 4 },
      { title: 'Job', kind: 'repair', requiredSkillTier: 1, workStatus: 'done' },
    ]
    for (const body of invalidBodies) {
      await expect(
        addTicketJob(db, { actor: actors.owner, ticketId, body }),
      ).resolves.toEqual({ ok: false, error: 'invalid_input' })
    }

    expect(await db.select().from(ticketJobs)).toHaveLength(1)
  })

  it('makes missing and cross-shop ticket IDs indistinguishable', async () => {
    const [crossActor] = await db
      .insert(profiles)
      .values({ userId: uuid(20), shopId: shopB.id, role: 'owner', skillTier: 3 })
      .returning()
    const [crossTicket] = await db
      .insert(tickets)
      .values({
        shopId: shopB.id,
        ticketNumber: 1,
        source: 'tech_quick',
        concern: 'Cross-shop concern',
        createdByProfileId: crossActor.id,
      })
      .returning()
    const hiddenIds = [crossTicket.id, '00000000-0000-4000-8000-000000000999']

    for (const hiddenId of hiddenIds) {
      await expect(
        getTicketDetail(db, { actor: actors.owner, ticketId: hiddenId }),
      ).resolves.toEqual({ ok: false, error: 'not_found' })
      await expect(
        addTicketJob(db, {
          actor: actors.owner,
          ticketId: hiddenId,
          body: { title: 'Hidden job', kind: 'repair', requiredSkillTier: 1 },
        }),
      ).resolves.toEqual({ ok: false, error: 'not_found' })
    }

    expect(await db.select().from(ticketJobs)).toHaveLength(1)
  })

  it('refuses closed and canceled tickets without adding a job', async () => {
    const terminalAt = new Date('2026-07-16T12:00:00.000Z')
    for (const status of ['closed', 'canceled'] as const) {
      const [terminalTicket] = await db.insert(tickets).values({
        shopId: shopA.id,
        ticketNumber: status === 'closed' ? 2 : 3,
        source: 'tech_quick',
        concern: `Already ${status}`,
        createdByProfileId: actors.owner.profileId,
        status,
        ...(status === 'closed'
          ? {
              closedAt: terminalAt,
              closedByProfileId: actors.owner.profileId,
              closeDisposition: 'customer_declined' as const,
            }
          : {
              canceledAt: terminalAt,
              canceledByProfileId: actors.owner.profileId,
              cancelReasonCode: 'administrative_error' as const,
            }),
      }).returning()
      await expect(
        addTicketJob(db, {
          actor: actors.owner,
          ticketId: terminalTicket.id,
          body: { title: 'Must not be added', kind: 'repair', requiredSkillTier: 1 },
        }),
      ).resolves.toEqual({ ok: false, error: 'ticket_not_open' })
      expect(await db.select().from(ticketJobs)).toHaveLength(1)
    }
  })

  it('applies the shared assignment rules when adding a job', async () => {
    const selfAssigned = await addTicketJob(db, {
      actor: actors.tech,
      ticketId,
      body: {
        title: 'Self-assigned diagnosis',
        kind: 'diagnostic',
        requiredSkillTier: 2,
        assignedTechId: actors.tech.profileId,
      },
    })
    expect(selfAssigned.ok).toBe(true)
    if (!selfAssigned.ok) return
    expect(selfAssigned.ticket.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assignedTechId: actors.tech.profileId }),
      ]),
    )

    await expect(
      addTicketJob(db, {
        actor: actors.tech,
        ticketId,
        body: {
          title: 'Unauthorized assignment',
          kind: 'repair',
          requiredSkillTier: 1,
          assignedTechId: tierOneTech.id,
        },
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_assignee' })

    const belowTier = {
      title: 'Advanced repair',
      kind: 'repair',
      requiredSkillTier: 3,
      assignedTechId: tierOneTech.id,
    }
    await expect(
      addTicketJob(db, { actor: actors.advisor, ticketId, body: belowTier }),
    ).resolves.toEqual({
      ok: false,
      error: 'tier_confirmation_required',
      warning: {
        code: 'below_required_tier',
        assignedTechId: tierOneTech.id,
        assignedSkillTier: 1,
        requiredSkillTier: 3,
      },
    })
    const confirmed = await addTicketJob(db, {
      actor: actors.advisor,
      ticketId,
      body: { ...belowTier, confirmBelowTier: true },
    })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(confirmed.ticket.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Advanced repair',
          assignedTechId: tierOneTech.id,
          assignedTech: {
            id: tierOneTech.id,
            fullName: 'Terry Tier One',
            role: 'tech',
            skillTier: 1,
          },
        }),
      ]),
    )
  })

  it('returns only the safe projection with jobs ordered by createdAt then id', async () => {
    const initialJob = (await db.select().from(ticketJobs))[0]
    const early = new Date('2026-01-01T00:00:00.000Z')
    await db.insert(ticketJobs).values([
      {
        id: uuid(102),
        shopId: shopA.id,
        ticketId,
        title: 'Second by id',
        kind: 'repair',
        requiredSkillTier: 1,
        createdAt: early,
        updatedAt: early,
      },
      {
        id: uuid(101),
        shopId: shopA.id,
        ticketId,
        title: 'First by id',
        kind: 'repair',
        requiredSkillTier: 1,
        assignedTechId: tierOneTech.id,
        createdAt: early,
        updatedAt: early,
      },
    ])

    const result = await getTicketDetail(db, { actor: actors.parts, ticketId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ticket.jobs.map((job) => job.id)).toEqual([
      uuid(101),
      uuid(102),
      initialJob.id,
    ])
    expect(result.ticket).not.toHaveProperty('shopId')
    expect(result.ticket).not.toHaveProperty('createdByProfileId')
    expect(result.ticket.jobs[0]).not.toHaveProperty('shopId')
    expect(result.ticket.jobs[0]).not.toHaveProperty('claimedAt')
    expect(result.ticket.jobs[0]).not.toHaveProperty('diagnosticStartAttemptKey')
    expect(result.ticket.jobs[0].assignedTech).not.toHaveProperty('userId')
    expect(result.ticket.jobs[0].assignedTech).not.toHaveProperty('shopId')
  })
})
