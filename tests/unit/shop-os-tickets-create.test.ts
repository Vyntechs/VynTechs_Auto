import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AppDb } from '@/lib/db/queries'
import {
  cannedJobs,
  jobLines,
  sessions,
  ticketMutationReceiptJobs,
  ticketMutationReceipts,
} from '@/lib/db/schema'
import {
  buildResolvedTicketCreationEnvelopeV1,
  classifyResolvedTicketCreationReceiptInTransactionV1,
  createTicket,
  finalizeResolvedTicketCreationInTransactionV1,
  insertResolvedTicketBatchInTransactionV1,
  insertResolvedTicketCreationReceiptInTransactionV1,
  readFinalizedTicketCreationResultV1,
  readResolvedTechQuickReplayResultV1,
  resolveTicketCreationInLockedScopeV1,
  type ResolveTicketCreationInputV1,
  type TicketActor,
} from '@/lib/tickets'
import {
  consumeCanonicalQuickReceiptRequestForCreationV1,
  parseQuickTicketRequestV1,
} from '@/lib/intake/quick-ticket-contracts'
import {
  materializeTicketIntakeIdentityInLockedScopeV1,
  preflightTicketIntakeIdentityV1,
  type TicketIntakeIdentityInputV1,
  type TicketIntakeIdentityLockPlanV1,
} from '@/lib/intake/ticket-identity'
import {
  createCannedJob,
  preflightStrictCannedJobV1,
  replaceCannedJob,
  resolveStrictCannedJobInLockedScopeV1,
} from '@/lib/shop-os/canned-jobs'
import {
  createCounterTicketOriginV1,
  createQuickTicketOriginV1,
  createTechQuickTicketOriginV1,
} from '@/lib/shop-os/continuity/mutation-foundation/ticket-origin.server'
import type {
  NormalizedJobLineCreateV1,
  NormalizedTicketCreateV1,
  NormalizedTicketJobCreateV1,
  ResolvedTicketCreationV1,
  TrustedTicketOriginV1,
} from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { createMutationFingerprintKeyringV1 } from '@/lib/shop-os/continuity/mutation-foundation/keyring'
import type {
  LockedMutationScopeV1,
  MutationLockRequestV1,
} from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import { insertMutationReceiptPrimitiveV1 } from '@/lib/shop-os/continuity/mutation-foundation/receipts'
import { runBoundedShopOsMutationV1 } from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'
import {
  customers,
  profiles,
  shops,
  ticketJobs,
  tickets,
  vehicles,
  type Profile,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

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

describe('Task 7B ticket creation kernel source boundary', () => {
  it('declares the private server-only origin authority and parallel kernel without a barrel export', async () => {
    const root = process.cwd()
    const origin = await readFile(
      path.join(root, 'lib/shop-os/continuity/mutation-foundation/ticket-origin.server.ts'),
      'utf8',
    ).catch(() => '')
    const ticketSource = await readFile(path.join(root, 'lib/tickets.ts'), 'utf8')
    const barrel = await readFile(
      path.join(root, 'lib/shop-os/continuity/mutation-foundation/index.ts'),
      'utf8',
    )

    expect(origin.startsWith("import 'server-only'\n")).toBe(true)
    for (const declaration of [
      'createCounterTicketOriginV1',
      'createTechQuickTicketOriginV1',
      'createQuickTicketOriginV1',
      'resolveTrustedTicketOriginInLockedScopeV1',
    ]) {
      expect(origin).toContain(`export function ${declaration}`)
    }
    for (const declaration of [
      'resolveTicketCreationInLockedScopeV1',
      'insertResolvedTicketBatchInTransactionV1',
      'finalizeResolvedTicketCreationInTransactionV1',
      'insertResolvedTicketCreationReceiptInTransactionV1',
      'classifyResolvedTicketCreationReceiptInTransactionV1',
      'readFinalizedTicketCreationResultV1',
      'readResolvedTechQuickReplayResultV1',
      'buildResolvedTicketCreationEnvelopeV1',
    ]) {
      expect(ticketSource).toMatch(new RegExp(`export (?:async )?function ${declaration}`))
    }
    expect(barrel).not.toContain('ticket-origin.server')
    expect(barrel).not.toContain('createCounterTicketOriginV1')
    expect(barrel).not.toContain('createTechQuickTicketOriginV1')
    expect(barrel).not.toContain('createQuickTicketOriginV1')
    expect(barrel).not.toContain('resolveTrustedTicketOriginInLockedScopeV1')
    const quickBranch = ticketSource.indexOf("if (mode === 'quick_insert')")
    const activationGuard = ticketSource.indexOf(
      'assertActivatedQuickInsertScope(scope)',
      quickBranch,
    )
    const identityConsumer = ticketSource.indexOf(
      'consumeMaterializedTicketIntakeIdentityForCreationV1(',
      quickBranch,
    )
    expect(quickBranch).toBeGreaterThan(-1)
    expect(activationGuard).toBeGreaterThan(quickBranch)
    expect(identityConsumer).toBeGreaterThan(activationGuard)
    expect(ticketSource).toContain("mode: 'tech_quick_replay'")
    expect(ticketSource).not.toContain('createTechQuickTicketInTransaction')
    expect(ticketSource).not.toContain('CreateTechQuickTicketInput')
  })

  it('creates opaque immutable origins and rejects malformed authority inputs synchronously', () => {
    const origins = [
      createCounterTicketOriginV1(),
      createQuickTicketOriginV1(uuid(901).toUpperCase()),
      createTechQuickTicketOriginV1(uuid(902).toUpperCase()),
    ]

    for (const origin of origins) {
      expect(Object.getPrototypeOf(origin)).toBe(null)
      expect(Object.isFrozen(origin)).toBe(true)
      expect(Reflect.ownKeys(origin)).toEqual([])
      expect(Reflect.set(origin as object, 'kind', 'counter')).toBe(false)
    }
    for (const factory of [createQuickTicketOriginV1, createTechQuickTicketOriginV1]) {
      for (const malformed of ['', 'not-a-uuid', uuid(903).slice(1)]) {
        expect(() => factory(malformed)).toThrow('trusted_ticket_origin_invalid')
      }
    }
  })
})

const kernelUuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const EMPTY_MUTATION_INTENTS = Object.freeze({
  sessions: Object.freeze([]),
  customers: Object.freeze([]),
  vehicles: Object.freeze([]),
  tickets: Object.freeze([]),
  jobs: Object.freeze([]),
})

describe('Task 7B transaction-bound ticket creation kernel', () => {
  let db: TestDb
  let close: () => Promise<void>
  const shopId = kernelUuid(1001)
  const ownerProfileId = kernelUuid(1002)
  const techProfileId = kernelUuid(1003)
  const customerId = kernelUuid(1004)
  const vehicleId = kernelUuid(1005)

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({
      id: shopId,
      name: 'Kernel Shop',
      nextTicketNumber: 41,
      taxRateBps: 825,
    })
    await db.insert(profiles).values([
      {
        id: ownerProfileId,
        userId: kernelUuid(1012),
        shopId,
        role: 'owner',
        skillTier: 3,
        fullName: 'Kernel Owner',
      },
      {
        id: techProfileId,
        userId: kernelUuid(1013),
        shopId,
        role: 'tech',
        skillTier: 2,
        fullName: 'Kernel Tech',
      },
    ])
    await db.insert(customers).values({
      id: customerId,
      shopId,
      name: 'Kernel Customer',
      phone: '555-1004',
      email: 'kernel@example.com',
    })
    await db.insert(vehicles).values({
      id: vehicleId,
      customerId,
      year: 2020,
      make: 'Honda',
      model: 'Civic',
      engine: '2.0L',
      vin: '2HGFC2F59LH100005',
      mileage: 41_000,
      plate: 'KERNEL',
    })
  })

  afterEach(async () => close())

  function lockRequest(
    overrides: Partial<MutationLockRequestV1> = {},
  ): MutationLockRequestV1 {
    return {
      shopId,
      actorProfileId: ownerProfileId,
      profileIds: [ownerProfileId],
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
      insertionIntents: EMPTY_MUTATION_INTENTS,
      ...overrides,
    }
  }

  function normalizedTicket(
    id: string,
    overrides: Partial<NormalizedTicketCreateV1> = {},
  ): NormalizedTicketCreateV1 {
    return {
      id,
      customerId,
      vehicleId,
      concern: 'Diagnose front-end noise',
      whenStarted: 'Last week',
      howOften: 'Cold starts',
      diagnosticAuthorizedCents: 12_500,
      diagnosticAuthorizationNote: 'Approved by phone',
      ...overrides,
    }
  }

  function normalizedJob(
    id: string,
    overrides: Partial<NormalizedTicketJobCreateV1> = {},
  ): NormalizedTicketJobCreateV1 {
    return {
      id,
      title: 'Diagnose front-end noise',
      kind: 'diagnostic',
      requiredSkillTier: 2,
      assignedTechId: null,
      sessionId: null,
      createdFromJobId: null,
      ...overrides,
    }
  }

  function ticketInsertionIntents(ticketId: string, jobIds: readonly string[]) {
    return {
      ...EMPTY_MUTATION_INTENTS,
      tickets: [ticketId],
      jobs: jobIds.map((id) => ({ id, ticketId })),
    }
  }

  function quickPreparedLockRequest(
    plan: TicketIntakeIdentityLockPlanV1,
    requestKey: string,
    ticketId: string,
    jobId: string,
    cannedJobIds: readonly string[] = [],
  ): MutationLockRequestV1 {
    return lockRequest({
      receiptRequestKey: requestKey,
      receiptConditionalInsert: {
        kind: 'prepared',
        extension: {
          lockShop: true,
          customerIds: plan.customerIds,
          vehicleIds: plan.vehicleIds,
          ticketIds: [],
          jobIds: [],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          includeAllQuoteVersionsForTickets: false,
          includeAllQuoteEventsForTickets: false,
          sessionIds: [],
          sessionEventIds: [],
          vendorAccountIds: [],
          cannedJobIds,
          insertionIntents: {
            ...ticketInsertionIntents(ticketId, [jobId]),
            customers: plan.insertionIntents.customers,
            vehicles: plan.insertionIntents.vehicles,
          },
        },
      },
      insertionIntents: EMPTY_MUTATION_INTENTS,
    })
  }

  it('resolves genuine Counter and Tech insert origins only against exact locked intents', async () => {
    const counterTicketId = kernelUuid(1020)
    const counterJobId = kernelUuid(1021)
    const counterInput: ResolveTicketCreationInputV1 = {
      mode: 'insert',
      origin: createCounterTicketOriginV1(),
      ticket: normalizedTicket(counterTicketId),
      jobs: [normalizedJob(counterJobId)],
      seededLinesByJobIndex: new Map(),
    }
    const counterResolved = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: ticketInsertionIntents(counterTicketId, [counterJobId]),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          ...counterInput,
          origin: createQuickTicketOriginV1(kernelUuid(1090)),
        })).toThrow('trusted_ticket_origin_invalid')
        const forged = Object.freeze(Object.create(null)) as TrustedTicketOriginV1
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          ...counterInput,
          origin: forged,
        })).toThrow('trusted_ticket_origin_invalid')
        return resolveTicketCreationInLockedScopeV1(tx, scope, counterInput)
      },
    })
    expect(Object.getPrototypeOf(counterResolved)).toBe(null)
    expect(Object.isFrozen(counterResolved)).toBe(true)
    expect(Reflect.ownKeys(counterResolved)).toEqual([])

    const techSessionId = kernelUuid(1030)
    const techTicketId = kernelUuid(1031)
    const techJobId = kernelUuid(1032)
    const techInput: ResolveTicketCreationInputV1 = {
      mode: 'insert',
      origin: createTechQuickTicketOriginV1(techSessionId.toUpperCase()),
      ticket: normalizedTicket(techTicketId, {
        customerId: null,
        vehicleId: null,
        concern: 'No-start diagnosis',
        whenStarted: null,
        howOften: null,
        diagnosticAuthorizedCents: null,
        diagnosticAuthorizationNote: null,
      }),
      jobs: [normalizedJob(techJobId, {
        title: 'No-start diagnosis',
        assignedTechId: techProfileId,
        sessionId: techSessionId,
      })],
      seededLinesByJobIndex: new Map(),
    }
    const techResolved = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          actorProfileId: techProfileId,
          profileIds: [techProfileId],
          lockShop: true,
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: {
            ...ticketInsertionIntents(techTicketId, [techJobId]),
            sessions: [{ id: techSessionId, shopId, techId: techProfileId }],
          },
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const mismatchedSessionId = kernelUuid(1091)
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          ...techInput,
          origin: createTechQuickTicketOriginV1(mismatchedSessionId),
        })).toThrow('trusted_ticket_origin_invalid')
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          ...techInput,
          origin: createTechQuickTicketOriginV1(mismatchedSessionId),
          jobs: [normalizedJob(techJobId, {
            title: 'No-start diagnosis',
            assignedTechId: techProfileId,
            sessionId: mismatchedSessionId,
          })],
        })).toThrow('trusted_ticket_origin_invalid')
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          ...techInput,
          jobs: [normalizedJob(techJobId, {
            title: 'No-start diagnosis',
            assignedTechId: techProfileId,
            sessionId: mismatchedSessionId,
          })],
        })).toThrow('trusted_ticket_origin_invalid')
        return resolveTicketCreationInLockedScopeV1(tx, scope, techInput)
      },
    })
    expect(Object.getPrototypeOf(techResolved)).toBe(null)
    expect(Reflect.ownKeys(techResolved)).toEqual([])
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect(await db.select().from(sessions)).toEqual([])
  })

  it('rejects Tech origin authority when the registered session belongs to a different locked actor', async () => {
    const sessionId = kernelUuid(1033)
    const ticketId = kernelUuid(1034)
    const jobId = kernelUuid(1035)
    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          actorProfileId: ownerProfileId,
          profileIds: [ownerProfileId, techProfileId],
          lockShop: true,
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: {
            ...ticketInsertionIntents(ticketId, [jobId]),
            sessions: [{ id: sessionId, shopId, techId: techProfileId }],
          },
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin: createTechQuickTicketOriginV1(sessionId),
          ticket: normalizedTicket(ticketId, {
            customerId: null,
            vehicleId: null,
          }),
          jobs: [normalizedJob(jobId, {
            assignedTechId: techProfileId,
            sessionId,
          })],
          seededLinesByJobIndex: new Map(),
        })).toThrow('trusted_ticket_origin_invalid')
      },
    })
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(sessions)).toEqual([])
  })

  it('returns Tech Quick replay identity only through a genuine live replay handle', async () => {
    const sessionId = kernelUuid(1036)
    const ticketId = kernelUuid(1037)
    const jobId = kernelUuid(1038)
    const replayIntake = {
      vehicleYear: 2019,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'Intermittent no-start',
    }
    await db.insert(sessions).values({
      id: sessionId,
      shopId,
      techId: techProfileId,
      intake: replayIntake,
      treeState: { nodes: [], currentNodeId: 'root', message: 'Open' },
    })
    await db.insert(tickets).values({
      id: ticketId,
      shopId,
      ticketNumber: 41,
      source: 'tech_quick',
      customerId: null,
      vehicleId: null,
      concern: replayIntake.customerComplaint,
      createdByProfileId: techProfileId,
      projectionRevision: 1n,
      continuityRevision: 1n,
    })
    await db.insert(ticketJobs).values({
      id: jobId,
      shopId,
      ticketId,
      title: replayIntake.customerComplaint,
      kind: 'diagnostic',
      requiredSkillTier: 2,
      assignedTechId: techProfileId,
      sessionId,
      sequenceNumber: 1,
      createdByProfileId: techProfileId,
      creatorProvenance: 'direct',
      revision: 1n,
    })

    let captured: Readonly<{
      tx: AppDb
      scope: LockedMutationScopeV1
      resolved: ResolvedTicketCreationV1
    }> | null = null
    const result = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          actorProfileId: techProfileId,
          profileIds: [techProfileId],
          lockShop: true,
          ticketIds: [ticketId],
          jobIds: [jobId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          sessionIds: [sessionId],
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'tech_quick_replay',
          origin: createTechQuickTicketOriginV1(sessionId),
          sessionId,
          intake: replayIntake,
          candidateTicketIds: [ticketId],
          candidateJobIds: [jobId],
        })
        captured = { tx, scope, resolved }
        const forged = Object.freeze(Object.create(null)) as ResolvedTicketCreationV1
        const wrongScope = Object.freeze({ ...scope }) as LockedMutationScopeV1
        expect(() => readResolvedTechQuickReplayResultV1(tx, scope, forged)).toThrow()
        expect(() => readResolvedTechQuickReplayResultV1(db as AppDb, scope, resolved)).toThrow()
        expect(() => readResolvedTechQuickReplayResultV1(tx, wrongScope, resolved)).toThrow()
        return readResolvedTechQuickReplayResultV1(tx, scope, resolved)
      },
    })
    expect(result).toEqual({ id: sessionId, ticketId, jobId })
    expect(Object.isFrozen(result)).toBe(true)
    expect(captured).not.toBeNull()
    const stale = captured as unknown as {
      tx: AppDb
      scope: LockedMutationScopeV1
      resolved: ResolvedTicketCreationV1
    }
    expect(() => readResolvedTechQuickReplayResultV1(
      stale.tx,
      stale.scope,
      stale.resolved,
    )).toThrow()

    await db.update(profiles).set({ skillTier: null })
      .where(eq(profiles.id, techProfileId))
    await expect(runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          actorProfileId: techProfileId,
          profileIds: [techProfileId],
          lockShop: true,
          ticketIds: [ticketId],
          jobIds: [jobId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          sessionIds: [sessionId],
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => resolveTicketCreationInLockedScopeV1(tx, scope, {
        mode: 'tech_quick_replay',
        origin: createTechQuickTicketOriginV1(sessionId),
        sessionId,
        intake: replayIntake,
        candidateTicketIds: [ticketId],
        candidateJobIds: [jobId],
      }),
    })).rejects.toThrow('ticket_creation_kernel_invalid')

    const counterTicketId = kernelUuid(1039)
    const counterJobId = kernelUuid(1040)
    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: ticketInsertionIntents(counterTicketId, [counterJobId]),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const nonReplay = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin: createCounterTicketOriginV1(),
          ticket: normalizedTicket(counterTicketId),
          jobs: [normalizedJob(counterJobId)],
          seededLinesByJobIndex: new Map(),
        })
        expect(() => readResolvedTechQuickReplayResultV1(tx, scope, nonReplay)).toThrow()
      },
    })
  })

  it('resolves materialized-intake and manual Quick insert modes in the same live scope', async () => {
    const identityInput: TicketIntakeIdentityInputV1 = {
      mode: 'existing_vehicle',
      shopId,
      existingVehicleId: vehicleId,
      mileage: null,
    }

    const intakeTicketId = kernelUuid(1040)
    const intakeJobId = kernelUuid(1041)
    const intakeResolved = await runBoundedShopOsMutationV1(db, {
      discover: async (tx, attempt) => {
        const preflight = await preflightTicketIntakeIdentityV1(
          tx,
          attempt.capability,
          identityInput,
        )
        if (!preflight.ok) throw new Error(preflight.error)
        return {
          lockRequest: lockRequest({
            lockShop: true,
            customerIds: preflight.lockPlan.customerIds,
            vehicleIds: preflight.lockPlan.vehicleIds,
            includeAllJobsForTickets: true,
            includeAllLinesForJobs: true,
            insertionIntents: {
              ...ticketInsertionIntents(intakeTicketId, [intakeJobId]),
              customers: preflight.lockPlan.insertionIntents.customers,
              vehicles: preflight.lockPlan.insertionIntents.vehicles,
            },
          }),
          payload: preflight,
        }
      },
      executeLocked: async (tx, scope, preflight) => {
        const materialized = await materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          preflight.identity,
        )
        if (!materialized.ok) throw new Error(materialized.error)
        return resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'intake_insert',
          origin: createCounterTicketOriginV1(),
          ticket: {
            id: intakeTicketId,
            concern: 'Intake concern',
            whenStarted: null,
            howOften: null,
            diagnosticAuthorizedCents: null,
            diagnosticAuthorizationNote: null,
          },
          identity: materialized.materialized,
          jobs: [normalizedJob(intakeJobId, { title: 'Intake concern' })],
          seededLinesByJobIndex: new Map(),
        })
      },
    })
    expect(Object.getPrototypeOf(intakeResolved)).toBe(null)
    expect(Reflect.ownKeys(intakeResolved)).toEqual([])

    const requestKey = kernelUuid(1050)
    const quickTicketId = kernelUuid(1051)
    const quickJobId = kernelUuid(1052)
    const parsed = parseQuickTicketRequestV1({
      vehicleMode: 'existing',
      existingVehicleId: vehicleId,
      mileage: null,
      clientKey: requestKey,
      quote: {
        mode: 'manual',
        kind: 'repair',
        description: 'Replace boost hose',
      },
    })
    if (!parsed.ok) throw new Error(parsed.error)
    const quickResolved = await runBoundedShopOsMutationV1(db, {
      discover: async (tx, attempt) => {
        const preflight = await preflightTicketIntakeIdentityV1(
          tx,
          attempt.capability,
          identityInput,
        )
        if (!preflight.ok) throw new Error(preflight.error)
        return {
          lockRequest: quickPreparedLockRequest(
            preflight.lockPlan,
            requestKey,
            quickTicketId,
            quickJobId,
          ),
          payload: preflight,
        }
      },
      executeLocked: async (tx, scope, preflight) => {
        const materialized = await materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          preflight.identity,
        )
        if (!materialized.ok) throw new Error(materialized.error)
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'quick_insert',
          origin: createCounterTicketOriginV1(),
          identity: materialized.materialized,
          receipt: parsed.value.receipt,
          template: null,
        })).toThrow('trusted_ticket_origin_invalid')
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'quick_insert',
          origin: createQuickTicketOriginV1(kernelUuid(1092)),
          identity: materialized.materialized,
          receipt: parsed.value.receipt,
          template: null,
        })).toThrow('trusted_ticket_origin_invalid')
        return resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'quick_insert',
          origin: createQuickTicketOriginV1(requestKey),
          identity: materialized.materialized,
          receipt: parsed.value.receipt,
          template: null,
        })
      },
    })
    expect(Object.getPrototypeOf(quickResolved)).toBe(null)
    expect(Reflect.ownKeys(quickResolved)).toEqual([])
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('rejects canonical Quick receipt A bound to materialized identity B by vehicle or mileage', async () => {
    const otherCustomerId = kernelUuid(1053)
    const otherVehicleId = kernelUuid(1054)
    await db.insert(customers).values({
      id: otherCustomerId,
      shopId,
      name: 'Other Quick Customer',
      phone: '555-1053',
      email: 'other-quick@example.com',
    })
    await db.insert(vehicles).values({
      id: otherVehicleId,
      customerId: otherCustomerId,
      year: 2019,
      make: 'Ford',
      model: 'Escape',
      mileage: 50_000,
      vin: '1FMCU0F70KUA10540',
    })
    const requestKey = kernelUuid(1055)
    const parsed = parseQuickTicketRequestV1({
      vehicleMode: 'existing',
      existingVehicleId: vehicleId,
      mileage: 42_000,
      clientKey: requestKey,
      quote: { mode: 'manual', kind: 'repair', description: 'Identity-bound Quick' },
    })
    if (!parsed.ok) throw new Error(parsed.error)

    for (const [index, identityInput] of [
      {
        mode: 'existing_vehicle' as const,
        shopId,
        existingVehicleId: otherVehicleId,
        mileage: 42_000,
      },
      {
        mode: 'existing_vehicle' as const,
        shopId,
        existingVehicleId: vehicleId,
        mileage: 43_000,
      },
    ].entries()) {
      const ticketId = kernelUuid(1056 + index * 2)
      const jobId = kernelUuid(1057 + index * 2)
      await expect(runBoundedShopOsMutationV1(db, {
        discover: async (tx, attempt) => {
          const identity = await preflightTicketIntakeIdentityV1(
            tx,
            attempt.capability,
            identityInput,
          )
          if (!identity.ok) throw new Error(identity.error)
          return {
            lockRequest: quickPreparedLockRequest(
              identity.lockPlan,
              requestKey,
              ticketId,
              jobId,
            ),
            payload: identity,
          }
        },
        executeLocked: async (tx, scope, identity) => {
          const materialized = await materializeTicketIntakeIdentityInLockedScopeV1(
            tx,
            scope,
            identity.identity,
          )
          if (!materialized.ok) throw new Error(materialized.error)
          return resolveTicketCreationInLockedScopeV1(tx, scope, {
            mode: 'quick_insert',
            origin: createQuickTicketOriginV1(requestKey),
            identity: materialized.materialized,
            receipt: parsed.value.receipt,
            template: null,
          })
        },
      })).rejects.toThrow('ticket_creation_kernel_invalid')
    }
    expect((await db.select().from(vehicles).where(eq(vehicles.id, vehicleId)))[0])
      .toMatchObject({ mileage: 41_000 })
    expect((await db.select().from(vehicles).where(eq(vehicles.id, otherVehicleId)))[0])
      .toMatchObject({ mileage: 50_000 })
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('resolves Quick replay only from one owned receipt and its complete locked result graph', async () => {
    const requestKey = kernelUuid(1060)
    const resultTicketId = kernelUuid(1061)
    const resultJobId = kernelUuid(1062)
    await db.insert(tickets).values({
      id: resultTicketId,
      shopId,
      ticketNumber: 90,
      source: 'quick_quote',
      customerId,
      vehicleId,
      concern: 'Replace boost hose',
      projectionRevision: 1n,
      continuityRevision: 1n,
      createdByProfileId: ownerProfileId,
    })
    await db.insert(ticketJobs).values({
      id: resultJobId,
      shopId,
      ticketId: resultTicketId,
      title: 'Replace boost hose',
      kind: 'repair',
      requiredSkillTier: 2,
      sequenceNumber: 1,
      revision: 1n,
      createdByProfileId: ownerProfileId,
      creatorProvenance: 'direct',
    })
    const parsed = parseQuickTicketRequestV1({
      vehicleMode: 'existing',
      existingVehicleId: vehicleId,
      mileage: null,
      clientKey: requestKey,
      quote: {
        mode: 'manual',
        kind: 'repair',
        description: 'Replace boost hose',
      },
    })
    if (!parsed.ok) throw new Error(parsed.error)
    const canonical = consumeCanonicalQuickReceiptRequestForCreationV1(
      parsed.value.receipt,
    )
    const keyring = createMutationFingerprintKeyringV1({
      SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1',
      SHOP_OS_MUTATION_HMAC_KEYS_B64: `1:${Buffer.alloc(32, 7).toString('base64')}`,
    })
    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          ticketIds: [resultTicketId],
          jobIds: [resultJobId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          receiptRequestKey: requestKey,
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => insertMutationReceiptPrimitiveV1(
        tx,
        scope,
        {
          requestKey,
          mutationKind: 'create_repair_order',
          mutationSchemaVersion: 1,
          targetTicketId: null,
          envelope: {
            ...canonical.base,
            operationOrigin: 'quick_quote',
            actorProfileId: ownerProfileId,
          },
          keyring,
          resultTicketId,
          resultJobIds: [resultJobId],
        },
      ),
    })

    const replay = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({ receiptRequestKey: requestKey }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'replay',
          origin: createQuickTicketOriginV1(requestKey),
          resultTicketId,
          receipt: parsed.value.receipt,
        })
        await expect(insertResolvedTicketBatchInTransactionV1(
          tx,
          scope,
          resolved,
        )).rejects.toThrow('ticket_creation_kernel_invalid')
        await expect(finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          [{
            ticketId: resultTicketId,
            createdTicket: true,
            createdJobIds: [],
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )).rejects.toThrow('ticket_creation_kernel_invalid')
        const replayAsFinalized = resolved as unknown as Parameters<
          typeof readFinalizedTicketCreationResultV1
        >[2]
        expect(() => readFinalizedTicketCreationResultV1(
          tx,
          scope,
          replayAsFinalized,
        )).toThrow('ticket_creation_kernel_invalid')
        await expect(insertResolvedTicketCreationReceiptInTransactionV1(
          tx,
          scope,
          replayAsFinalized,
          keyring,
        )).rejects.toThrow('ticket_creation_kernel_invalid')
        return Object.freeze({
          resolved,
          envelope: buildResolvedTicketCreationEnvelopeV1(tx, scope, resolved),
        })
      },
    })
    expect(Object.getPrototypeOf(replay.resolved)).toBe(null)
    expect(replay.envelope).toEqual({
      ...canonical.base,
      operationOrigin: 'quick_quote',
      actorProfileId: ownerProfileId,
    })
  })

  it('inserts one owned Counter batch with exact numbering, sequences, provenance, revisions, and derived seed fields', async () => {
    const ticketId = kernelUuid(1070)
    const jobIds = [kernelUuid(1071), kernelUuid(1072), kernelUuid(1073)]
    const callerTicket = normalizedTicket(ticketId)
    const callerJobs = [
      normalizedJob(jobIds[0]!, { title: 'Inspect brakes' }),
      normalizedJob(jobIds[1]!, {
        title: 'Replace pads',
        kind: 'repair',
        requiredSkillTier: 3,
      }),
      normalizedJob(jobIds[2]!, {
        title: 'Shop supplies',
        kind: 'maintenance',
        requiredSkillTier: 1,
      }),
    ]
    const partLine = {
      kind: 'part' as const,
      description: 'Brake pad set',
      sort: 10,
      priceCents: 8_500,
      taxable: true,
      quantity: 2,
      partNumber: 'PAD-100',
      brand: 'Example',
    }
    const laborLine = {
      kind: 'labor' as const,
      description: 'Brake labor',
      sort: 20,
      priceCents: 15_000,
      taxable: false,
      laborHours: 1.5,
      laborRateCents: 10_000,
    }
    const feeLine = {
      kind: 'fee' as const,
      description: 'Shop supplies',
      sort: 30,
      priceCents: 500,
      taxable: true,
    }
    const callerSeeds = new Map<number, NormalizedJobLineCreateV1[]>([
      [0, [partLine]],
      [1, [laborLine]],
      [2, [feeLine]],
    ])

    await expect(runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: ticketInsertionIntents(ticketId, jobIds),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin: createCounterTicketOriginV1(),
          ticket: callerTicket,
          jobs: callerJobs,
          seededLinesByJobIndex: callerSeeds,
        })
        ;(callerTicket as { concern: string }).concern = 'caller mutation'
        ;(callerJobs[0] as { title: string }).title = 'caller mutation'
        partLine.description = 'caller mutation'
        callerSeeds.clear()

        const batch = await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
        expect(batch).toEqual({ ticketId, jobIds })
        expect(Object.isFrozen(batch)).toBe(true)
        expect(Object.isFrozen(batch.jobIds)).toBe(true)
        await expect(
          insertResolvedTicketBatchInTransactionV1(tx, scope, resolved),
        ).rejects.toThrow('ticket_creation_kernel_invalid')

        const [insertedTicket] = await tx.select().from(tickets)
          .where(eq(tickets.id, ticketId))
        expect(insertedTicket).toMatchObject({
          ticketNumber: 41,
          source: 'counter',
          customerId,
          vehicleId,
          concern: 'Diagnose front-end noise',
          projectionRevision: 1n,
          continuityRevision: 1n,
          createdByProfileId: ownerProfileId,
        })
        const insertedJobs = await tx.select().from(ticketJobs)
          .where(eq(ticketJobs.ticketId, ticketId))
          .orderBy(ticketJobs.sequenceNumber)
        expect(insertedJobs.map((job) => ({
          id: job.id,
          title: job.title,
          sequenceNumber: job.sequenceNumber,
          revision: job.revision,
          createdByProfileId: job.createdByProfileId,
          creatorProvenance: job.creatorProvenance,
        }))).toEqual([
          {
            id: jobIds[0], title: 'Inspect brakes', sequenceNumber: 1, revision: 1n,
            createdByProfileId: ownerProfileId, creatorProvenance: 'direct',
          },
          {
            id: jobIds[1], title: 'Replace pads', sequenceNumber: 2, revision: 1n,
            createdByProfileId: ownerProfileId, creatorProvenance: 'direct',
          },
          {
            id: jobIds[2], title: 'Shop supplies', sequenceNumber: 3, revision: 1n,
            createdByProfileId: ownerProfileId, creatorProvenance: 'direct',
          },
        ])
        const insertedLines = await tx.select().from(jobLines)
          .orderBy(jobLines.sort)
        expect(insertedLines.map((line) => ({
          shopId: line.shopId,
          jobId: line.jobId,
          kind: line.kind,
          description: line.description,
          quantity: line.quantity,
          partNumber: line.partNumber,
          brand: line.brand,
          laborHours: line.laborHours,
          laborRateCents: line.laborRateCents,
          source: line.source,
          partStatus: line.partStatus,
          unitCostCents: line.unitCostCents,
          coreChargeCents: line.coreChargeCents,
          fitment: line.fitment,
          vendorAccountId: line.vendorAccountId,
          externalOfferId: line.externalOfferId,
          vendorSnapshot: line.vendorSnapshot,
          orderedAt: line.orderedAt,
          orderedByProfileId: line.orderedByProfileId,
          receivedAt: line.receivedAt,
          receivedByProfileId: line.receivedByProfileId,
        }))).toEqual([
          {
            shopId, jobId: jobIds[0], kind: 'part', description: 'Brake pad set',
            quantity: 2, partNumber: 'PAD-100', brand: 'Example',
            laborHours: null, laborRateCents: null, source: 'manual',
            partStatus: 'proposed', unitCostCents: null, coreChargeCents: null,
            fitment: null, vendorAccountId: null, externalOfferId: null,
            vendorSnapshot: null, orderedAt: null, orderedByProfileId: null,
            receivedAt: null, receivedByProfileId: null,
          },
          {
            shopId, jobId: jobIds[1], kind: 'labor', description: 'Brake labor',
            quantity: 1, partNumber: null, brand: null,
            laborHours: 1.5, laborRateCents: 10_000, source: 'manual',
            partStatus: 'proposed', unitCostCents: null, coreChargeCents: null,
            fitment: null, vendorAccountId: null, externalOfferId: null,
            vendorSnapshot: null, orderedAt: null, orderedByProfileId: null,
            receivedAt: null, receivedByProfileId: null,
          },
          {
            shopId, jobId: jobIds[2], kind: 'fee', description: 'Shop supplies',
            quantity: 1, partNumber: null, brand: null,
            laborHours: null, laborRateCents: null, source: 'manual',
            partStatus: 'proposed', unitCostCents: null, coreChargeCents: null,
            fitment: null, vendorAccountId: null, externalOfferId: null,
            vendorSnapshot: null, orderedAt: null, orderedByProfileId: null,
            receivedAt: null, receivedByProfileId: null,
          },
        ])
        throw new Error('rollback_after_kernel_insert')
      },
    })).rejects.toThrow('rollback_after_kernel_insert')

    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
    expect(await db.select().from(jobLines)).toEqual([])
    const [shop] = await db.select().from(shops).where(eq(shops.id, shopId))
    expect(shop.nextTicketNumber).toBe(41)
  })

  it('finalizes Counter and same-transaction Tech creation once before exposing safe result IDs', async () => {
    const counterTicketId = kernelUuid(1080)
    const counterJobId = kernelUuid(1081)
    const counter = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: ticketInsertionIntents(counterTicketId, [counterJobId]),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin: createCounterTicketOriginV1(),
          ticket: normalizedTicket(counterTicketId),
          jobs: [normalizedJob(counterJobId)],
          seededLinesByJobIndex: new Map(),
        })
        await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
        expect(() => buildResolvedTicketCreationEnvelopeV1(tx, scope, resolved))
          .toThrow('ticket_creation_kernel_invalid')
        const finalized = await finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          [{
            ticketId: counterTicketId,
            createdTicket: true,
            createdJobIds: [counterJobId],
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )
        expect(Object.getPrototypeOf(finalized)).toBe(null)
        expect(Object.isFrozen(finalized)).toBe(true)
        expect(Reflect.ownKeys(finalized)).toEqual([])
        await expect(finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          [{
            ticketId: counterTicketId,
            createdTicket: true,
            createdJobIds: [counterJobId],
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )).rejects.toThrow('ticket_creation_kernel_invalid')
        return readFinalizedTicketCreationResultV1(tx, scope, finalized)
      },
    })
    expect(counter).toEqual({ ticketId: counterTicketId, jobIds: [counterJobId] })
    expect(Object.isFrozen(counter)).toBe(true)
    expect(Object.isFrozen(counter.jobIds)).toBe(true)

    const sessionId = kernelUuid(1082)
    const techTicketId = kernelUuid(1083)
    const techJobId = kernelUuid(1084)
    const tech = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          actorProfileId: techProfileId,
          profileIds: [techProfileId],
          lockShop: true,
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: {
            ...ticketInsertionIntents(techTicketId, [techJobId]),
            sessions: [{ id: sessionId, shopId, techId: techProfileId }],
          },
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        await tx.insert(sessions).values({
          id: sessionId,
          shopId,
          techId: techProfileId,
          vehicleId: null,
          intake: {
            vehicleYear: 2020,
            vehicleMake: 'Unknown',
            vehicleModel: 'Unknown',
            customerComplaint: 'No-start diagnosis',
          },
          treeState: {
            nodes: [],
            currentNodeId: 'root',
            message: 'Open',
            done: false,
          },
        })
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin: createTechQuickTicketOriginV1(sessionId),
          ticket: normalizedTicket(techTicketId, {
            customerId: null,
            vehicleId: null,
            concern: 'No-start diagnosis',
            whenStarted: null,
            howOften: null,
            diagnosticAuthorizedCents: null,
            diagnosticAuthorizationNote: null,
          }),
          jobs: [normalizedJob(techJobId, {
            title: 'No-start diagnosis',
            assignedTechId: techProfileId,
            sessionId,
          })],
          seededLinesByJobIndex: new Map(),
        })
        await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
        const finalized = await finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          [{
            ticketId: techTicketId,
            createdTicket: true,
            createdJobIds: [techJobId],
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )
        return readFinalizedTicketCreationResultV1(tx, scope, finalized)
      },
    })
    expect(tech).toEqual({ ticketId: techTicketId, jobIds: [techJobId] })
    const [persistedTechTicket] = await db.select().from(tickets)
      .where(eq(tickets.id, techTicketId))
    const [persistedTechJob] = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.id, techJobId))
    expect(persistedTechTicket).toMatchObject({
      source: 'tech_quick',
      customerId: null,
      vehicleId: null,
      projectionRevision: 1n,
      continuityRevision: 1n,
    })
    expect(persistedTechJob).toMatchObject({
      sessionId,
      assignedTechId: techProfileId,
      revision: 1n,
      sequenceNumber: 1,
    })
  })

  it('bridges one finalized manual Quick batch to an immutable receipt and classifies exact replay', async () => {
    const requestKey = kernelUuid(1090)
    const quickTicketId = kernelUuid(1091)
    const quickJobId = kernelUuid(1092)
    const body = {
      vehicleMode: 'existing' as const,
      existingVehicleId: vehicleId,
      mileage: 42_500,
      clientKey: requestKey,
      quote: {
        mode: 'manual' as const,
        kind: 'maintenance' as const,
        description: 'Perform transmission service',
      },
    }
    const parsed = parseQuickTicketRequestV1(body)
    if (!parsed.ok) throw new Error(parsed.error)
    const keyring = createMutationFingerprintKeyringV1({
      SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1',
      SHOP_OS_MUTATION_HMAC_KEYS_B64: `1:${Buffer.alloc(32, 9).toString('base64')}`,
    })
    const identityInput: TicketIntakeIdentityInputV1 = {
      mode: 'existing_vehicle',
      shopId,
      existingVehicleId: vehicleId,
      mileage: 42_500,
    }

    const created = await runBoundedShopOsMutationV1(db, {
      discover: async (tx, attempt) => {
        const identity = await preflightTicketIntakeIdentityV1(
          tx,
          attempt.capability,
          identityInput,
        )
        if (!identity.ok) throw new Error(identity.error)
        return {
          lockRequest: quickPreparedLockRequest(
            identity.lockPlan,
            requestKey,
            quickTicketId,
            quickJobId,
          ),
          payload: identity,
        }
      },
      executeLocked: async (tx, scope, identity) => {
        const materialized = await materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          identity.identity,
        )
        if (!materialized.ok) throw new Error(materialized.error)
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'quick_insert',
          origin: createQuickTicketOriginV1(requestKey),
          identity: materialized.materialized,
          receipt: parsed.value.receipt,
          template: null,
        })
        expect(await classifyResolvedTicketCreationReceiptInTransactionV1(
          tx,
          scope,
          resolved,
          keyring,
        )).toEqual({ kind: 'missing' })
        expect(buildResolvedTicketCreationEnvelopeV1(tx, scope, resolved)).toEqual({
          schemaVersion: 1,
          mutationKind: 'create_repair_order',
          operationOrigin: 'quick_quote',
          actorProfileId: ownerProfileId,
          target: {},
          candidates: [],
          payload: body,
        })
        await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
        const finalized = await finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          [{
            ticketId: quickTicketId,
            createdTicket: true,
            createdJobIds: [quickJobId],
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )
        expect(() => readFinalizedTicketCreationResultV1(tx, scope, finalized))
          .toThrow('ticket_creation_kernel_invalid')
        const result = await insertResolvedTicketCreationReceiptInTransactionV1(
          tx,
          scope,
          finalized,
          keyring,
        )
        await expect(insertResolvedTicketCreationReceiptInTransactionV1(
          tx,
          scope,
          finalized,
          keyring,
        )).rejects.toThrow('ticket_creation_kernel_invalid')
        return result
      },
    })
    expect(created).toEqual({ ticketId: quickTicketId, jobIds: [quickJobId] })
    const [persistedTicket] = await db.select().from(tickets)
      .where(eq(tickets.id, quickTicketId))
    const [persistedJob] = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.id, quickJobId))
    expect(persistedTicket).toMatchObject({
      source: 'quick_quote',
      concern: 'Perform transmission service',
      customerId,
      vehicleId,
      projectionRevision: 1n,
      continuityRevision: 1n,
    })
    expect(persistedJob).toMatchObject({
      title: 'Perform transmission service',
      kind: 'maintenance',
      requiredSkillTier: 1,
      sequenceNumber: 1,
      revision: 1n,
      createdByProfileId: ownerProfileId,
      creatorProvenance: 'direct',
    })
    expect(await db.select().from(ticketMutationReceipts)).toHaveLength(1)
    expect(await db.select().from(ticketMutationReceiptJobs)).toEqual([
      expect.objectContaining({
        resultTicketId: quickTicketId,
        resultJobCount: 1,
        ordinal: 0,
        jobId: quickJobId,
      }),
    ])

    const laterJobId = kernelUuid(1093)
    await db.insert(ticketJobs).values({
      id: laterJobId,
      shopId,
      ticketId: quickTicketId,
      title: 'Later added inspection',
      kind: 'diagnostic',
      requiredSkillTier: 2,
      sequenceNumber: 2,
      revision: 1n,
      createdByProfileId: ownerProfileId,
      creatorProvenance: 'direct',
    })

    const beforeReplay = {
      ticketCount: (await db.select().from(tickets)).length,
      jobCount: (await db.select().from(ticketJobs)).length,
      lineCount: (await db.select().from(jobLines)).length,
      nextTicketNumber: (await db.select().from(shops)
        .where(eq(shops.id, shopId)))[0]!.nextTicketNumber,
    }
    const replay = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({ receiptRequestKey: requestKey }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'replay',
          origin: createQuickTicketOriginV1(requestKey),
          resultTicketId: quickTicketId,
          receipt: parsed.value.receipt,
        })
        return classifyResolvedTicketCreationReceiptInTransactionV1(
          tx,
          scope,
          resolved,
          keyring,
        )
      },
    })
    expect(replay).toEqual({
      kind: 'replay',
      ticketId: quickTicketId,
      jobIds: [quickJobId],
    })
    expect((await db.select().from(ticketJobs)
      .where(eq(ticketJobs.ticketId, quickTicketId))).map(({ id }) => id).sort())
      .toEqual([laterJobId, quickJobId].sort())
    expect(await db.select().from(ticketMutationReceiptJobs)).toEqual([
      expect.objectContaining({
        resultTicketId: quickTicketId,
        resultJobCount: 1,
        ordinal: 0,
        jobId: quickJobId,
      }),
    ])
    expect({
      ticketCount: (await db.select().from(tickets)).length,
      jobCount: (await db.select().from(ticketJobs)).length,
      lineCount: (await db.select().from(jobLines)).length,
      nextTicketNumber: (await db.select().from(shops)
        .where(eq(shops.id, shopId)))[0]!.nextTicketNumber,
    }).toEqual(beforeReplay)

    const changed = parseQuickTicketRequestV1({
      ...body,
      quote: { ...body.quote, description: 'Changed service' },
    })
    if (!changed.ok) throw new Error(changed.error)
    const conflict = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({ receiptRequestKey: requestKey }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'replay',
          origin: createQuickTicketOriginV1(requestKey),
          resultTicketId: quickTicketId,
          receipt: changed.value.receipt,
        })
        return classifyResolvedTicketCreationReceiptInTransactionV1(
          tx,
          scope,
          resolved,
          keyring,
        )
      },
    })
    expect(conflict).toEqual({ kind: 'conflict' })
  })

  it('creates a genuine canned Quick batch with exact decimal lines, receipt, and replay', async () => {
    const createdCanned = await createCannedJob(db, {
      actor: { profileId: ownerProfileId },
      clientKey: kernelUuid(1094),
      body: {
        title: 'Precision canned service',
        kind: 'repair',
        defaultRequiredSkillTier: 3,
        sort: 7,
        lines: [
          {
            kind: 'part',
            description: 'Precision additive',
            sort: 1,
            priceCents: 1_001,
            taxable: true,
            quantity: '1.001',
            partNumber: 'P-1001',
            brand: 'Kernel',
          },
          {
            kind: 'labor',
            description: 'Precision labor',
            sort: 2,
            priceCents: 2_900,
            taxable: false,
            hours: '0.29',
            laborRateCents: 10_000,
          },
          {
            kind: 'fee',
            description: 'Precision fee',
            sort: 3,
            priceCents: 99,
            taxable: true,
          },
        ],
      },
    })
    if (!createdCanned.ok) throw new Error(createdCanned.error)

    const requestKey = kernelUuid(1095)
    const ticketId = kernelUuid(1096)
    const jobId = kernelUuid(1097)
    const body = {
      vehicleMode: 'existing' as const,
      existingVehicleId: vehicleId,
      mileage: null,
      clientKey: requestKey,
      quote: {
        mode: 'canned' as const,
        cannedJobId: createdCanned.cannedJob.id,
        expectedFingerprint: createdCanned.cannedJob.fingerprint,
        expectedTaxRateBps: 825,
      },
    }
    const parsed = parseQuickTicketRequestV1(body)
    if (!parsed.ok) throw new Error(parsed.error)
    const keyring = createMutationFingerprintKeyringV1({
      SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1',
      SHOP_OS_MUTATION_HMAC_KEYS_B64: `1:${Buffer.alloc(32, 11).toString('base64')}`,
    })

    const created = await runBoundedShopOsMutationV1(db, {
      discover: async (tx, attempt) => {
        const [identity, template] = await Promise.all([
          preflightTicketIntakeIdentityV1(tx, attempt.capability, {
            mode: 'existing_vehicle',
            shopId,
            existingVehicleId: vehicleId,
            mileage: null,
          }),
          preflightStrictCannedJobV1(tx, attempt.capability, {
            shopId,
            cannedJobId: createdCanned.cannedJob.id,
            expectedFingerprint: createdCanned.cannedJob.fingerprint,
            expectedTaxRateBps: 825,
          }),
        ])
        if (!identity.ok) throw new Error(identity.error)
        if (!template.ok) throw new Error(template.error)
        return {
          lockRequest: quickPreparedLockRequest(
            identity.lockPlan,
            requestKey,
            ticketId,
            jobId,
            template.cannedJobIds,
          ),
          payload: { identity, template },
        }
      },
      executeLocked: async (tx, scope, preflight) => {
        const identity = await materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          preflight.identity.identity,
        )
        if (!identity.ok) throw new Error(identity.error)
        const template = resolveStrictCannedJobInLockedScopeV1(
          tx,
          scope,
          preflight.template.template,
        )
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'quick_insert',
          origin: createQuickTicketOriginV1(requestKey),
          identity: identity.materialized,
          receipt: parsed.value.receipt,
          template,
        })
        await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
        const finalized = await finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          [{
            ticketId,
            createdTicket: true,
            createdJobIds: [jobId],
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )
        return insertResolvedTicketCreationReceiptInTransactionV1(
          tx,
          scope,
          finalized,
          keyring,
        )
      },
    })
    expect(created).toEqual({ ticketId, jobIds: [jobId] })
    expect(await db.select().from(jobLines).where(eq(jobLines.jobId, jobId)))
      .toEqual([
        expect.objectContaining({
          kind: 'part',
          quantity: 1.001,
          laborHours: null,
          source: 'manual',
          unitCostCents: null,
          vendorAccountId: null,
        }),
        expect.objectContaining({
          kind: 'labor',
          quantity: 1,
          laborHours: 0.29,
          source: 'manual',
          unitCostCents: null,
          vendorAccountId: null,
        }),
        expect.objectContaining({
          kind: 'fee',
          quantity: 1,
          laborHours: null,
          source: 'manual',
          unitCostCents: null,
          vendorAccountId: null,
        }),
      ])

    const replay = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({ receiptRequestKey: requestKey }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'replay',
          origin: createQuickTicketOriginV1(requestKey),
          resultTicketId: ticketId,
          receipt: parsed.value.receipt,
        })
        return classifyResolvedTicketCreationReceiptInTransactionV1(
          tx,
          scope,
          resolved,
          keyring,
        )
      },
    })
    expect(replay).toEqual({ kind: 'replay', ticketId, jobIds: [jobId] })
  })

  it('rejects canned Quick receipt A bound to a different genuine locked template B', async () => {
    const cannedBody = (title: string, priceCents: number) => ({
      title,
      kind: 'repair' as const,
      defaultRequiredSkillTier: 2 as const,
      sort: 0,
      lines: [{
        kind: 'fee' as const,
        description: `${title} fee`,
        sort: 0,
        priceCents,
        taxable: true,
      }],
    })
    const cannedA = await createCannedJob(db, {
      actor: { profileId: ownerProfileId },
      clientKey: kernelUuid(1098),
      body: cannedBody('Canned A', 100),
    })
    const cannedB = await createCannedJob(db, {
      actor: { profileId: ownerProfileId },
      clientKey: kernelUuid(1099),
      body: cannedBody('Canned B', 200),
    })
    if (!cannedA.ok) throw new Error(cannedA.error)
    if (!cannedB.ok) throw new Error(cannedB.error)
    const requestKey = kernelUuid(1132)
    const parseReceipt = (
      fingerprint: string,
      expectedTaxRateBps: number,
    ) => parseQuickTicketRequestV1({
      vehicleMode: 'existing',
      existingVehicleId: vehicleId,
      mileage: null,
      clientKey: requestKey,
      quote: {
        mode: 'canned',
        cannedJobId: cannedA.cannedJob.id,
        expectedFingerprint: fingerprint,
        expectedTaxRateBps,
      },
    })
    const originalReceipt = parseReceipt(cannedA.cannedJob.fingerprint, 825)
    if (!originalReceipt.ok) throw new Error(originalReceipt.error)
    const cannedIdOnlyReceipt = parseReceipt(cannedB.cannedJob.fingerprint, 825)
    if (!cannedIdOnlyReceipt.ok) throw new Error(cannedIdOnlyReceipt.error)

    const expectMismatch = async (
      receipt: typeof originalReceipt.value.receipt,
      template: Readonly<{
        id: string
        fingerprint: string
        expectedTaxRateBps: number
      }>,
      suffix: number,
    ) => {
      await expect(runBoundedShopOsMutationV1(db, {
        discover: async (tx, attempt) => {
          const [identity, canned] = await Promise.all([
            preflightTicketIntakeIdentityV1(tx, attempt.capability, {
              mode: 'existing_vehicle',
              shopId,
              existingVehicleId: vehicleId,
              mileage: null,
            }),
            preflightStrictCannedJobV1(tx, attempt.capability, {
              shopId,
              cannedJobId: template.id,
              expectedFingerprint: template.fingerprint,
              expectedTaxRateBps: template.expectedTaxRateBps,
            }),
          ])
          if (!identity.ok) throw new Error(identity.error)
          if (!canned.ok) throw new Error(canned.error)
          return {
            lockRequest: quickPreparedLockRequest(
              identity.lockPlan,
              requestKey,
              kernelUuid(suffix),
              kernelUuid(suffix + 1),
              canned.cannedJobIds,
            ),
            payload: { identity, canned },
          }
        },
        executeLocked: async (tx, scope, preflight) => {
          const identity = await materializeTicketIntakeIdentityInLockedScopeV1(
            tx,
            scope,
            preflight.identity.identity,
          )
          if (!identity.ok) throw new Error(identity.error)
          const template = resolveStrictCannedJobInLockedScopeV1(
            tx,
            scope,
            preflight.canned.template,
          )
          return resolveTicketCreationInLockedScopeV1(tx, scope, {
            mode: 'quick_insert',
            origin: createQuickTicketOriginV1(requestKey),
            identity: identity.materialized,
            receipt,
            template,
          })
        },
      })).rejects.toThrow('ticket_creation_kernel_invalid')
    }

    await expectMismatch(cannedIdOnlyReceipt.value.receipt, {
      id: cannedB.cannedJob.id,
      fingerprint: cannedB.cannedJob.fingerprint,
      expectedTaxRateBps: 825,
    }, 1133)

    const replacedA = await replaceCannedJob(db, {
      actor: { profileId: ownerProfileId },
      cannedJobId: cannedA.cannedJob.id,
      expectedFingerprint: cannedA.cannedJob.fingerprint,
      body: cannedBody('Canned A revised', 300),
    })
    if (!replacedA.ok) throw new Error(replacedA.error)
    await expectMismatch(originalReceipt.value.receipt, {
      id: replacedA.cannedJob.id,
      fingerprint: replacedA.cannedJob.fingerprint,
      expectedTaxRateBps: 825,
    }, 1135)

    const taxReceipt = parseReceipt(replacedA.cannedJob.fingerprint, 825)
    if (!taxReceipt.ok) throw new Error(taxReceipt.error)
    await db.update(shops).set({ taxRateBps: 900 }).where(eq(shops.id, shopId))
    await expectMismatch(taxReceipt.value.receipt, {
      id: replacedA.cannedJob.id,
      fingerprint: replacedA.cannedJob.fingerprint,
      expectedTaxRateBps: 900,
    }, 1137)
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('binds new/new and existing-customer/new-vehicle materialization to exact private created manifests', async () => {
    const intakeTicketId = kernelUuid(1100)
    const intakeJobId = kernelUuid(1101)
    const newIdentity: TicketIntakeIdentityInputV1 = {
      mode: 'new_vehicle',
      shopId,
      customer: {
        name: 'New Customer',
        phone: '555-NEW-1100',
        email: 'new@example.com',
      },
      vehicle: {
        year: 2021,
        make: 'Toyota',
        model: 'Tacoma',
        engine: '3.5L',
        vin: '3TMCZ5AN1MM110001',
        mileage: 12_000,
        plate: 'NEW1100',
      },
    }
    const intake = await runBoundedShopOsMutationV1(db, {
      discover: async (tx, attempt) => {
        const identity = await preflightTicketIntakeIdentityV1(
          tx,
          attempt.capability,
          newIdentity,
        )
        if (!identity.ok) throw new Error(identity.error)
        return {
          lockRequest: lockRequest({
            lockShop: true,
            customerIds: identity.lockPlan.customerIds,
            vehicleIds: identity.lockPlan.vehicleIds,
            includeAllJobsForTickets: true,
            includeAllLinesForJobs: true,
            insertionIntents: {
              ...ticketInsertionIntents(intakeTicketId, [intakeJobId]),
              customers: identity.lockPlan.insertionIntents.customers,
              vehicles: identity.lockPlan.insertionIntents.vehicles,
            },
          }),
          payload: identity,
        }
      },
      executeLocked: async (tx, scope, identity) => {
        const materialized = await materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          identity.identity,
        )
        if (!materialized.ok) throw new Error(materialized.error)
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'intake_insert',
          origin: createCounterTicketOriginV1(),
          ticket: {
            id: intakeTicketId,
            concern: 'New identity concern',
            whenStarted: null,
            howOften: null,
            diagnosticAuthorizedCents: null,
            diagnosticAuthorizationNote: null,
          },
          identity: materialized.materialized,
          jobs: [normalizedJob(intakeJobId, { title: 'New identity concern' })],
          seededLinesByJobIndex: new Map(),
        })
        await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
        const finalized = await finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          [{
            ticketId: intakeTicketId,
            createdTicket: true,
            createdJobIds: [intakeJobId],
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )
        return readFinalizedTicketCreationResultV1(tx, scope, finalized)
      },
    })
    expect(intake).toEqual({ ticketId: intakeTicketId, jobIds: [intakeJobId] })
    const [newCustomer] = await db.select().from(customers)
      .where(eq(customers.phone, '555-NEW-1100'))
    const [newVehicle] = await db.select().from(vehicles)
      .where(eq(vehicles.vin, '3TMCZ5AN1MM110001'))
    const [intakeTicket] = await db.select().from(tickets)
      .where(eq(tickets.id, intakeTicketId))
    expect(newCustomer).toBeDefined()
    expect(newVehicle).toMatchObject({ customerId: newCustomer!.id })
    expect(intakeTicket).toMatchObject({
      customerId: newCustomer!.id,
      vehicleId: newVehicle!.id,
    })

    const requestKey = kernelUuid(1110)
    const quickTicketId = kernelUuid(1111)
    const quickJobId = kernelUuid(1112)
    const quickBody = {
      vehicleMode: 'new' as const,
      customer: {
        name: 'Kernel Customer',
        phone: '555-1004',
        email: 'kernel@example.com',
      },
      vehicle: {
        year: 2022,
        make: 'Mazda',
        model: 'CX-5',
        engine: '2.5L',
        vin: 'JM3KFBDM0N0111001',
        mileage: 9_000,
        plate: 'MIX1110',
      },
      clientKey: requestKey,
      quote: {
        mode: 'manual' as const,
        kind: 'repair' as const,
        description: 'Repair mixed identity vehicle',
      },
    }
    const quickParsed = parseQuickTicketRequestV1(quickBody)
    if (!quickParsed.ok) throw new Error(quickParsed.error)
    const keyring = createMutationFingerprintKeyringV1({
      SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1',
      SHOP_OS_MUTATION_HMAC_KEYS_B64: `1:${Buffer.alloc(32, 10).toString('base64')}`,
    })
    const quick = await runBoundedShopOsMutationV1(db, {
      discover: async (tx, attempt) => {
        const identity = await preflightTicketIntakeIdentityV1(
          tx,
          attempt.capability,
          {
            mode: 'new_vehicle',
            shopId,
            customer: quickBody.customer,
            vehicle: quickBody.vehicle,
          },
        )
        if (!identity.ok) throw new Error(identity.error)
        expect(identity.lockPlan.customerIds).toEqual([customerId])
        expect(identity.lockPlan.insertionIntents.customers).toEqual([])
        expect(identity.lockPlan.insertionIntents.vehicles).toHaveLength(1)
        return {
          lockRequest: quickPreparedLockRequest(
            identity.lockPlan,
            requestKey,
            quickTicketId,
            quickJobId,
          ),
          payload: identity,
        }
      },
      executeLocked: async (tx, scope, identity) => {
        const materialized = await materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          identity.identity,
        )
        if (!materialized.ok) throw new Error(materialized.error)
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'quick_insert',
          origin: createQuickTicketOriginV1(requestKey),
          identity: materialized.materialized,
          receipt: quickParsed.value.receipt,
          template: null,
        })
        await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
        const finalized = await finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          [{
            ticketId: quickTicketId,
            createdTicket: true,
            createdJobIds: [quickJobId],
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )
        return insertResolvedTicketCreationReceiptInTransactionV1(
          tx,
          scope,
          finalized,
          keyring,
        )
      },
    })
    expect(quick).toEqual({ ticketId: quickTicketId, jobIds: [quickJobId] })
    const matchingCustomers = await db.select().from(customers)
      .where(eq(customers.phone, '555-1004'))
    const [mixedVehicle] = await db.select().from(vehicles)
      .where(eq(vehicles.vin, 'JM3KFBDM0N0111001'))
    const [quickTicket] = await db.select().from(tickets)
      .where(eq(tickets.id, quickTicketId))
    expect(matchingCustomers).toHaveLength(1)
    expect(mixedVehicle).toMatchObject({ customerId })
    expect(quickTicket).toMatchObject({ customerId, vehicleId: mixedVehicle!.id })
  })

  it('independently rejects ticket, job, and seeded-line truth tampering and rolls each attempt back', async () => {
    const mutations = [
      async (tx: AppDb, ticketId: string, _jobId: string) => {
        await tx.update(tickets).set({
          status: 'closed',
          closedAt: new Date(),
          closedByProfileId: ownerProfileId,
          closeDisposition: 'customer_declined',
        }).where(eq(tickets.id, ticketId))
      },
      async (tx: AppDb, _ticketId: string, jobId: string) => {
        await tx.update(ticketJobs).set({ title: 'Tampered title' })
          .where(eq(ticketJobs.id, jobId))
      },
      async (tx: AppDb, _ticketId: string, jobId: string) => {
        await tx.update(jobLines).set({ priceCents: 999 })
          .where(eq(jobLines.jobId, jobId))
      },
    ] as const

    for (const [index, mutateOnlyOneTable] of mutations.entries()) {
      const ticketId = kernelUuid(1120 + index * 2)
      const jobId = kernelUuid(1121 + index * 2)
      await expect(runBoundedShopOsMutationV1(db, {
        discover: async () => ({
          lockRequest: lockRequest({
            lockShop: true,
            customerIds: [customerId],
            vehicleIds: [vehicleId],
            includeAllJobsForTickets: true,
            includeAllLinesForJobs: true,
            insertionIntents: ticketInsertionIntents(ticketId, [jobId]),
          }),
          payload: undefined,
        }),
        executeLocked: async (tx, scope) => {
          const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
            mode: 'insert',
            origin: createCounterTicketOriginV1(),
            ticket: normalizedTicket(ticketId),
            jobs: [normalizedJob(jobId, { title: 'Untampered title' })],
            seededLinesByJobIndex: new Map([[0, [{
              kind: 'fee',
              description: 'Untampered fee',
              sort: 1,
              priceCents: 100,
              taxable: true,
            }]]]),
          })
          await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
          await mutateOnlyOneTable(tx, ticketId, jobId)
          return finalizeResolvedTicketCreationInTransactionV1(
            tx,
            scope,
            resolved,
            [{
              ticketId,
              createdTicket: true,
              createdJobIds: [jobId],
              existingChangedJobIds: [],
              actorVisibleTicketFieldsChanged: true,
            }],
          )
        },
      })).rejects.toThrow('ticket_creation_kernel_invalid')
      expect(await db.select().from(tickets)).toEqual([])
      expect(await db.select().from(ticketJobs)).toEqual([])
      expect(await db.select().from(jobLines)).toEqual([])
      expect((await db.select().from(shops).where(eq(shops.id, shopId)))[0])
        .toMatchObject({ nextTicketNumber: 41 })
    }
  })

  it('rolls back ticket number and prior rows when ticket, job, or line insertion stages fail', async () => {
    const stages = [
      { table: 'tickets', suffix: 1270, marker: 'task_7b_ticket_stage' },
      { table: 'ticket_jobs', suffix: 1272, marker: 'task_7b_job_stage' },
      { table: 'job_lines', suffix: 1274, marker: 'task_7b_line_stage' },
    ] as const

    for (const stage of stages) {
      const functionName = `task_7b_fail_${stage.table}`
      const triggerName = `task_7b_trigger_${stage.table}`
      await db.execute(sql.raw(`
        create or replace function ${functionName}() returns trigger
        language plpgsql as $$
        begin
          raise exception '${stage.marker}';
        end;
        $$
      `))
      await db.execute(sql.raw(`
        create trigger ${triggerName}
        after insert on ${stage.table}
        for each row execute function ${functionName}()
      `))
      const ticketId = kernelUuid(stage.suffix)
      const jobId = kernelUuid(stage.suffix + 1)
      try {
        await expect(runBoundedShopOsMutationV1(db, {
          discover: async () => ({
            lockRequest: lockRequest({
              lockShop: true,
              customerIds: [customerId],
              vehicleIds: [vehicleId],
              includeAllJobsForTickets: true,
              includeAllLinesForJobs: true,
              insertionIntents: ticketInsertionIntents(ticketId, [jobId]),
            }),
            payload: undefined,
          }),
          executeLocked: async (tx, scope) => {
            const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
              mode: 'insert',
              origin: createCounterTicketOriginV1(),
              ticket: normalizedTicket(ticketId),
              jobs: [normalizedJob(jobId)],
              seededLinesByJobIndex: new Map([[0, [{
                kind: 'fee',
                description: 'Stage rollback seed',
                sort: 0,
                priceCents: 1,
                taxable: true,
              }]]]),
            })
            return insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
          },
        })).rejects.toThrow(`Failed query: insert into "${stage.table}"`)
      } finally {
        await db.execute(sql.raw(
          `drop trigger if exists ${triggerName} on ${stage.table}`,
        ))
        await db.execute(sql.raw(`drop function if exists ${functionName}()`))
      }
      expect(await db.select().from(tickets)).toEqual([])
      expect(await db.select().from(ticketJobs)).toEqual([])
      expect(await db.select().from(jobLines)).toEqual([])
      expect((await db.select().from(shops).where(eq(shops.id, shopId)))[0])
        .toMatchObject({ nextTicketNumber: 41 })
    }
  })

  it('accepts exactly 1 and 25 jobs while rejecting 0, 26, source, actor, and privileged seed inputs', async () => {
    const ticketId = kernelUuid(1140)
    const jobIds = Array.from({ length: 25 }, (_, index) => kernelUuid(1141 + index))
    const jobs = jobIds.map((id, index) => normalizedJob(id, {
      title: `Bounded job ${index + 1}`,
    }))
    const reusableOrigin = createCounterTicketOriginV1()

    const compileOnlyTicket: NormalizedTicketCreateV1 = {
      ...normalizedTicket(ticketId),
      // @ts-expect-error source authority is not caller ticket input
      source: 'counter',
    }
    const compileOnlyLine: NormalizedJobLineCreateV1 = {
      kind: 'fee',
      description: 'Compile-only privileged line',
      sort: 0,
      priceCents: 1,
      taxable: true,
      // @ts-expect-error persistence source is kernel-derived
      source: 'manual',
    }
    const compileOnlyRoot: ResolveTicketCreationInputV1 = {
      mode: 'insert',
      origin: reusableOrigin,
      ticket: normalizedTicket(ticketId),
      jobs,
      seededLinesByJobIndex: new Map(),
      // @ts-expect-error actor authority is never accepted from the caller
      actor: ownerProfileId,
    }
    void compileOnlyTicket
    void compileOnlyLine
    void compileOnlyRoot

    const acceptedTwentyFive = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: ticketInsertionIntents(ticketId, jobIds),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const base = {
          mode: 'insert' as const,
          origin: reusableOrigin,
          ticket: normalizedTicket(ticketId),
          seededLinesByJobIndex: new Map<number, readonly NormalizedJobLineCreateV1[]>(),
        }
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          ...base,
          jobs: [],
        })).toThrow('ticket_creation_kernel_invalid')
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          ...base,
          jobs: [...jobs, normalizedJob(kernelUuid(1166))],
        })).toThrow('ticket_creation_kernel_invalid')
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          ...base,
          ticket: {
            ...normalizedTicket(ticketId),
            source: 'counter',
          } as unknown as NormalizedTicketCreateV1,
          jobs,
        })).toThrow('ticket_creation_kernel_invalid')
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          ...base,
          ticket: {
            ...normalizedTicket(ticketId),
            createdByProfileId: ownerProfileId,
          } as unknown as NormalizedTicketCreateV1,
          jobs,
        })).toThrow('ticket_creation_kernel_invalid')
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          ...base,
          jobs: [
            { ...jobs[0]!, title: ' padded title ' },
            ...jobs.slice(1),
          ],
        })).toThrow('ticket_creation_kernel_invalid')
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          ...base,
          jobs,
          seededLinesByJobIndex: new Map([[0, [{
            kind: 'part',
            description: 'Over-precision part',
            sort: 0,
            priceCents: 1,
            taxable: true,
            quantity: 1.0001,
            partNumber: null,
            brand: null,
          }]]]),
        })).toThrow('ticket_creation_kernel_invalid')
        for (const [field, value] of [
          ['source', 'vendor_offer'],
          ['partStatus', 'ordered'],
          ['unitCostCents', 1],
          ['coreChargeCents', 1],
          ['fitment', 'caller supplied'],
          ['vendorAccountId', kernelUuid(1267)],
          ['externalOfferId', 'offer-1'],
          ['vendorSnapshot', { vendor: 'caller' }],
          ['orderedAt', new Date()],
          ['orderedByProfileId', ownerProfileId],
          ['receivedAt', new Date()],
          ['receivedByProfileId', ownerProfileId],
          ['id', kernelUuid(1268)],
          ['shopId', shopId],
          ['jobId', jobIds[0]],
          ['createdAt', new Date()],
          ['updatedAt', new Date()],
        ] as const) {
          expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
            ...base,
            jobs,
            seededLinesByJobIndex: new Map([[0, [{
              kind: 'fee',
              description: 'Privileged seed',
              sort: 0,
              priceCents: 1,
              taxable: true,
              [field]: value,
            } as unknown as NormalizedJobLineCreateV1]]]),
          }), field).toThrow('ticket_creation_kernel_invalid')
        }
        for (const field of ['actor', 'source'] as const) {
          expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
            ...base,
            jobs,
            [field]: field === 'actor' ? ownerProfileId : 'counter',
          } as unknown as ResolveTicketCreationInputV1), field)
            .toThrow('ticket_creation_kernel_invalid')
        }

        const accepted = resolveTicketCreationInLockedScopeV1(tx, scope, {
          ...base,
          jobs,
        })
        expect(Reflect.ownKeys(accepted)).toEqual([])
        await insertResolvedTicketBatchInTransactionV1(tx, scope, accepted)
        const finalized = await finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          accepted,
          [{
            ticketId,
            createdTicket: true,
            createdJobIds: jobIds,
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )
        return readFinalizedTicketCreationResultV1(tx, scope, finalized)
      },
    })
    expect(acceptedTwentyFive).toEqual({ ticketId, jobIds })
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId)))
      .map(({ sequenceNumber }) => sequenceNumber).sort((left, right) => left! - right!))
      .toEqual(Array.from({ length: 25 }, (_, index) => index + 1))

    const oneTicketId = kernelUuid(1167)
    const oneJobId = kernelUuid(1168)
    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: ticketInsertionIntents(oneTicketId, [oneJobId]),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin: reusableOrigin,
          ticket: normalizedTicket(oneTicketId),
          jobs: [normalizedJob(oneJobId)],
          seededLinesByJobIndex: new Map(),
        })).not.toThrow()
      },
    })
  })

  it('rejects every invalid assignee and unrelated or cross-ticket creation provenance in genuine scopes', async () => {
    const inactiveId = kernelUuid(1280)
    const deactivatedId = kernelUuid(1281)
    const tierlessId = kernelUuid(1282)
    const otherTechId = kernelUuid(1283)
    const otherShopId = kernelUuid(1284)
    const crossShopTechId = kernelUuid(1285)
    const crossTicketId = kernelUuid(1286)
    const crossTicketJobId = kernelUuid(1287)
    await db.insert(profiles).values([
      {
        id: inactiveId,
        userId: kernelUuid(1380),
        shopId,
        role: 'tech',
        skillTier: 2,
        membershipStatus: 'pending',
        membershipActivatedAt: null,
      },
      {
        id: deactivatedId,
        userId: kernelUuid(1381),
        shopId,
        role: 'tech',
        skillTier: 2,
        deactivatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        id: tierlessId,
        userId: kernelUuid(1382),
        shopId,
        role: 'parts',
        skillTier: null,
      },
      {
        id: otherTechId,
        userId: kernelUuid(1383),
        shopId,
        role: 'tech',
        skillTier: 2,
      },
    ])
    await db.insert(shops).values({
      id: otherShopId,
      name: 'Other Profile Shop',
      nextTicketNumber: 1,
      taxRateBps: 825,
    })
    await db.insert(profiles).values({
      id: crossShopTechId,
      userId: kernelUuid(1385),
      shopId: otherShopId,
      role: 'tech',
      skillTier: 2,
    })
    await db.insert(tickets).values({
      id: crossTicketId,
      shopId,
      ticketNumber: 99,
      source: 'counter',
      customerId,
      vehicleId,
      concern: 'Existing provenance ticket',
      projectionRevision: 1n,
      continuityRevision: 1n,
      createdByProfileId: ownerProfileId,
    })
    await db.insert(ticketJobs).values({
      id: crossTicketJobId,
      shopId,
      ticketId: crossTicketId,
      title: 'Existing provenance job',
      kind: 'repair',
      requiredSkillTier: 2,
      sequenceNumber: 1,
      revision: 1n,
      createdByProfileId: ownerProfileId,
      creatorProvenance: 'direct',
    })

    const expectInsertRejected = async (input: Readonly<{
      suffix: number
      actorProfileId?: string
      profileIds?: readonly string[]
      assignedTechId?: string | null
      requiredSkillTier?: 1 | 2 | 3
      createdFromJobId?: string | null
    }>) => {
      const ticketId = kernelUuid(input.suffix)
      const jobId = kernelUuid(input.suffix + 1)
      await expect(runBoundedShopOsMutationV1(db, {
        discover: async () => ({
          lockRequest: lockRequest({
            actorProfileId: input.actorProfileId ?? ownerProfileId,
            profileIds: input.profileIds ?? [ownerProfileId],
            lockShop: true,
            customerIds: [customerId],
            vehicleIds: [vehicleId],
            includeAllJobsForTickets: true,
            includeAllLinesForJobs: true,
            insertionIntents: ticketInsertionIntents(ticketId, [jobId]),
          }),
          payload: undefined,
        }),
        executeLocked: async (tx, scope) => resolveTicketCreationInLockedScopeV1(
          tx,
          scope,
          {
            mode: 'insert',
            origin: createCounterTicketOriginV1(),
            ticket: normalizedTicket(ticketId),
            jobs: [normalizedJob(jobId, {
              assignedTechId: input.assignedTechId ?? null,
              requiredSkillTier: input.requiredSkillTier ?? 2,
              createdFromJobId: input.createdFromJobId ?? null,
            })],
            seededLinesByJobIndex: new Map(),
          },
        ),
      })).rejects.toThrow('ticket_creation_kernel_invalid')
    }

    await expectInsertRejected({
      suffix: 1290,
      assignedTechId: kernelUuid(1399),
    })
    await expectInsertRejected({
      suffix: 1292,
      assignedTechId: crossShopTechId,
    })
    await expectInsertRejected({
      suffix: 1294,
      profileIds: [ownerProfileId, inactiveId],
      assignedTechId: inactiveId,
    })
    await expectInsertRejected({
      suffix: 1296,
      profileIds: [ownerProfileId, deactivatedId],
      assignedTechId: deactivatedId,
    })
    await expectInsertRejected({
      suffix: 1298,
      profileIds: [ownerProfileId, tierlessId],
      assignedTechId: tierlessId,
    })
    await expectInsertRejected({
      suffix: 1300,
      actorProfileId: techProfileId,
      profileIds: [techProfileId],
      assignedTechId: techProfileId,
      requiredSkillTier: 3,
    })
    await expectInsertRejected({
      suffix: 1302,
      actorProfileId: techProfileId,
      profileIds: [techProfileId, otherTechId],
      assignedTechId: otherTechId,
    })
    await expectInsertRejected({
      suffix: 1304,
      createdFromJobId: kernelUuid(1398),
    })
    await expectInsertRejected({
      suffix: 1306,
      createdFromJobId: crossTicketJobId,
    })
    await expectInsertRejected({
      suffix: 1310,
      createdFromJobId: kernelUuid(1311),
    })

    const intakeTicketId = kernelUuid(1308)
    const intakeJobId = kernelUuid(1309)
    await expect(runBoundedShopOsMutationV1(db, {
      discover: async (tx, attempt) => {
        const identity = await preflightTicketIntakeIdentityV1(
          tx,
          attempt.capability,
          { mode: 'existing_vehicle', shopId, existingVehicleId: vehicleId, mileage: null },
        )
        if (!identity.ok) throw new Error(identity.error)
        return {
          lockRequest: lockRequest({
            profileIds: [ownerProfileId, inactiveId],
            lockShop: true,
            customerIds: identity.lockPlan.customerIds,
            vehicleIds: identity.lockPlan.vehicleIds,
            includeAllJobsForTickets: true,
            includeAllLinesForJobs: true,
            insertionIntents: {
              ...ticketInsertionIntents(intakeTicketId, [intakeJobId]),
              customers: identity.lockPlan.insertionIntents.customers,
              vehicles: identity.lockPlan.insertionIntents.vehicles,
            },
          }),
          payload: identity,
        }
      },
      executeLocked: async (tx, scope, identity) => {
        const materialized = await materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          identity.identity,
        )
        if (!materialized.ok) throw new Error(materialized.error)
        return resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'intake_insert',
          origin: createCounterTicketOriginV1(),
          ticket: {
            id: intakeTicketId,
            concern: 'Invalid intake assignee',
            whenStarted: null,
            howOften: null,
            diagnosticAuthorizedCents: null,
            diagnosticAuthorizationNote: null,
          },
          identity: materialized.materialized,
          jobs: [normalizedJob(intakeJobId, { assignedTechId: inactiveId })],
          seededLinesByJobIndex: new Map(),
        })
      },
    })).rejects.toThrow('ticket_creation_kernel_invalid')

    const validTicketId = kernelUuid(1312)
    const validJobIds = [kernelUuid(1313), kernelUuid(1314)]
    const valid = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: ticketInsertionIntents(validTicketId, validJobIds),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin: createCounterTicketOriginV1(),
          ticket: normalizedTicket(validTicketId),
          jobs: [
            normalizedJob(validJobIds[0]!, { title: 'Source job' }),
            normalizedJob(validJobIds[1]!, {
              title: 'Derived job',
              createdFromJobId: validJobIds[0]!,
            }),
          ],
          seededLinesByJobIndex: new Map(),
        })
        await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
        const finalized = await finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          [{
            ticketId: validTicketId,
            createdTicket: true,
            createdJobIds: validJobIds,
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )
        return readFinalizedTicketCreationResultV1(tx, scope, finalized)
      },
    })
    expect(valid).toEqual({ ticketId: validTicketId, jobIds: validJobIds })
    expect((await db.select().from(ticketJobs)
      .where(eq(ticketJobs.id, validJobIds[1]!)))[0])
      .toMatchObject({ createdFromJobId: validJobIds[0] })
    expect((await db.select().from(tickets)).map(({ id }) => id).sort())
      .toEqual([crossTicketId, validTicketId].sort())
  })

  it('rejects omitted, duplicated, and reordered creation deltas before one exact finalization', async () => {
    const ticketId = kernelUuid(1170)
    const jobIds = [kernelUuid(1171), kernelUuid(1172), kernelUuid(1173)]
    const result = await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: ticketInsertionIntents(ticketId, jobIds),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin: createCounterTicketOriginV1(),
          ticket: normalizedTicket(ticketId),
          jobs: jobIds.map((id) => normalizedJob(id)),
          seededLinesByJobIndex: new Map(),
        })
        await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
        const delta = (createdJobIds: readonly string[]) => [{
          ticketId,
          createdTicket: true,
          createdJobIds,
          existingChangedJobIds: [],
          actorVisibleTicketFieldsChanged: true,
        }]
        for (const invalidIds of [
          jobIds.slice(0, 2),
          [jobIds[0]!, jobIds[0]!, jobIds[2]!],
          [jobIds[1]!, jobIds[0]!, jobIds[2]!],
        ]) {
          await expect(finalizeResolvedTicketCreationInTransactionV1(
            tx,
            scope,
            resolved,
            delta(invalidIds),
          )).rejects.toThrow('ticket_creation_kernel_invalid')
        }
        const finalized = await finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          delta(jobIds),
        )
        return readFinalizedTicketCreationResultV1(tx, scope, finalized)
      },
    })
    expect(result).toEqual({ ticketId, jobIds })
  })

  it('rolls back allocation when the locked ticket number cannot advance safely', async () => {
    await db.update(shops).set({ nextTicketNumber: Number.MAX_SAFE_INTEGER })
      .where(eq(shops.id, shopId))
    const ticketId = kernelUuid(1180)
    const jobId = kernelUuid(1181)
    await expect(runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: ticketInsertionIntents(ticketId, [jobId]),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin: createCounterTicketOriginV1(),
          ticket: normalizedTicket(ticketId),
          jobs: [normalizedJob(jobId)],
          seededLinesByJobIndex: new Map(),
        })
        return insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
      },
    })).rejects.toThrow('ticket_creation_kernel_invalid')
    expect(await db.select().from(tickets)).toEqual([])
    expect((await db.select().from(shops).where(eq(shops.id, shopId)))[0])
      .toMatchObject({ nextTicketNumber: Number.MAX_SAFE_INTEGER })
  })

  it('rejects extra quote locks and unrelated canned locks from exact creation footprints', async () => {
    const counterTicketId = kernelUuid(1190)
    const counterJobId = kernelUuid(1191)
    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          includeAllQuoteVersionsForTickets: true,
          insertionIntents: ticketInsertionIntents(counterTicketId, [counterJobId]),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin: createCounterTicketOriginV1(),
          ticket: normalizedTicket(counterTicketId),
          jobs: [normalizedJob(counterJobId)],
          seededLinesByJobIndex: new Map(),
        })).toThrow('ticket_creation_kernel_invalid')
      },
    })

    const unrelatedCannedId = kernelUuid(1192)
    await db.insert(cannedJobs).values({
      id: unrelatedCannedId,
      shopId,
      title: 'Unrelated template',
      kind: 'repair',
      defaultRequiredSkillTier: 2,
      defaultLines: [],
      sort: 0,
    })
    const requestKey = kernelUuid(1193)
    const quickTicketId = kernelUuid(1194)
    const quickJobId = kernelUuid(1195)
    const parsed = parseQuickTicketRequestV1({
      vehicleMode: 'existing',
      existingVehicleId: vehicleId,
      mileage: null,
      clientKey: requestKey,
      quote: { mode: 'manual', kind: 'repair', description: 'Manual only' },
    })
    if (!parsed.ok) throw new Error(parsed.error)
    await runBoundedShopOsMutationV1(db, {
      discover: async (tx, attempt) => {
        const identity = await preflightTicketIntakeIdentityV1(
          tx,
          attempt.capability,
          { mode: 'existing_vehicle', shopId, existingVehicleId: vehicleId, mileage: null },
        )
        if (!identity.ok) throw new Error(identity.error)
        return {
          lockRequest: quickPreparedLockRequest(
            identity.lockPlan,
            requestKey,
            quickTicketId,
            quickJobId,
            [unrelatedCannedId],
          ),
          payload: identity,
        }
      },
      executeLocked: async (tx, scope, identity) => {
        const materialized = await materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          identity.identity,
        )
        if (!materialized.ok) throw new Error(materialized.error)
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'quick_insert',
          origin: createQuickTicketOriginV1(requestKey),
          identity: materialized.materialized,
          receipt: parsed.value.receipt,
          template: null,
        })).toThrow('ticket_creation_kernel_invalid')
      },
    })
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('suppresses Quick insertion for occupied, owned, and unavailable receipt states without writes', async () => {
    const resultTicketId = kernelUuid(1200)
    const occupiedKey = kernelUuid(1201)
    const ownedKey = kernelUuid(1202)
    const unavailableKey = kernelUuid(1203)
    await db.insert(tickets).values({
      id: resultTicketId,
      shopId,
      ticketNumber: 80,
      source: 'quick_quote',
      customerId,
      vehicleId,
      concern: 'Existing Quick result',
      projectionRevision: 1n,
      continuityRevision: 1n,
      createdByProfileId: ownerProfileId,
    })
    await db.insert(ticketMutationReceipts).values([
      {
        id: kernelUuid(1204),
        shopId,
        requestKey: occupiedKey,
        mutationSchemaVersion: 1,
        fingerprintKeyVersion: 1,
        mutationKind: 'create_repair_order',
        actorProfileId: techProfileId,
        targetTicketId: null,
        targetBindingFingerprint: '0'.repeat(64),
        requestFingerprint: '1'.repeat(64),
        resultTicketId,
        resultJobCount: 0,
      },
      {
        id: kernelUuid(1205),
        shopId,
        requestKey: ownedKey,
        mutationSchemaVersion: 1,
        fingerprintKeyVersion: 1,
        mutationKind: 'create_repair_order',
        actorProfileId: ownerProfileId,
        targetTicketId: null,
        targetBindingFingerprint: '2'.repeat(64),
        requestFingerprint: '3'.repeat(64),
        resultTicketId,
        resultJobCount: 0,
      },
    ])
    const plan: TicketIntakeIdentityLockPlanV1 = {
      lockShop: true,
      customerIds: [customerId],
      vehicleIds: [vehicleId],
      insertionIntents: { customers: [], vehicles: [] },
    }
    const before = {
      tickets: (await db.select().from(tickets)).length,
      jobs: (await db.select().from(ticketJobs)).length,
      receipts: (await db.select().from(ticketMutationReceipts)).length,
      number: (await db.select().from(shops).where(eq(shops.id, shopId)))[0]!
        .nextTicketNumber,
    }

    const occupiedParsed = parseQuickTicketRequestV1({
      vehicleMode: 'existing',
      existingVehicleId: vehicleId,
      mileage: null,
      clientKey: occupiedKey,
      quote: { mode: 'manual', kind: 'repair', description: 'Occupied Quick' },
    })
    if (!occupiedParsed.ok) throw new Error(occupiedParsed.error)
    await runBoundedShopOsMutationV1(db, {
      discover: async (tx, attempt) => {
        const identity = await preflightTicketIntakeIdentityV1(
          tx,
          attempt.capability,
          { mode: 'existing_vehicle', shopId, existingVehicleId: vehicleId, mileage: null },
        )
        if (!identity.ok) throw new Error(identity.error)
        return {
          lockRequest: lockRequest({
            lockShop: true,
            customerIds: identity.lockPlan.customerIds,
            vehicleIds: identity.lockPlan.vehicleIds,
            includeAllJobsForTickets: true,
            includeAllLinesForJobs: true,
            receiptRequestKey: occupiedKey,
            insertionIntents: ticketInsertionIntents(kernelUuid(1230), [kernelUuid(1231)]),
          }),
          payload: identity,
        }
      },
      executeLocked: async (tx, scope, identity) => {
        expect(scope.receiptPeek).toEqual({ kind: 'occupied' })
        const materialized = await materializeTicketIntakeIdentityInLockedScopeV1(
          tx,
          scope,
          identity.identity,
        )
        if (!materialized.ok) throw new Error(materialized.error)
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'quick_insert',
          origin: createQuickTicketOriginV1(occupiedKey),
          identity: materialized.materialized,
          receipt: occupiedParsed.value.receipt,
          template: null,
        })).toThrow('ticket_creation_kernel_invalid')
      },
    })

    for (const [requestKey, expectedState, expectedPeek] of [
      [occupiedKey, 'suppressed_by_occupied_receipt', { kind: 'occupied' }],
      [ownedKey, 'suppressed_by_owned_receipt', {
        kind: 'owned',
        receiptId: kernelUuid(1205),
        resultTicketId,
      }],
    ] as const) {
      const parsed = parseQuickTicketRequestV1({
        vehicleMode: 'existing',
        existingVehicleId: vehicleId,
        mileage: null,
        clientKey: requestKey,
        quote: { mode: 'manual', kind: 'repair', description: 'Suppressed Quick' },
      })
      if (!parsed.ok) throw new Error(parsed.error)
      await runBoundedShopOsMutationV1(db, {
        discover: async () => ({
          lockRequest: quickPreparedLockRequest(
            plan,
            requestKey,
            kernelUuid(requestKey === occupiedKey ? 1206 : 1208),
            kernelUuid(requestKey === occupiedKey ? 1207 : 1209),
          ),
          payload: undefined,
        }),
        executeLocked: async (tx, scope) => {
          expect(scope.receiptConditionalInsertState).toBe(expectedState)
          expect(scope.receiptPeek).toEqual(expectedPeek)
          expect(scope.insertionIntents).toEqual(EMPTY_MUTATION_INTENTS)
          expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
            mode: 'quick_insert',
            origin: createQuickTicketOriginV1(requestKey),
            identity: Object.freeze(Object.create(null)),
            receipt: parsed.value.receipt,
            template: null,
          })).toThrow('ticket_creation_kernel_invalid')
        },
      })
    }

    const unavailable = parseQuickTicketRequestV1({
      vehicleMode: 'existing',
      existingVehicleId: vehicleId,
      mileage: null,
      clientKey: unavailableKey,
      quote: { mode: 'manual', kind: 'repair', description: 'Unavailable Quick' },
    })
    if (!unavailable.ok) throw new Error(unavailable.error)
    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          receiptRequestKey: unavailableKey,
          receiptConditionalInsert: { kind: 'unavailable' },
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        expect(scope.receiptConditionalInsertState).toBe('unavailable')
        expect(scope.receiptPeek).toEqual({ kind: 'none' })
        expect(scope.insertionIntents).toEqual(EMPTY_MUTATION_INTENTS)
        expect(scope.shop).toBeNull()
        expect(scope.tickets).toEqual([])
        expect(() => resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'quick_insert',
          origin: createQuickTicketOriginV1(unavailableKey),
          identity: Object.freeze(Object.create(null)),
          receipt: unavailable.value.receipt,
          template: null,
        })).toThrow('ticket_creation_kernel_invalid')
      },
    })
    expect({
      tickets: (await db.select().from(tickets)).length,
      jobs: (await db.select().from(ticketJobs)).length,
      receipts: (await db.select().from(ticketMutationReceipts)).length,
      number: (await db.select().from(shops).where(eq(shops.id, shopId)))[0]!
        .nextTicketNumber,
    }).toEqual(before)
  })

  it('rejects forged, stale, cross-transaction, and cross-scope resolved or finalized handles', async () => {
    const ticketId = kernelUuid(1210)
    const jobId = kernelUuid(1211)
    let finalizedTx: AppDb | undefined
    let finalizedScope: LockedMutationScopeV1 | undefined
    let capturedFinalized: Parameters<typeof readFinalizedTicketCreationResultV1>[2] | undefined

    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: ticketInsertionIntents(ticketId, [jobId]),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const forged = Object.freeze(Object.create(null)) as ResolvedTicketCreationV1
        await expect(insertResolvedTicketBatchInTransactionV1(
          tx,
          scope,
          forged,
        )).rejects.toThrow('ticket_creation_kernel_invalid')
        expect(() => readFinalizedTicketCreationResultV1(
          tx,
          scope,
          Object.freeze(Object.create(null)),
        )).toThrow('ticket_creation_kernel_invalid')

        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin: createCounterTicketOriginV1(),
          ticket: normalizedTicket(ticketId),
          jobs: [normalizedJob(jobId)],
          seededLinesByJobIndex: new Map(),
        })
        await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
        const finalized = await finalizeResolvedTicketCreationInTransactionV1(
          tx,
          scope,
          resolved,
          [{
            ticketId,
            createdTicket: true,
            createdJobIds: [jobId],
            existingChangedJobIds: [],
            actorVisibleTicketFieldsChanged: true,
          }],
        )
        finalizedTx = tx
        finalizedScope = scope
        capturedFinalized = finalized
        return readFinalizedTicketCreationResultV1(tx, scope, finalized)
      },
    })

    expect(() => readFinalizedTicketCreationResultV1(
      finalizedTx!,
      finalizedScope!,
      capturedFinalized!,
    )).toThrow('mutation_attempt_capability_closed')

    const bindingTicketId = kernelUuid(1212)
    const bindingJobId = kernelUuid(1213)
    let activeTx: AppDb | undefined
    const stableTx = new Proxy(Object.create(null) as AppDb, {
      get: (_target, property) => {
        if (!activeTx) throw new Error('stable transaction used outside an attempt')
        const value = Reflect.get(activeTx as object, property, activeTx)
        return typeof value === 'function' ? value.bind(activeTx) : value
      },
    })
    const sameIdentityDb = Object.freeze({
      transaction: async <T>(callback: (tx: AppDb) => Promise<T>): Promise<T> =>
        db.transaction(async (rawTx) => {
          if (activeTx) throw new Error('overlapping transaction attempts')
          activeTx = rawTx as AppDb
          try {
            return await callback(stableTx)
          } finally {
            activeTx = undefined
          }
        }),
    }) as unknown as TestDb
    let bindingTx: AppDb | undefined
    let bindingScope: LockedMutationScopeV1 | undefined
    let bindingResolved: ResolvedTicketCreationV1 | undefined
    const bindingRequest = lockRequest({
      lockShop: true,
      customerIds: [customerId],
      vehicleIds: [vehicleId],
      includeAllJobsForTickets: true,
      includeAllLinesForJobs: true,
      insertionIntents: ticketInsertionIntents(bindingTicketId, [bindingJobId]),
    })
    await runBoundedShopOsMutationV1(sameIdentityDb, {
      discover: async () => ({ lockRequest: bindingRequest, payload: undefined }),
      executeLocked: async (tx, scope) => {
        expect(tx).toBe(stableTx)
        bindingTx = tx
        bindingScope = scope
        bindingResolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin: createCounterTicketOriginV1(),
          ticket: normalizedTicket(bindingTicketId),
          jobs: [normalizedJob(bindingJobId)],
          seededLinesByJobIndex: new Map(),
        })
      },
    })
    await expect(insertResolvedTicketBatchInTransactionV1(
      bindingTx!,
      bindingScope!,
      bindingResolved!,
    )).rejects.toThrow('mutation_attempt_capability_closed')
    await runBoundedShopOsMutationV1(sameIdentityDb, {
      discover: async () => ({ lockRequest: bindingRequest, payload: undefined }),
      executeLocked: async (tx, scope) => {
        expect(tx).toBe(stableTx)
        await expect(insertResolvedTicketBatchInTransactionV1(
          tx,
          scope,
          bindingResolved!,
        )).rejects.toThrow('ticket_creation_kernel_invalid')
      },
    })

    const otherTicketId = kernelUuid(1214)
    const otherJobId = kernelUuid(1215)
    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: ticketInsertionIntents(otherTicketId, [otherJobId]),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        expect(() => readFinalizedTicketCreationResultV1(
          tx,
          scope,
          capturedFinalized!,
        )).toThrow('ticket_creation_kernel_invalid')
      },
    })
    expect((await db.select().from(tickets)).map(({ id }) => id)).toEqual([ticketId])
  })

  it('rejects attempt-one creation handles during allowlisted collision recovery and uses a fresh handle', async () => {
    const ticketId = kernelUuid(1220)
    const jobId = kernelUuid(1221)
    const origin = createCounterTicketOriginV1()
    let primaryResolved: ResolvedTicketCreationV1 | undefined
    let primaryTx: AppDb | undefined
    let primaryScope: LockedMutationScopeV1 | undefined
    let primaryCapability: unknown
    const attempts: Array<{ ordinal: number; purpose: string }> = []
    let activeTx: AppDb | undefined
    const stableTx = new Proxy(Object.create(null) as AppDb, {
      get: (_target, property) => {
        if (!activeTx) throw new Error('stable transaction used outside an attempt')
        const value = Reflect.get(activeTx as object, property, activeTx)
        return typeof value === 'function' ? value.bind(activeTx) : value
      },
    })
    const sameIdentityDb = Object.freeze({
      transaction: async <T>(callback: (tx: AppDb) => Promise<T>): Promise<T> =>
        db.transaction(async (rawTx) => {
          if (activeTx) throw new Error('overlapping transaction attempts')
          activeTx = rawTx as AppDb
          try {
            return await callback(stableTx)
          } finally {
            activeTx = undefined
          }
        }),
    }) as unknown as TestDb

    const result = await runBoundedShopOsMutationV1(sameIdentityDb, {
      discover: async (tx, attempt) => {
        expect(tx).toBe(stableTx)
        attempts.push({ ordinal: attempt.ordinal, purpose: attempt.purpose })
        return {
          lockRequest: lockRequest({
            lockShop: true,
            customerIds: [customerId],
            vehicleIds: [vehicleId],
            includeAllJobsForTickets: true,
            includeAllLinesForJobs: true,
            insertionIntents: ticketInsertionIntents(ticketId, [jobId]),
          }),
          payload: undefined,
        }
      },
      executeLocked: async (tx, scope, _payload, attempt) => {
        expect(tx).toBe(stableTx)
        primaryCapability = attempt.capability
        primaryTx = tx
        primaryScope = scope
        primaryResolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'insert',
          origin,
          ticket: normalizedTicket(ticketId),
          jobs: [normalizedJob(jobId)],
          seededLinesByJobIndex: new Map(),
        })
        throw Object.assign(new Error('forced collision recovery'), {
          code: '23505',
          constraint: 'sessions_pkey',
        })
      },
      uniqueCollisionRecovery: {
        allowedConstraints: ['sessions_pkey'],
        executeLocked: async (tx, scope, _payload, attempt) => {
          expect(tx).toBe(stableTx)
          expect(attempt.capability).not.toBe(primaryCapability)
          await expect(insertResolvedTicketBatchInTransactionV1(
            tx,
            scope,
            primaryResolved!,
          )).rejects.toThrow('ticket_creation_kernel_invalid')
          const fresh = resolveTicketCreationInLockedScopeV1(tx, scope, {
            mode: 'insert',
            origin,
            ticket: normalizedTicket(ticketId),
            jobs: [normalizedJob(jobId)],
            seededLinesByJobIndex: new Map(),
          })
          await insertResolvedTicketBatchInTransactionV1(tx, scope, fresh)
          const finalized = await finalizeResolvedTicketCreationInTransactionV1(
            tx,
            scope,
            fresh,
            [{
              ticketId,
              createdTicket: true,
              createdJobIds: [jobId],
              existingChangedJobIds: [],
              actorVisibleTicketFieldsChanged: true,
            }],
          )
          return {
            kind: 'recovered' as const,
            value: readFinalizedTicketCreationResultV1(tx, scope, finalized),
          }
        },
      },
    })
    expect(result).toEqual({ ticketId, jobIds: [jobId] })
    expect(attempts).toEqual([
      { ordinal: 1, purpose: 'primary' },
      { ordinal: 2, purpose: 'unique_collision_recovery' },
    ])
    await expect(insertResolvedTicketBatchInTransactionV1(
      primaryTx!,
      primaryScope!,
      primaryResolved!,
    )).rejects.toThrow('mutation_attempt_capability_closed')
  })

  it('rejects an accessor-backed resolver mode without invoking caller code', async () => {
    const ticketId = kernelUuid(1130)
    const jobId = kernelUuid(1131)
    let getterCalls = 0
    await runBoundedShopOsMutationV1(db, {
      discover: async () => ({
        lockRequest: lockRequest({
          lockShop: true,
          customerIds: [customerId],
          vehicleIds: [vehicleId],
          includeAllJobsForTickets: true,
          includeAllLinesForJobs: true,
          insertionIntents: ticketInsertionIntents(ticketId, [jobId]),
        }),
        payload: undefined,
      }),
      executeLocked: async (tx, scope) => {
        const evil = Object.create(null) as Record<string, unknown>
        Object.defineProperties(evil, {
          mode: {
            enumerable: true,
            get() {
              getterCalls += 1
              throw new Error('caller_getter_executed')
            },
          },
          origin: { enumerable: true, value: createCounterTicketOriginV1() },
          ticket: { enumerable: true, value: normalizedTicket(ticketId) },
          jobs: { enumerable: true, value: [normalizedJob(jobId)] },
          seededLinesByJobIndex: { enumerable: true, value: new Map() },
        })
        expect(() => resolveTicketCreationInLockedScopeV1(
          tx,
          scope,
          evil as ResolveTicketCreationInputV1,
        )).toThrow('ticket_creation_kernel_invalid')
        expect(getterCalls).toBe(0)
      },
    })
  })
})

describe('createTicket', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopA: typeof shops.$inferSelect
  let shopB: typeof shops.$inferSelect
  let customerA: typeof customers.$inferSelect
  let customerA2: typeof customers.$inferSelect
  let customerB: typeof customers.$inferSelect
  let vehicleA: typeof vehicles.$inferSelect
  let vehicleA2: typeof vehicles.$inferSelect
  let vehicleB: typeof vehicles.$inferSelect
  let actors: Record<'tech' | 'advisor' | 'parts' | 'owner', TicketActor>
  let sameShopTierOne: SeededProfile

  beforeEach(async () => {
    const created = await createTestDb()
    db = created.db
    close = created.close

    ;[shopA, shopB] = await db
      .insert(shops)
      .values([{ name: 'North Shop' }, { name: 'South Shop' }])
      .returning()
    ;[customerA, customerA2, customerB] = await db
      .insert(customers)
      .values([
        { shopId: shopA.id, name: 'Ada Driver', phone: '555-0101', email: 'ada@example.com' },
        { shopId: shopA.id, name: 'Ben Driver', phone: '555-0102' },
        { shopId: shopB.id, name: 'Cross Shop', phone: '555-0201' },
      ])
      .returning()
    ;[vehicleA, vehicleA2, vehicleB] = await db
      .insert(vehicles)
      .values([
        {
          customerId: customerA.id,
          year: 2020,
          make: 'Honda',
          model: 'Civic',
          engine: '2.0L',
          vin: 'VIN-A',
          mileage: 42000,
          plate: 'NORTH1',
        },
        { customerId: customerA2.id, year: 2019, make: 'Ford', model: 'F-150' },
        { customerId: customerB.id, year: 2021, make: 'Toyota', model: 'Camry' },
      ])
      .returning()

    const seeded = await db
      .insert(profiles)
      .values([
        {
          userId: uuid(1),
          shopId: shopA.id,
          role: 'tech',
          skillTier: 2,
          fullName: 'Taylor Tech',
        },
        {
          userId: uuid(2),
          shopId: shopA.id,
          role: 'advisor',
          skillTier: 2,
          fullName: 'Alex Advisor',
        },
        {
          userId: uuid(3),
          shopId: shopA.id,
          role: 'parts',
          skillTier: null,
          fullName: 'Pat Parts',
        },
        {
          userId: uuid(4),
          shopId: shopA.id,
          role: 'owner',
          skillTier: 3,
          fullName: 'Owen Owner',
        },
        {
          userId: uuid(5),
          shopId: shopA.id,
          role: 'tech',
          skillTier: 1,
          fullName: 'Terry Tier One',
        },
      ])
      .returning()

    actors = {
      tech: actorFrom(seeded[0]),
      advisor: actorFrom(seeded[1]),
      parts: actorFrom(seeded[2]),
      owner: actorFrom(seeded[3]),
    }
    sameShopTierOne = seeded[4]
  })

  afterEach(async () => {
    await close()
  })

  function body(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      customerId: customerA.id,
      vehicleId: vehicleA.id,
      concern: '  Intermittent front-end noise  ',
      whenStarted: '  last week  ',
      howOften: '  on cold starts  ',
      diagnosticAuthorizedCents: 12500,
      diagnosticAuthorizationNote: '  customer approved by phone  ',
      jobs: [
        {
          title: '  Diagnose front-end noise  ',
          kind: 'diagnostic',
          requiredSkillTier: 2,
        },
      ],
      ...overrides,
    }
  }

  async function genericMutationState() {
    const [shop] = await db
      .select({ nextTicketNumber: shops.nextTicketNumber })
      .from(shops)
      .where(eq(shops.id, shopA.id))
    return {
      nextTicketNumber: shop.nextTicketNumber,
      tickets: await db.select().from(tickets),
      jobs: await db.select().from(ticketJobs),
      lines: await db.select().from(jobLines),
      sessions: await db.select().from(sessions),
      receipts: await db.select().from(ticketMutationReceipts),
      receiptJobs: await db.select().from(ticketMutationReceiptJobs),
    }
  }

  describe('Task 7E strict source-free boundary', () => {
    it('accepts a source-free body for every active Shop OS role', async () => {
      for (const role of ['tech', 'advisor', 'parts', 'owner'] as const) {
        await expect(
          createTicket(db, { actor: actors[role], body: body() }),
        ).resolves.toMatchObject({ ok: true, ticket: { source: 'counter' } })
      }
    })

    it('rejects every supplied source before database access', async () => {
      const inaccessibleDb = new Proxy(
        {},
        {
          get() {
            throw new Error('database must not be accessed')
          },
        },
      ) as AppDb

      for (const source of [
        'counter',
        'tech_quick',
        'quick_quote',
        'unknown',
        null,
        42,
        {},
        undefined,
      ]) {
        await expect(
          createTicket(inaccessibleDb, {
            actor: actors.owner,
            body: body({ source }),
          }),
        ).resolves.toEqual({ ok: false, error: 'invalid_input' })
      }
    })

    it('rejects null identity, extra fields, malformed UUIDs, and job bounds before access', async () => {
      const inaccessibleDb = new Proxy(
        {},
        {
          get() {
            throw new Error('database must not be accessed')
          },
        },
      ) as AppDb
      const invalidBodies: unknown[] = [
        body({ customerId: null }),
        body({ vehicleId: null }),
        body({ customerId: 'not-a-uuid' }),
        body({ vehicleId: 'not-a-uuid' }),
        { ...body(), status: 'closed' },
        body({ jobs: [] }),
        body({
          jobs: Array.from({ length: 26 }, () => ({
            title: 'Job',
            kind: 'repair',
            requiredSkillTier: 1,
          })),
        }),
      ]

      for (const invalidBody of invalidBodies) {
        await expect(
          createTicket(inaccessibleDb, { actor: actors.owner, body: invalidBody }),
        ).resolves.toEqual({ ok: false, error: 'invalid_input' })
      }
    })
  })

  it('uses the bounded generic kernel exactly once and removes caller-owned seams', async () => {
    const source = await readFile(path.join(process.cwd(), 'lib/tickets.ts'), 'utf8')
    const start = source.indexOf('export async function createTicket')
    const end = source.indexOf('export async function getTicketDetail', start)
    const slice = source.slice(start, end)
    const callCount = (name: string) =>
      slice.match(new RegExp(`\\b${name}(?:<[^>]+>)?\\s*\\(`, 'g'))?.length ?? 0

    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    for (const name of [
      'runBoundedShopOsMutationV1',
      'createCounterTicketOriginV1',
      'resolveTicketCreationInLockedScopeV1',
      'insertResolvedTicketBatchInTransactionV1',
      'finalizeResolvedTicketCreationInTransactionV1',
      'readFinalizedTicketCreationResultV1',
    ]) {
      expect(callCount(name), name).toBe(1)
    }
    expect(slice).not.toMatch(/\b(?:insertTicketInTransaction|validateAssignment)\s*\(/)
    expect(slice).not.toContain('db.transaction')
    expect(slice).not.toContain('body.source')
    expect(slice).not.toContain('internalTicketId')
    expect(slice).not.toContain('input.internal')
    expect(slice).not.toContain('uniqueCollisionRecovery')
    expect(slice).not.toMatch(/\.from\((?:customers|vehicles|profiles)\)/)

    const discoverStart = slice.indexOf('discover:')
    const executeStart = slice.indexOf('executeLocked:', discoverStart)
    const discover = slice.slice(discoverStart, executeStart)
    expect(discover.match(/randomUUID\(\)/g)).toHaveLength(2)
    expect(discover).toContain('body.jobs.map(() => randomUUID())')

    const firstAwait = slice.indexOf('await ')
    expect(firstAwait).toBeGreaterThan(-1)
    expect(slice.slice(firstAwait)).not.toContain('input.actor')
    expect(slice.slice(firstAwait)).not.toContain('input.body')

    if (false) {
      void createTicket(db, {
        actor: actors.owner,
        body: body(),
        // @ts-expect-error the generic adapter has no internal ticket-ID seam
        internal: { ticketId: uuid(999) },
      })
    }
  })

  it('persists one canonical Counter batch with exact IDs, order, revisions, and provenance', async () => {
    const uppercaseActor: TicketActor = {
      ...actors.owner,
      profileId: actors.owner.profileId.toUpperCase(),
      shopId: actors.owner.shopId!.toUpperCase(),
    }
    const result = await createTicket(db, {
      actor: uppercaseActor,
      body: body({
        customerId: customerA.id.toUpperCase(),
        vehicleId: vehicleA.id.toUpperCase(),
        jobs: [
          {
            title: '  First entered job  ',
            kind: 'repair',
            requiredSkillTier: 1,
            assignedTechId: sameShopTierOne.id.toUpperCase(),
          },
          {
            title: 'Second entered job',
            kind: 'maintenance',
            requiredSkillTier: 1,
          },
          {
            title: 'Third entered job',
            kind: 'diagnostic',
            requiredSkillTier: 3,
          },
        ],
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [persistedTicket] = await db.select().from(tickets)
    const persistedJobs = (await db.select().from(ticketJobs))
      .sort((left, right) => (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0))
    expect(persistedTicket).toMatchObject({
      id: result.ticket.id,
      shopId: shopA.id,
      ticketNumber: 1,
      source: 'counter',
      customerId: customerA.id,
      vehicleId: vehicleA.id,
      concern: 'Intermittent front-end noise',
      whenStarted: 'last week',
      howOften: 'on cold starts',
      diagnosticAuthorizedCents: 12500,
      diagnosticAuthorizationNote: 'customer approved by phone',
      projectionRevision: 1n,
      continuityRevision: 1n,
      createdByProfileId: actors.owner.profileId,
    })
    expect(persistedJobs.map((job) => ({
      id: job.id,
      title: job.title,
      sequenceNumber: job.sequenceNumber,
      assignedTechId: job.assignedTechId,
      sessionId: job.sessionId,
      createdFromJobId: job.createdFromJobId,
      revision: job.revision,
      createdByProfileId: job.createdByProfileId,
      creatorProvenance: job.creatorProvenance,
    }))).toEqual([
      {
        id: expect.any(String),
        title: 'First entered job',
        sequenceNumber: 1,
        assignedTechId: sameShopTierOne.id,
        sessionId: null,
        createdFromJobId: null,
        revision: 1n,
        createdByProfileId: actors.owner.profileId,
        creatorProvenance: 'direct',
      },
      {
        id: expect.any(String),
        title: 'Second entered job',
        sequenceNumber: 2,
        assignedTechId: null,
        sessionId: null,
        createdFromJobId: null,
        revision: 1n,
        createdByProfileId: actors.owner.profileId,
        creatorProvenance: 'direct',
      },
      {
        id: expect.any(String),
        title: 'Third entered job',
        sequenceNumber: 3,
        assignedTechId: null,
        sessionId: null,
        createdFromJobId: null,
        revision: 1n,
        createdByProfileId: actors.owner.profileId,
        creatorProvenance: 'direct',
      },
    ])
    expect(new Set(result.ticket.jobs.map(({ id }) => id)))
      .toEqual(new Set(persistedJobs.map(({ id }) => id)))
    expect(result.ticket).not.toHaveProperty('projectionRevision')
    expect(result.ticket).not.toHaveProperty('continuityRevision')
    for (const job of result.ticket.jobs) {
      expect(job).not.toHaveProperty('revision')
      expect(job).not.toHaveProperty('sequenceNumber')
      expect(job).not.toHaveProperty('creatorProvenance')
    }
    expect((await genericMutationState())).toMatchObject({
      nextTicketNumber: 2,
      lines: [],
      sessions: [],
      receipts: [],
      receiptJobs: [],
    })
  })

  it('persists the exact 25-job public boundary as one ordered atomic Counter batch', async () => {
    const enteredTitles = Array.from(
      { length: 25 },
      (_, index) => `Boundary job ${String(index + 1).padStart(2, '0')}`,
    )
    const result = await createTicket(db, {
      actor: actors.owner,
      body: body({
        jobs: enteredTitles.map((title) => ({
          title,
          kind: 'maintenance',
          requiredSkillTier: 1,
        })),
      }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const state = await genericMutationState()
    const persistedJobs = [...state.jobs]
      .sort((left, right) => (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0))
    expect(state.tickets).toHaveLength(1)
    expect(state.tickets[0]).toMatchObject({
      id: result.ticket.id,
      ticketNumber: 1,
      source: 'counter',
      projectionRevision: 1n,
      continuityRevision: 1n,
      createdByProfileId: actors.owner.profileId,
    })
    expect(persistedJobs).toHaveLength(25)
    expect(persistedJobs.map((job) => ({
      title: job.title,
      sequenceNumber: job.sequenceNumber,
      revision: job.revision,
      createdByProfileId: job.createdByProfileId,
      creatorProvenance: job.creatorProvenance,
      sessionId: job.sessionId,
      createdFromJobId: job.createdFromJobId,
    }))).toEqual(enteredTitles.map((title, index) => ({
      title,
      sequenceNumber: index + 1,
      revision: 1n,
      createdByProfileId: actors.owner.profileId,
      creatorProvenance: 'direct',
      sessionId: null,
      createdFromJobId: null,
    })))
    expect(result.ticket.jobs).toHaveLength(25)
    expect(new Set(result.ticket.jobs.map(({ id }) => id)))
      .toEqual(new Set(persistedJobs.map(({ id }) => id)))
    expect(state).toMatchObject({
      nextTicketNumber: 2,
      lines: [],
      sessions: [],
      receipts: [],
      receiptJobs: [],
    })
  })

  it('uses locked persisted actor authority instead of a stale permissive caller token', async () => {
    const before = await genericMutationState()
    await db
      .update(profiles)
      .set({ role: 'tech', skillTier: 3 })
      .where(eq(profiles.id, actors.owner.profileId))
    await expect(
      createTicket(db, {
        actor: actors.owner,
        body: body({
          jobs: [{
            title: 'Stale owner assignment',
            kind: 'repair',
            requiredSkillTier: 1,
            assignedTechId: sameShopTierOne.id,
          }],
        }),
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_assignee' })

    await db
      .update(profiles)
      .set({ membershipStatus: 'pending', membershipActivatedAt: null })
      .where(eq(profiles.id, actors.advisor.profileId))
    await expect(
      createTicket(db, { actor: actors.advisor, body: body() }),
    ).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await genericMutationState()).toEqual(before)
  })

  it('owns actor and body values before the first await', async () => {
    const callerActor: TicketActor = { ...actors.owner }
    const callerBody = body({
      concern: '  Original owned concern  ',
      jobs: [
        {
          title: 'Original first job',
          kind: 'repair',
          requiredSkillTier: 1,
          assignedTechId: sameShopTierOne.id,
        },
        {
          title: 'Original second job',
          kind: 'maintenance',
          requiredSkillTier: 1,
        },
      ],
    })
    const callerJobs = callerBody.jobs as Array<Record<string, unknown>>
    const pending = createTicket(db, { actor: callerActor, body: callerBody })

    callerActor.profileId = actors.tech.profileId
    callerActor.shopId = shopB.id
    callerActor.role = 'curator'
    callerActor.skillTier = null
    callerActor.membershipStatus = 'pending'
    callerActor.deactivatedAt = new Date()
    callerBody.customerId = customerB.id
    callerBody.vehicleId = vehicleB.id
    callerBody.concern = 'Caller mutation'
    callerBody.whenStarted = 'caller-mutated start'
    callerBody.howOften = 'caller-mutated frequency'
    callerBody.diagnosticAuthorizedCents = 1
    callerBody.diagnosticAuthorizationNote = 'caller-mutated authorization'
    callerBody.source = 'tech_quick'
    callerJobs[0]!.title = 'Caller-mutated first job'
    callerJobs[0]!.kind = 'diagnostic'
    callerJobs[0]!.requiredSkillTier = 3
    callerJobs[0]!.assignedTechId = actors.tech.profileId
    callerJobs.reverse()

    const result = await pending
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [persistedTicket] = await db.select().from(tickets)
    const persistedJobs = (await db.select().from(ticketJobs))
      .sort((left, right) => (left.sequenceNumber ?? 0) - (right.sequenceNumber ?? 0))
    expect(persistedTicket).toMatchObject({
      shopId: shopA.id,
      source: 'counter',
      customerId: customerA.id,
      vehicleId: vehicleA.id,
      concern: 'Original owned concern',
      whenStarted: 'last week',
      howOften: 'on cold starts',
      diagnosticAuthorizedCents: 12500,
      diagnosticAuthorizationNote: 'customer approved by phone',
      createdByProfileId: actors.owner.profileId,
    })
    expect(persistedJobs.map(({
      title,
      kind,
      requiredSkillTier,
      assignedTechId,
    }) => ({ title, kind, requiredSkillTier, assignedTechId })))
      .toEqual([
        {
          title: 'Original first job',
          kind: 'repair',
          requiredSkillTier: 1,
          assignedTechId: sameShopTierOne.id,
        },
        {
          title: 'Original second job',
          kind: 'maintenance',
          requiredSkillTier: 1,
          assignedTechId: null,
        },
      ])
  })

  it('rolls back the number and every row when a batch insert trigger fails', async () => {
    const before = await genericMutationState()
    await db.execute(sql.raw(`
      create function task_7e_fail_batch_insert() returns trigger
      language plpgsql as $$
      begin
        raise exception 'task_7e_batch_insert';
      end;
      $$
    `))
    await db.execute(sql.raw(`
      create trigger task_7e_fail_batch_insert
      after insert on ticket_jobs
      for each row execute function task_7e_fail_batch_insert()
    `))
    try {
      await expect(
        createTicket(db, { actor: actors.owner, body: body() }),
      ).rejects.toThrow('Failed query: insert into "ticket_jobs"')
    } finally {
      await db.execute(sql.raw(
        'drop trigger if exists task_7e_fail_batch_insert on ticket_jobs',
      ))
      await db.execute(sql.raw('drop function if exists task_7e_fail_batch_insert()'))
    }
    expect(await genericMutationState()).toEqual(before)
  })

  it('rolls back the entire generic batch when finalization detects trigger drift', async () => {
    const before = await genericMutationState()
    await db.execute(sql.raw(`
      create function task_7e_drift_before_finalization() returns trigger
      language plpgsql as $$
      begin
        update tickets set projection_revision = 2 where id = new.id;
        return new;
      end;
      $$
    `))
    await db.execute(sql.raw(`
      create trigger task_7e_drift_before_finalization
      after insert on tickets
      for each row execute function task_7e_drift_before_finalization()
    `))
    try {
      await expect(
        createTicket(db, { actor: actors.owner, body: body() }),
      ).rejects.toThrow('ticket_creation_kernel_invalid')
    } finally {
      await db.execute(sql.raw(
        'drop trigger if exists task_7e_drift_before_finalization on tickets',
      ))
      await db.execute(sql.raw('drop function if exists task_7e_drift_before_finalization()'))
    }
    expect(await genericMutationState()).toEqual(before)
  })

  it('rolls back after projection when a deferred commit trigger rejects the batch', async () => {
    const before = await genericMutationState()
    await db.execute(sql.raw(`
      create function task_7e_fail_after_projection() returns trigger
      language plpgsql as $$
      begin
        raise exception 'task_7e_after_projection';
      end;
      $$
    `))
    await db.execute(sql.raw(`
      create constraint trigger task_7e_fail_after_projection
      after insert on tickets deferrable initially deferred
      for each row execute function task_7e_fail_after_projection()
    `))
    try {
      await expect(
        createTicket(db, { actor: actors.owner, body: body() }),
      ).rejects.toThrow('task_7e_after_projection')
    } finally {
      await db.execute(sql.raw(
        'drop trigger if exists task_7e_fail_after_projection on tickets',
      ))
      await db.execute(sql.raw('drop function if exists task_7e_fail_after_projection()'))
    }
    expect(await genericMutationState()).toEqual(before)
  })

  it('allows every active Shop OS role and returns the trimmed canonical safe projection', async () => {
    for (const role of ['tech', 'advisor', 'parts', 'owner'] as const) {
      const result = await createTicket(db, { actor: actors[role], body: body() })
      expect(result.ok, role).toBe(true)
      if (!result.ok) continue

      expect(result.ticket).toMatchObject({
        ticketNumber: ['tech', 'advisor', 'parts', 'owner'].indexOf(role) + 1,
        source: 'counter',
        status: 'open',
        concern: 'Intermittent front-end noise',
        whenStarted: 'last week',
        howOften: 'on cold starts',
        diagnosticAuthorizedCents: 12500,
        diagnosticAuthorizationNote: 'customer approved by phone',
        customer: {
          id: customerA.id,
          name: 'Ada Driver',
          phone: '555-0101',
          email: 'ada@example.com',
        },
        vehicle: {
          id: vehicleA.id,
          year: 2020,
          make: 'Honda',
          model: 'Civic',
          engine: '2.0L',
          vin: 'VIN-A',
          mileage: 42000,
          plate: 'NORTH1',
        },
        jobs: [
          {
            title: 'Diagnose front-end noise',
            kind: 'diagnostic',
            requiredSkillTier: 2,
            assignedTechId: null,
            assignedTech: null,
            sessionId: null,
            workStatus: 'open',
            approvalState: 'pending_quote',
            workNotes: null,
            diagnosticStartState: 'idle',
            diagnosticStartErrorCode: null,
            createdAt: expect.any(Date),
            updatedAt: expect.any(Date),
          },
        ],
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      })
      expect(result.ticket).not.toHaveProperty('shopId')
      expect(result.ticket).not.toHaveProperty('createdByProfileId')
    }
  })

  it('rejects unsupported, pending, deactivated, and no-shop actors without mutation', async () => {
    const denied: Array<[TicketActor, string]> = [
      [{ ...actors.tech, role: 'curator' }, 'forbidden'],
      [{ ...actors.tech, membershipStatus: 'pending' }, 'inactive_profile'],
      [{ ...actors.tech, deactivatedAt: new Date() }, 'inactive_profile'],
      [{ ...actors.tech, shopId: null }, 'no_shop'],
    ]

    for (const [actor, error] of denied) {
      await expect(createTicket(db, { actor, body: body() })).resolves.toEqual({
        ok: false,
        error,
      })
    }
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })

  it('rejects malformed, unbounded, unsafe, empty, and client-managed body fields', async () => {
    const invalidBodies: unknown[] = [
      null,
      body({ source: 'counter' }),
      body({ source: 'tech_quick' }),
      body({ source: 'quick_quote' }),
      body({ source: 'legacy_repair_order' }),
      body({ source: null }),
      body({ customerId: 'not-a-uuid' }),
      body({ concern: '   ' }),
      body({ concern: 'x'.repeat(5001) }),
      body({ whenStarted: 'x'.repeat(1001) }),
      body({ howOften: 'x'.repeat(1001) }),
      body({ diagnosticAuthorizationNote: 'x'.repeat(2001) }),
      body({ diagnosticAuthorizedCents: -1 }),
      body({ diagnosticAuthorizedCents: Number.MAX_SAFE_INTEGER + 1 }),
      body({ diagnosticAuthorizedCents: 1.5 }),
      body({ jobs: [] }),
      body({
        jobs: Array.from({ length: 26 }, () => ({
          title: 'Job',
          kind: 'repair',
          requiredSkillTier: 1,
        })),
      }),
      body({ jobs: [{ title: ' ', kind: 'repair', requiredSkillTier: 1 }] }),
      body({ jobs: [{ title: 'x'.repeat(201), kind: 'repair', requiredSkillTier: 1 }] }),
      body({ jobs: [{ title: 'Job', kind: 'inspection', requiredSkillTier: 1 }] }),
      body({ jobs: [{ title: 'Job', kind: 'repair', requiredSkillTier: 4 }] }),
      { ...body(), status: 'closed' },
      body({
        jobs: [{ title: 'Job', kind: 'repair', requiredSkillTier: 1, workStatus: 'done' }],
      }),
    ]

    for (const invalidBody of invalidBodies) {
      await expect(
        createTicket(db, { actor: actors.owner, body: invalidBody }),
      ).resolves.toEqual({ ok: false, error: 'invalid_input' })
    }
    expect(await db.select().from(tickets)).toEqual([])
    expect(await db.select().from(ticketJobs)).toEqual([])
  })

  it('reports locked pair drift while hiding cross-shop customer and vehicle records', async () => {
    const invalidPairs = [
      body({ customerId: null }),
      body({ vehicleId: null }),
      body({ customerId: customerA.id, vehicleId: vehicleA2.id }),
      body({ customerId: customerB.id, vehicleId: vehicleB.id }),
      body({ customerId: customerA.id, vehicleId: vehicleB.id }),
    ]

    await expect(
      createTicket(db, { actor: actors.advisor, body: invalidPairs[0] }),
    ).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(
      createTicket(db, { actor: actors.advisor, body: invalidPairs[1] }),
    ).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(
      createTicket(db, { actor: actors.advisor, body: invalidPairs[2] }),
    ).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })
    for (const invalidPair of invalidPairs.slice(3)) {
      await expect(
        createTicket(db, { actor: actors.advisor, body: invalidPair }),
      ).resolves.toEqual({ ok: false, error: 'not_found' })
    }
  })

  it('keeps open work unassigned and permits only sufficiently tiered self-assignment', async () => {
    const open = await createTicket(db, { actor: actors.tech, body: body() })
    expect(open).toMatchObject({
      ok: true,
      ticket: { jobs: [{ assignedTechId: null, assignedTech: null }] },
    })

    const assigned = await createTicket(db, {
      actor: actors.tech,
      body: body({
        jobs: [
          {
            title: 'Self-assigned diagnosis',
            kind: 'diagnostic',
            requiredSkillTier: 2,
            assignedTechId: actors.tech.profileId,
          },
        ],
      }),
    })
    expect(assigned).toMatchObject({
      ok: true,
      ticket: {
        jobs: [
          {
            assignedTechId: actors.tech.profileId,
            assignedTech: {
              id: actors.tech.profileId,
              fullName: 'Taylor Tech',
              role: 'tech',
              skillTier: 2,
            },
          },
        ],
      },
    })
    if (assigned.ok) {
      expect(assigned.ticket.jobs[0].assignedTech).not.toHaveProperty('userId')
    }

    await expect(
      createTicket(db, {
        actor: actors.tech,
        body: body({
          jobs: [
            {
              title: 'Too advanced',
              kind: 'repair',
              requiredSkillTier: 3,
              assignedTechId: actors.tech.profileId,
              confirmBelowTier: true,
            },
          ],
        }),
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_assignee' })
  })

  it('requires assignment authority and explicit advisor or owner confirmation below tier', async () => {
    for (const role of ['tech', 'parts'] as const) {
      await expect(
        createTicket(db, {
          actor: actors[role],
          body: body({
            jobs: [
              {
                title: 'Assign another tech',
                kind: 'repair',
                requiredSkillTier: 1,
                assignedTechId: sameShopTierOne.id,
              },
            ],
          }),
        }),
      ).resolves.toEqual({ ok: false, error: 'invalid_assignee' })
    }

    for (const role of ['advisor', 'owner'] as const) {
      const assignment = {
        title: 'Advanced repair',
        kind: 'repair',
        requiredSkillTier: 3,
        assignedTechId: sameShopTierOne.id,
      }
      await expect(
        createTicket(db, { actor: actors[role], body: body({ jobs: [assignment] }) }),
      ).resolves.toEqual({
        ok: false,
        error: 'tier_confirmation_required',
        warning: {
          code: 'below_required_tier',
          assignedTechId: sameShopTierOne.id,
          assignedSkillTier: 1,
          requiredSkillTier: 3,
        },
      })

      await expect(
        createTicket(db, {
          actor: actors[role],
          body: body({ jobs: [{ ...assignment, confirmBelowTier: true }] }),
        }),
      ).resolves.toMatchObject({
        ok: true,
        ticket: { jobs: [{ assignedTechId: sameShopTierOne.id }] },
      })
    }
  })

  it('hides missing and cross-shop assignees and rejects invalid same-shop assignees', async () => {
    await db.execute(sql.raw(
      'alter table profiles drop constraint profiles_skill_tier_range',
    ))
    const [crossShop, pending, deactivated, tierless, unsupported, invalidTier] = await db
      .insert(profiles)
      .values([
        { userId: uuid(20), shopId: shopB.id, role: 'tech', skillTier: 3 },
        {
          userId: uuid(21),
          shopId: shopA.id,
          role: 'tech',
          skillTier: 3,
          membershipStatus: 'pending',
          membershipActivatedAt: null,
        },
        {
          userId: uuid(22),
          shopId: shopA.id,
          role: 'tech',
          skillTier: 3,
          deactivatedAt: new Date(),
        },
        { userId: uuid(23), shopId: shopA.id, role: 'parts', skillTier: null },
        { userId: uuid(24), shopId: shopA.id, role: 'curator', skillTier: 3 },
        { userId: uuid(25), shopId: shopA.id, role: 'tech', skillTier: 4 },
      ])
      .returning()

    await expect(
      createTicket(db, {
        actor: actors.owner,
        body: body({
          jobs: [
            {
              title: 'Cross-shop assignment',
              kind: 'repair',
              requiredSkillTier: 1,
              assignedTechId: crossShop.id,
            },
          ],
        }),
      }),
    ).resolves.toEqual({ ok: false, error: 'not_found' })

    await expect(
      createTicket(db, {
        actor: actors.owner,
        body: body({
          jobs: [
            {
              title: 'Unknown assignment',
              kind: 'repair',
              requiredSkillTier: 1,
              assignedTechId: '00000000-0000-4000-8000-000000000999',
            },
          ],
        }),
      }),
    ).resolves.toEqual({ ok: false, error: 'not_found' })

    for (const assignedTechId of [
      pending.id,
      deactivated.id,
      tierless.id,
      unsupported.id,
      invalidTier.id,
    ]) {
      await expect(
        createTicket(db, {
          actor: actors.owner,
          body: body({
            jobs: [
              {
                title: 'Invalid assignment',
                kind: 'repair',
                requiredSkillTier: 1,
                assignedTechId,
              },
            ],
          }),
        }),
      ).resolves.toEqual({ ok: false, error: 'invalid_assignee' })
    }
    expect(await db.select().from(tickets)).toEqual([])
  })

  it('allocates concurrent same-shop numbers consecutively and sequences shops independently', async () => {
    const [first, second] = await Promise.all([
      createTicket(db, { actor: actors.owner, body: body() }),
      createTicket(db, { actor: actors.advisor, body: body() }),
    ])
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect([first.ticket.ticketNumber, second.ticket.ticketNumber].sort()).toEqual([1, 2])

    const [shopBActor] = await db
      .insert(profiles)
      .values({ userId: uuid(30), shopId: shopB.id, role: 'owner', skillTier: 3 })
      .returning()
    const otherShop = await createTicket(db, {
      actor: actorFrom(shopBActor),
      body: body({ customerId: customerB.id, vehicleId: vehicleB.id }),
    })
    expect(otherShop).toMatchObject({ ok: true, ticket: { ticketNumber: 1 } })

    const [northSequence] = await db
      .select({ nextTicketNumber: shops.nextTicketNumber })
      .from(shops)
      .where(eq(shops.id, shopA.id))
    const [southSequence] = await db
      .select({ nextTicketNumber: shops.nextTicketNumber })
      .from(shops)
      .where(eq(shops.id, shopB.id))
    expect(northSequence.nextTicketNumber).toBe(3)
    expect(southSequence.nextTicketNumber).toBe(2)
  })
})
