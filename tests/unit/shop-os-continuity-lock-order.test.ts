import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  ShopOsMutationConflict,
  isRetryableMutationConflict,
} from '@/lib/shop-os/continuity/mutation-foundation/conflicts'
import {
  assertLiveLockedMutationScopeV1,
  assertLiveMutationAttemptV1,
  bindLockedMutationScopeToAttemptV1,
  closeMutationAttemptCapabilityV1,
  createMutationAttemptCapabilityV1,
} from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import type { AppDb } from '@/lib/db/queries'
import type { MutationAttemptCapabilityV1 } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { ShopOsMutationNotFound } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import type { LockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import {
  lockMutationScopeV1,
  REPOSITORY_LOCK_CLASSES_V1,
  type MutationLockRequestV1,
  type RepositoryLockClassV1,
} from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import {
  cannedJobs,
  customers,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  sessions,
  sessionEvents,
  shops,
  ticketJobs,
  ticketMutationReceiptJobs,
  ticketMutationReceipts,
  tickets,
  vendorAccounts,
  vehicles,
} from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { drizzle } from 'drizzle-orm/pglite'
import { eq } from 'drizzle-orm'
import {
  MAX_MUTATION_ATTEMPTS_V1,
  MUTATION_LOCK_TIMEOUT_MS_V1,
  MUTATION_STATEMENT_TIMEOUT_MS_V1,
  RECOVERABLE_UNIQUE_CONSTRAINTS_V1,
  runBoundedShopOsMutationV1,
  type BoundedMutationOperationV1,
} from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'
import type { MutationAttemptContextV1 } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import type { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const root = process.cwd()

describe('ShopOS continuity mutation lock order', () => {
  it('defines one central repository lock-order contract for the current writers', () => {
    const writerSources = [
      'lib/tickets.ts',
      'lib/shop-os/quotes.ts',
      'lib/shop-os/canned-jobs.ts',
      'lib/intake/quick-ticket.ts',
      'lib/sessions.ts',
    ].map((path) => readFileSync(resolve(root, path), 'utf8'))
    const lockOrderPath = resolve(
      root,
      'lib/shop-os/continuity/mutation-foundation/lock-order.ts',
    )

    expect(writerSources).toHaveLength(5)
    expect(existsSync(lockOrderPath), 'central lock-order module must exist').toBe(true)
    const source = existsSync(lockOrderPath) ? readFileSync(lockOrderPath, 'utf8') : ''
    expect(source).toContain('REPOSITORY_LOCK_CLASSES_V1')
    expect(source).toMatch(/export async function lockMutationScopeV1\s*\(/)
  })

  it('defines the shared conflict and attempt-capability modules', () => {
    const requiredSources = [
      {
        path: 'lib/shop-os/continuity/mutation-foundation/conflicts.ts',
        names: ['ShopOsMutationConflict', 'isRetryableMutationConflict'],
      },
      {
        path: 'lib/shop-os/continuity/mutation-foundation/attempt-capability.ts',
        names: [
          'createMutationAttemptCapabilityV1',
          'bindLockedMutationScopeToAttemptV1',
          'assertLiveMutationAttemptV1',
          'assertLiveLockedMutationScopeV1',
          'closeMutationAttemptCapabilityV1',
        ],
      },
      {
        path: 'lib/shop-os/continuity/mutation-foundation/transaction-runner.ts',
        names: [
          'MUTATION_LOCK_TIMEOUT_MS_V1',
          'MUTATION_STATEMENT_TIMEOUT_MS_V1',
          'MAX_MUTATION_ATTEMPTS_V1',
          'RECOVERABLE_UNIQUE_CONSTRAINTS_V1',
          'runBoundedShopOsMutationV1',
        ],
      },
    ]

    for (const required of requiredSources) {
      const absolutePath = resolve(root, required.path)
      expect(existsSync(absolutePath), `${required.path} must exist`).toBe(true)
      const source = existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : ''
      for (const name of required.names) expect(source).toContain(name)
    }
  })
})

describe('ShopOS mutation conflict classification', () => {
  it('accepts only the explicit drift conflict and exact retryable SQLSTATEs', () => {
    expect(isRetryableMutationConflict(new ShopOsMutationConflict())).toBe(true)
    for (const code of ['55P03', '40001', '40P01']) {
      expect(isRetryableMutationConflict({ code })).toBe(true)
      expect(isRetryableMutationConflict({ cause: { cause: { code } } })).toBe(true)
    }

    for (const candidate of [
      { code: '23505' },
      { code: '57014' },
      { code: '55p03' },
      { code: 55_003 },
      { message: 'SQLSTATE 55P03 lock unavailable' },
      new Error('deadlock detected'),
      null,
    ]) {
      expect(isRetryableMutationConflict(candidate)).toBe(false)
    }
  })

  it('bounds cyclic cause traversal without coercing structured fields', () => {
    const cycle: { code: object; cause?: unknown } = {
      code: { toString: () => '55P03' },
    }
    cycle.cause = cycle
    expect(isRetryableMutationConflict(cycle)).toBe(false)

    let cause: unknown = { code: '55P03' }
    for (let index = 0; index < 20; index += 1) cause = { cause }
    expect(isRetryableMutationConflict(cause)).toBe(false)
  })
})

const fakeTx = (): AppDb => Object.create(null) as AppDb
const fakeScope = (): LockedMutationScopeV1 =>
  Object.freeze(Object.create(null)) as LockedMutationScopeV1

describe('ShopOS mutation attempt capabilities', () => {
  it('creates an opaque frozen capability bound to the exact transaction and metadata', () => {
    const tx = fakeTx()
    const context = createMutationAttemptCapabilityV1(tx, {
      ordinal: 1,
      purpose: 'primary',
    })

    expect(context).toEqual({
      capability: context.capability,
      ordinal: 1,
      purpose: 'primary',
    })
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.getPrototypeOf(context.capability)).toBe(null)
    expect(Object.isFrozen(context.capability)).toBe(true)
    expect(Reflect.ownKeys(context.capability)).toEqual([])
    expect(() => assertLiveMutationAttemptV1(tx, context.capability)).not.toThrow()
    expect(() => assertLiveMutationAttemptV1(fakeTx(), context.capability)).toThrow()
    expect(() =>
      assertLiveMutationAttemptV1(tx, Object.freeze(Object.create(null)) as MutationAttemptCapabilityV1),
    ).toThrow()
  })

  it('accepts only the exact scope bound once to the same live attempt', () => {
    const tx = fakeTx()
    const otherTx = fakeTx()
    const first = createMutationAttemptCapabilityV1(tx, {
      ordinal: 1,
      purpose: 'primary',
    })
    const second = createMutationAttemptCapabilityV1(tx, {
      ordinal: 2,
      purpose: 'primary',
    })
    const scope = fakeScope()
    const otherScope = fakeScope()

    expect(() => assertLiveLockedMutationScopeV1(tx, scope)).toThrow()
    bindLockedMutationScopeToAttemptV1(tx, first.capability, scope)
    expect(assertLiveLockedMutationScopeV1(tx, scope)).toBe(first.capability)
    expect(() => assertLiveLockedMutationScopeV1(otherTx, scope)).toThrow()
    expect(() => bindLockedMutationScopeToAttemptV1(tx, first.capability, otherScope)).toThrow()
    expect(() => bindLockedMutationScopeToAttemptV1(tx, second.capability, scope)).toThrow()
  })

  it('permanently closes the capability and its bound scope', () => {
    const tx = fakeTx()
    const context = createMutationAttemptCapabilityV1(tx, {
      ordinal: 2,
      purpose: 'unique_collision_recovery',
    })
    const scope = fakeScope()
    bindLockedMutationScopeToAttemptV1(tx, context.capability, scope)

    closeMutationAttemptCapabilityV1(context.capability)

    expect(() => assertLiveMutationAttemptV1(tx, context.capability)).toThrow()
    expect(() => assertLiveLockedMutationScopeV1(tx, scope)).toThrow()
    expect(() => bindLockedMutationScopeToAttemptV1(tx, context.capability, fakeScope())).toThrow()
    expect(() => closeMutationAttemptCapabilityV1(context.capability)).toThrow()
  })
})

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const EMPTY_INTENTS = Object.freeze({
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

function lockExtension(
  overrides: Partial<NonNullable<Extract<MutationLockRequestV1['receiptConditionalInsert'], { kind: 'prepared' }>['extension']>> = {},
): Extract<MutationLockRequestV1['receiptConditionalInsert'], { kind: 'prepared' }>['extension'] {
  return {
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
    insertionIntents: EMPTY_INTENTS,
    ...overrides,
  }
}

describe('ShopOS repository lock coordinator', () => {
  let db: TestDb
  let loggingDb: TestDb
  let close: () => Promise<void>
  let client: PGlite
  let queryLog: Array<Readonly<{ sql: string; params: readonly unknown[] }>>

  beforeAll(async () => {
    ;({ db, client, close } = await createTestDb())
    queryLog = []
    loggingDb = drizzle(client, {
      schema,
      logger: {
        logQuery: (query, params) => queryLog.push({ sql: query, params: [...params] }),
      },
    })
    await db.insert(shops).values([
      { id: uuid(1), name: 'North Shop' },
      { id: uuid(2), name: 'South Shop' },
    ])
    await db.insert(profiles).values([
      { id: uuid(10), userId: uuid(1010), shopId: uuid(1), role: 'owner', skillTier: null },
      { id: uuid(11), userId: uuid(1011), shopId: uuid(1), role: 'tech', skillTier: 2 },
      { id: uuid(12), userId: uuid(1012), shopId: uuid(1), role: 'advisor', skillTier: null },
      { id: uuid(13), userId: uuid(1013), shopId: uuid(1), role: 'parts', skillTier: null },
      { id: uuid(14), userId: uuid(1014), shopId: uuid(1), role: 'tech', skillTier: null },
      { id: uuid(15), userId: uuid(1015), shopId: uuid(1), role: 'owner', deactivatedAt: new Date() },
      { id: uuid(16), userId: uuid(1016), shopId: uuid(2), role: 'owner', skillTier: null },
    ])
    await db.insert(customers).values([
      { id: uuid(20), shopId: uuid(1), name: 'Alex', phone: '555-0100' },
      { id: uuid(21), shopId: uuid(1), name: 'Blake', phone: '555-0101' },
      { id: uuid(22), shopId: uuid(2), name: 'Cross', phone: '555-0102' },
    ])
    await db.insert(vehicles).values([
      { id: uuid(30), customerId: uuid(20), year: 2020, make: 'Ford', model: 'F-150' },
      { id: uuid(31), customerId: uuid(21), year: 2021, make: 'Honda', model: 'Civic' },
      { id: uuid(32), customerId: uuid(22), year: 2022, make: 'Toyota', model: 'Camry' },
    ])
    await db.insert(tickets).values([
      {
        id: uuid(50), shopId: uuid(1), ticketNumber: 50, source: 'counter',
        customerId: uuid(20), vehicleId: uuid(30), concern: 'Noise', createdByProfileId: uuid(10),
      },
      {
        id: uuid(51), shopId: uuid(1), ticketNumber: 51, source: 'tech_quick',
        customerId: null, vehicleId: null, concern: 'Quick concern', createdByProfileId: uuid(10),
      },
      {
        id: uuid(52), shopId: uuid(1), ticketNumber: 52, source: 'counter',
        customerId: uuid(20), vehicleId: uuid(30), concern: 'Approved work',
        createdByProfileId: uuid(10),
      },
    ])
    await db.insert(sessions).values({
      id: uuid(40), shopId: uuid(1), techId: uuid(11), vehicleId: uuid(30),
      intake: { vehicleYear: 2020, vehicleMake: 'Ford', vehicleModel: 'F-150', customerComplaint: 'Noise' },
      treeState: { nodes: [], currentNodeId: 'root', message: 'Open', done: false },
    })
    await db.insert(ticketJobs).values([
      {
        id: uuid(60), shopId: uuid(1), ticketId: uuid(50), title: 'Inspect', kind: 'diagnostic',
        requiredSkillTier: 2, assignedTechId: uuid(11), sessionId: uuid(40),
        createdByProfileId: uuid(10), creatorProvenance: 'direct',
        customerStory: {
          whatYouToldUs: 'Noise',
          whatWeFound: 'Loose shield',
          howWeKnow: [{ claim: 'Shield moved', sourceEventIds: [uuid(41)], sourceArtifactIds: [] }],
          whatItMeansIfWaived: 'Noise may continue',
          whatWeRecommend: 'Secure shield',
        },
        storyMeta: {
          source: 'manual', lastEditedByProfileId: uuid(10),
          lastEditedAt: '2026-07-16T00:00:00.000Z',
        },
      },
      {
        id: uuid(61), shopId: uuid(1), ticketId: uuid(50), title: 'Repair', kind: 'repair',
        requiredSkillTier: 2, createdByProfileId: uuid(10), creatorProvenance: 'direct',
      },
      {
        id: uuid(62), shopId: uuid(1), ticketId: uuid(52), title: 'Approved repair', kind: 'repair',
        requiredSkillTier: 2, createdByProfileId: uuid(10), creatorProvenance: 'direct',
      },
    ])
    await db.insert(jobLines).values({
      id: uuid(70), shopId: uuid(1), jobId: uuid(60), kind: 'part', description: 'Part',
      quantity: 1, priceCents: 100, taxable: true,
      vendorSnapshot: { offer: { id: 'locked-offer', warehouses: ['north'] } },
    })
    await db.insert(quoteVersions).values({
      id: uuid(80), shopId: uuid(1), ticketId: uuid(50), versionNumber: 1,
      snapshot: { jobs: [{ id: uuid(60), decision: 'pending' }] },
      createdByProfileId: uuid(10),
    })
    await db.insert(quoteVersions).values({
      id: uuid(81), shopId: uuid(1), ticketId: uuid(52), versionNumber: 1,
      snapshot: { jobs: [{ id: uuid(62), decision: 'approved' }] },
      createdByProfileId: uuid(10),
    })
    await db.insert(quoteEvents).values([
      {
        id: uuid(90), shopId: uuid(1), ticketId: uuid(50), jobId: uuid(60),
        quoteVersionId: uuid(80), kind: 'sent', actorProfileId: uuid(10), requestKey: 'event-90',
      },
      {
        id: uuid(91), shopId: uuid(1), ticketId: uuid(52), jobId: uuid(62),
        quoteVersionId: uuid(81), kind: 'approved', actorProfileId: uuid(10),
        approvedVia: 'in_person', requestKey: 'event-91',
      },
    ])
    await db.update(ticketJobs).set({ approvedApprovalEventId: uuid(91) })
      .where(eq(ticketJobs.id, uuid(62)))
    await db.insert(sessionEvents).values({
      id: uuid(41), sessionId: uuid(40), nodeId: 'root', eventType: 'observation',
      observationText: 'Observed noise', requestKey: uuid(400), requestActorProfileId: uuid(11),
      requestFingerprint: 'f'.repeat(64),
    })
    await db.insert(vendorAccounts).values({
      id: uuid(100), shopId: uuid(1), vendor: 'parts_co', displayName: 'Parts Co',
      mode: 'manual', enabled: true,
      nonSecretConfig: { catalog: { region: 'central', warehouses: ['north'] } },
    })
    await db.insert(cannedJobs).values({
      id: uuid(110), shopId: uuid(1), title: 'Oil service', kind: 'maintenance',
      defaultRequiredSkillTier: 1,
      defaultLines: [{
        kind: 'labor', description: 'Oil service labor', sort: 0, quantity: 1,
        priceCents: 5000, taxable: false, laborHours: 1, laborRateCents: 5000,
      }],
    })
  })

  afterAll(async () => close())

  async function lock(
    request: MutationLockRequestV1,
    afterClass?: (name: RepositoryLockClassV1) => Promise<void>,
    targetDb: TestDb = db,
  ): Promise<LockedMutationScopeV1> {
    return targetDb.transaction(async (rawTx) => {
      const tx = rawTx as AppDb
      const attempt = createMutationAttemptCapabilityV1(tx, { ordinal: 1, purpose: 'primary' })
      try {
        return await lockMutationScopeV1(tx, attempt.capability, request, { afterClass })
      } finally {
        closeMutationAttemptCapabilityV1(attempt.capability)
      }
    })
  }

  async function insertReceipt(
    suffix: number,
    requestKey: string,
    actorProfileId: string,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.insert(ticketMutationReceipts).values({
        id: uuid(suffix),
        shopId: uuid(1),
        requestKey,
        mutationSchemaVersion: 1,
        fingerprintKeyVersion: 1,
        mutationKind: 'create_repair_order',
        actorProfileId,
        targetTicketId: null,
        targetBindingFingerprint: 'a'.repeat(64),
        requestFingerprint: 'b'.repeat(64),
        resultTicketId: uuid(50),
        resultJobCount: 2,
      })
      await tx.insert(ticketMutationReceiptJobs).values([
        {
          shopId: uuid(1), receiptId: uuid(suffix), resultTicketId: uuid(50),
          resultJobCount: 2, ordinal: 0, jobId: uuid(60),
        },
        {
          shopId: uuid(1), receiptId: uuid(suffix), resultTicketId: uuid(50),
          resultJobCount: 2, ordinal: 1, jobId: uuid(61),
        },
      ])
    })
  }

  it('normalizes an immutable actor-only request and observes every lock class in one order', async () => {
    const profileIds = [uuid(12).toUpperCase(), uuid(10).toUpperCase(), uuid(12)]
    const classes: RepositoryLockClassV1[] = []
    const request = lockRequest({ profileIds })

    const scope = await lock(request, async (name) => {
      classes.push(name)
      profileIds.push(uuid(16))
    })

    expect(classes).toEqual(REPOSITORY_LOCK_CLASSES_V1)
    expect(scope.request.profileIds).toEqual([uuid(10), uuid(12)])
    expect(scope.profiles.map((row) => row.id)).toEqual([uuid(10), uuid(12)])
    expect(scope.actor).toMatchObject({ id: uuid(10), shopId: uuid(1), role: 'owner', skillTier: null })
    expect(scope.shop).toBeNull()
    expect(Object.isFrozen(scope)).toBe(true)
    expect(Object.isFrozen(scope.request)).toBe(true)
    expect(Object.isFrozen(scope.request.profileIds)).toBe(true)
    expect(scope.receiptPeek).toEqual({ kind: 'none' })
    expect(scope.receiptConditionalInsertState).toBe('not_applicable')
  })

  it('locks the complete same-shop graph with sorted tenant-constrained NOWAIT SQL', async () => {
    queryLog.length = 0
    const scope = await lock(lockRequest({
      profileIds: [uuid(11), uuid(10)],
      lockShop: true,
      customerIds: [uuid(20)],
      vehicleIds: [uuid(30)],
      ticketIds: [uuid(50)],
      jobIds: [uuid(61), uuid(60)],
      includeAllJobsForTickets: true,
      includeAllLinesForJobs: true,
      includeAllQuoteVersionsForTickets: true,
      includeAllQuoteEventsForTickets: true,
      sessionIds: [uuid(40)],
      sessionEventIds: [uuid(41)],
      vendorAccountIds: [uuid(100)],
      cannedJobIds: [uuid(110)],
    }), undefined, loggingDb)

    expect(scope.shop?.id).toBe(uuid(1))
    expect(scope.customers.map((row) => row.id)).toEqual([uuid(20)])
    expect(scope.vehicles.map((row) => row.id)).toEqual([uuid(30)])
    expect(scope.tickets).toHaveLength(1)
    expect(scope.tickets[0].jobs.map((row) => row.id)).toEqual([uuid(60), uuid(61)])
    expect(scope.tickets[0].lines.map((row) => row.id)).toEqual([uuid(70)])
    expect(scope.tickets[0].versions.map((row) => row.id)).toEqual([uuid(80)])
    expect(scope.tickets[0].events.map((row) => row.id)).toEqual([uuid(90)])
    expect(scope.beforeSignatures.has(uuid(50))).toBe(true)

    const locks = queryLog.filter(({ sql }) => /for update(?: of [^ ]+)? nowait/i.test(sql))
    expect(locks.map(({ sql }) => sql.replace(/\s+/g, ' '))).toEqual([
      expect.stringMatching(/from "profiles".*"shop_id" = \$1.*"id" in \(\$2, \$3\).*order by "profiles"\."id".*for update nowait/i),
      expect.stringMatching(/from "shops".*"id" = \$1.*for update nowait/i),
      expect.stringMatching(/from "customers".*"shop_id" = \$1.*order by "customers"\."id".*for update nowait/i),
      expect.stringMatching(/from "vehicles".*join "customers".*"customers"\."shop_id" = \$1.*order by "vehicles"\."id".*for update of "vehicles" nowait/i),
      expect.stringMatching(/from "tickets".*"shop_id" = \$1.*order by "tickets"\."id".*for update nowait/i),
      expect.stringMatching(/from "ticket_jobs".*"shop_id" = \$1.*order by "ticket_jobs"\."id".*for update nowait/i),
      expect.stringMatching(/from "job_lines".*"shop_id" = \$1.*order by "job_lines"\."id".*for update nowait/i),
      expect.stringMatching(/from "quote_versions".*"shop_id" = \$1.*order by "quote_versions"\."id".*for update nowait/i),
      expect.stringMatching(/from "quote_events".*"shop_id" = \$1.*order by "quote_events"\."id".*for update nowait/i),
      expect.stringMatching(/from "sessions".*"shop_id" = \$1.*order by "sessions"\."id".*for update nowait/i),
      expect.stringMatching(/from "session_events".*join "sessions".*"sessions"\."shop_id" = \$1.*order by "session_events"\."id".*for update of "session_events" nowait/i),
      expect.stringMatching(/from "vendor_accounts".*"shop_id" = \$1.*order by "vendor_accounts"\."id".*for update nowait/i),
      expect.stringMatching(/from "canned_jobs".*"shop_id" = \$1.*order by "canned_jobs"\."id".*for update nowait/i),
    ])
    expect(locks[0].params).toEqual([uuid(1), uuid(10), uuid(11)])
    expect(locks[5].params).toEqual([uuid(1), uuid(50)])
  })

  it('owns deeply immutable locked row truth, including JSON and timestamp values', async () => {
    const scope = await lock(lockRequest({
      profileIds: [uuid(10), uuid(11)],
      lockShop: true,
      customerIds: [uuid(20)],
      vehicleIds: [uuid(30)],
      ticketIds: [uuid(50)],
      jobIds: [uuid(60), uuid(61)],
      includeAllJobsForTickets: true,
      includeAllLinesForJobs: true,
      includeAllQuoteVersionsForTickets: true,
      includeAllQuoteEventsForTickets: true,
      sessionIds: [uuid(40)],
      sessionEventIds: [uuid(41)],
      vendorAccountIds: [uuid(100)],
      cannedJobIds: [uuid(110)],
    }))

    const graph = scope.tickets[0]
    const job = graph.jobs.find(({ id }) => id === uuid(60))!
    const lineSnapshot = graph.lines[0].vendorSnapshot as {
      offer: { id: string; warehouses: string[] }
    }
    const versionSnapshot = graph.versions[0].snapshot as {
      jobs: Array<{ id: string; decision: string }>
    }
    const vendorConfig = scope.vendorAccounts[0].nonSecretConfig as {
      catalog: { region: string; warehouses: string[] }
    }
    const createdAt = graph.ticket.createdAt
    const createdAtMs = createdAt.getTime()

    expect(() => scope.sessions[0].treeState.nodes.push({} as never)).toThrow(TypeError)
    expect(() => job.customerStory!.howWeKnow[0].sourceEventIds.push(uuid(999))).toThrow(TypeError)
    expect(() => { lineSnapshot.offer.id = 'changed' }).toThrow(TypeError)
    expect(() => versionSnapshot.jobs.push({ id: uuid(999), decision: 'changed' })).toThrow(TypeError)
    expect(() => vendorConfig.catalog.warehouses.push('south')).toThrow(TypeError)
    expect(() => { scope.cannedJobs[0].defaultLines[0].description = 'changed' }).toThrow(TypeError)
    expect(() => createdAt.setTime(0)).toThrow(TypeError)

    expect(scope.sessions[0].treeState.nodes).toEqual([])
    expect(job.customerStory!.howWeKnow[0].sourceEventIds).toEqual([uuid(41)])
    expect(lineSnapshot.offer).toEqual({ id: 'locked-offer', warehouses: ['north'] })
    expect(versionSnapshot.jobs).toEqual([{ id: uuid(60), decision: 'pending' }])
    expect(vendorConfig.catalog).toEqual({ region: 'central', warehouses: ['north'] })
    expect(scope.cannedJobs[0].defaultLines[0].description).toBe('Oil service labor')
    expect(createdAt.getTime()).toBe(createdAtMs)
  })

  it('requires each approved job event to be locked and bound to that exact job', async () => {
    const base = lockRequest({
      customerIds: [uuid(20)],
      vehicleIds: [uuid(30)],
      ticketIds: [uuid(52)],
      jobIds: [uuid(62)],
    })

    await expect(lock(base)).rejects.toBeInstanceOf(ShopOsMutationConflict)

    const scope = await lock(lockRequest({
      ...base,
      includeAllQuoteVersionsForTickets: true,
      includeAllQuoteEventsForTickets: true,
    }))
    const graph = scope.tickets[0]
    expect(graph.jobs[0].approvedApprovalEventId).toBe(uuid(91))
    expect(graph.events.find(({ id }) => id === uuid(91))).toMatchObject({
      ticketId: uuid(52),
      jobId: uuid(62),
    })
  })

  it('constrains explicit child locks by the already-locked composite parent IDs', async () => {
    queryLog.length = 0
    await lock(lockRequest({
      profileIds: [uuid(10), uuid(11)], customerIds: [uuid(20)],
      vehicleIds: [uuid(30)], ticketIds: [uuid(50)], jobIds: [uuid(60)],
      sessionIds: [uuid(40)], sessionEventIds: [uuid(41)],
    }), undefined, loggingDb)
    const jobSql = queryLog.find(({ sql }) => /from "ticket_jobs"/i.test(sql))?.sql ?? ''
    const eventSql = queryLog.find(({ sql }) => /from "session_events"/i.test(sql))?.sql ?? ''
    expect(jobSql).toMatch(/"ticket_jobs"\."ticket_id" in \(/i)
    expect(eventSql).toMatch(/"session_events"\."session_id" in \(/i)
  })

  it('privacy-collapses missing and cross-shop lock IDs', async () => {
    await expect(lock(lockRequest({ customerIds: [uuid(22)] })))
      .rejects.toBeInstanceOf(ShopOsMutationNotFound)
    await expect(lock(lockRequest({ actorProfileId: uuid(16), profileIds: [uuid(16)] })))
      .rejects.toBeInstanceOf(ShopOsMutationNotFound)
  })

  it('rejects a discovered child reference outside the locked set without a late lock', async () => {
    const classes: RepositoryLockClassV1[] = []
    await expect(lock(lockRequest({
      customerIds: [uuid(20)],
      vehicleIds: [uuid(30)],
      ticketIds: [uuid(50)],
      jobIds: [uuid(60)],
      sessionIds: [uuid(40)],
    }), async (name) => {
      classes.push(name)
    })).rejects.toBeInstanceOf(ShopOsMutationConflict)
    expect(classes).toEqual([
      'profiles', 'shop', 'customers', 'vehicles', 'tickets',
    ])
  })

  it('never assembles a complete before-signature from an incomplete child lock set', async () => {
    const scope = await lock(lockRequest({
      profileIds: [uuid(10), uuid(11)],
      customerIds: [uuid(20)],
      vehicleIds: [uuid(30)],
      ticketIds: [uuid(50)],
      jobIds: [uuid(60), uuid(61)],
      sessionIds: [uuid(40)],
    }))
    expect(scope.tickets[0].jobs).toHaveLength(2)
    expect(scope.tickets[0].lines).toEqual([])
    expect(scope.beforeSignatures.size).toBe(0)
    expect('set' in (scope.beforeSignatures as object)).toBe(false)
  })

  it('reauthorizes all four actor roles and preserves nullable tiers without inventing defaults', async () => {
    for (const [profileId, role, tier] of [
      [uuid(10), 'owner', null],
      [uuid(11), 'tech', 2],
      [uuid(12), 'advisor', null],
      [uuid(13), 'parts', null],
      [uuid(14), 'tech', null],
    ] as const) {
      const scope = await lock(lockRequest({ actorProfileId: profileId, profileIds: [profileId] }))
      expect(scope.actor).toMatchObject({ id: profileId, role, skillTier: tier })
    }
    await expect(lock(lockRequest({ actorProfileId: uuid(15), profileIds: [uuid(15)] })))
      .rejects.toBeInstanceOf(ShopOsMutationNotFound)
  })

  it('reasserts the live exact attempt after a class seam before issuing another query', async () => {
    queryLog.length = 0
    await expect(loggingDb.transaction(async (rawTx) => {
      const tx = rawTx as AppDb
      const attempt = createMutationAttemptCapabilityV1(tx, { ordinal: 1, purpose: 'primary' })
      return lockMutationScopeV1(tx, attempt.capability, lockRequest({ lockShop: true }), {
        afterClass: async (name) => {
          if (name === 'profiles') closeMutationAttemptCapabilityV1(attempt.capability)
        },
      })
    })).rejects.toThrowError('mutation_attempt_capability_closed')
    expect(queryLog.some(({ sql }) => /from "shops"/i.test(sql))).toBe(false)
  })

  it('activates one copied conditional extension only after an authoritative absent receipt peek', async () => {
    const extensionCustomerIds = [uuid(20).toUpperCase()]
    const scope = await lock(lockRequest({
      profileIds: [uuid(10), uuid(11)],
      receiptRequestKey: uuid(200),
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: lockExtension({
          lockShop: true,
          customerIds: extensionCustomerIds,
          vehicleIds: [uuid(30)],
          ticketIds: [uuid(50)],
          jobIds: [uuid(61), uuid(60)],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          includeAllQuoteVersionsForTickets: true,
          includeAllQuoteEventsForTickets: true,
          sessionIds: [uuid(40)],
          sessionEventIds: [uuid(41)],
          vendorAccountIds: [uuid(100)],
          cannedJobIds: [uuid(110)],
        }),
      },
    }), async (name) => {
      if (name === 'profiles') extensionCustomerIds.push(uuid(21))
    })

    expect(scope.receiptPeek).toEqual({ kind: 'none' })
    expect(scope.receiptConditionalInsertState).toBe('activated')
    expect(scope.request.customerIds).toEqual([uuid(20)])
    expect(scope.request.jobIds).toEqual([uuid(60), uuid(61)])
    expect(scope.shop?.id).toBe(uuid(1))
  })

  it('registers immutable insertion intents without granting authority or writing rows', async () => {
    const intents = {
      sessions: [{ id: uuid(210), shopId: uuid(1), techId: uuid(11) }],
      customers: [{ id: uuid(211), shopId: uuid(1) }],
      vehicles: [{ id: uuid(212), customerId: uuid(211) }],
      tickets: [uuid(213)],
      jobs: [{ id: uuid(214), ticketId: uuid(213) }],
    }
    const scope = await lock(lockRequest({
      profileIds: [uuid(10), uuid(11)],
      receiptRequestKey: uuid(201),
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: lockExtension({ lockShop: true, insertionIntents: intents }),
      },
    }))

    expect(scope.insertionIntents).toEqual(intents)
    expect(Object.isFrozen(scope.insertionIntents.sessions[0])).toBe(true)
    expect(await db.select().from(tickets).where(eq(tickets.id, uuid(213)))).toEqual([])
    expect(await db.select().from(sessions).where(eq(sessions.id, uuid(210)))).toEqual([])
  })

  it('refuses a session insertion intent bound to a null-tier technician', async () => {
    await expect(lock(lockRequest({
      profileIds: [uuid(10), uuid(14)],
      receiptRequestKey: uuid(209),
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: lockExtension({
          lockShop: true,
          insertionIntents: {
            ...EMPTY_INTENTS,
            sessions: [{ id: uuid(219), shopId: uuid(1), techId: uuid(14) }],
          },
        }),
      },
    }))).rejects.toBeInstanceOf(ShopOsMutationNotFound)
  })

  it('suppresses conditional resources for occupied receipts without exposing identifiers', async () => {
    await insertReceipt(300, uuid(202), uuid(12))
    const scope = await lock(lockRequest({
      receiptRequestKey: uuid(202),
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: lockExtension({ lockShop: true, customerIds: [uuid(20)] }),
      },
    }))

    expect(scope.receiptPeek).toEqual({ kind: 'occupied' })
    expect(scope.receiptConditionalInsertState).toBe('suppressed_by_occupied_receipt')
    expect(scope.request.customerIds).toEqual([])
    expect(scope.customers).toEqual([])
    expect(JSON.stringify(scope)).not.toContain(uuid(300))
    expect(JSON.stringify(scope)).not.toContain(uuid(50))
  })

  it('suppresses prepared inserts and locks the owned receipt replay graph in remaining order', async () => {
    await insertReceipt(301, uuid(203), uuid(10))
    const classes: RepositoryLockClassV1[] = []
    const scope = await lock(lockRequest({
      receiptRequestKey: uuid(203),
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: lockExtension({
          lockShop: true,
          customerIds: [uuid(21)],
          insertionIntents: {
            ...EMPTY_INTENTS,
            tickets: [uuid(215)],
          },
        }),
      },
    }), async (name) => {
      classes.push(name)
    })

    expect(scope.receiptPeek).toEqual({
      kind: 'owned', receiptId: uuid(301), resultTicketId: uuid(50),
    })
    expect(scope.receiptConditionalInsertState).toBe('suppressed_by_owned_receipt')
    expect(scope.request.customerIds).toEqual([uuid(20)])
    expect(scope.request.vehicleIds).toEqual([uuid(30)])
    expect(scope.request.ticketIds).toEqual([uuid(50)])
    expect(scope.request.jobIds).toEqual([uuid(60), uuid(61)])
    expect(scope.request.insertionIntents.tickets).toEqual([])
    expect(scope.tickets[0].jobs).toHaveLength(2)
    expect(classes).toEqual(REPOSITORY_LOCK_CLASSES_V1)
  })

  it('keeps an unavailable absent conditional request write-free for retry policy', async () => {
    const scope = await lock(lockRequest({
      receiptRequestKey: uuid(204),
      receiptConditionalInsert: { kind: 'unavailable' },
    }))
    expect(scope.receiptPeek).toEqual({ kind: 'none' })
    expect(scope.receiptConditionalInsertState).toBe('unavailable')
    expect(scope.shop).toBeNull()
    expect(scope.tickets).toEqual([])
  })

  it('rejects conditional base leakage, invalid insertion parents, and existing-ID collisions', async () => {
    await expect(lock(lockRequest({
      customerIds: [uuid(20)],
      receiptRequestKey: uuid(205),
      receiptConditionalInsert: { kind: 'unavailable' },
    }))).rejects.toThrowError('invalid_mutation_lock_request')

    await expect(lock(lockRequest({
      receiptRequestKey: uuid(206),
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: lockExtension({
          lockShop: true,
          insertionIntents: {
            ...EMPTY_INTENTS,
            jobs: [{ id: uuid(216), ticketId: uuid(999) }],
          },
        }),
      },
    }))).rejects.toThrowError('invalid_mutation_lock_request')

    await expect(lock(lockRequest({
      receiptRequestKey: uuid(207),
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: lockExtension({
          lockShop: true,
          insertionIntents: { ...EMPTY_INTENTS, tickets: [uuid(50)] },
        }),
      },
    }))).rejects.toBeInstanceOf(ShopOsMutationConflict)
  })

  it('owns one bounded transaction and closes its exact capability before returning', async () => {
    queryLog.length = 0
    let callbackTx: AppDb | undefined
    let callbackScope: LockedMutationScopeV1 | undefined
    let callbackAttempt: MutationAttemptContextV1 | undefined
    const payload = Object.freeze({ marker: 'attempt-local' })

    const result = await runBoundedShopOsMutationV1(loggingDb, {
      discover: async (tx, attempt) => {
        callbackTx = tx
        callbackAttempt = attempt
        expect(() => assertLiveMutationAttemptV1(tx, attempt.capability)).not.toThrow()
        return { lockRequest: lockRequest(), payload }
      },
      executeLocked: async (tx, scope, discovery, attempt) => {
        callbackScope = scope
        expect(discovery).toBe(payload)
        expect(attempt).toBe(callbackAttempt)
        expect(assertLiveLockedMutationScopeV1(tx, scope)).toBe(attempt.capability)
        return 'committed'
      },
    })

    expect(result).toBe('committed')
    expect(MUTATION_LOCK_TIMEOUT_MS_V1).toBe(250)
    expect(MUTATION_STATEMENT_TIMEOUT_MS_V1).toBe(5_000)
    expect(MAX_MUTATION_ATTEMPTS_V1).toBe(2)
    expect(RECOVERABLE_UNIQUE_CONSTRAINTS_V1).toEqual([
      'ticket_mutation_receipts_shop_request_key_uq', 'sessions_pkey',
    ])
    expect(() => assertLiveMutationAttemptV1(callbackTx!, callbackAttempt!.capability)).toThrow()
    expect(() => assertLiveLockedMutationScopeV1(callbackTx!, callbackScope!)).toThrow()
    const statements = queryLog.map(({ sql }) => sql.replace(/\s+/g, ' ').trim().toLowerCase())
    const lockTimeoutIndex = statements.findIndex((statement) =>
      statement === "set local lock_timeout = '250ms'")
    const statementTimeoutIndex = statements.findIndex((statement) =>
      statement === "set local statement_timeout = '5000ms'")
    const discoveryQueryIndex = statements.findIndex((statement) =>
      statement.includes('from "profiles"'))
    expect(lockTimeoutIndex).toBeGreaterThanOrEqual(0)
    expect(statementTimeoutIndex).toBe(lockTimeoutIndex + 1)
    expect(discoveryQueryIndex).toBeGreaterThan(statementTimeoutIndex)
  })

  it('retries one exact conflict with fresh transaction, discovery, scope, and capability', async () => {
    const contexts: MutationAttemptContextV1[] = []
    const transactions: AppDb[] = []
    const scopes: LockedMutationScopeV1[] = []
    const payloads: Array<Readonly<{ ordinal: number }>> = []

    const result = await runBoundedShopOsMutationV1(loggingDb, {
      discover: async (tx, attempt) => {
        if (contexts[0]) {
          expect(() =>
            assertLiveMutationAttemptV1(transactions[0], contexts[0].capability),
          ).toThrow()
          expect(() => assertLiveLockedMutationScopeV1(transactions[0], scopes[0])).toThrow()
        }
        contexts.push(attempt)
        transactions.push(tx)
        const payload = Object.freeze({ ordinal: attempt.ordinal })
        payloads.push(payload)
        return { lockRequest: lockRequest(), payload }
      },
      executeLocked: async (tx, scope, payload, attempt) => {
        scopes.push(scope)
        expect(assertLiveLockedMutationScopeV1(tx, scope)).toBe(attempt.capability)
        expect(payload).toBe(payloads[payloads.length - 1])
        if (attempt.ordinal === 1) throw { cause: { code: '55P03' } }
        return 'retried'
      },
    })

    expect(result).toBe('retried')
    expect(contexts.map(({ ordinal, purpose }) => ({ ordinal, purpose }))).toEqual([
      { ordinal: 1, purpose: 'primary' },
      { ordinal: 2, purpose: 'primary' },
    ])
    expect(transactions[1]).not.toBe(transactions[0])
    expect(payloads[1]).not.toBe(payloads[0])
    expect(scopes[1]).not.toBe(scopes[0])
  })

  it('collapses exact retry exhaustion but propagates spoofed and nonretryable failures', async () => {
    let discoveries = 0
    await expect(runBoundedShopOsMutationV1(loggingDb, {
      discover: async () => {
        discoveries += 1
        return { lockRequest: lockRequest(), payload: undefined }
      },
      executeLocked: async () => {
        throw { code: discoveries === 1 ? '40001' : '40P01' }
      },
    })).rejects.toBeInstanceOf(ShopOsMutationConflict)
    expect(discoveries).toBe(2)

    for (const error of [
      { message: 'SQLSTATE 55P03 lock unavailable' },
      { code: '57014' },
      new Error('deadlock detected'),
    ]) {
      let attempts = 0
      await expect(runBoundedShopOsMutationV1(loggingDb, {
        discover: async () => {
          attempts += 1
          return { lockRequest: lockRequest(), payload: undefined }
        },
        executeLocked: async () => { throw error },
      })).rejects.toBe(error)
      expect(attempts).toBe(1)
    }
  })

  it('recovers only operation-allowlisted exact receipt and session constraints in one fresh attempt', async () => {
    for (const [constraint, field] of [
      ['ticket_mutation_receipts_shop_request_key_uq', 'constraint'],
      ['sessions_pkey', 'constraint_name'],
    ] as const) {
      const original = { code: '23505', [field]: constraint }
      const contexts: MutationAttemptContextV1[] = []
      const transactions: AppDb[] = []
      const payloads: Array<Readonly<{ nonce: number }>> = []
      let primaryExecutions = 0
      let recoveryExecutions = 0

      const operation: BoundedMutationOperationV1<string, Readonly<{ nonce: number }>> = {
        discover: async (tx, attempt) => {
          if (contexts[0]) {
            expect(() =>
              assertLiveMutationAttemptV1(transactions[0], contexts[0].capability),
            ).toThrow()
          }
          contexts.push(attempt)
          transactions.push(tx)
          const payload = Object.freeze({ nonce: contexts.length })
          payloads.push(payload)
          return { lockRequest: lockRequest(), payload }
        },
        executeLocked: async () => {
          primaryExecutions += 1
          throw original
        },
        uniqueCollisionRecovery: {
          allowedConstraints: [constraint],
          executeLocked: async (tx, scope, payload, attempt, recoveredConstraint) => {
            recoveryExecutions += 1
            expect(assertLiveLockedMutationScopeV1(tx, scope)).toBe(attempt.capability)
            expect(payload).toBe(payloads[1])
            expect(recoveredConstraint).toBe(constraint)
            return { kind: 'recovered', value: `recovered:${constraint}` }
          },
        },
      }

      expect(await runBoundedShopOsMutationV1(loggingDb, operation))
        .toBe(`recovered:${constraint}`)
      expect(primaryExecutions).toBe(1)
      expect(recoveryExecutions).toBe(1)
      expect(contexts.map(({ ordinal, purpose }) => ({ ordinal, purpose }))).toEqual([
        { ordinal: 1, purpose: 'primary' },
        { ordinal: 2, purpose: 'unique_collision_recovery' },
      ])
      expect(transactions[1]).not.toBe(transactions[0])
      expect(payloads[1]).not.toBe(payloads[0])
    }
  })

  it('rethrows the original unresolved or ineligible 23505 and never exceeds two attempts', async () => {
    const original = { code: '23505', constraint: 'sessions_pkey' }
    let discoveries = 0
    await expect(runBoundedShopOsMutationV1(loggingDb, {
      discover: async () => {
        discoveries += 1
        return { lockRequest: lockRequest(), payload: Object.freeze({ discoveries }) }
      },
      executeLocked: async () => { throw original },
      uniqueCollisionRecovery: {
        allowedConstraints: ['sessions_pkey'],
        executeLocked: async () => ({ kind: 'unresolved' }),
      },
    })).rejects.toBe(original)
    expect(discoveries).toBe(2)

    for (const error of [
      { code: '23505', constraint: 'sessions_pkey' },
      { code: '23505', constraint: 'some_other_constraint' },
      { message: '23505 sessions_pkey' },
      { code: '23505', constraint: { toString: () => 'sessions_pkey' } },
    ]) {
      let recoveryCalls = 0
      await expect(runBoundedShopOsMutationV1(loggingDb, {
        discover: async () => ({ lockRequest: lockRequest(), payload: undefined }),
        executeLocked: async () => { throw error },
        uniqueCollisionRecovery: {
          allowedConstraints: ['ticket_mutation_receipts_shop_request_key_uq'],
          executeLocked: async () => {
            recoveryCalls += 1
            return { kind: 'recovered', value: 'must-not-recover' }
          },
        },
      })).rejects.toBe(error)
      expect(recoveryCalls).toBe(0)
    }

    const secondAttemptCollision = { code: '23505', constraint: 'sessions_pkey' }
    let totalDiscoveries = 0
    let recoveryCalls = 0
    await expect(runBoundedShopOsMutationV1(loggingDb, {
      discover: async () => {
        totalDiscoveries += 1
        return { lockRequest: lockRequest(), payload: undefined }
      },
      executeLocked: async () => {
        if (totalDiscoveries === 1) throw { code: '55P03' }
        throw secondAttemptCollision
      },
      uniqueCollisionRecovery: {
        allowedConstraints: ['sessions_pkey'],
        executeLocked: async () => {
          recoveryCalls += 1
          return { kind: 'recovered', value: 'third-attempt' }
        },
      },
    })).rejects.toBe(secondAttemptCollision)
    expect(totalDiscoveries).toBe(2)
    expect(recoveryCalls).toBe(0)
  })

  it('closes attempt state before discovery, lock, and commit-time failures escape', async () => {
    const discoveryFailure = new Error('discovery_failed')
    let discoveryTx: AppDb | undefined
    let discoveryAttempt: MutationAttemptContextV1 | undefined
    await expect(runBoundedShopOsMutationV1(loggingDb, {
      discover: async (tx, attempt) => {
        discoveryTx = tx
        discoveryAttempt = attempt
        throw discoveryFailure
      },
      executeLocked: async () => 'unreachable',
    })).rejects.toBe(discoveryFailure)
    expect(() =>
      assertLiveMutationAttemptV1(discoveryTx!, discoveryAttempt!.capability),
    ).toThrow()

    let lockTx: AppDb | undefined
    let lockAttempt: MutationAttemptContextV1 | undefined
    await expect(runBoundedShopOsMutationV1(loggingDb, {
      discover: async (tx, attempt) => {
        lockTx = tx
        lockAttempt = attempt
        return { lockRequest: lockRequest({ customerIds: [uuid(22)] }), payload: undefined }
      },
      executeLocked: async () => 'unreachable',
    })).rejects.toBeInstanceOf(ShopOsMutationNotFound)
    expect(() => assertLiveMutationAttemptV1(lockTx!, lockAttempt!.capability)).toThrow()

    let commitTx: AppDb | undefined
    let commitAttempt: MutationAttemptContextV1 | undefined
    await expect(runBoundedShopOsMutationV1(loggingDb, {
      discover: async (tx, attempt) => {
        commitTx = tx
        commitAttempt = attempt
        return { lockRequest: lockRequest(), payload: undefined }
      },
      executeLocked: async (tx) => {
        await tx.insert(ticketMutationReceipts).values({
          id: uuid(350), shopId: uuid(1), requestKey: uuid(350),
          mutationSchemaVersion: 1, fingerprintKeyVersion: 1,
          mutationKind: 'create_repair_order', actorProfileId: uuid(10),
          targetTicketId: null, targetBindingFingerprint: 'c'.repeat(64),
          requestFingerprint: 'd'.repeat(64), resultTicketId: uuid(50), resultJobCount: 2,
        })
        return 'commit-will-fail'
      },
    })).rejects.toMatchObject({ code: '23514' })
    expect(() => assertLiveMutationAttemptV1(commitTx!, commitAttempt!.capability)).toThrow()
  })

  it('records PGlite queue order for the three deadlock probes without claiming row-lock proof', async () => {
    const fullGraph = lockRequest({
      profileIds: [uuid(10), uuid(11)], lockShop: true,
      customerIds: [uuid(20)], vehicleIds: [uuid(30)], ticketIds: [uuid(50)],
      jobIds: [uuid(60), uuid(61)], includeAllJobsForTickets: true,
      includeAllLinesForJobs: true, includeAllQuoteVersionsForTickets: true,
      includeAllQuoteEventsForTickets: true, sessionIds: [uuid(40)],
      sessionEventIds: [uuid(41)], vendorAccountIds: [uuid(100)],
      cannedJobIds: [uuid(110)],
    })
    const addJob = lockRequest({
      profileIds: [uuid(10), uuid(11)], customerIds: [uuid(20)],
      vehicleIds: [uuid(30)], ticketIds: [uuid(50)], jobIds: [uuid(60)],
      sessionIds: [uuid(40)],
    })
    const scenarios = [
      {
        name: 'profile A/B cross-assignment', pauseAfter: 'profiles' as const,
        first: lockRequest({ profileIds: [uuid(10), uuid(11)] }),
        second: lockRequest({
          actorProfileId: uuid(11), profileIds: [uuid(11), uuid(10)],
        }),
      },
      {
        name: 'assignment versus quote decision', pauseAfter: 'profiles' as const,
        first: fullGraph, second: fullGraph,
      },
      {
        name: 'add-job versus version creation', pauseAfter: 'tickets' as const,
        first: addJob,
        second: lockRequest({ ...addJob, includeAllQuoteVersionsForTickets: true }),
      },
    ]

    for (const scenario of scenarios) {
      let release!: () => void
      let reached!: () => void
      let secondDiscovered!: () => void
      let paused = false
      const gate = new Promise<void>((resolveGate) => { release = resolveGate })
      const reachedGate = new Promise<void>((resolveReached) => { reached = resolveReached })
      const secondDiscovery = new Promise<void>((resolveSecond) => {
        secondDiscovered = resolveSecond
      })
      const first = lock(scenario.first, async (name) => {
        if (!paused && name === scenario.pauseAfter) {
          paused = true
          reached()
          await gate
        }
      })
      await reachedGate
      const second = runBoundedShopOsMutationV1(loggingDb, {
        discover: async () => {
          secondDiscovered()
          return { lockRequest: scenario.second, payload: scenario.name }
        },
        executeLocked: async (_tx, _scope, payload) => payload,
      })
      const startedBeforeRelease = await Promise.race([
        secondDiscovery.then(() => true),
        new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), 10)),
      ])
      release()
      const [, result] = await Promise.all([first, second])
      expect(startedBeforeRelease, `${scenario.name} is queue evidence only`).toBe(false)
      expect(result).toBe(scenario.name)
    }
  })
})
