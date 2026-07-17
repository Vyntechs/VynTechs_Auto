import { and, eq, gt, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  sessions,
  ticketJobs,
  tickets,
  vehicles,
  vendorAccounts,
  type IntakePayload,
  type TreeState,
} from '@/lib/db/schema'
import { assertLiveLockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import { ShopOsMutationNotFound } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { ShopOsMutationConflict } from '@/lib/shop-os/continuity/mutation-foundation/conflicts'
import type {
  LockedMutationScopeV1,
  MutationLockRequestV1,
} from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import { finalizeMutationRevisionsV1 } from '@/lib/shop-os/continuity/mutation-foundation/revisions'
import { runBoundedShopOsMutationV1 } from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'

export const DIAGNOSTIC_START_LEASE_MINUTES = 2

export type DiagnosticStartActor = { profileId: string; shopId: string }

type SafeFailure = { ok: false; status: 404 | 409; error: 'not found' | 'start unavailable' }
type Ready = { ok: true; state: 'ready'; sessionId: string }
type Waiting = { ok: true; state: 'initializing'; leaseAcquired: false }
type Acquired = {
  ok: true
  state: 'initializing'
  leaseAcquired: true
  attemptKey: string
  leaseUntil: Date
  context: { vehicleId: string; intake: IntakePayload }
}
type Ambiguous = { ok: true; state: 'ambiguous' }
type Failed = { ok: true; state: 'failed' }

export type AcquireDiagnosticStartResult = Ready | Waiting | Acquired | Ambiguous | Failed | SafeFailure
export type SettleDiagnosticStartResult = Ready | Waiting | Ambiguous | Failed | SafeFailure

type StartInput = {
  actor: DiagnosticStartActor
  ticketId: string
  jobId: string
  attemptKey: string
}

type FinalizeInput = StartInput & {
  sessionId: string
  treeState: TreeState
  context: { vehicleId: string; intake: IntakePayload }
  maxCorpusSimilarity?: number | null
}

export type DiagnosticStartMutationDependencies = Readonly<{
  afterDiscovery?: (tx: AppDb) => Promise<void>
  afterLocks?: () => Promise<void>
  beforeLink?: (tx: AppDb) => Promise<void>
  afterWrite?: () => Promise<void>
  afterFinalization?: () => Promise<void>
}>

type DiagnosticStartDiscovery = Readonly<{
  kind: 'ready' | 'not_found'
  separateChainIds: readonly string[]
  closureFingerprint: string | null
  attemptCollision: boolean
  sessionInsertion: 'none' | 'create' | 'existing' | 'collision'
}>

type LockedStartContext = Readonly<{
  graph: LockedMutationScopeV1['tickets'][number]
  job: typeof ticketJobs.$inferSelect
  linkedSession: typeof sessions.$inferSelect | null
  vehicle: typeof vehicles.$inferSelect | null
}>

class DiagnosticFinalizeFailed extends Error {}

const notFound = (): SafeFailure => ({ ok: false, status: 404, error: 'not found' })
const unavailable = (): SafeFailure => ({ ok: false, status: 409, error: 'start unavailable' })
const waiting = (): Waiting => ({ ok: true, state: 'initializing', leaseAcquired: false })
const ambiguous = (): Ambiguous => ({ ok: true, state: 'ambiguous' })

function uuidList(values: readonly (string | null | undefined)[]): readonly string[] {
  return Object.freeze([...new Set(values.filter((value): value is string =>
    typeof value === 'string'))].sort())
}

function rowsById<T extends { id: string }>(rows: readonly T[]): readonly T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id))
}

function emptyInsertionIntents(): MutationLockRequestV1['insertionIntents'] {
  return Object.freeze({
    sessions: Object.freeze([]),
    customers: Object.freeze([]),
    vehicles: Object.freeze([]),
    tickets: Object.freeze([]),
    jobs: Object.freeze([]),
  })
}

function persistedFingerprint(value: unknown): string {
  const normalize = (member: unknown): unknown => {
    if (member instanceof Date) return { $date: member.toISOString() }
    if (typeof member === 'bigint') return { $bigint: member.toString() }
    if (
      member === null || member === undefined ||
      ['string', 'number', 'boolean'].includes(typeof member)
    ) return member ?? null
    if (Array.isArray(member)) return member.map(normalize)
    if (typeof member !== 'object') throw new TypeError('invalid_diagnostic_start_discovery')
    return Object.fromEntries(Object.keys(member as Record<string, unknown>).sort()
      .map((key) => [key, normalize((member as Record<string, unknown>)[key])]))
  }
  return JSON.stringify(normalize(value))
}

function actorOnlyDiscovery(input: StartInput): Readonly<{
  lockRequest: MutationLockRequestV1
  payload: DiagnosticStartDiscovery
}> {
  return Object.freeze({
    lockRequest: Object.freeze({
      shopId: input.actor.shopId,
      actorProfileId: input.actor.profileId,
      profileIds: Object.freeze([input.actor.profileId]),
      lockShop: false,
      customerIds: Object.freeze([]),
      vehicleIds: Object.freeze([]),
      ticketIds: Object.freeze([]),
      jobIds: Object.freeze([]),
      includeAllJobsForTickets: false,
      includeAllLinesForJobs: false,
      includeAllQuoteVersionsForTickets: false,
      includeAllQuoteEventsForTickets: false,
      sessionIds: Object.freeze([]),
      sessionEventIds: Object.freeze([]),
      vendorAccountIds: Object.freeze([]),
      cannedJobIds: Object.freeze([]),
      receiptRequestKey: null,
      receiptConditionalInsert: null,
      insertionIntents: emptyInsertionIntents(),
    }),
    payload: Object.freeze({
      kind: 'not_found' as const,
      separateChainIds: Object.freeze([]),
      closureFingerprint: null,
      attemptCollision: false,
      sessionInsertion: 'none' as const,
    }),
  })
}

async function discoverDiagnosticStart(
  tx: AppDb,
  input: StartInput & { sessionId?: string },
  dependencies: DiagnosticStartMutationDependencies,
): Promise<Readonly<{ lockRequest: MutationLockRequestV1; payload: DiagnosticStartDiscovery }>> {
  const [target] = await tx.select().from(tickets).where(and(
    eq(tickets.shopId, input.actor.shopId), eq(tickets.id, input.ticketId),
  )).limit(1)
  const [targetJob] = target ? await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.actor.shopId),
    eq(ticketJobs.ticketId, input.ticketId),
    eq(ticketJobs.id, input.jobId),
  )).limit(1) : []
  if (!target || !targetJob) {
    await dependencies.afterDiscovery?.(tx)
    return actorOnlyDiscovery(input)
  }

  const ticketRows = [target]
  const seenTicketIds = new Set([target.id])
  let parentId = target.separateFromTicketId
  while (parentId !== null) {
    if (ticketRows.length >= 64 || seenTicketIds.has(parentId)) {
      throw new ShopOsMutationConflict()
    }
    const [parent] = await tx.select().from(tickets).where(and(
      eq(tickets.shopId, input.actor.shopId), eq(tickets.id, parentId),
    )).limit(1)
    if (!parent) throw new ShopOsMutationConflict()
    ticketRows.push(parent)
    seenTicketIds.add(parent.id)
    parentId = parent.separateFromTicketId
  }
  const ticketIds = uuidList(ticketRows.map(({ id }) => id))
  const jobs = await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.actor.shopId), inArray(ticketJobs.ticketId, ticketIds),
  )).orderBy(ticketJobs.id)
  const jobIds = uuidList(jobs.map(({ id }) => id))
  const lines = jobIds.length === 0 ? [] : await tx.select().from(jobLines).where(and(
    eq(jobLines.shopId, input.actor.shopId), inArray(jobLines.jobId, jobIds),
  )).orderBy(jobLines.id)
  const versions = await tx.select().from(quoteVersions).where(and(
    eq(quoteVersions.shopId, input.actor.shopId), inArray(quoteVersions.ticketId, ticketIds),
  )).orderBy(quoteVersions.id)
  const events = await tx.select().from(quoteEvents).where(and(
    eq(quoteEvents.shopId, input.actor.shopId), inArray(quoteEvents.ticketId, ticketIds),
  )).orderBy(quoteEvents.id)
  const sessionIds = uuidList(jobs.map(({ sessionId }) => sessionId))
  const sessionRows = sessionIds.length === 0 ? [] : await tx.select().from(sessions).where(and(
    eq(sessions.shopId, input.actor.shopId), inArray(sessions.id, sessionIds),
  )).orderBy(sessions.id)
  const vehicleIds = uuidList([
    ...ticketRows.map(({ vehicleId }) => vehicleId),
    ...sessionRows.map(({ vehicleId }) => vehicleId),
  ])
  const vehicleRows = vehicleIds.length === 0 ? [] : (await tx.select({ row: vehicles })
    .from(vehicles).innerJoin(customers, eq(customers.id, vehicles.customerId))
    .where(and(eq(customers.shopId, input.actor.shopId), inArray(vehicles.id, vehicleIds)))
    .orderBy(vehicles.id)).map(({ row }) => row)
  const customerIds = uuidList([
    ...ticketRows.map(({ customerId }) => customerId),
    ...vehicleRows.map(({ customerId }) => customerId),
  ])
  const customerRows = customerIds.length === 0 ? [] : await tx.select().from(customers).where(and(
    eq(customers.shopId, input.actor.shopId), inArray(customers.id, customerIds),
  )).orderBy(customers.id)
  const vendorAccountIds = uuidList(lines.map(({ vendorAccountId }) => vendorAccountId))
  const vendorRows = vendorAccountIds.length === 0 ? [] : await tx.select().from(vendorAccounts)
    .where(and(
      eq(vendorAccounts.shopId, input.actor.shopId),
      inArray(vendorAccounts.id, vendorAccountIds),
    )).orderBy(vendorAccounts.id)
  const profileIds = uuidList([
    input.actor.profileId,
    ...ticketRows.flatMap((ticket) => [
      ticket.createdByProfileId, ticket.canceledByProfileId,
      ticket.deliveredByProfileId, ticket.closedByProfileId,
    ]),
    ...jobs.flatMap((job) => [
      job.assignedTechId, job.createdByProfileId, job.statementConfirmedByProfileId,
    ]),
    ...lines.flatMap((line) => [line.orderedByProfileId, line.receivedByProfileId]),
    ...sessionRows.map(({ techId }) => techId),
    ...versions.map(({ createdByProfileId }) => createdByProfileId),
    ...events.map(({ actorProfileId }) => actorProfileId),
  ])
  const profileRows = await tx.select().from(profiles).where(and(
    eq(profiles.shopId, input.actor.shopId), inArray(profiles.id, profileIds),
  )).orderBy(profiles.id)
  const [attemptOwner] = await tx.select({ id: ticketJobs.id }).from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.actor.shopId),
    eq(ticketJobs.diagnosticStartAttemptKey, input.attemptKey),
    ne(ticketJobs.id, input.jobId),
  )).limit(1)

  let sessionInsertion: DiagnosticStartDiscovery['sessionInsertion'] = 'none'
  if (input.sessionId !== undefined) {
    if (targetJob.sessionId === input.sessionId) {
      sessionInsertion = 'existing'
    } else if (targetJob.sessionId !== null) {
      sessionInsertion = 'collision'
    } else {
      const [existing] = await tx.select({ id: sessions.id }).from(sessions)
        .where(eq(sessions.id, input.sessionId)).limit(1)
      sessionInsertion = existing ? 'collision' : 'create'
    }
  }
  const fingerprint = persistedFingerprint({
    profiles: rowsById(profileRows), customers: rowsById(customerRows),
    vehicles: rowsById(vehicleRows), tickets: rowsById(ticketRows),
    jobs: rowsById(jobs), lines: rowsById(lines), versions: rowsById(versions),
    events: rowsById(events), sessions: rowsById(sessionRows), vendors: rowsById(vendorRows),
  })
  const insertionIntents = sessionInsertion === 'create'
    ? Object.freeze({
        ...emptyInsertionIntents(),
        sessions: Object.freeze([{
          id: input.sessionId!, shopId: input.actor.shopId, techId: input.actor.profileId,
        }]),
      })
    : emptyInsertionIntents()
  const result = Object.freeze({
    lockRequest: Object.freeze({
      shopId: input.actor.shopId,
      actorProfileId: input.actor.profileId,
      profileIds,
      lockShop: sessionInsertion === 'create',
      customerIds,
      vehicleIds,
      ticketIds,
      jobIds,
      includeAllJobsForTickets: true,
      includeAllLinesForJobs: true,
      includeAllQuoteVersionsForTickets: true,
      includeAllQuoteEventsForTickets: true,
      sessionIds,
      sessionEventIds: Object.freeze([]),
      vendorAccountIds,
      cannedJobIds: Object.freeze([]),
      receiptRequestKey: null,
      receiptConditionalInsert: null,
      insertionIntents,
    }),
    payload: Object.freeze({
      kind: 'ready' as const,
      separateChainIds: Object.freeze(ticketRows.map(({ id }) => id)),
      closureFingerprint: fingerprint,
      attemptCollision: Boolean(attemptOwner),
      sessionInsertion,
    }),
  })
  await dependencies.afterDiscovery?.(tx)
  return result
}

function resolveLockedContext(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  discovery: DiagnosticStartDiscovery,
  input: StartInput,
): LockedStartContext {
  assertLiveLockedMutationScopeV1(tx, scope)
  if (discovery.kind === 'not_found') throw new ShopOsMutationNotFound()
  if (
    scope.profiles.length !== scope.request.profileIds.length ||
    scope.profiles.some(({ id, shopId }) =>
      shopId !== scope.actor.shopId || !scope.request.profileIds.includes(id))
  ) throw new ShopOsMutationNotFound()
  const graphById = new Map(scope.tickets.map((graph) => [graph.ticket.id, graph] as const))
  if (
    discovery.separateChainIds.length < 1 || discovery.separateChainIds[0] !== input.ticketId ||
    discovery.separateChainIds.length !== scope.tickets.length ||
    new Set(discovery.separateChainIds).size !== discovery.separateChainIds.length
  ) throw new ShopOsMutationConflict()
  for (let index = 0; index < discovery.separateChainIds.length; index += 1) {
    const graph = graphById.get(discovery.separateChainIds[index]!)
    if (!graph || graph.ticket.separateFromTicketId !==
      (discovery.separateChainIds[index + 1] ?? null)) throw new ShopOsMutationConflict()
  }
  const lockedFingerprint = persistedFingerprint({
    profiles: rowsById(scope.profiles), customers: rowsById(scope.customers),
    vehicles: rowsById(scope.vehicles),
    tickets: rowsById(scope.tickets.map(({ ticket }) => ticket)),
    jobs: rowsById(scope.tickets.flatMap(({ jobs }) => jobs)),
    lines: rowsById(scope.tickets.flatMap(({ lines }) => lines)),
    versions: rowsById(scope.tickets.flatMap(({ versions }) => versions)),
    events: rowsById(scope.tickets.flatMap(({ events }) => events)),
    sessions: rowsById(scope.sessions), vendors: rowsById(scope.vendorAccounts),
  })
  if (lockedFingerprint !== discovery.closureFingerprint) throw new ShopOsMutationConflict()
  const graph = graphById.get(input.ticketId)
  const job = graph?.jobs.find(({ id }) => id === input.jobId)
  if (
    !graph || !job || graph.ticket.status !== 'open' || job.kind !== 'diagnostic' ||
    job.assignedTechId !== scope.actor.id || typeof scope.actor.skillTier !== 'number' ||
    scope.actor.skillTier < job.requiredSkillTier
  ) throw new ShopOsMutationNotFound()
  const linkedSession = job.sessionId === null
    ? null
    : scope.sessions.find(({ id }) => id === job.sessionId) ?? null
  const vehicle = graph.ticket.vehicleId === null
    ? null
    : scope.vehicles.find(({ id }) => id === graph.ticket.vehicleId) ?? null
  return { graph, job, linkedSession, vehicle }
}

function intakeFromContext(context: LockedStartContext): { vehicleId: string; intake: IntakePayload } | null {
  const { graph, vehicle } = context
  if (
    graph.ticket.customerId === null || graph.ticket.vehicleId === null || !vehicle ||
    vehicle.customerId !== graph.ticket.customerId
  ) return null
  return {
    vehicleId: vehicle.id,
    intake: {
      vehicleYear: vehicle.year,
      vehicleMake: vehicle.make,
      vehicleModel: vehicle.model,
      ...(vehicle.engine ? { vehicleEngine: vehicle.engine } : {}),
      ...(vehicle.mileage !== null ? { mileage: vehicle.mileage } : {}),
      customerComplaint: graph.ticket.concern,
    },
  }
}

function existingReady(context: LockedStartContext): Ready | SafeFailure | null {
  const { job, linkedSession, vehicle } = context
  if (job.sessionId === null) return null
  if (
    !linkedSession || linkedSession.techId !== job.assignedTechId ||
    linkedSession.vehicleId !== vehicle?.id || job.workStatus !== 'in_progress' ||
    job.diagnosticStartState !== 'ready'
  ) return notFound()
  return { ok: true, state: 'ready', sessionId: linkedSession.id }
}

function safeState(context: LockedStartContext): SettleDiagnosticStartResult {
  const ready = existingReady(context)
  if (ready) return ready
  if (context.job.diagnosticStartState === 'ambiguous') return ambiguous()
  if (context.job.diagnosticStartState === 'initializing') return waiting()
  if (context.job.diagnosticStartState === 'failed') return { ok: true, state: 'failed' }
  return unavailable()
}

async function finalizeChangedJob(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  input: StartInput,
  sessionIds: readonly string[],
  dependencies: DiagnosticStartMutationDependencies,
): Promise<void> {
  await dependencies.afterWrite?.()
  await finalizeMutationRevisionsV1(tx, scope, {
    sessionIds, customerIds: [], vehicleIds: [],
  }, [{
    ticketId: input.ticketId,
    createdTicket: false,
    createdJobIds: [],
    existingChangedJobIds: [input.jobId],
    actorVisibleTicketFieldsChanged: true,
  }])
  await dependencies.afterFinalization?.()
}

async function updateExpiredLease(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  context: LockedStartContext,
  input: StartInput,
  dependencies: DiagnosticStartMutationDependencies,
): Promise<boolean> {
  const [updated] = await tx.update(ticketJobs).set({
    diagnosticStartState: 'ambiguous',
    diagnosticStartLeaseUntil: null,
    diagnosticStartErrorCode: 'lease_expired',
    updatedAt: sql`now()`,
  }).where(and(
    eq(ticketJobs.shopId, input.actor.shopId),
    eq(ticketJobs.id, input.jobId),
    eq(ticketJobs.diagnosticStartState, 'initializing'),
    eq(ticketJobs.diagnosticStartAttemptKey, context.job.diagnosticStartAttemptKey!),
    or(
      isNull(ticketJobs.diagnosticStartLeaseUntil),
      lte(ticketJobs.diagnosticStartLeaseUntil, sql`now()`),
    ),
  )).returning()
  if (!updated) return false
  await finalizeChangedJob(tx, scope, input, [], dependencies)
  return true
}

export async function acquireDiagnosticStart(
  db: AppDb,
  input: StartInput & { confirmAmbiguousRetry?: boolean; statusOnly?: boolean },
  dependencies: DiagnosticStartMutationDependencies = {},
): Promise<AcquireDiagnosticStartResult> {
  try {
    return await runBoundedShopOsMutationV1<AcquireDiagnosticStartResult, DiagnosticStartDiscovery>(db, {
      discover: async (tx) => discoverDiagnosticStart(tx, input, dependencies),
      executeLocked: async (tx, scope, discovery) => {
        const context = resolveLockedContext(tx, scope, discovery, input)
        await dependencies.afterLocks?.()
        const ready = existingReady(context)
        if (ready) return ready
        if (context.job.workStatus !== 'open') return notFound()
        if (discovery.attemptCollision) return unavailable()

        if (context.job.diagnosticStartState === 'initializing') {
          if (!context.job.diagnosticStartAttemptKey) return unavailable()
          if (await updateExpiredLease(tx, scope, context, input, dependencies)) return ambiguous()
          return waiting()
        }
        if (input.statusOnly) {
          if (context.job.diagnosticStartState === 'ambiguous') return ambiguous()
          if (context.job.diagnosticStartState === 'failed') return { ok: true, state: 'failed' }
          return unavailable()
        }
        if (context.job.diagnosticStartState === 'ambiguous') {
          if (
            input.confirmAmbiguousRetry !== true ||
            !context.job.diagnosticStartAttemptKey ||
            context.job.diagnosticStartAttemptKey === input.attemptKey
          ) return ambiguous()
        } else if (
          context.job.diagnosticStartState !== 'idle' &&
          context.job.diagnosticStartState !== 'failed'
        ) return unavailable()

        const acquiredContext = intakeFromContext(context)
        if (!acquiredContext) return notFound()
        const allowedState = context.job.diagnosticStartState as 'idle' | 'failed' | 'ambiguous'
        const [leased] = await tx.update(ticketJobs).set({
          diagnosticStartState: 'initializing',
          diagnosticStartAttemptKey: input.attemptKey,
          diagnosticStartLeaseUntil:
            sql`now() + (${DIAGNOSTIC_START_LEASE_MINUTES} * interval '1 minute')`,
          diagnosticStartErrorCode: null,
          updatedAt: sql`now()`,
        }).where(and(
          eq(ticketJobs.shopId, input.actor.shopId),
          eq(ticketJobs.id, input.jobId),
          eq(ticketJobs.workStatus, 'open'),
          eq(ticketJobs.diagnosticStartState, allowedState),
          allowedState === 'ambiguous' && context.job.diagnosticStartAttemptKey
            ? and(
                eq(ticketJobs.diagnosticStartAttemptKey, context.job.diagnosticStartAttemptKey),
                ne(ticketJobs.diagnosticStartAttemptKey, input.attemptKey),
              )
            : undefined,
        )).returning()
        if (!leased?.diagnosticStartLeaseUntil) throw new DiagnosticFinalizeFailed()
        await finalizeChangedJob(tx, scope, input, [], dependencies)
        return {
          ok: true,
          state: 'initializing',
          leaseAcquired: true,
          attemptKey: input.attemptKey,
          leaseUntil: leased.diagnosticStartLeaseUntil,
          context: acquiredContext,
        }
      },
    })
  } catch (error) {
    if (error instanceof ShopOsMutationNotFound) return notFound()
    return unavailable()
  }
}

function sameAcquiredContext(
  acquired: FinalizeInput['context'],
  persisted: { vehicleId: string; intake: IntakePayload },
): boolean {
  return acquired.vehicleId === persisted.vehicleId
    && acquired.intake.vehicleYear === persisted.intake.vehicleYear
    && acquired.intake.vehicleMake === persisted.intake.vehicleMake
    && acquired.intake.vehicleModel === persisted.intake.vehicleModel
    && acquired.intake.vehicleEngine === persisted.intake.vehicleEngine
    && acquired.intake.mileage === persisted.intake.mileage
    && acquired.intake.customerComplaint === persisted.intake.customerComplaint
}

async function settleDiagnosticStart(
  db: AppDb,
  input: StartInput & { state: 'failed' | 'ambiguous'; errorCode: string },
  dependencies: DiagnosticStartMutationDependencies = {},
): Promise<SettleDiagnosticStartResult> {
  const startInput: StartInput = {
    actor: input.actor,
    ticketId: input.ticketId,
    jobId: input.jobId,
    attemptKey: input.attemptKey,
  }
  try {
    return await runBoundedShopOsMutationV1<SettleDiagnosticStartResult, DiagnosticStartDiscovery>(db, {
      discover: async (tx) => discoverDiagnosticStart(tx, startInput, dependencies),
      executeLocked: async (tx, scope, discovery) => {
        const context = resolveLockedContext(tx, scope, discovery, startInput)
        await dependencies.afterLocks?.()
        const ready = existingReady(context)
        if (ready) return ready
        if (context.job.workStatus !== 'open') return notFound()
        if (
          context.job.diagnosticStartState !== 'initializing' ||
          context.job.diagnosticStartAttemptKey !== input.attemptKey
        ) return safeState(context)
        const [updated] = await tx.update(ticketJobs).set({
          diagnosticStartState: input.state,
          diagnosticStartLeaseUntil: null,
          diagnosticStartErrorCode: input.errorCode,
          updatedAt: sql`now()`,
        }).where(and(
          eq(ticketJobs.shopId, input.actor.shopId),
          eq(ticketJobs.id, input.jobId),
          eq(ticketJobs.diagnosticStartState, 'initializing'),
          eq(ticketJobs.diagnosticStartAttemptKey, input.attemptKey),
          gt(ticketJobs.diagnosticStartLeaseUntil, sql`now()`),
        )).returning()
        if (!updated) {
          if (await updateExpiredLease(tx, scope, context, startInput, dependencies)) {
            return ambiguous()
          }
          throw new ShopOsMutationConflict()
        }
        await finalizeChangedJob(tx, scope, startInput, [], dependencies)
        return input.state === 'failed' ? { ok: true, state: 'failed' } : ambiguous()
      },
    })
  } catch (error) {
    if (error instanceof ShopOsMutationNotFound) return notFound()
    return unavailable()
  }
}

export async function finalizeDiagnosticStart(
  db: AppDb,
  input: FinalizeInput,
  dependencies: DiagnosticStartMutationDependencies = {},
): Promise<SettleDiagnosticStartResult> {
  if (input.treeState.nodes.length === 0) {
    return settleDiagnosticStart(db, {
      ...input, state: 'ambiguous', errorCode: 'empty_initial_tree',
    }, dependencies)
  }
  try {
    return await runBoundedShopOsMutationV1<SettleDiagnosticStartResult, DiagnosticStartDiscovery>(db, {
      discover: async (tx) => discoverDiagnosticStart(tx, input, dependencies),
      executeLocked: async (tx, scope, discovery) => {
        const context = resolveLockedContext(tx, scope, discovery, input)
        await dependencies.afterLocks?.()
        const ready = existingReady(context)
        if (ready) return ready
        if (
          context.job.workStatus !== 'open' ||
          context.job.diagnosticStartState !== 'initializing' ||
          context.job.diagnosticStartAttemptKey !== input.attemptKey
        ) return safeState(context)
        if (discovery.sessionInsertion !== 'create') throw new DiagnosticFinalizeFailed()
        const persistedContext = intakeFromContext(context)
        if (!persistedContext || !sameAcquiredContext(input.context, persistedContext)) {
          throw new DiagnosticFinalizeFailed()
        }
        await tx.insert(sessions).values({
          id: input.sessionId,
          shopId: input.actor.shopId,
          techId: input.actor.profileId,
          vehicleId: input.context.vehicleId,
          intake: input.context.intake,
          treeState: input.treeState,
          maxCorpusSimilarity: input.maxCorpusSimilarity ?? null,
        })
        await dependencies.beforeLink?.(tx)
        const [linked] = await tx.update(ticketJobs).set({
          sessionId: input.sessionId,
          workStatus: 'in_progress',
          diagnosticStartState: 'ready',
          diagnosticStartAttemptKey: null,
          diagnosticStartLeaseUntil: null,
          diagnosticStartErrorCode: null,
          updatedAt: sql`now()`,
        }).where(and(
          eq(ticketJobs.shopId, input.actor.shopId),
          eq(ticketJobs.id, input.jobId),
          eq(ticketJobs.workStatus, 'open'),
          eq(ticketJobs.diagnosticStartState, 'initializing'),
          eq(ticketJobs.diagnosticStartAttemptKey, input.attemptKey),
          gt(ticketJobs.diagnosticStartLeaseUntil, sql`now()`),
          isNull(ticketJobs.sessionId),
        )).returning()
        if (!linked?.sessionId) throw new DiagnosticFinalizeFailed()
        await finalizeChangedJob(tx, scope, input, [input.sessionId], dependencies)
        return { ok: true, state: 'ready', sessionId: linked.sessionId }
      },
      uniqueCollisionRecovery: {
        allowedConstraints: ['sessions_pkey'],
        executeLocked: async (tx, scope, discovery) => {
          const context = resolveLockedContext(tx, scope, discovery, input)
          const ready = existingReady(context)
          return ready && ready.ok
            ? { kind: 'recovered', value: ready }
            : { kind: 'unresolved' }
        },
      },
    })
  } catch (error) {
    if (error instanceof ShopOsMutationNotFound) return notFound()
    return settleDiagnosticStart(db, {
      ...input, state: 'ambiguous', errorCode: 'persistence_outcome_uncertain',
    })
  }
}

export async function recordDiagnosticStartFailure(
  db: AppDb,
  input: StartInput & {
    certainty: 'certain' | 'uncertain'
    errorCode: string
  },
  dependencies: DiagnosticStartMutationDependencies = {},
): Promise<SettleDiagnosticStartResult> {
  return settleDiagnosticStart(db, {
    ...input,
    state: input.certainty === 'certain' ? 'failed' : 'ambiguous',
    errorCode: input.errorCode,
  }, dependencies)
}
