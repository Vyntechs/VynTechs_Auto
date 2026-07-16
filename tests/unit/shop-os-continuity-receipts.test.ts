import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import type { PGlite } from '@electric-sql/pglite'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  profiles,
  shops,
  ticketJobs,
  ticketMutationReceiptJobs,
  ticketMutationReceipts,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import * as schema from '@/lib/db/schema'
import {
  closeMutationAttemptCapabilityV1,
  createMutationAttemptCapabilityV1,
} from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import type { MutationAttemptCapabilityV1 } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import type {
  CanonicalMutationEnvelopeV1,
  MutationFingerprintKeyringV1,
  TicketMutationKind,
} from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { ShopOsMutationNotFound } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { createMutationFingerprintKeyringV1 } from '@/lib/shop-os/continuity/mutation-foundation/keyring'
import {
  createCanonicalMutationFingerprintV1,
  createCanonicalTargetBindingFingerprintV1,
} from '@/lib/shop-os/continuity/mutation-foundation/canonical'
import { ShopOsMutationConflict } from '@/lib/shop-os/continuity/mutation-foundation/conflicts'
import {
  lockMutationScopeV1,
  type LockedMutationScopeV1,
  type MutationLockRequestV1,
} from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import { finalizeMutationRevisionsV1 } from '@/lib/shop-os/continuity/mutation-foundation/revisions'
import * as receiptModule from '@/lib/shop-os/continuity/mutation-foundation/receipts'
import { runBoundedShopOsMutationV1 } from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const repoRoot = process.cwd()
const receiptModulePath = resolve(
  repoRoot,
  'lib/shop-os/continuity/mutation-foundation/receipts.ts',
)
const migrationPath = resolve(
  repoRoot,
  'drizzle/migrations/0037_shop_os_continuity_foundation.sql',
)

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

function requiredReceiptFunction<T>(name: string): T {
  const value = (receiptModule as Readonly<Record<string, unknown>>)[name]
  expect(typeof value, `missing receipt export: ${name}`).toBe('function')
  return value as T
}

type ReceiptExpectation = Readonly<{
  requestKey: string
  mutationKind: TicketMutationKind
  mutationSchemaVersion: 1
  targetTicketId: string | null
  envelope: CanonicalMutationEnvelopeV1
}>

type ReceiptIdentity = Readonly<{ ticketId: string; jobIds: readonly string[] }>

const EMPTY_INTENTS = Object.freeze({
  sessions: Object.freeze([]),
  customers: Object.freeze([]),
  vehicles: Object.freeze([]),
  tickets: Object.freeze([]),
  jobs: Object.freeze([]),
})

function baseLockRequest(
  requestKey: string,
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
    receiptRequestKey: requestKey,
    receiptConditionalInsert: null,
    insertionIntents: EMPTY_INTENTS,
    ...overrides,
  }
}

function testKeyring(
  activeVersion = 1,
  versions: readonly number[] = [1],
): MutationFingerprintKeyringV1 {
  return createMutationFingerprintKeyringV1({
    SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: String(activeVersion),
    SHOP_OS_MUTATION_HMAC_KEYS_B64: versions
      .map((version) => `${version}:${Buffer.alloc(32, version).toString('base64')}`)
      .join(';'),
  })
}

function createExpectation(
  requestKey: string,
  overrides: Partial<ReceiptExpectation> = {},
): ReceiptExpectation {
  const mutationKind = overrides.mutationKind ?? 'create_repair_order'
  const envelope: CanonicalMutationEnvelopeV1 = {
    schemaVersion: 1,
    mutationKind,
    operationOrigin: 'quick_quote',
    actorProfileId: uuid(999),
    target: { mode: 'quick_create' },
    candidates: [],
    payload: { concern: 'Brake noise' },
    ...overrides.envelope,
  }
  return {
    requestKey,
    mutationKind,
    mutationSchemaVersion: 1,
    targetTicketId: null,
    envelope,
    ...overrides,
  }
}

describe('Shop OS immutable mutation receipts', () => {
  it('declares the receipt module and immutable receipt migration contracts', () => {
    expect(
      existsSync(receiptModulePath),
      'missing lib/shop-os/continuity/mutation-foundation/receipts.ts',
    ).toBe(true)

    const migration = readFileSync(migrationPath, 'utf8')
    for (const declaration of [
      'create table public.ticket_mutation_receipts',
      'create table public.ticket_mutation_receipt_jobs',
      'ticket_mutation_receipts_shop_request_key_uq',
      'ticket_mutation_receipts_immutable_write',
      'ticket_mutation_receipt_jobs_immutable_write',
      'ticket_mutation_receipts_complete_deferred',
      'ticket_mutation_receipt_jobs_complete_deferred',
    ]) {
      expect(migration, `missing migration declaration: ${declaration}`).toContain(declaration)
    }
  })

  it('exports only the safe receipt surface from the general barrel', () => {
    const barrel = readFileSync(resolve(
      repoRoot,
      'lib/shop-os/continuity/mutation-foundation/index.ts',
    ), 'utf8')
    expect(barrel).toContain('MutationReceiptExpectationV1')
    expect(barrel).toContain('lockAndClassifyMutationReceiptV1')
    expect(barrel).toContain('isExactReceiptRequestKeyViolation')
    expect(barrel).not.toContain('insertMutationReceiptPrimitiveV1')
    expect(barrel).not.toContain('peekMutationReceiptV1')
    expect(barrel).not.toContain('hintMutationReceiptPresenceV1')
  })

  it('recognizes only structured exact request-key unique violations', () => {
    const isExactViolation = requiredReceiptFunction<(error: unknown) => boolean>(
      'isExactReceiptRequestKeyViolation',
    )
    for (const error of [
      {
        code: '23505',
        constraint: 'ticket_mutation_receipts_shop_request_key_uq',
      },
      {
        cause: {
          cause: {
            code: '23505',
            constraint_name: 'ticket_mutation_receipts_shop_request_key_uq',
          },
        },
      },
    ]) expect(isExactViolation(error)).toBe(true)

    const cyclic: { cause?: unknown } = {}
    cyclic.cause = cyclic
    for (const error of [
      { code: '23505', constraint: 'some_other_constraint' },
      {
        code: '23505',
        constraint: 'ticket_mutation_receipts_shop_request_key_uq',
        constraint_name: 'some_other_constraint',
      },
      { code: '23505', message: 'ticket_mutation_receipts_shop_request_key_uq' },
      { message: '23505 ticket_mutation_receipts_shop_request_key_uq' },
      { code: '23505', constraint: { toString: () => 'ticket_mutation_receipts_shop_request_key_uq' } },
      cyclic,
      null,
    ]) expect(isExactViolation(error)).toBe(false)
  })
})

describe('Shop OS mutation receipt presence hint', () => {
  let db: TestDb
  let loggingDb: TestDb
  let client: PGlite
  let close: () => Promise<void>
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
    await db.insert(shops).values({ id: uuid(1), name: 'North Shop' })
    await db.insert(profiles).values([
      {
        id: uuid(10),
        userId: uuid(1010),
        shopId: uuid(1),
        role: 'owner',
        skillTier: null,
      },
      {
        id: uuid(11),
        userId: uuid(1011),
        shopId: uuid(1),
        role: 'advisor',
        skillTier: null,
      },
    ])
    await db.insert(customers).values({
      id: uuid(20),
      shopId: uuid(1),
      name: 'Alex',
      phone: '555-0100',
    })
    await db.insert(vehicles).values({
      id: uuid(30),
      customerId: uuid(20),
      year: 2020,
      make: 'Ford',
      model: 'F-150',
    })
    await db.insert(tickets).values({
      id: uuid(50),
      shopId: uuid(1),
      ticketNumber: 50,
      source: 'quick_quote',
      customerId: uuid(20),
      vehicleId: uuid(30),
      concern: 'Quick concern',
      createdByProfileId: uuid(10),
    })
    await db.transaction(async (tx) => {
      await tx.insert(ticketMutationReceipts).values({
        id: uuid(300),
        shopId: uuid(1),
        requestKey: uuid(200),
        mutationSchemaVersion: 1,
        fingerprintKeyVersion: 1,
        mutationKind: 'create_repair_order',
        actorProfileId: uuid(10),
        targetTicketId: null,
        targetBindingFingerprint: 'a'.repeat(64),
        requestFingerprint: 'b'.repeat(64),
        resultTicketId: uuid(50),
        resultJobCount: 0,
      })
    })
  })

  afterAll(async () => close())

  it('returns only presence from one normalized SELECT 1 query', async () => {
    const hint = requiredReceiptFunction<(
      tx: AppDb,
      attempt: MutationAttemptCapabilityV1,
      input: Readonly<{ shopId: string; requestKey: string }>,
    ) => Promise<'present' | 'absent'>>('hintMutationReceiptPresenceV1')

    queryLog.length = 0
    const values = await loggingDb.transaction(async (rawTx) => {
      const tx = rawTx as AppDb
      const attempt = createMutationAttemptCapabilityV1(tx, {
        ordinal: 1,
        purpose: 'primary',
      })
      try {
        return await Promise.all([
          hint(tx, attempt.capability, {
            shopId: uuid(1).toUpperCase(),
            requestKey: uuid(200).toUpperCase(),
          }),
          hint(tx, attempt.capability, { shopId: uuid(1), requestKey: uuid(201) }),
        ])
      } finally {
        closeMutationAttemptCapabilityV1(attempt.capability)
      }
    })

    expect(values).toEqual(['present', 'absent'])
    const selects = queryLog
      .map(({ sql }) => sql.replace(/\s+/g, ' ').trim().toLowerCase())
      .filter((statement) => statement.startsWith('select'))
    expect(selects).toHaveLength(2)
    for (const statement of selects) {
      expect(statement).toMatch(/^select 1 from "ticket_mutation_receipts"/)
      expect(statement).not.toMatch(/actor_profile_id|result_ticket_id|request_fingerprint|\"id\"/)
    }
  })

  it('rejects invalid or stale attempt bindings before querying', async () => {
    const hint = requiredReceiptFunction<(
      tx: AppDb,
      attempt: MutationAttemptCapabilityV1,
      input: Readonly<{ shopId: string; requestKey: string }>,
    ) => Promise<'present' | 'absent'>>('hintMutationReceiptPresenceV1')

    await db.transaction(async (rawTx) => {
      const tx = rawTx as AppDb
      const attempt = createMutationAttemptCapabilityV1(tx, {
        ordinal: 1,
        purpose: 'primary',
      })
      closeMutationAttemptCapabilityV1(attempt.capability)
      queryLog.length = 0
      await expect(hint(tx, attempt.capability, {
        shopId: uuid(1),
        requestKey: uuid(200),
      })).rejects.toThrowError('mutation_attempt_capability_closed')
      expect(queryLog).toEqual([])
    })
  })
})

describe('Shop OS immutable receipt insertion and replay', () => {
  let db: TestDb
  let loggingDb: TestDb
  let close: () => Promise<void>
  let queryLog: string[]

  beforeAll(async () => {
    const created = await createTestDb()
    ;({ db, close } = created)
    queryLog = []
    loggingDb = drizzle(created.client, {
      schema,
      logger: { logQuery: (query) => queryLog.push(query) },
    })
    await db.insert(shops).values([
      { id: uuid(1), name: 'North Shop' },
      { id: uuid(2), name: 'South Shop' },
    ])
    await db.insert(profiles).values([
      {
        id: uuid(10),
        userId: uuid(1010),
        shopId: uuid(1),
        role: 'owner',
        skillTier: null,
      },
      {
        id: uuid(11),
        userId: uuid(1011),
        shopId: uuid(1),
        role: 'advisor',
        skillTier: null,
      },
      {
        id: uuid(12),
        userId: uuid(1012),
        shopId: uuid(1),
        role: 'owner',
        skillTier: null,
        deactivatedAt: new Date(),
      },
      {
        id: uuid(20),
        userId: uuid(1020),
        shopId: uuid(2),
        role: 'owner',
        skillTier: null,
      },
    ])
    await db.insert(customers).values([
      { id: uuid(20), shopId: uuid(1), name: 'Alex', phone: '555-0100' },
      { id: uuid(40), shopId: uuid(2), name: 'Sam', phone: '555-0200' },
    ])
    await db.insert(vehicles).values([
      {
        id: uuid(30), customerId: uuid(20), year: 2020,
        make: 'Ford', model: 'F-150',
      },
      {
        id: uuid(50), customerId: uuid(40), year: 2021,
        make: 'Honda', model: 'Civic',
      },
    ])
  })

  afterAll(async () => close())

  async function withScope<T>(
    request: MutationLockRequestV1,
    run: (tx: AppDb, scope: LockedMutationScopeV1) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (rawTx) => {
      const tx = rawTx as AppDb
      const attempt = createMutationAttemptCapabilityV1(tx, {
        ordinal: 1,
        purpose: 'primary',
      })
      try {
        const scope = await lockMutationScopeV1(tx, attempt.capability, request)
        return await run(tx, scope)
      } finally {
        closeMutationAttemptCapabilityV1(attempt.capability)
      }
    })
  }

  async function insertCreationReceipt(input: Readonly<{
    requestKey: string
    resultTicketId: string
    ticketNumber: number
    resultJobIds?: readonly string[]
    expectation?: ReceiptExpectation
    keyring?: MutationFingerprintKeyringV1
    source?: 'counter' | 'quick_quote' | 'tech_quick'
  }>): Promise<ReceiptIdentity> {
    const insertReceipt = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      value: ReceiptExpectation & Readonly<{
        keyring: MutationFingerprintKeyringV1
        resultTicketId: string
        resultJobIds: readonly string[]
      }>,
    ) => Promise<ReceiptIdentity>>('insertMutationReceiptPrimitiveV1')
    const resultJobIds = input.resultJobIds ?? []
    const expectation = input.expectation ?? createExpectation(input.requestKey)
    const insertionIntents = Object.freeze({
      ...EMPTY_INTENTS,
      tickets: Object.freeze([input.resultTicketId]),
      jobs: Object.freeze(resultJobIds.map((id) => Object.freeze({
        id,
        ticketId: input.resultTicketId,
      }))),
    })
    return withScope(baseLockRequest(input.requestKey, {
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: {
          lockShop: true,
          customerIds: [uuid(20)],
          vehicleIds: [uuid(30)],
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
          insertionIntents,
        },
      },
    }), async (tx, scope) => {
      await tx.insert(tickets).values({
        id: input.resultTicketId,
        shopId: uuid(1),
        ticketNumber: input.ticketNumber,
        source: input.source ?? 'quick_quote',
        customerId: uuid(20),
        vehicleId: uuid(30),
        concern: 'Brake noise',
        createdByProfileId: uuid(10),
      })
      if (resultJobIds.length > 0) {
        await tx.insert(ticketJobs).values(resultJobIds.map((id, index) => ({
          id,
          shopId: uuid(1),
          ticketId: input.resultTicketId,
          title: `Created work ${index}`,
          kind: 'repair' as const,
          requiredSkillTier: 1 as const,
          createdByProfileId: uuid(10),
          creatorProvenance: 'direct' as const,
        })))
      }
      return insertReceipt(tx, scope, {
        ...expectation,
        keyring: input.keyring ?? testKeyring(),
        resultTicketId: input.resultTicketId,
        resultJobIds,
      })
    })
  }

  async function classifyReceipt(
    requestKey: string,
    expectation: ReceiptExpectation,
    keyring: MutationFingerprintKeyringV1,
    requestOverrides: Partial<MutationLockRequestV1> = {},
  ): Promise<Readonly<{
    kind: 'missing' | 'conflict' | 'verification_unavailable' | 'replay'
    ticketId?: string
    jobIds?: readonly string[]
  }>> {
    const classify = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      expected: ReceiptExpectation,
      ring: MutationFingerprintKeyringV1,
    ) => Promise<Readonly<{
      kind: 'missing' | 'conflict' | 'verification_unavailable' | 'replay'
      ticketId?: string
      jobIds?: readonly string[]
    }>>>('lockAndClassifyMutationReceiptV1')
    return withScope(baseLockRequest(requestKey, {
      receiptConditionalInsert: { kind: 'unavailable' },
      ...requestOverrides,
    }), (tx, scope) => classify(tx, scope, expectation, keyring))
  }

  function preparedCreationRequest(
    requestKey: string,
    resultTicketId: string,
  ): MutationLockRequestV1 {
    return baseLockRequest(requestKey, {
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: {
          lockShop: true,
          customerIds: [uuid(20)],
          vehicleIds: [uuid(30)],
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
          insertionIntents: Object.freeze({
            ...EMPTY_INTENTS,
            tickets: Object.freeze([resultTicketId]),
          }),
        },
      },
    })
  }

  async function runReceiptCreation(input: Readonly<{
    requestKey: string
    resultTicketId: string
    ticketNumber: number
    expectation: ReceiptExpectation
    hintOverride?: (actual: 'present' | 'absent', call: number) => 'present' | 'absent'
  }>): Promise<ReceiptIdentity> {
    const hint = requiredReceiptFunction<(
      tx: AppDb,
      attempt: MutationAttemptCapabilityV1,
      value: Readonly<{ shopId: string; requestKey: string }>,
    ) => Promise<'present' | 'absent'>>('hintMutationReceiptPresenceV1')
    const classify = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      expected: ReceiptExpectation,
      keyring: MutationFingerprintKeyringV1,
    ) => Promise<Readonly<{
      kind: 'missing' | 'conflict' | 'verification_unavailable' | 'replay'
      ticketId?: string
      jobIds?: readonly string[]
    }>>>('lockAndClassifyMutationReceiptV1')
    const insertReceipt = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      value: ReceiptExpectation & Readonly<{
        keyring: MutationFingerprintKeyringV1
        resultTicketId: string
        resultJobIds: readonly string[]
      }>,
    ) => Promise<ReceiptIdentity>>('insertMutationReceiptPrimitiveV1')
    const keyring = testKeyring()
    let hintCalls = 0

    return runBoundedShopOsMutationV1<
      ReceiptIdentity,
      Readonly<{
        expectation: ReceiptExpectation
        resultTicketId: string
        ticketNumber: number
      }>
    >(db, {
      discover: async (tx, attempt) => {
        const actual = await hint(tx, attempt.capability, {
          shopId: uuid(1),
          requestKey: input.requestKey,
        })
        hintCalls += 1
        const observed = input.hintOverride?.(actual, hintCalls) ?? actual
        return {
          lockRequest: observed === 'absent'
            ? preparedCreationRequest(input.requestKey, input.resultTicketId)
            : baseLockRequest(input.requestKey, {
              receiptConditionalInsert: { kind: 'unavailable' },
            }),
          payload: Object.freeze({
            expectation: input.expectation,
            resultTicketId: input.resultTicketId,
            ticketNumber: input.ticketNumber,
          }),
        }
      },
      executeLocked: async (tx, scope, payload) => {
        const classification = await classify(tx, scope, payload.expectation, keyring)
        if (classification.kind === 'replay') {
          return Object.freeze({
            ticketId: classification.ticketId!,
            jobIds: Object.freeze([...(classification.jobIds ?? [])]),
          })
        }
        if (
          classification.kind !== 'missing' ||
          scope.receiptConditionalInsertState !== 'activated'
        ) throw new ShopOsMutationConflict()
        await tx.insert(tickets).values({
          id: payload.resultTicketId,
          shopId: uuid(1),
          ticketNumber: payload.ticketNumber,
          source: payload.expectation.envelope.operationOrigin as 'counter' | 'quick_quote' | 'tech_quick',
          customerId: uuid(20),
          vehicleId: uuid(30),
          concern: 'Brake noise',
          createdByProfileId: uuid(10),
        })
        return insertReceipt(tx, scope, {
          ...payload.expectation,
          keyring,
          resultTicketId: payload.resultTicketId,
          resultJobIds: [],
        })
      },
      uniqueCollisionRecovery: {
        allowedConstraints: ['ticket_mutation_receipts_shop_request_key_uq'],
        executeLocked: async (tx, scope, payload, _attempt, constraint) => {
          expect(constraint).toBe('ticket_mutation_receipts_shop_request_key_uq')
          const classification = await classify(tx, scope, payload.expectation, keyring)
          return classification.kind === 'replay'
            ? {
              kind: 'recovered' as const,
              value: Object.freeze({
                ticketId: classification.ticketId!,
                jobIds: Object.freeze([...(classification.jobIds ?? [])]),
              }),
            }
            : { kind: 'unresolved' as const }
        },
      },
    })
  }

  it('inserts and exactly replays immutable ordered identities with 0, 1, 2, 24, and 25 jobs', async () => {
    const insertReceipt = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      input: ReceiptExpectation & Readonly<{
        keyring: MutationFingerprintKeyringV1
        resultTicketId: string
        resultJobIds: readonly string[]
      }>,
    ) => Promise<ReceiptIdentity>>('insertMutationReceiptPrimitiveV1')
    const classifyReceipt = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      expected: ReceiptExpectation,
      keyring: MutationFingerprintKeyringV1,
    ) => Promise<
      | Readonly<{ kind: 'missing' }>
      | Readonly<{ kind: 'replay'; ticketId: string; jobIds: readonly string[] }>
      | Readonly<{ kind: 'conflict' }>
      | Readonly<{ kind: 'verification_unavailable' }>
    >>('lockAndClassifyMutationReceiptV1')
    const keyring = testKeyring()

    for (const [caseIndex, jobCount] of [0, 1, 2, 24, 25].entries()) {
      const requestKey = uuid(400 + caseIndex)
      const resultTicketId = uuid(500 + caseIndex)
      const resultJobIds = Array.from(
        { length: jobCount },
        (_, index) => uuid(600 + caseIndex * 100 + index),
      )
      const expectation = createExpectation(requestKey)
      const insertionIntents = Object.freeze({
        ...EMPTY_INTENTS,
        tickets: Object.freeze([resultTicketId]),
        jobs: Object.freeze(resultJobIds.map((id) => Object.freeze({
          id,
          ticketId: resultTicketId,
        }))),
      })
      const insertRequest = baseLockRequest(requestKey, {
        receiptConditionalInsert: {
          kind: 'prepared',
          extension: {
            lockShop: true,
            customerIds: [uuid(20)],
            vehicleIds: [uuid(30)],
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
            insertionIntents,
          },
        },
      })

      const inserted = await withScope(insertRequest, async (tx, scope) => {
        await tx.insert(tickets).values({
          id: resultTicketId,
          shopId: uuid(1),
          ticketNumber: 500 + caseIndex,
          source: 'quick_quote',
          customerId: uuid(20),
          vehicleId: uuid(30),
          concern: 'Brake noise',
          createdByProfileId: uuid(10),
        })
        if (resultJobIds.length > 0) {
          await tx.insert(ticketJobs).values(resultJobIds.map((id, index) => ({
            id,
            shopId: uuid(1),
            ticketId: resultTicketId,
            title: `Work ${index}`,
            kind: 'repair' as const,
            requiredSkillTier: 1 as const,
            createdByProfileId: uuid(10),
            creatorProvenance: 'direct' as const,
          })))
        }
        return insertReceipt(tx, scope, {
          ...expectation,
          keyring,
          resultTicketId,
          resultJobIds,
        })
      })

      expect(inserted).toEqual({ ticketId: resultTicketId, jobIds: resultJobIds })
      expect(Object.keys(inserted)).toEqual(['ticketId', 'jobIds'])
      expect(Object.isFrozen(inserted)).toBe(true)
      expect(Object.isFrozen(inserted.jobIds)).toBe(true)

      const replay = await withScope(
        baseLockRequest(requestKey, {
          receiptConditionalInsert: { kind: 'unavailable' },
        }),
        (tx, scope) => classifyReceipt(tx, scope, expectation, keyring),
      )
      expect(replay).toEqual({ kind: 'replay', ticketId: resultTicketId, jobIds: resultJobIds })
      if (replay.kind === 'replay') {
        expect(Object.keys(replay)).toEqual(['kind', 'ticketId', 'jobIds'])
        expect(Object.isFrozen(replay)).toBe(true)
        expect(Object.isFrozen(replay.jobIds)).toBe(true)
      }

      const [persisted] = await db.select().from(ticketMutationReceipts)
        .where(eq(ticketMutationReceipts.requestKey, requestKey))
      expect(persisted).toMatchObject({
        shopId: uuid(1),
        actorProfileId: uuid(10),
        requestKey,
        mutationKind: 'create_repair_order',
        resultTicketId,
        resultJobCount: jobCount,
      })
      const persistedJobs = await db.select().from(ticketMutationReceiptJobs)
        .where(eq(ticketMutationReceiptJobs.receiptId, persisted!.id))
        .orderBy(ticketMutationReceiptJobs.ordinal)
      expect(persistedJobs.map(({ ordinal, jobId }) => ({ ordinal, jobId }))).toEqual(
        resultJobIds.map((jobId, ordinal) => ({ ordinal, jobId })),
      )
    }
  })

  it('owns canonical target and payload snapshots before the first database await', async () => {
    const insertReceipt = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      input: ReceiptExpectation & Readonly<{
        keyring: MutationFingerprintKeyringV1
        resultTicketId: string
        resultJobIds: readonly string[]
      }>,
    ) => Promise<ReceiptIdentity>>('insertMutationReceiptPrimitiveV1')
    const classifyReceipt = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      expected: ReceiptExpectation,
      keyring: MutationFingerprintKeyringV1,
    ) => Promise<Readonly<{
      kind: 'missing' | 'conflict' | 'verification_unavailable' | 'replay'
      ticketId?: string
      jobIds?: readonly string[]
    }>>>('lockAndClassifyMutationReceiptV1')
    const requestKey = uuid(450)
    const resultTicketId = uuid(550)
    const mutableTarget = { mode: 'quick_create' }
    const mutablePayload = { concern: 'Brake noise' }
    const baseline = createExpectation(requestKey)
    const mutableExpectation = createExpectation(requestKey, {
      envelope: {
        ...baseline.envelope,
        target: mutableTarget,
        payload: mutablePayload,
      },
    })
    const insertionIntents = Object.freeze({
      ...EMPTY_INTENTS,
      tickets: Object.freeze([resultTicketId]),
    })
    const insertRequest = baseLockRequest(requestKey, {
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: {
          lockShop: true,
          customerIds: [uuid(20)],
          vehicleIds: [uuid(30)],
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
          insertionIntents,
        },
      },
    })
    const keyring = testKeyring()

    await withScope(insertRequest, async (tx, scope) => {
      await tx.insert(tickets).values({
        id: resultTicketId,
        shopId: uuid(1),
        ticketNumber: 550,
        source: 'quick_quote',
        customerId: uuid(20),
        vehicleId: uuid(30),
        concern: 'Brake noise',
        createdByProfileId: uuid(10),
      })
      const inserting = insertReceipt(tx, scope, {
        ...mutableExpectation,
        keyring,
        resultTicketId,
        resultJobIds: [],
      })
      mutableTarget.mode = 'tampered-after-call'
      mutablePayload.concern = 'tampered-after-call'
      await inserting
    })

    const replay = await withScope(
      baseLockRequest(requestKey, {
        receiptConditionalInsert: { kind: 'unavailable' },
      }),
      (tx, scope) => classifyReceipt(tx, scope, baseline, keyring),
    )
    expect(replay).toEqual({ kind: 'replay', ticketId: resultTicketId, jobIds: [] })
  })

  it('owns the caller-supplied keyring before the first database await', async () => {
    const insertReceipt = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      input: ReceiptExpectation & Readonly<{
        keyring: MutationFingerprintKeyringV1
        resultTicketId: string
        resultJobIds: readonly string[]
      }>,
    ) => Promise<ReceiptIdentity>>('insertMutationReceiptPrimitiveV1')
    const requestKey = uuid(451)
    const resultTicketId = uuid(551)
    const expectation = createExpectation(requestKey)
    const v1Keyring = testKeyring(1, [1])
    const v2Keyring = testKeyring(2, [2])
    const retainedV1Keyring = testKeyring(2, [1, 2])
    const mutableInput: ReceiptExpectation & {
      keyring: MutationFingerprintKeyringV1
      resultTicketId: string
      resultJobIds: readonly string[]
    } = {
      ...expectation,
      keyring: v1Keyring,
      resultTicketId,
      resultJobIds: [],
    }

    await withScope(preparedCreationRequest(requestKey, resultTicketId), async (tx, scope) => {
      await tx.insert(tickets).values({
        id: resultTicketId,
        shopId: uuid(1),
        ticketNumber: 551,
        source: 'quick_quote',
        customerId: uuid(20),
        vehicleId: uuid(30),
        concern: 'Brake noise',
        createdByProfileId: uuid(10),
      })
      const inserting = insertReceipt(tx, scope, mutableInput)
      mutableInput.keyring = v2Keyring
      await inserting
    })

    const [persisted] = await db.select().from(ticketMutationReceipts).where(eq(
      ticketMutationReceipts.requestKey,
      requestKey,
    ))
    expect(persisted?.fingerprintKeyVersion).toBe(1)
    expect(await classifyReceipt(requestKey, expectation, retainedV1Keyring)).toEqual({
      kind: 'replay',
      ticketId: resultTicketId,
      jobIds: [],
    })
  })

  it('permits a zero-result receipt on a ticket that already has unrelated jobs', async () => {
    const insertReceipt = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      input: ReceiptExpectation & Readonly<{
        keyring: MutationFingerprintKeyringV1
        resultTicketId: string
        resultJobIds: readonly string[]
      }>,
    ) => Promise<ReceiptIdentity>>('insertMutationReceiptPrimitiveV1')
    const resultTicketId = uuid(560)
    const unrelatedJobId = uuid(660)
    const requestKey = uuid(460)
    await db.insert(tickets).values({
      id: resultTicketId,
      shopId: uuid(1),
      ticketNumber: 560,
      source: 'counter',
      customerId: uuid(20),
      vehicleId: uuid(30),
      concern: 'Existing concern',
      createdByProfileId: uuid(10),
    })
    await db.insert(ticketJobs).values({
      id: unrelatedJobId,
      shopId: uuid(1),
      ticketId: resultTicketId,
      title: 'Existing work',
      kind: 'repair',
      requiredSkillTier: 1,
      createdByProfileId: uuid(10),
      creatorProvenance: 'direct',
    })
    const expectation: ReceiptExpectation = {
      requestKey,
      mutationKind: 'append_work_items',
      mutationSchemaVersion: 1,
      targetTicketId: resultTicketId,
      envelope: {
        schemaVersion: 1,
        mutationKind: 'append_work_items',
        operationOrigin: null,
        actorProfileId: uuid(999),
        target: { ticketId: resultTicketId },
        candidates: [{
          ticketId: resultTicketId,
          continuityRevision: '0' as never,
        }],
        payload: { note: 'No child result' },
      },
    }

    const inserted = await withScope(baseLockRequest(requestKey, {
      customerIds: [uuid(20)],
      vehicleIds: [uuid(30)],
      ticketIds: [resultTicketId],
      jobIds: [unrelatedJobId],
      includeAllJobsForTickets: true,
    }), (tx, scope) => insertReceipt(tx, scope, {
      ...expectation,
      keyring: testKeyring(),
      resultTicketId,
      resultJobIds: [],
    }))

    expect(inserted).toEqual({ ticketId: resultTicketId, jobIds: [] })
  })

  it('conflicts on a corrupted target digest even when replay uses a retained historical key', async () => {
    const classifyReceipt = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      expected: ReceiptExpectation,
      keyring: MutationFingerprintKeyringV1,
    ) => Promise<Readonly<{ kind: string }>>>(
      'lockAndClassifyMutationReceiptV1',
    )
    const requestKey = uuid(470)
    const resultTicketId = uuid(570)
    const expectation = createExpectation(requestKey)
    const v1Keyring = testKeyring()
    const fingerprint = createCanonicalMutationFingerprintV1({
      ...expectation.envelope,
      actorProfileId: uuid(10),
    }, v1Keyring)
    await db.insert(tickets).values({
      id: resultTicketId,
      shopId: uuid(1),
      ticketNumber: 570,
      source: 'quick_quote',
      customerId: uuid(20),
      vehicleId: uuid(30),
      concern: 'Brake noise',
      createdByProfileId: uuid(10),
    })
    await db.transaction(async (tx) => {
      await tx.insert(ticketMutationReceipts).values({
        id: uuid(370),
        shopId: uuid(1),
        requestKey,
        mutationSchemaVersion: 1,
        fingerprintKeyVersion: fingerprint.keyVersion,
        mutationKind: expectation.mutationKind,
        actorProfileId: uuid(10),
        targetTicketId: null,
        targetBindingFingerprint: '0'.repeat(64),
        requestFingerprint: fingerprint.digest,
        resultTicketId,
        resultJobCount: 0,
      })
    })

    const result = await withScope(
      baseLockRequest(requestKey, {
        receiptConditionalInsert: { kind: 'unavailable' },
      }),
      (tx, scope) => classifyReceipt(tx, scope, expectation, testKeyring(2, [1, 2])),
    )
    expect(result).toEqual({ kind: 'conflict' })
  })

  it('replays retained history and privacy-conflicts every changed semantic field', async () => {
    const requestKey = uuid(480)
    const resultTicketId = uuid(580)
    const expectation = createExpectation(requestKey)
    await insertCreationReceipt({
      requestKey,
      resultTicketId,
      ticketNumber: 580,
      expectation,
      keyring: testKeyring(),
    })
    const retainedHistory = testKeyring(2, [1, 2])

    expect(await classifyReceipt(requestKey, expectation, retainedHistory)).toEqual({
      kind: 'replay',
      ticketId: resultTicketId,
      jobIds: [],
    })
    expect(await classifyReceipt(requestKey, expectation, testKeyring(2, [2]))).toEqual({
      kind: 'verification_unavailable',
    })
    expect(await classifyReceipt(
      requestKey,
      expectation,
      Object.freeze(Object.create(null)) as MutationFingerprintKeyringV1,
    )).toEqual({ kind: 'conflict' })

    const changed: ReceiptExpectation[] = [
      createExpectation(requestKey, {
        envelope: { ...expectation.envelope, payload: { concern: 'Changed' } },
      }),
      createExpectation(requestKey, {
        envelope: { ...expectation.envelope, operationOrigin: 'counter' },
      }),
      createExpectation(requestKey, {
        mutationKind: 'create_separate_repair_order',
        envelope: {
          ...expectation.envelope,
          mutationKind: 'create_separate_repair_order',
        },
      }),
      createExpectation(requestKey, {
        envelope: { ...expectation.envelope, target: { mode: 'changed' } },
      }),
      createExpectation(requestKey, {
        envelope: {
          ...expectation.envelope,
          candidates: [{
            ticketId: resultTicketId,
            continuityRevision: '0' as never,
          }],
        },
      }),
    ]
    for (const candidate of changed) {
      const result = await classifyReceipt(requestKey, candidate, retainedHistory)
      expect(result).toEqual({ kind: 'conflict' })
      expect(JSON.stringify(result)).not.toContain(resultTicketId)
    }

    const otherActor = await classifyReceipt(
      requestKey,
      expectation,
      retainedHistory,
      { actorProfileId: uuid(11), profileIds: [uuid(11)] },
    )
    expect(otherActor).toEqual({ kind: 'conflict' })
    expect(JSON.stringify(otherActor)).not.toContain(resultTicketId)

    const missingKey = uuid(481)
    expect(await classifyReceipt(
      missingKey,
      createExpectation(missingKey),
      retainedHistory,
    )).toEqual({ kind: 'missing' })
  })

  it('keeps constant business content origin-bound across counter, Quick, and Tech Quick', async () => {
    const origins = ['counter', 'quick_quote', 'tech_quick'] as const
    for (const [index, origin] of origins.entries()) {
      const requestKey = uuid(490 + index)
      const resultTicketId = uuid(590 + index)
      const baseline = createExpectation(requestKey)
      const expectation = createExpectation(requestKey, {
        envelope: { ...baseline.envelope, operationOrigin: origin },
      })
      await insertCreationReceipt({
        requestKey,
        resultTicketId,
        ticketNumber: 590 + index,
        expectation,
        source: origin,
      })
      expect(await classifyReceipt(requestKey, expectation, testKeyring())).toEqual({
        kind: 'replay',
        ticketId: resultTicketId,
        jobIds: [],
      })
      for (const changedOrigin of origins.filter((candidate) => candidate !== origin)) {
        expect(await classifyReceipt(requestKey, createExpectation(requestKey, {
          envelope: { ...expectation.envelope, operationOrigin: changedOrigin },
        }), testKeyring())).toEqual({ kind: 'conflict' })
      }
    }
  })

  it('exactly replays separate-repair-order identity and refuses missing or changed origin', async () => {
    const insertReceipt = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      input: ReceiptExpectation & Readonly<{
        keyring: MutationFingerprintKeyringV1
        resultTicketId: string
        resultJobIds: readonly string[]
      }>,
    ) => Promise<ReceiptIdentity>>('insertMutationReceiptPrimitiveV1')
    const targetTicketId = uuid(5900)
    const resultTicketId = uuid(5901)
    const requestKey = uuid(4900)
    await db.insert(tickets).values({
      id: targetTicketId,
      shopId: uuid(1),
      ticketNumber: 5900,
      source: 'counter',
      customerId: uuid(20),
      vehicleId: uuid(30),
      concern: 'Original work',
      createdByProfileId: uuid(10),
    })
    const expectation: ReceiptExpectation = {
      requestKey,
      mutationKind: 'create_separate_repair_order',
      mutationSchemaVersion: 1,
      targetTicketId,
      envelope: {
        schemaVersion: 1,
        mutationKind: 'create_separate_repair_order',
        operationOrigin: 'counter',
        actorProfileId: uuid(999),
        target: { ticketId: targetTicketId },
        candidates: [{
          ticketId: targetTicketId,
          continuityRevision: '0' as never,
        }],
        payload: { reason: 'warranty' },
      },
    }
    await withScope(baseLockRequest(requestKey, {
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: {
          lockShop: true,
          customerIds: [uuid(20)],
          vehicleIds: [uuid(30)],
          ticketIds: [targetTicketId],
          jobIds: [],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: false,
          includeAllQuoteVersionsForTickets: false,
          includeAllQuoteEventsForTickets: false,
          sessionIds: [],
          sessionEventIds: [],
          vendorAccountIds: [],
          cannedJobIds: [],
          insertionIntents: Object.freeze({
            ...EMPTY_INTENTS,
            tickets: Object.freeze([resultTicketId]),
          }),
        },
      },
    }), async (tx, scope) => {
      await tx.insert(tickets).values({
        id: resultTicketId,
        shopId: uuid(1),
        ticketNumber: 5901,
        source: 'counter',
        customerId: uuid(20),
        vehicleId: uuid(30),
        concern: 'Separated warranty work',
        createdByProfileId: uuid(10),
        separateFromTicketId: targetTicketId,
        separateReason: 'warranty',
      })
      await insertReceipt(tx, scope, {
        ...expectation,
        keyring: testKeyring(),
        resultTicketId,
        resultJobIds: [],
      })
    })

    expect(await classifyReceipt(requestKey, expectation, testKeyring())).toEqual({
      kind: 'replay',
      ticketId: resultTicketId,
      jobIds: [],
    })
    expect(await classifyReceipt(requestKey, {
      ...expectation,
      envelope: { ...expectation.envelope, operationOrigin: null },
    }, testKeyring())).toEqual({ kind: 'conflict' })
    expect(await classifyReceipt(requestKey, {
      ...expectation,
      envelope: { ...expectation.envelope, operationOrigin: 'quick_quote' },
    }, testKeyring())).toEqual({ kind: 'conflict' })
    const missingKey = uuid(4901)
    expect(await classifyReceipt(missingKey, {
      ...expectation,
      requestKey: missingKey,
    }, testKeyring())).toEqual({ kind: 'missing' })
  })

  it('refuses 26 results, duplicate identities, and cross-ticket jobs before receipt commit', async () => {
    const insertReceipt = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      input: ReceiptExpectation & Readonly<{
        keyring: MutationFingerprintKeyringV1
        resultTicketId: string
        resultJobIds: readonly string[]
      }>,
    ) => Promise<ReceiptIdentity>>('insertMutationReceiptPrimitiveV1')

    const overflowTicketId = uuid(6000)
    const overflowJobs = Array.from({ length: 26 }, (_, index) => uuid(7000 + index))
    await expect(insertCreationReceipt({
      requestKey: uuid(5000),
      resultTicketId: overflowTicketId,
      ticketNumber: 6000,
      resultJobIds: overflowJobs,
    })).rejects.toBeInstanceOf(ShopOsMutationConflict)
    expect(await db.select().from(tickets).where(eq(tickets.id, overflowTicketId))).toEqual([])

    const duplicateTicketId = uuid(6001)
    const duplicateJobIds = [uuid(7030), uuid(7031)]
    const duplicateKey = uuid(5001)
    const duplicateExpectation = createExpectation(duplicateKey)
    const duplicateIntents = Object.freeze({
      ...EMPTY_INTENTS,
      tickets: Object.freeze([duplicateTicketId]),
      jobs: Object.freeze(duplicateJobIds.map((id) => Object.freeze({
        id,
        ticketId: duplicateTicketId,
      }))),
    })
    const preparedExtension = (
      insertionIntents: typeof duplicateIntents,
      ticketIds: readonly string[] = [],
    ) => ({
      lockShop: true,
      customerIds: [uuid(20)],
      vehicleIds: [uuid(30)],
      ticketIds,
      jobIds: [],
      includeAllJobsForTickets: false,
      includeAllLinesForJobs: false,
      includeAllQuoteVersionsForTickets: false,
      includeAllQuoteEventsForTickets: false,
      sessionIds: [],
      sessionEventIds: [],
      vendorAccountIds: [],
      cannedJobIds: [],
      insertionIntents,
    })
    await expect(withScope(baseLockRequest(duplicateKey, {
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: preparedExtension(duplicateIntents),
      },
    }), async (tx, scope) => {
      await tx.insert(tickets).values({
        id: duplicateTicketId,
        shopId: uuid(1),
        ticketNumber: 6001,
        source: 'quick_quote',
        customerId: uuid(20),
        vehicleId: uuid(30),
        concern: 'Duplicate result guard',
        createdByProfileId: uuid(10),
      })
      await tx.insert(ticketJobs).values(duplicateJobIds.map((id, index) => ({
        id,
        shopId: uuid(1),
        ticketId: duplicateTicketId,
        title: `Duplicate guard ${index}`,
        kind: 'repair' as const,
        requiredSkillTier: 1 as const,
        createdByProfileId: uuid(10),
        creatorProvenance: 'direct' as const,
      })))
      return insertReceipt(tx, scope, {
        ...duplicateExpectation,
        keyring: testKeyring(),
        resultTicketId: duplicateTicketId,
        resultJobIds: [duplicateJobIds[0]!, duplicateJobIds[0]!],
      })
    })).rejects.toBeInstanceOf(ShopOsMutationConflict)

    const firstTicketId = uuid(6002)
    const secondTicketId = uuid(6003)
    const crossTicketJobId = uuid(7032)
    const crossKey = uuid(5002)
    const crossIntents = Object.freeze({
      ...EMPTY_INTENTS,
      tickets: Object.freeze([firstTicketId, secondTicketId]),
      jobs: Object.freeze([Object.freeze({
        id: crossTicketJobId,
        ticketId: secondTicketId,
      })]),
    })
    await expect(withScope(baseLockRequest(crossKey, {
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: preparedExtension(crossIntents),
      },
    }), async (tx, scope) => {
      await tx.insert(tickets).values([
        {
          id: firstTicketId,
          shopId: uuid(1),
          ticketNumber: 6002,
          source: 'quick_quote',
          customerId: uuid(20),
          vehicleId: uuid(30),
          concern: 'First ticket',
          createdByProfileId: uuid(10),
        },
        {
          id: secondTicketId,
          shopId: uuid(1),
          ticketNumber: 6003,
          source: 'quick_quote',
          customerId: uuid(20),
          vehicleId: uuid(30),
          concern: 'Second ticket',
          createdByProfileId: uuid(10),
        },
      ])
      await tx.insert(ticketJobs).values({
        id: crossTicketJobId,
        shopId: uuid(1),
        ticketId: secondTicketId,
        title: 'Wrong parent',
        kind: 'repair',
        requiredSkillTier: 1,
        createdByProfileId: uuid(10),
        creatorProvenance: 'direct',
      })
      return insertReceipt(tx, scope, {
        ...createExpectation(crossKey),
        keyring: testKeyring(),
        resultTicketId: firstTicketId,
        resultJobIds: [crossTicketJobId],
      })
    })).rejects.toBeInstanceOf(ShopOsMutationConflict)
    expect(await db.select().from(ticketMutationReceipts).where(eq(
      ticketMutationReceipts.requestKey,
      crossKey,
    ))).toEqual([])
  })

  it('refuses persisted child-count corruption without returning result identity', async () => {
    const requestKey = uuid(5003)
    const resultTicketId = uuid(6004)
    await insertCreationReceipt({
      requestKey,
      resultTicketId,
      ticketNumber: 6004,
      resultJobIds: [uuid(7040), uuid(7041)],
    })
    const [receipt] = await db.select().from(ticketMutationReceipts).where(eq(
      ticketMutationReceipts.requestKey,
      requestKey,
    ))
    await db.execute(sql`
      alter table ticket_mutation_receipt_jobs
      disable trigger ticket_mutation_receipt_jobs_immutable_write
    `)
    try {
      await db.delete(ticketMutationReceiptJobs).where(and(
        eq(ticketMutationReceiptJobs.receiptId, receipt!.id),
        eq(ticketMutationReceiptJobs.ordinal, 1),
      ))
    } finally {
      await db.execute(sql`
        alter table ticket_mutation_receipt_jobs
        enable trigger ticket_mutation_receipt_jobs_immutable_write
      `)
    }

    const result = await classifyReceipt(
      requestKey,
      createExpectation(requestKey),
      testKeyring(),
    )
    expect(result).toEqual({ kind: 'conflict' })
    expect(JSON.stringify(result)).not.toContain(resultTicketId)
  })

  it('isolates the same request key by shop and refuses inactive authority before classification', async () => {
    const requestKey = uuid(5100)
    const northTicketId = uuid(6100)
    const southTicketId = uuid(6101)
    const northExpectation = createExpectation(requestKey)
    await insertCreationReceipt({
      requestKey,
      resultTicketId: northTicketId,
      ticketNumber: 6100,
      expectation: northExpectation,
    })

    const southExpectation = createExpectation(requestKey)
    const southEnvelope = {
      ...southExpectation.envelope,
      actorProfileId: uuid(20),
    }
    const keyring = testKeyring()
    const requestFingerprint = createCanonicalMutationFingerprintV1(southEnvelope, keyring)
    const targetFingerprint = createCanonicalTargetBindingFingerprintV1(
      southEnvelope.target,
      southEnvelope.candidates,
      keyring,
    )
    await db.insert(tickets).values({
      id: southTicketId,
      shopId: uuid(2),
      ticketNumber: 6101,
      source: 'quick_quote',
      customerId: uuid(40),
      vehicleId: uuid(50),
      concern: 'Brake noise',
      createdByProfileId: uuid(20),
    })
    await db.transaction(async (tx) => {
      await tx.insert(ticketMutationReceipts).values({
        id: uuid(4100),
        shopId: uuid(2),
        requestKey,
        mutationSchemaVersion: 1,
        fingerprintKeyVersion: requestFingerprint.keyVersion,
        mutationKind: southExpectation.mutationKind,
        actorProfileId: uuid(20),
        targetTicketId: null,
        targetBindingFingerprint: targetFingerprint.digest,
        requestFingerprint: requestFingerprint.digest,
        resultTicketId: southTicketId,
        resultJobCount: 0,
      })
    })

    expect(await classifyReceipt(requestKey, northExpectation, keyring)).toEqual({
      kind: 'replay', ticketId: northTicketId, jobIds: [],
    })
    expect(await classifyReceipt(requestKey, southExpectation, keyring, {
      shopId: uuid(2),
      actorProfileId: uuid(20),
      profileIds: [uuid(20)],
    })).toEqual({
      kind: 'replay', ticketId: southTicketId, jobIds: [],
    })

    await expect(withScope(baseLockRequest(uuid(5101), {
      actorProfileId: uuid(12),
      profileIds: [uuid(12)],
      receiptConditionalInsert: { kind: 'unavailable' },
    }), async () => 'must-not-classify')).rejects.toBeInstanceOf(ShopOsMutationNotFound)
  })

  it('refuses persisted creation identity when the locked result source mismatches origin', async () => {
    const requestKey = uuid(5200)
    const resultTicketId = uuid(6200)
    const expectation = createExpectation(requestKey)
    const keyring = testKeyring()
    const envelope = { ...expectation.envelope, actorProfileId: uuid(10) }
    const requestFingerprint = createCanonicalMutationFingerprintV1(envelope, keyring)
    const targetFingerprint = createCanonicalTargetBindingFingerprintV1(
      envelope.target,
      envelope.candidates,
      keyring,
    )
    await db.insert(tickets).values({
      id: resultTicketId,
      shopId: uuid(1),
      ticketNumber: 6200,
      source: 'counter',
      customerId: uuid(20),
      vehicleId: uuid(30),
      concern: 'Brake noise',
      createdByProfileId: uuid(10),
    })
    await db.transaction(async (tx) => {
      await tx.insert(ticketMutationReceipts).values({
        id: uuid(4200),
        shopId: uuid(1),
        requestKey,
        mutationSchemaVersion: 1,
        fingerprintKeyVersion: requestFingerprint.keyVersion,
        mutationKind: expectation.mutationKind,
        actorProfileId: uuid(10),
        targetTicketId: null,
        targetBindingFingerprint: targetFingerprint.digest,
        requestFingerprint: requestFingerprint.digest,
        resultTicketId,
        resultJobCount: 0,
      })
    })

    const result = await classifyReceipt(requestKey, expectation, keyring)
    expect(result).toEqual({ kind: 'conflict' })
    expect(JSON.stringify(result)).not.toContain(resultTicketId)
  })

  it('treats hints as advisory and suppresses prepared resources when a receipt appears before lock', async () => {
    const hint = requiredReceiptFunction<(
      tx: AppDb,
      attempt: MutationAttemptCapabilityV1,
      value: Readonly<{ shopId: string; requestKey: string }>,
    ) => Promise<'present' | 'absent'>>('hintMutationReceiptPresenceV1')
    const appearedKey = uuid(5300)
    const winnerTicketId = uuid(6300)
    const suppressedTicketId = uuid(6301)
    const preLockHint = await db.transaction(async (rawTx) => {
      const tx = rawTx as AppDb
      const attempt = createMutationAttemptCapabilityV1(tx, {
        ordinal: 1,
        purpose: 'primary',
      })
      try {
        return await hint(tx, attempt.capability, {
          shopId: uuid(1),
          requestKey: appearedKey,
        })
      } finally {
        closeMutationAttemptCapabilityV1(attempt.capability)
      }
    })
    expect(preLockHint).toBe('absent')

    await insertCreationReceipt({
      requestKey: appearedKey,
      resultTicketId: winnerTicketId,
      ticketNumber: 6300,
    })
    const suppression = await withScope(
      preparedCreationRequest(appearedKey, suppressedTicketId),
      async (_tx, scope) => ({
        peek: scope.receiptPeek,
        state: scope.receiptConditionalInsertState,
        ticketIds: scope.tickets.map(({ ticket }) => ticket.id),
        insertionTicketIds: [...scope.insertionIntents.tickets],
        shopLocked: scope.shop !== null,
      }),
    )
    expect(suppression).toMatchObject({
      peek: { kind: 'owned', resultTicketId: winnerTicketId },
      state: 'suppressed_by_owned_receipt',
      ticketIds: [winnerTicketId],
      insertionTicketIds: [],
      shopLocked: false,
    })
    expect(await db.select().from(tickets).where(eq(
      tickets.id,
      suppressedTicketId,
    ))).toEqual([])

    const falsePositiveKey = uuid(5301)
    const freshTicketId = uuid(6302)
    const actualHints: Array<'present' | 'absent'> = []
    const identity = await runReceiptCreation({
      requestKey: falsePositiveKey,
      resultTicketId: freshTicketId,
      ticketNumber: 6302,
      expectation: createExpectation(falsePositiveKey),
      hintOverride: (actual, call) => {
        actualHints.push(actual)
        return call === 1 ? 'present' : actual
      },
    })
    expect(actualHints).toEqual(['absent', 'absent'])
    expect(identity).toEqual({ ticketId: freshTicketId, jobIds: [] })
  })

  it('converges two identical PGlite contenders on one immutable winner identity', async () => {
    const requestKey = uuid(5302)
    const expectation = createExpectation(requestKey)
    const contenderTicketIds = [uuid(6303), uuid(6304)] as const
    const identities = await Promise.all(contenderTicketIds.map((resultTicketId, index) =>
      runReceiptCreation({
        requestKey,
        resultTicketId,
        ticketNumber: 6303 + index,
        expectation,
      })))

    const persistedReceipts = await db.select().from(ticketMutationReceipts).where(eq(
      ticketMutationReceipts.requestKey,
      requestKey,
    ))
    const persistedTickets = await db.select().from(tickets).where(inArray(
      tickets.id,
      contenderTicketIds,
    ))
    expect(persistedReceipts).toHaveLength(1)
    expect(persistedTickets).toHaveLength(1)
    expect(identities).toEqual([
      { ticketId: persistedReceipts[0]!.resultTicketId, jobIds: [] },
      { ticketId: persistedReceipts[0]!.resultTicketId, jobIds: [] },
    ])
  })

  it('allows one PGlite winner and privacy-conflicts the different-payload contender', async () => {
    const requestKey = uuid(5303)
    const baseline = createExpectation(requestKey)
    const changed = createExpectation(requestKey, {
      envelope: { ...baseline.envelope, payload: { concern: 'Different contender' } },
    })
    const contenderTicketIds = [uuid(6305), uuid(6306)] as const
    const settled = await Promise.allSettled([
      runReceiptCreation({
        requestKey,
        resultTicketId: contenderTicketIds[0],
        ticketNumber: 6305,
        expectation: baseline,
      }),
      runReceiptCreation({
        requestKey,
        resultTicketId: contenderTicketIds[1],
        ticketNumber: 6306,
        expectation: changed,
      }),
    ])

    const fulfilled = settled.filter((result) => result.status === 'fulfilled')
    const rejected = settled.filter((result) => result.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect((rejected[0] as PromiseRejectedResult).reason)
      .toBeInstanceOf(ShopOsMutationConflict)
    expect(JSON.stringify((rejected[0] as PromiseRejectedResult).reason))
      .not.toMatch(new RegExp(contenderTicketIds.join('|')))
    expect(await db.select().from(ticketMutationReceipts).where(eq(
      ticketMutationReceipts.requestKey,
      requestKey,
    ))).toHaveLength(1)
    expect(await db.select().from(tickets).where(inArray(
      tickets.id,
      contenderTicketIds,
    ))).toHaveLength(1)
  })

  it('rolls back domain and finalized revisions when failure occurs before receipt insertion', async () => {
    const requestKey = uuid(5304)
    const ticketId = uuid(6307)
    const jobId = uuid(7307)
    await db.insert(tickets).values({
      id: ticketId,
      shopId: uuid(1),
      ticketNumber: 6307,
      source: 'counter',
      customerId: uuid(20),
      vehicleId: uuid(30),
      concern: 'Rollback concern',
      createdByProfileId: uuid(10),
    })
    await db.insert(ticketJobs).values({
      id: jobId,
      shopId: uuid(1),
      ticketId,
      title: 'Rollback work',
      kind: 'repair',
      requiredSkillTier: 1,
      createdByProfileId: uuid(10),
      creatorProvenance: 'direct',
    })
    const marker = new Error('injected_between_revision_and_receipt')

    await expect(runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: baseLockRequest(requestKey, {
          customerIds: [uuid(20)],
          vehicleIds: [uuid(30)],
          ticketIds: [ticketId],
          jobIds: [jobId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        await tx.update(ticketJobs).set({ workNotes: 'must roll back' }).where(and(
          eq(ticketJobs.shopId, uuid(1)),
          eq(ticketJobs.id, jobId),
        ))
        await finalizeMutationRevisionsV1(
          tx,
          scope,
          { sessionIds: [], customerIds: [], vehicleIds: [] },
          [{
            ticketId,
            createdTicket: false,
            createdJobIds: [],
            existingChangedJobIds: [jobId],
            actorVisibleTicketFieldsChanged: false,
          }],
        )
        throw marker
      },
    })).rejects.toBe(marker)

    const [persistedTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [persistedJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(persistedTicket).toMatchObject({
      projectionRevision: 0n,
      continuityRevision: 0n,
    })
    expect(persistedJob).toMatchObject({ revision: 0n, workNotes: null })
    expect(await db.select().from(ticketMutationReceipts).where(eq(
      ticketMutationReceipts.requestKey,
      requestKey,
    ))).toEqual([])
  })

  it('rejects stale and cross-transaction receipt scopes before any query or write', async () => {
    const classify = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      expected: ReceiptExpectation,
      keyring: MutationFingerprintKeyringV1,
    ) => Promise<unknown>>('lockAndClassifyMutationReceiptV1')
    const insertReceipt = requiredReceiptFunction<(
      tx: AppDb,
      scope: LockedMutationScopeV1,
      value: ReceiptExpectation & Readonly<{
        keyring: MutationFingerprintKeyringV1
        resultTicketId: string
        resultJobIds: readonly string[]
      }>,
    ) => Promise<unknown>>('insertMutationReceiptPrimitiveV1')
    const requestKey = uuid(5305)
    const expectation = createExpectation(requestKey)
    let staleScope: LockedMutationScopeV1 | undefined

    await loggingDb.transaction(async (rawTx) => {
      const tx = rawTx as AppDb
      const attempt = createMutationAttemptCapabilityV1(tx, {
        ordinal: 1,
        purpose: 'primary',
      })
      try {
        staleScope = await lockMutationScopeV1(
          tx,
          attempt.capability,
          baseLockRequest(requestKey, {
            receiptConditionalInsert: { kind: 'unavailable' },
          }),
        )
        queryLog.length = 0
        await expect(classify(
          loggingDb,
          staleScope,
          expectation,
          testKeyring(),
        )).rejects.toThrowError('mutation_attempt_transaction_mismatch')
        expect(queryLog).toEqual([])
      } finally {
        closeMutationAttemptCapabilityV1(attempt.capability)
      }
    })

    queryLog.length = 0
    await expect(classify(
      loggingDb,
      staleScope!,
      expectation,
      testKeyring(),
    )).rejects.toThrowError('mutation_attempt_capability_closed')
    await expect(insertReceipt(loggingDb, staleScope!, {
      ...expectation,
      keyring: testKeyring(),
      resultTicketId: uuid(6308),
      resultJobIds: [],
    })).rejects.toThrowError('mutation_attempt_capability_closed')
    expect(queryLog).toEqual([])
    expect(await db.select().from(ticketMutationReceipts).where(eq(
      ticketMutationReceipts.requestKey,
      requestKey,
    ))).toEqual([])
  })
})
