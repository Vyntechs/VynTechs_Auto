import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  jobLines,
  profiles,
  sessions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import * as databaseSchema from '@/lib/db/schema'
import {
  ShopOsMutationNotFound,
  type MutationInsertionIntentsV1,
} from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { ShopOsMutationConflict } from '@/lib/shop-os/continuity/mutation-foundation/conflicts'
import type { MutationLockRequestV1 } from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import {
  finalizeMutationRevisionsV1,
  reserveJobSequencesForInsertionV1,
} from '@/lib/shop-os/continuity/mutation-foundation/revisions'
import { runBoundedShopOsMutationV1 } from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const EMPTY_INTENTS: MutationInsertionIntentsV1 = Object.freeze({
  sessions: Object.freeze([]),
  customers: Object.freeze([]),
  vehicles: Object.freeze([]),
  tickets: Object.freeze([]),
  jobs: Object.freeze([]),
})

function lockRequest(
  overrides: Partial<MutationLockRequestV1> = {},
): MutationLockRequestV1 {
  return {
    shopId: uuid(1),
    actorProfileId: uuid(10),
    profileIds: [uuid(10)],
    lockShop: false,
    customerIds: [],
    vehicleIds: [],
    ticketIds: [],
    jobIds: [],
    includeAllJobsForTickets: false,
    includeAllLinesForJobs: false,
    includeAllQuoteVersionsForTickets: false,
    includeAllQuoteEventsForTickets: false,
    sessionIds: [],
    sessionEventIds: [],
    vendorAccountIds: [],
    cannedJobIds: [],
    receiptRequestKey: null,
    receiptConditionalInsert: null,
    insertionIntents: EMPTY_INTENTS,
    ...overrides,
  }
}

describe('Shop OS continuity revision foundation', () => {
  let db: TestDb
  let loggingDb: TestDb
  let close: () => Promise<void>
  let queryLog: Array<Readonly<{ sql: string; params: readonly unknown[] }>>

  beforeAll(async () => {
    const created = await createTestDb()
    ;({ db, close } = created)
    queryLog = []
    loggingDb = drizzle(created.client, {
      schema: databaseSchema,
      logger: {
        logQuery: (query, params) => queryLog.push({ sql: query, params: [...params] }),
      },
    })
    await db.insert(shops).values([
      { id: uuid(1), name: 'North Shop' },
      { id: uuid(2), name: 'South Shop' },
    ])
    await db.insert(profiles).values({
      id: uuid(10),
      userId: uuid(1010),
      shopId: uuid(1),
      role: 'owner',
      skillTier: null,
    })
    await db.insert(profiles).values({
      id: uuid(11),
      userId: uuid(1011),
      shopId: uuid(1),
      role: 'tech',
      skillTier: 2,
    })
    await db.insert(customers).values([
      { id: uuid(20), shopId: uuid(1), name: 'Alex', phone: '555-0100' },
      { id: uuid(23), shopId: uuid(1), name: 'Blake', phone: '555-0103' },
      { id: uuid(24), shopId: uuid(2), name: 'Cross', phone: '555-0104' },
    ])
    await db.insert(vehicles).values([
      {
        id: uuid(30), customerId: uuid(20), year: 2020,
        make: 'Ford', model: 'F-150',
      },
      {
        id: uuid(33), customerId: uuid(23), year: 2021,
        make: 'Honda', model: 'Civic',
      },
      {
        id: uuid(34), customerId: uuid(24), year: 2022,
        make: 'Toyota', model: 'Camry',
      },
    ])
    await db.insert(tickets).values({
      id: uuid(50),
      shopId: uuid(1),
      ticketNumber: 50,
      source: 'counter',
      customerId: uuid(20),
      vehicleId: uuid(30),
      concern: 'Noise',
      projectionRevision: 9_007_199_254_740_993n,
      continuityRevision: 9_007_199_254_740_992n,
      createdByProfileId: uuid(10),
    })
    await db.insert(ticketJobs).values([
      {
        id: uuid(60),
        shopId: uuid(1),
        ticketId: uuid(50),
        title: 'Inspect',
        kind: 'diagnostic',
        requiredSkillTier: 2,
        sequenceNumber: 1,
        revision: 1n,
        createdByProfileId: uuid(10),
        creatorProvenance: 'direct',
      },
      {
        id: uuid(61),
        shopId: uuid(1),
        ticketId: uuid(50),
        title: 'Repair',
        kind: 'repair',
        requiredSkillTier: 2,
        sequenceNumber: 2,
        revision: 1n,
        createdByProfileId: uuid(10),
        creatorProvenance: 'direct',
      },
    ])
    await db.insert(tickets).values([
      {
        id: uuid(52),
        shopId: uuid(1),
        ticketNumber: 52,
        source: 'counter',
        customerId: uuid(20),
        vehicleId: uuid(30),
        concern: 'Legacy sequence',
        createdByProfileId: uuid(10),
      },
      {
        id: uuid(53),
        shopId: uuid(1),
        ticketNumber: 53,
        source: 'counter',
        customerId: uuid(20),
        vehicleId: uuid(30),
        concern: 'Conflicting legacy suffix',
        createdByProfileId: uuid(10),
      },
      {
        id: uuid(54),
        shopId: uuid(1),
        ticketNumber: 54,
        source: 'counter',
        customerId: uuid(20),
        vehicleId: uuid(30),
        concern: 'Overflow suffix',
        createdByProfileId: uuid(10),
      },
    ])
    await db.insert(ticketJobs).values([
      ...[
        { id: uuid(70), sequenceNumber: null, createdAt: new Date('2024-01-01T00:00:00Z') },
        { id: uuid(71), sequenceNumber: null, createdAt: new Date('2024-01-02T00:00:00Z') },
        { id: uuid(72), sequenceNumber: 3, createdAt: new Date('2024-01-03T00:00:00Z') },
        { id: uuid(73), sequenceNumber: 4, createdAt: new Date('2024-01-04T00:00:00Z') },
      ].map((row) => ({
        ...row,
        shopId: uuid(1),
        ticketId: uuid(52),
        title: `Legacy ${row.id}`,
        kind: 'repair' as const,
        requiredSkillTier: 2,
        createdByProfileId: uuid(10),
        creatorProvenance: 'direct' as const,
      })),
      ...[
        { id: uuid(80), sequenceNumber: null },
        { id: uuid(81), sequenceNumber: null },
        { id: uuid(82), sequenceNumber: 1 },
        { id: uuid(83), sequenceNumber: 2 },
      ].map((row) => ({
        ...row,
        shopId: uuid(1),
        ticketId: uuid(53),
        title: `Conflicting ${row.id}`,
        kind: 'repair' as const,
        requiredSkillTier: 2,
        createdByProfileId: uuid(10),
        creatorProvenance: 'direct' as const,
      })),
      {
        id: uuid(90),
        shopId: uuid(1),
        ticketId: uuid(54),
        title: 'Maximum sequence',
        kind: 'repair',
        requiredSkillTier: 2,
        sequenceNumber: 2_147_483_647,
        createdByProfileId: uuid(10),
        creatorProvenance: 'direct',
      },
    ])
    await db.insert(jobLines).values({
      id: uuid(180),
      shopId: uuid(1),
      jobId: uuid(80),
      kind: 'part',
      description: 'Legacy part',
      quantity: 1,
      priceCents: 100,
      taxable: true,
      partStatus: 'proposed',
    })
  })

  afterAll(async () => close())

  it('exports only the public revision functions and contracts from the barrel', () => {
    const source = readFileSync(resolve(
      process.cwd(),
      'lib/shop-os/continuity/mutation-foundation/index.ts',
    ), 'utf8')

    expect(source).toContain('finalizeMutationRevisionsV1')
    expect(source).toContain('reserveJobSequencesForInsertionV1')
    for (const typeName of [
      'CreatedMutationRowsV1',
      'FinalizedMutationRevisionsV1',
      'TicketRevisionDeltaV1',
    ]) expect(source).toContain(typeName)
    expect(source).not.toContain('sequenceReservations')
  })

  it('returns a frozen empty replay without writes and rejects the escaped stale scope', async () => {
    const escaped = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({ lockRequest: lockRequest(), payload: undefined }),
      executeLocked: async (tx, scope) => ({
        scope,
        result: await finalizeMutationRevisionsV1(
          tx as AppDb,
          scope,
          { sessionIds: [], customerIds: [], vehicleIds: [] },
          [],
        ),
      }),
    })

    expect(escaped.result).toEqual({ tickets: [], jobs: [] })
    expect(Object.isFrozen(escaped.result)).toBe(true)
    expect(Object.isFrozen(escaped.result.tickets)).toBe(true)
    expect(Object.isFrozen(escaped.result.jobs)).toBe(true)
    await expect(finalizeMutationRevisionsV1(
      db as AppDb,
      escaped.scope,
      { sessionIds: [], customerIds: [], vehicleIds: [] },
      [],
    )).rejects.toThrow('mutation_attempt_capability_closed')
    expect(() => reserveJobSequencesForInsertionV1(
      db as AppDb,
      escaped.scope,
      uuid(999),
      [],
    )).toThrow('mutation_attempt_capability_closed')
  })

  it('reserves a registered 25-job new ticket as immutable contiguous 1..25', async () => {
    const ticketId = uuid(150)
    const jobIds = Array.from({ length: 25 }, (_, index) => uuid(200 + index))
    const insertionIntents: MutationInsertionIntentsV1 = {
      ...EMPTY_INTENTS,
      tickets: [ticketId],
      jobs: jobIds.map((id) => ({ id, ticketId })),
    }

    const result = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          includeAllJobsForTickets: true,
          insertionIntents,
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) =>
        reserveJobSequencesForInsertionV1(
          tx as AppDb,
          scope,
          ticketId,
          jobIds,
        ),
    })

    expect(result).toEqual(jobIds.map((jobId, index) => ({
      jobId,
      sequenceNumber: index + 1,
    })))
    expect(Object.isFrozen(result)).toBe(true)
    expect(result.every(Object.isFrozen)).toBe(true)
  })

  it('increments bigint projection, changed jobs, and changed continuity exactly once', async () => {
    const result = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          profileIds: [uuid(10), uuid(11)],
          customerIds: [uuid(20)],
          vehicleIds: [uuid(30)],
          ticketIds: [uuid(50)],
          jobIds: [uuid(60), uuid(61)],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        await tx.update(ticketJobs).set({ workStatus: 'in_progress' }).where(and(
          eq(ticketJobs.shopId, uuid(1)),
          eq(ticketJobs.id, uuid(60)),
        ))
        await tx.update(ticketJobs).set({ workNotes: 'Internal note' }).where(and(
          eq(ticketJobs.shopId, uuid(1)),
          eq(ticketJobs.id, uuid(61)),
        ))
        return finalizeMutationRevisionsV1(
          tx as AppDb,
          scope,
          { sessionIds: [], customerIds: [], vehicleIds: [] },
          [{
            ticketId: uuid(50),
            createdTicket: false,
            createdJobIds: [],
            existingChangedJobIds: [uuid(60), uuid(61)],
            actorVisibleTicketFieldsChanged: false,
          }],
        )
      },
    })

    expect(result.tickets).toEqual([{
      id: uuid(50),
      projectionRevision: '9007199254740994',
      continuityRevision: '9007199254740993',
      continuityChanged: true,
    }])
    expect(result.jobs.map((job) => job.revision)).toEqual(['2', '2'])
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.tickets)).toBe(true)
    expect(Object.isFrozen(result.jobs)).toBe(true)

    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, uuid(50)))
    const jobs = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.ticketId, uuid(50)))
      .orderBy(ticketJobs.id)
    expect(ticket).toMatchObject({
      projectionRevision: 9_007_199_254_740_994n,
      continuityRevision: 9_007_199_254_740_993n,
    })
    expect(jobs.map((job) => job.revision)).toEqual([2n, 2n])
  })

  it('finalizes a registered 25-job creation at revision one with exact parent bindings', async () => {
    const customerId = uuid(21)
    const vehicleId = uuid(31)
    const sessionId = uuid(40)
    const ticketId = uuid(151)
    const jobIds = Array.from({ length: 25 }, (_, index) => uuid(350 - index))
    const insertionIntents: MutationInsertionIntentsV1 = {
      sessions: [{ id: sessionId, shopId: uuid(1), techId: uuid(11) }],
      customers: [{ id: customerId, shopId: uuid(1) }],
      vehicles: [{ id: vehicleId, customerId }],
      tickets: [ticketId],
      jobs: jobIds.map((id) => ({ id, ticketId })),
    }

    const result = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          profileIds: [uuid(10), uuid(11)],
          lockShop: true,
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents,
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const reservations = reserveJobSequencesForInsertionV1(
          tx as AppDb,
          scope,
          ticketId,
          jobIds,
        )
        await tx.insert(customers).values({
          id: customerId,
          shopId: uuid(1),
          name: 'Created customer',
          phone: '555-0101',
        })
        await tx.insert(vehicles).values({
          id: vehicleId,
          customerId,
          year: 2024,
          make: 'Toyota',
          model: 'Tacoma',
        })
        await tx.insert(sessions).values({
          id: sessionId,
          shopId: uuid(1),
          techId: uuid(11),
          vehicleId,
          intake: {
            vehicleYear: 2024,
            vehicleMake: 'Toyota',
            vehicleModel: 'Tacoma',
            customerComplaint: 'Noise',
          },
          treeState: { nodes: [], currentNodeId: 'root', message: 'Open', done: false },
        })
        await tx.insert(tickets).values({
          id: ticketId,
          shopId: uuid(1),
          ticketNumber: 151,
          source: 'counter',
          customerId,
          vehicleId,
          concern: 'Created concern',
          projectionRevision: 1n,
          continuityRevision: 1n,
          createdByProfileId: uuid(10),
        })
        await tx.insert(ticketJobs).values(reservations.map((reservation, index) => ({
          id: reservation.jobId,
          shopId: uuid(1),
          ticketId,
          title: `Created job ${index + 1}`,
          kind: index === 0 ? 'diagnostic' as const : 'repair' as const,
          requiredSkillTier: 2,
          sessionId: index === 0 ? sessionId : null,
          sequenceNumber: reservation.sequenceNumber,
          workStatement: `Created work ${index + 1}`,
          statementSource: 'customer_request' as const,
          statementReviewState: 'confirmed' as const,
          revision: 1n,
          createdByProfileId: uuid(10),
          creatorProvenance: 'direct' as const,
        })))
        return finalizeMutationRevisionsV1(
          tx as AppDb,
          scope,
          { sessionIds: [sessionId], customerIds: [customerId], vehicleIds: [vehicleId] },
          [{
            ticketId,
            createdTicket: true,
            createdJobIds: jobIds,
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )
      },
    })

    expect(result.tickets).toEqual([{
      id: ticketId,
      projectionRevision: '1',
      continuityRevision: '1',
      continuityChanged: true,
    }])
    expect(result.jobs).toEqual(jobIds.map((id) => ({ id, revision: '1' })))
    const persistedJobs = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.ticketId, ticketId))
      .orderBy(ticketJobs.sequenceNumber)
    expect(persistedJobs.map(({ id, sequenceNumber, revision }) => ({
      id,
      sequenceNumber,
      revision,
    }))).toEqual(jobIds.map((id, index) => ({
      id,
      sequenceNumber: index + 1,
      revision: 1n,
    })))
  })

  it('rejects a sparse created-row manifest instead of treating holes as reported IDs', async () => {
    const sessionId = uuid(41)
    const sparseSessionIds = new Array<string>(1)

    await expect(runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          profileIds: [uuid(10), uuid(11)],
          lockShop: true,
          insertionIntents: {
            ...EMPTY_INTENTS,
            sessions: [{ id: sessionId, shopId: uuid(1), techId: uuid(11) }],
          },
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => finalizeMutationRevisionsV1(
        tx as AppDb,
        scope,
        { sessionIds: sparseSessionIds, customerIds: [], vehicleIds: [] },
        [],
      ),
    })).rejects.toBeInstanceOf(ShopOsMutationConflict)
  })

  it('appends after a legacy-null prefix across repeated reservations and finalizes mixed jobs once', async () => {
    const firstJobId = uuid(75)
    const secondJobId = uuid(74)
    const insertionIntents: MutationInsertionIntentsV1 = {
      ...EMPTY_INTENTS,
      jobs: [
        { id: firstJobId, ticketId: uuid(52) },
        { id: secondJobId, ticketId: uuid(52) },
      ],
    }

    const result = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [uuid(20)],
          vehicleIds: [uuid(30)],
          ticketIds: [uuid(52)],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents,
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const first = reserveJobSequencesForInsertionV1(
          tx as AppDb,
          scope,
          uuid(52),
          [firstJobId],
        )
        const second = reserveJobSequencesForInsertionV1(
          tx as AppDb,
          scope,
          uuid(52),
          [secondJobId],
        )
        expect([...first, ...second].map(({ sequenceNumber }) => sequenceNumber))
          .toEqual([5, 6])

        await tx.insert(ticketJobs).values([...first, ...second].map((reservation) => ({
          id: reservation.jobId,
          shopId: uuid(1),
          ticketId: uuid(52),
          title: `Appended ${reservation.sequenceNumber}`,
          kind: 'repair' as const,
          requiredSkillTier: 2,
          sequenceNumber: reservation.sequenceNumber,
          workStatement: `Appended work ${reservation.sequenceNumber}`,
          statementSource: 'advisor_added' as const,
          statementReviewState: 'confirmed' as const,
          revision: 1n,
          createdByProfileId: uuid(10),
          creatorProvenance: 'direct' as const,
        })))
        await tx.update(ticketJobs).set({ workNotes: 'Changed internally' }).where(and(
          eq(ticketJobs.shopId, uuid(1)),
          eq(ticketJobs.id, uuid(71)),
        ))
        return finalizeMutationRevisionsV1(
          tx as AppDb,
          scope,
          { sessionIds: [], customerIds: [], vehicleIds: [] },
          [{
            ticketId: uuid(52),
            createdTicket: false,
            createdJobIds: [secondJobId, firstJobId],
            existingChangedJobIds: [uuid(71)],
            actorVisibleTicketFieldsChanged: false,
          }],
        )
      },
    })

    expect(result.tickets).toEqual([{
      id: uuid(52),
      projectionRevision: '1',
      continuityRevision: '1',
      continuityChanged: true,
    }])
    expect(result.jobs).toEqual([
      { id: firstJobId, revision: '1' },
      { id: secondJobId, revision: '1' },
      { id: uuid(71), revision: '1' },
    ])

    const rows = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.ticketId, uuid(52)))
      .orderBy(ticketJobs.id)
    const nullPrefix = rows
      .filter(({ sequenceNumber }) => sequenceNumber === null)
      .sort((left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id))
      .map((row, index) => ({ id: row.id, sequenceNumber: index + 1 }))
    const immutableSuffix = rows
      .filter((row): row is typeof row & { sequenceNumber: number } =>
        row.sequenceNumber !== null)
      .sort((left, right) => left.sequenceNumber - right.sequenceNumber)
      .map(({ id, sequenceNumber }) => ({ id, sequenceNumber }))
    expect([...nullPrefix, ...immutableSuffix].map(({ sequenceNumber }) => sequenceNumber))
      .toEqual([1, 2, 3, 4, 5, 6])
    expect(immutableSuffix.map(({ id }) => id)).toEqual([
      uuid(72), uuid(73), firstJobId, secondJobId,
    ])
  })

  it('fails incomplete, duplicate, unregistered, replayed, and conflicting sequence reservations', async () => {
    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          includeAllJobsForTickets: true,
          insertionIntents: {
            ...EMPTY_INTENTS,
            tickets: [uuid(160)],
            jobs: [
              { id: uuid(500), ticketId: uuid(160) },
              { id: uuid(501), ticketId: uuid(160) },
            ],
          },
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        expect(() => reserveJobSequencesForInsertionV1(
          tx as AppDb, scope, uuid(160), [uuid(500), uuid(500)],
        )).toThrow(ShopOsMutationConflict)
        expect(() => reserveJobSequencesForInsertionV1(
          tx as AppDb, scope, uuid(160), [uuid(502)],
        )).toThrow(ShopOsMutationConflict)
        expect(reserveJobSequencesForInsertionV1(
          tx as AppDb, scope, uuid(160), [uuid(500)],
        )).toEqual([{ jobId: uuid(500), sequenceNumber: 1 }])
        expect(reserveJobSequencesForInsertionV1(
          tx as AppDb, scope, uuid(160), [uuid(501)],
        )).toEqual([{ jobId: uuid(501), sequenceNumber: 2 }])
        expect(() => reserveJobSequencesForInsertionV1(
          tx as AppDb, scope, uuid(160), [uuid(500)],
        )).toThrow(ShopOsMutationConflict)
      },
    })

    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          insertionIntents: {
            ...EMPTY_INTENTS,
            tickets: [uuid(161)],
            jobs: [{ id: uuid(503), ticketId: uuid(161) }],
          },
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        expect(() => reserveJobSequencesForInsertionV1(
          tx as AppDb, scope, uuid(161), [uuid(503)],
        )).toThrow(ShopOsMutationConflict)
      },
    })

    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [uuid(20)],
          vehicleIds: [uuid(30)],
          ticketIds: [uuid(53)],
          includeAllJobsForTickets: true,
          insertionIntents: {
            ...EMPTY_INTENTS,
            jobs: [{ id: uuid(84), ticketId: uuid(53) }],
          },
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        expect(() => reserveJobSequencesForInsertionV1(
          tx as AppDb, scope, uuid(53), [uuid(84)],
        )).toThrow(ShopOsMutationConflict)
      },
    })
  })

  it('rejects integer-overflow state and discards reservations with a rolled-back scope', async () => {
    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [uuid(20)],
          vehicleIds: [uuid(30)],
          ticketIds: [uuid(54)],
          includeAllJobsForTickets: true,
          insertionIntents: {
            ...EMPTY_INTENTS,
            jobs: [{ id: uuid(91), ticketId: uuid(54) }],
          },
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        expect(() => reserveJobSequencesForInsertionV1(
          tx as AppDb,
          scope,
          uuid(54),
          [uuid(91)],
        )).toThrow(ShopOsMutationConflict)
      },
    })

    const marker = new Error('rollback_reservation')
    const request = () => lockRequest({
      lockShop: true,
      includeAllJobsForTickets: true,
      insertionIntents: {
        ...EMPTY_INTENTS,
        tickets: [uuid(167)],
        jobs: [{ id: uuid(510), ticketId: uuid(167) }],
      },
    })
    await expect(runBoundedShopOsMutationV1(db, {
      discover: async () => ({ lockRequest: request(), payload: undefined }),
      executeLocked: async (tx, scope) => {
        expect(reserveJobSequencesForInsertionV1(
          tx as AppDb, scope, uuid(167), [uuid(510)],
        )).toEqual([{ jobId: uuid(510), sequenceNumber: 1 }])
        throw marker
      },
    })).rejects.toBe(marker)

    const retriedReservation = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({ lockRequest: request(), payload: undefined }),
      executeLocked: async (tx, scope) => reserveJobSequencesForInsertionV1(
        tx as AppDb, scope, uuid(167), [uuid(510)],
      ),
    })
    expect(retriedReservation).toEqual([{ jobId: uuid(510), sequenceNumber: 1 }])
  })

  it.each([
    {
      name: 'session',
      request: lockRequest({
        profileIds: [uuid(10), uuid(11)],
        lockShop: true,
        insertionIntents: {
          ...EMPTY_INTENTS,
          sessions: [{ id: uuid(42), shopId: uuid(1), techId: uuid(11) }],
        },
      }),
      createdRows: { sessionIds: [uuid(42)], customerIds: [], vehicleIds: [] },
    },
    {
      name: 'customer',
      request: lockRequest({
        lockShop: true,
        insertionIntents: {
          ...EMPTY_INTENTS,
          customers: [{ id: uuid(22), shopId: uuid(1) }],
        },
      }),
      createdRows: { sessionIds: [], customerIds: [uuid(22)], vehicleIds: [] },
    },
    {
      name: 'vehicle',
      request: lockRequest({
        lockShop: true,
        customerIds: [uuid(20)],
        insertionIntents: {
          ...EMPTY_INTENTS,
          vehicles: [{ id: uuid(32), customerId: uuid(20) }],
        },
      }),
      createdRows: { sessionIds: [], customerIds: [], vehicleIds: [uuid(32)] },
    },
  ])('rejects a reported registered $name row that was never inserted', async ({
    request,
    createdRows,
  }) => {
    await expect(runBoundedShopOsMutationV1(db, {
      discover: async () => ({ lockRequest: request, payload: undefined }),
      executeLocked: async (tx, scope) => finalizeMutationRevisionsV1(
        tx as AppDb,
        scope,
        createdRows,
        [],
      ),
    })).rejects.toBeInstanceOf(ShopOsMutationNotFound)
  })

  it('rolls back domain and revision writes across every finalization failure seam', async () => {
    const request = () => lockRequest({
      customerIds: [uuid(20)],
      vehicleIds: [uuid(30)],
      ticketIds: [uuid(53)],
      includeAllJobsForTickets: true,
      includeAllLinesForJobs: true,
    })
    const cases = [
      'after_domain_reload',
      'ticket_cas_drift',
      'job_cas_drift',
      'after_revision_write',
      'after_finalization',
    ] as const

    for (const failureCase of cases) {
      const marker = new Error(`injected_${failureCase}`)
      const operation = runBoundedShopOsMutationV1(db, {
        discover: async () => ({ lockRequest: request(), payload: undefined }),
        executeLocked: async (tx, scope) => {
          await tx.update(ticketJobs).set({ workNotes: 'must roll back' }).where(and(
            eq(ticketJobs.shopId, uuid(1)),
            eq(ticketJobs.id, uuid(80)),
          ))
          const changedJobIds = failureCase === 'job_cas_drift'
            ? [uuid(80), uuid(81)]
            : [uuid(80)]
          const finalized = await finalizeMutationRevisionsV1(
            tx as AppDb,
            scope,
            { sessionIds: [], customerIds: [], vehicleIds: [] },
            [{
              ticketId: uuid(53),
              createdTicket: false,
              createdJobIds: [],
              existingChangedJobIds: changedJobIds,
              actorVisibleTicketFieldsChanged: false,
            }],
            {
              afterDomainReload: async () => {
                if (failureCase === 'after_domain_reload') throw marker
                if (failureCase === 'ticket_cas_drift') {
                  await tx.update(tickets).set({
                    projectionRevision: sql`${tickets.projectionRevision} + 1`,
                  }).where(and(
                    eq(tickets.shopId, uuid(1)),
                    eq(tickets.id, uuid(53)),
                  ))
                }
                if (failureCase === 'job_cas_drift') {
                  await tx.update(ticketJobs).set({
                    revision: sql`${ticketJobs.revision} + 1`,
                  }).where(and(
                    eq(ticketJobs.shopId, uuid(1)),
                    eq(ticketJobs.id, uuid(81)),
                  ))
                }
              },
              afterRevisionWrite: async () => {
                if (failureCase === 'after_revision_write') throw marker
              },
            },
          )
          if (failureCase === 'after_finalization') throw marker
          return finalized
        },
      })

      if (failureCase === 'ticket_cas_drift' || failureCase === 'job_cas_drift') {
        await expect(operation).rejects.toBeInstanceOf(ShopOsMutationConflict)
      } else {
        await expect(operation).rejects.toBe(marker)
      }

      const [ticket] = await db.select().from(tickets).where(eq(tickets.id, uuid(53)))
      const jobs = await db.select().from(ticketJobs).where(and(
        eq(ticketJobs.ticketId, uuid(53)),
        inArray(ticketJobs.id, [uuid(80), uuid(81)]),
      )).orderBy(ticketJobs.id)
      expect(ticket).toMatchObject({ projectionRevision: 0n, continuityRevision: 0n })
      expect(jobs.map(({ revision, workNotes }) => ({ revision, workNotes }))).toEqual([
        { revision: 0n, workNotes: null },
        { revision: 0n, workNotes: null },
      ])
    }
  })

  it('keeps excluded assignment, claim, note, story, and price changes out of continuity', async () => {
    const excludedResult = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          profileIds: [uuid(10), uuid(11)],
          customerIds: [uuid(20)],
          vehicleIds: [uuid(30)],
          ticketIds: [uuid(53)],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        await tx.update(ticketJobs).set({
          assignedTechId: uuid(11),
          claimedAt: new Date('2026-07-16T12:00:00Z'),
          workNotes: 'Internal-only note',
          customerStory: {
            whatYouToldUs: 'Updated prose',
            whatWeFound: 'Updated prose only',
            howWeKnow: [],
            whatItMeansIfWaived: 'Prose consequence',
            whatWeRecommend: 'Prose recommendation',
          },
        }).where(and(
          eq(ticketJobs.shopId, uuid(1)),
          eq(ticketJobs.id, uuid(80)),
        ))
        await tx.update(jobLines).set({ priceCents: 999 }).where(and(
          eq(jobLines.shopId, uuid(1)),
          eq(jobLines.id, uuid(180)),
        ))
        return finalizeMutationRevisionsV1(
          tx as AppDb,
          scope,
          { sessionIds: [], customerIds: [], vehicleIds: [] },
          [{
            ticketId: uuid(53),
            createdTicket: false,
            createdJobIds: [],
            existingChangedJobIds: [uuid(80)],
            actorVisibleTicketFieldsChanged: false,
          }],
        )
      },
    })

    expect(excludedResult.tickets).toEqual([{
      id: uuid(53),
      projectionRevision: '1',
      continuityRevision: '0',
      continuityChanged: false,
    }])
    expect(excludedResult.jobs).toEqual([{ id: uuid(80), revision: '1' }])

    const includedResult = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          profileIds: [uuid(10), uuid(11)],
          customerIds: [uuid(20)],
          vehicleIds: [uuid(30)],
          ticketIds: [uuid(53)],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        await tx.update(jobLines).set({ partStatus: 'needs_order' }).where(and(
          eq(jobLines.shopId, uuid(1)),
          eq(jobLines.id, uuid(180)),
        ))
        return finalizeMutationRevisionsV1(
          tx as AppDb,
          scope,
          { sessionIds: [], customerIds: [], vehicleIds: [] },
          [{
            ticketId: uuid(53),
            createdTicket: false,
            createdJobIds: [],
            existingChangedJobIds: [uuid(80)],
            actorVisibleTicketFieldsChanged: false,
          }],
        )
      },
    })

    expect(includedResult.tickets).toEqual([{
      id: uuid(53),
      projectionRevision: '2',
      continuityRevision: '1',
      continuityChanged: true,
    }])
    expect(includedResult.jobs).toEqual([{ id: uuid(80), revision: '2' }])
  })

  it('rejects missing registered ticket/job rows and persisted sequence mismatches', async () => {
    await expect(runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: {
            ...EMPTY_INTENTS,
            tickets: [uuid(164)],
          },
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => finalizeMutationRevisionsV1(
        tx as AppDb,
        scope,
        { sessionIds: [], customerIds: [], vehicleIds: [] },
        [{
          ticketId: uuid(164),
          createdTicket: true,
          createdJobIds: [],
          existingChangedJobIds: [],
          actorVisibleTicketFieldsChanged: true,
        }],
      ),
    })).rejects.toBeInstanceOf(ShopOsMutationNotFound)

    for (const mismatch of ['missing', 'wrong_sequence'] as const) {
      const jobId = mismatch === 'missing' ? uuid(506) : uuid(507)
      await expect(runBoundedShopOsMutationV1(db, {
        discover: async () => ({
          lockRequest: lockRequest({
            lockShop: true,
            customerIds: [uuid(20)],
            vehicleIds: [uuid(30)],
            ticketIds: [uuid(50)],
            includeAllJobsForTickets: true,
            includeAllLinesForJobs: true,
            insertionIntents: {
              ...EMPTY_INTENTS,
              jobs: [{ id: jobId, ticketId: uuid(50) }],
            },
          }),
          payload: undefined,
        }),
        executeLocked: async (tx, scope) => {
          const [reservation] = reserveJobSequencesForInsertionV1(
            tx as AppDb,
            scope,
            uuid(50),
            [jobId],
          )
          if (mismatch === 'wrong_sequence') {
            await tx.insert(ticketJobs).values({
              id: jobId,
              shopId: uuid(1),
              ticketId: uuid(50),
              title: 'Wrong sequence',
              kind: 'repair',
              requiredSkillTier: 2,
              sequenceNumber: reservation.sequenceNumber + 1,
              revision: 1n,
              createdByProfileId: uuid(10),
              creatorProvenance: 'direct',
            })
          }
          return finalizeMutationRevisionsV1(
            tx as AppDb,
            scope,
            { sessionIds: [], customerIds: [], vehicleIds: [] },
            [{
              ticketId: uuid(50),
              createdTicket: false,
              createdJobIds: [jobId],
              existingChangedJobIds: [],
              actorVisibleTicketFieldsChanged: false,
            }],
          )
        },
      })).rejects.toBeInstanceOf(ShopOsMutationConflict)
    }
  })

  it('requires exact unreported/extra/spoofed bijections for every created row type', async () => {
    const variants = ['unreported', 'extra', 'spoofed'] as const
    const extraId = uuid(999)
    const baseDelta = (
      ticketId: string,
      createdTicket: boolean,
      createdJobIds: readonly string[] = [],
    ) => ({
      ticketId,
      createdTicket,
      createdJobIds,
      existingChangedJobIds: [],
      actorVisibleTicketFieldsChanged: createdTicket,
    })

    for (const rowType of ['session', 'customer', 'vehicle', 'ticket', 'job'] as const) {
      const expectedId = {
        session: uuid(43),
        customer: uuid(25),
        vehicle: uuid(35),
        ticket: uuid(165),
        job: uuid(508),
      }[rowType]
      for (const variant of variants) {
        const reportedIds = variant === 'unreported'
          ? []
          : variant === 'extra'
            ? [expectedId, extraId]
            : [extraId]
        const insertionIntents: MutationInsertionIntentsV1 = {
          sessions: rowType === 'session'
            ? [{ id: expectedId, shopId: uuid(1), techId: uuid(11) }]
            : [],
          customers: rowType === 'customer'
            ? [{ id: expectedId, shopId: uuid(1) }]
            : [],
          vehicles: rowType === 'vehicle'
            ? [{ id: expectedId, customerId: uuid(20) }]
            : [],
          tickets: rowType === 'ticket' ? [expectedId] : [],
          jobs: rowType === 'job'
            ? [{ id: expectedId, ticketId: uuid(50) }]
            : [],
        }
        const request = lockRequest({
          profileIds: rowType === 'session' ? [uuid(10), uuid(11)] : [uuid(10)],
          lockShop: true,
          customerIds: rowType === 'vehicle' || rowType === 'job' ? [uuid(20)] : [],
          vehicleIds: rowType === 'job' ? [uuid(30)] : [],
          ticketIds: rowType === 'job' ? [uuid(50)] : [],
          includeAllJobsForTickets: rowType === 'ticket' || rowType === 'job',
          includeAllLinesForJobs: rowType === 'ticket' || rowType === 'job',
          insertionIntents,
        })
        const createdRows = {
          sessionIds: rowType === 'session' ? reportedIds : [],
          customerIds: rowType === 'customer' ? reportedIds : [],
          vehicleIds: rowType === 'vehicle' ? reportedIds : [],
        }
        const deltas = rowType === 'ticket'
          ? variant === 'unreported'
            ? []
            : reportedIds.map((id) => baseDelta(id, true))
          : rowType === 'job'
            ? [baseDelta(uuid(50), false, reportedIds)]
            : []

        try {
          await runBoundedShopOsMutationV1(db, {
            discover: async () => ({ lockRequest: request, payload: undefined }),
            executeLocked: async (tx, scope) => finalizeMutationRevisionsV1(
              tx as AppDb,
              scope,
              createdRows,
              deltas,
            ),
          })
          throw new Error('expected_bijection_conflict')
        } catch (error) {
          expect(error).toBeInstanceOf(ShopOsMutationConflict)
          expect((error as Error).message).toBe('shop_os_mutation_conflict')
          expect((error as Error).message).not.toContain(expectedId)
          expect((error as Error).message).not.toContain(extraId)
        }
      }
    }
  })

  it('rejects cross-shop and cross-parent created rows with privacy-safe errors', async () => {
    for (const rowType of ['session', 'customer', 'vehicle', 'ticket', 'job'] as const) {
      const createdId = {
        session: uuid(44),
        customer: uuid(26),
        vehicle: uuid(36),
        ticket: uuid(166),
        job: uuid(509),
      }[rowType]
      const insertionIntents: MutationInsertionIntentsV1 = {
        sessions: rowType === 'session'
          ? [{ id: createdId, shopId: uuid(1), techId: uuid(11) }]
          : [],
        customers: rowType === 'customer'
          ? [{ id: createdId, shopId: uuid(1) }]
          : [],
        vehicles: rowType === 'vehicle'
          ? [{ id: createdId, customerId: uuid(20) }]
          : [],
        tickets: rowType === 'ticket' ? [createdId] : [],
        jobs: rowType === 'job'
          ? [{ id: createdId, ticketId: uuid(50) }]
          : [],
      }
      const request = lockRequest({
        profileIds: rowType === 'session' ? [uuid(10), uuid(11)] : [uuid(10)],
        lockShop: true,
        customerIds: rowType === 'vehicle' || rowType === 'job' ? [uuid(20)] : [],
        vehicleIds: rowType === 'job' ? [uuid(30)] : [],
        ticketIds: rowType === 'job' ? [uuid(50)] : [],
        includeAllJobsForTickets: rowType === 'ticket' || rowType === 'job',
        includeAllLinesForJobs: rowType === 'ticket' || rowType === 'job',
        insertionIntents,
      })

      try {
        await runBoundedShopOsMutationV1(db, {
          discover: async () => ({ lockRequest: request, payload: undefined }),
          executeLocked: async (tx, scope) => {
            if (rowType === 'session') {
              await tx.insert(sessions).values({
                id: createdId,
                shopId: uuid(1),
                techId: uuid(10),
                vehicleId: null,
                intake: {
                  vehicleYear: 2024,
                  vehicleMake: 'Ford',
                  vehicleModel: 'Bronco',
                  customerComplaint: 'Cross parent',
                },
                treeState: { nodes: [], currentNodeId: 'root', message: 'Open', done: false },
              })
            } else if (rowType === 'customer') {
              await tx.insert(customers).values({
                id: createdId,
                shopId: uuid(2),
                name: 'Wrong shop',
                phone: '555-0199',
              })
            } else if (rowType === 'vehicle') {
              await tx.insert(vehicles).values({
                id: createdId,
                customerId: uuid(23),
                year: 2024,
                make: 'Mazda',
                model: 'CX-5',
              })
            } else if (rowType === 'ticket') {
              await tx.insert(tickets).values({
                id: createdId,
                shopId: uuid(1),
                ticketNumber: 166,
                source: 'counter',
                customerId: uuid(23),
                vehicleId: uuid(33),
                concern: 'Unauthorized parents',
                projectionRevision: 1n,
                continuityRevision: 1n,
                createdByProfileId: uuid(10),
              })
            } else {
              reserveJobSequencesForInsertionV1(
                tx as AppDb,
                scope,
                uuid(50),
                [createdId],
              )
              await tx.insert(ticketJobs).values({
                id: createdId,
                shopId: uuid(1),
                ticketId: uuid(52),
                title: 'Wrong ticket',
                kind: 'repair',
                requiredSkillTier: 2,
                sequenceNumber: 7,
                revision: 1n,
                createdByProfileId: uuid(10),
                creatorProvenance: 'direct',
              })
            }

            return finalizeMutationRevisionsV1(
              tx as AppDb,
              scope,
              {
                sessionIds: rowType === 'session' ? [createdId] : [],
                customerIds: rowType === 'customer' ? [createdId] : [],
                vehicleIds: rowType === 'vehicle' ? [createdId] : [],
              },
              rowType === 'ticket'
                ? [{
                  ticketId: createdId,
                  createdTicket: true,
                  createdJobIds: [],
                  existingChangedJobIds: [],
                  actorVisibleTicketFieldsChanged: true,
                }]
                : rowType === 'job'
                  ? [{
                    ticketId: uuid(50),
                    createdTicket: false,
                    createdJobIds: [createdId],
                    existingChangedJobIds: [],
                    actorVisibleTicketFieldsChanged: false,
                  }]
                  : [],
            )
          },
        })
        throw new Error('expected_parent_conflict')
      } catch (error) {
        expect([
          'shop_os_mutation_conflict',
          'shop_os_mutation_not_found',
        ]).toContain((error as Error).message)
        expect((error as Error).message).not.toContain(createdId)
      }
    }
  })

  it('writes every sorted parent CAS before grouped sorted child CAS updates', async () => {
    const result = await runBoundedShopOsMutationV1(loggingDb, {
      discover: async () => ({
        lockRequest: lockRequest({
          profileIds: [uuid(10), uuid(11)],
          customerIds: [uuid(20)],
          vehicleIds: [uuid(30)],
          ticketIds: [uuid(54), uuid(53)],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        queryLog.length = 0
        return finalizeMutationRevisionsV1(
          tx as AppDb,
          scope,
          { sessionIds: [], customerIds: [], vehicleIds: [] },
          [
            {
              ticketId: uuid(54),
              createdTicket: false,
              createdJobIds: [],
              existingChangedJobIds: [uuid(90)],
              actorVisibleTicketFieldsChanged: true,
            },
            {
              ticketId: uuid(53),
              createdTicket: false,
              createdJobIds: [],
              existingChangedJobIds: [uuid(80)],
              actorVisibleTicketFieldsChanged: true,
            },
          ],
        )
      },
    })

    const writes = queryLog.filter(({ sql: query }) =>
      /^update "(?:tickets|ticket_jobs)"/i.test(query))
    expect(writes.map(({ sql: query, params }) => {
      const table = query.startsWith('update "tickets"') ? 'ticket' : 'job'
      const id = (table === 'ticket' ? [uuid(53), uuid(54)] : [uuid(80), uuid(90)])
        .find((candidate) => params.includes(candidate))
      return `${table}:${id}`
    })).toEqual([
      `ticket:${uuid(53)}`,
      `ticket:${uuid(54)}`,
      `job:${uuid(80)}`,
      `job:${uuid(90)}`,
    ])
    expect(result.tickets.map(({ id }) => id)).toEqual([uuid(53), uuid(54)])
    expect(result.jobs.map(({ id }) => id)).toEqual([uuid(80), uuid(90)])
  })
})
