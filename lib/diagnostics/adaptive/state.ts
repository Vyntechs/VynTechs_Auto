import { and, eq, inArray } from 'drizzle-orm'
import { z } from 'zod'
import type { TopologyTestAction } from '@/lib/diagnostics/load-system-topology'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  jobLines,
  quoteEvents,
  quoteVersions,
  sessionEvents,
  sessions,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { reconcileSeededSymptom } from '@/lib/diagnostics/reconcile-seeded-symptom'
import { resolvePlatformSlug } from '@/lib/diagnostics/resolve-platform'
import { extractDtcCodes, resolveSymptomSlug } from '@/lib/diagnostics/symptom-resolver'
import { isAdaptiveCanvasEnabled } from '@/lib/feature-flags'
import { assertLiveLockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import { ShopOsMutationNotFound } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { ShopOsMutationConflict } from '@/lib/shop-os/continuity/mutation-foundation/conflicts'
import type {
  LockedMutationScopeV1,
  MutationLockRequestV1,
} from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import { runBoundedShopOsMutationV1 } from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'
import {
  adaptiveMutationDependencies,
  adaptiveRequestFingerprint,
  authorizeAdaptiveMutationInLockedScopeV1,
  type AdaptiveMutationActor,
  type AdaptiveMutationDependencies,
} from './actor'
import type {
  AdaptiveCoverage,
  AdaptiveDiagnosticState,
  DiagnosticMode,
} from './contracts'
import { adaptiveDiagnosticStateSchema } from './contracts'
import { resolveAdaptiveCoverage } from './coverage'
import { adaptiveStepId } from './step-adapter'

const updateAdaptiveModeSchema = z.object({
  requestKey: z.uuid(),
  expectedRevision: z.number().int().nonnegative(),
  mode: z.enum(['guided', 'manual']),
}).strict()

const adaptiveModeResponseSchema = z.object({
  schemaVersion: z.literal(1),
  from: z.enum(['guided', 'manual']),
  to: z.enum(['guided', 'manual']),
  state: adaptiveDiagnosticStateSchema,
  revision: z.number().int().nonnegative(),
})

export type UpdateAdaptiveModeResult =
  | { ok: true; state: AdaptiveDiagnosticState; revision: number }
  | { ok: false; status: 400 | 404 | 409; error: 'invalid_input' | 'not_found' | 'not_eligible' }

export type AdaptiveModeMutationDependencies = AdaptiveMutationDependencies & Readonly<{
  afterDiscovery?: () => Promise<void>
  afterEventInsert?: (tx: AppDb) => Promise<void>
}>

export function initialAdaptiveState(
  coverage: AdaptiveCoverage,
): AdaptiveDiagnosticState {
  let mode: DiagnosticMode
  switch (coverage.state) {
    case 'exact':
    case 'verified_equivalent':
      mode = coverage.technicianInstructionsAvailable ? 'guided' : 'manual'
      break
    case 'partial':
    case 'draft':
    case 'unsupported':
      mode = 'manual'
      break
  }

  return {
    schemaVersion: 1,
    mode,
    coverage,
    currentTestActionId: null,
    finding: null,
  }
}

export function changeDiagnosticMode(
  state: AdaptiveDiagnosticState,
  mode: DiagnosticMode,
): AdaptiveDiagnosticState {
  switch (mode) {
    case 'guided':
      return { ...state, mode: 'guided' }
    case 'manual':
      return { ...state, mode: 'manual' }
  }
}

export function selectCurrentAdaptiveTest(
  state: AdaptiveDiagnosticState,
  steps: readonly TopologyTestAction[],
): TopologyTestAction | null {
  const fallback = steps[0] ?? null
  if (state.currentTestActionId === null) return fallback

  return steps.find(
    (step) => adaptiveStepId(step) === state.currentTestActionId,
  ) ?? fallback
}

async function initializeAdaptiveState(
  db: AppDb,
  intake: {
    vehicleYear: number
    vehicleMake: string
    vehicleModel: string
    vehicleEngine?: string
    customerComplaint: string
  },
): Promise<AdaptiveDiagnosticState> {
  const platformSlug = resolvePlatformSlug({
    year: intake.vehicleYear,
    make: intake.vehicleMake,
    model: intake.vehicleModel,
    engine: intake.vehicleEngine ?? '',
  })
  const candidateSlug = resolveSymptomSlug({
    dtcCodes: extractDtcCodes(intake.customerComplaint),
    complaintText: intake.customerComplaint,
  })
  const symptomSlug = platformSlug
    ? await reconcileSeededSymptom(db, platformSlug, {
        candidateSlug,
        complaintText: intake.customerComplaint,
      })
    : null
  const coverage = await resolveAdaptiveCoverage(db, { platformSlug, symptomSlug })
  return initialAdaptiveState(coverage)
}

function canUseGuidedMode(state: AdaptiveDiagnosticState): boolean {
  return (state.coverage.state === 'exact' || state.coverage.state === 'verified_equivalent')
    && state.coverage.technicianInstructionsAvailable
    && state.coverage.instructionProof !== null
}

type AdaptiveMutationClosure = Readonly<{
  profileIds: readonly string[]
  customerIds: readonly string[]
  vehicleIds: readonly string[]
  ticketIds: readonly string[]
  jobIds: readonly string[]
  lineIds: readonly string[]
  versionIds: readonly string[]
  quoteEventIds: readonly string[]
  sessionIds: readonly string[]
  sessionEventIds: readonly string[]
  vendorAccountIds: readonly string[]
}>

type AdaptiveMutationDiscovery = Readonly<{
  kind: 'ready' | 'not_found' | 'not_eligible'
  separateChainIds: readonly string[]
  targetJobId: string | null
  closure: AdaptiveMutationClosure | null
}>

class AdaptiveMutationNotEligible extends Error {}

function adaptiveUuidList(values: readonly (string | null | undefined)[]): readonly string[] {
  return Object.freeze([...new Set(values.filter((value): value is string =>
    typeof value === 'string'))].sort())
}

function emptyAdaptiveInsertionIntents(): MutationLockRequestV1['insertionIntents'] {
  return Object.freeze({
    sessions: Object.freeze([]),
    customers: Object.freeze([]),
    vehicles: Object.freeze([]),
    tickets: Object.freeze([]),
    jobs: Object.freeze([]),
  })
}

function adaptiveActorOnlyRequest(
  actor: AdaptiveMutationActor,
): MutationLockRequestV1 {
  return Object.freeze({
    shopId: actor.shopId,
    actorProfileId: actor.profileId,
    profileIds: Object.freeze([actor.profileId]),
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
    insertionIntents: emptyAdaptiveInsertionIntents(),
  })
}

function adaptiveDiscoveryResult(
  actor: AdaptiveMutationActor,
  kind: 'not_found' | 'not_eligible',
): Readonly<{ lockRequest: MutationLockRequestV1; payload: AdaptiveMutationDiscovery }> {
  return Object.freeze({
    lockRequest: adaptiveActorOnlyRequest(actor),
    payload: Object.freeze({
      kind,
      separateChainIds: Object.freeze([]),
      targetJobId: null,
      closure: null,
    }),
  })
}

async function discoverAdaptiveMutation(
  tx: AppDb,
  input: Readonly<{
    actor: AdaptiveMutationActor
    sessionId: string
    requestKey: string
  }>,
  dependencies: AdaptiveModeMutationDependencies,
): Promise<Readonly<{
  lockRequest: MutationLockRequestV1
  payload: AdaptiveMutationDiscovery
}>> {
  if (!isAdaptiveCanvasEnabled()) throw new AdaptiveMutationNotEligible()
  let paid = false
  try {
    paid = await dependencies.hasPaidAccess(tx, input.actor.userId)
  } catch {
    throw new AdaptiveMutationNotEligible()
  }
  if (!paid) throw new AdaptiveMutationNotEligible()

  const [targetSession] = await tx.select().from(sessions)
    .where(eq(sessions.id, input.sessionId)).limit(1)
  if (!targetSession) {
    await dependencies.afterDiscovery?.()
    return adaptiveDiscoveryResult(input.actor, 'not_found')
  }
  if (targetSession.shopId !== input.actor.shopId) {
    await dependencies.afterDiscovery?.()
    return adaptiveDiscoveryResult(input.actor, 'not_eligible')
  }
  const linkedJobs = await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.actor.shopId),
    eq(ticketJobs.sessionId, input.sessionId),
  )).orderBy(ticketJobs.id)
  if (linkedJobs.length !== 1) {
    await dependencies.afterDiscovery?.()
    return adaptiveDiscoveryResult(input.actor, 'not_eligible')
  }
  const targetJob = linkedJobs[0]
  const [targetTicket] = await tx.select().from(tickets).where(and(
    eq(tickets.shopId, input.actor.shopId),
    eq(tickets.id, targetJob.ticketId),
  )).limit(1)
  if (!targetTicket) {
    await dependencies.afterDiscovery?.()
    return adaptiveDiscoveryResult(input.actor, 'not_eligible')
  }

  const ticketRows = [targetTicket]
  const seenTicketIds = new Set([targetTicket.id])
  let parentId = targetTicket.separateFromTicketId
  while (parentId !== null) {
    if (ticketRows.length >= 64 || seenTicketIds.has(parentId)) {
      throw new ShopOsMutationConflict()
    }
    const [parent] = await tx.select().from(tickets).where(and(
      eq(tickets.shopId, input.actor.shopId),
      eq(tickets.id, parentId),
    )).limit(1)
    if (!parent) throw new ShopOsMutationConflict()
    ticketRows.push(parent)
    seenTicketIds.add(parent.id)
    parentId = parent.separateFromTicketId
  }

  const ticketIds = adaptiveUuidList(ticketRows.map(({ id }) => id))
  const jobs = await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.actor.shopId),
    inArray(ticketJobs.ticketId, ticketIds),
  )).orderBy(ticketJobs.id)
  const jobIds = adaptiveUuidList(jobs.map(({ id }) => id))
  const lines = jobIds.length === 0 ? [] : await tx.select().from(jobLines).where(and(
    eq(jobLines.shopId, input.actor.shopId),
    inArray(jobLines.jobId, jobIds),
  )).orderBy(jobLines.id)
  const versions = await tx.select().from(quoteVersions).where(and(
    eq(quoteVersions.shopId, input.actor.shopId),
    inArray(quoteVersions.ticketId, ticketIds),
  )).orderBy(quoteVersions.id)
  const quoteEventRows = await tx.select().from(quoteEvents).where(and(
    eq(quoteEvents.shopId, input.actor.shopId),
    inArray(quoteEvents.ticketId, ticketIds),
  )).orderBy(quoteEvents.id)
  const sessionIds = adaptiveUuidList(jobs.map(({ sessionId }) => sessionId))
  const sessionRows = sessionIds.length === 0 ? [] : await tx.select().from(sessions).where(and(
    eq(sessions.shopId, input.actor.shopId),
    inArray(sessions.id, sessionIds),
  )).orderBy(sessions.id)
  const requestEvents = await tx.select().from(sessionEvents).where(and(
    eq(sessionEvents.sessionId, input.sessionId),
    eq(sessionEvents.requestKey, input.requestKey),
  )).orderBy(sessionEvents.id)
  const vehicleIds = adaptiveUuidList([
    ...ticketRows.map(({ vehicleId }) => vehicleId),
    ...sessionRows.map(({ vehicleId }) => vehicleId),
  ])
  const vehicleRows = vehicleIds.length === 0 ? [] : (await tx.select({ row: vehicles })
    .from(vehicles)
    .innerJoin(customers, eq(customers.id, vehicles.customerId))
    .where(and(
      eq(customers.shopId, input.actor.shopId),
      inArray(vehicles.id, vehicleIds),
    )).orderBy(vehicles.id)).map(({ row }) => row)
  const customerIds = adaptiveUuidList([
    ...ticketRows.map(({ customerId }) => customerId),
    ...vehicleRows.map(({ customerId }) => customerId),
  ])
  const lineVendorIds = adaptiveUuidList(lines.map(({ vendorAccountId }) => vendorAccountId))
  const profileIds = adaptiveUuidList([
    input.actor.profileId,
    ...ticketRows.flatMap((ticket) => [
      ticket.createdByProfileId,
      ticket.canceledByProfileId,
      ticket.deliveredByProfileId,
      ticket.closedByProfileId,
    ]),
    ...jobs.flatMap((job) => [
      job.assignedTechId,
      job.createdByProfileId,
      job.statementConfirmedByProfileId,
    ]),
    ...lines.flatMap((line) => [line.orderedByProfileId, line.receivedByProfileId]),
    ...versions.map(({ createdByProfileId }) => createdByProfileId),
    ...quoteEventRows.map(({ actorProfileId }) => actorProfileId),
    ...sessionRows.map(({ techId }) => techId),
    ...requestEvents.map(({ requestActorProfileId }) => requestActorProfileId),
  ])
  const closure = Object.freeze({
    profileIds,
    customerIds,
    vehicleIds,
    ticketIds,
    jobIds,
    lineIds: adaptiveUuidList(lines.map(({ id }) => id)),
    versionIds: adaptiveUuidList(versions.map(({ id }) => id)),
    quoteEventIds: adaptiveUuidList(quoteEventRows.map(({ id }) => id)),
    sessionIds,
    sessionEventIds: adaptiveUuidList(requestEvents.map(({ id }) => id)),
    vendorAccountIds: lineVendorIds,
  })
  const result = Object.freeze({
    lockRequest: Object.freeze({
      shopId: input.actor.shopId,
      actorProfileId: input.actor.profileId,
      profileIds,
      lockShop: false,
      customerIds,
      vehicleIds,
      ticketIds,
      jobIds,
      includeAllJobsForTickets: true,
      includeAllLinesForJobs: true,
      includeAllQuoteVersionsForTickets: true,
      includeAllQuoteEventsForTickets: true,
      sessionIds,
      sessionEventIds: closure.sessionEventIds,
      vendorAccountIds: lineVendorIds,
      cannedJobIds: Object.freeze([]),
      receiptRequestKey: null,
      receiptConditionalInsert: null,
      insertionIntents: emptyAdaptiveInsertionIntents(),
    }),
    payload: Object.freeze({
      kind: 'ready' as const,
      separateChainIds: Object.freeze(ticketRows.map(({ id }) => id)),
      targetJobId: targetJob.id,
      closure,
    }),
  })
  await dependencies.afterDiscovery?.()
  return result
}

function sameAdaptiveIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function resolveAdaptiveMutationScope(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  discovery: AdaptiveMutationDiscovery,
  sessionId: string,
): Readonly<{
  session: (typeof sessions.$inferSelect)
  requestEvents: readonly (typeof sessionEvents.$inferSelect)[]
}> | UpdateAdaptiveModeResult {
  assertLiveLockedMutationScopeV1(tx, scope)
  if (discovery.kind === 'not_found') {
    return { ok: false, status: 404, error: 'not_found' }
  }
  if (discovery.kind === 'not_eligible' || discovery.closure === null) {
    return { ok: false, status: 409, error: 'not_eligible' }
  }
  const closure = discovery.closure
  const lockedClosure: AdaptiveMutationClosure = {
    profileIds: adaptiveUuidList(scope.profiles.map(({ id }) => id)),
    customerIds: adaptiveUuidList(scope.customers.map(({ id }) => id)),
    vehicleIds: adaptiveUuidList(scope.vehicles.map(({ id }) => id)),
    ticketIds: adaptiveUuidList(scope.tickets.map(({ ticket }) => ticket.id)),
    jobIds: adaptiveUuidList(scope.tickets.flatMap(({ jobs }) => jobs.map(({ id }) => id))),
    lineIds: adaptiveUuidList(scope.tickets.flatMap(({ lines }) => lines.map(({ id }) => id))),
    versionIds: adaptiveUuidList(scope.tickets.flatMap(({ versions }) => versions.map(({ id }) => id))),
    quoteEventIds: adaptiveUuidList(scope.tickets.flatMap(({ events }) => events.map(({ id }) => id))),
    sessionIds: adaptiveUuidList(scope.sessions.map(({ id }) => id)),
    sessionEventIds: adaptiveUuidList(scope.sessionEvents.map(({ id }) => id)),
    vendorAccountIds: adaptiveUuidList(scope.vendorAccounts.map(({ id }) => id)),
  }
  for (const key of Object.keys(closure) as (keyof AdaptiveMutationClosure)[]) {
    if (!sameAdaptiveIds(closure[key], lockedClosure[key])) throw new ShopOsMutationConflict()
  }
  if (
    discovery.separateChainIds.length < 1 ||
    discovery.separateChainIds.length !== scope.tickets.length ||
    new Set(discovery.separateChainIds).size !== discovery.separateChainIds.length
  ) throw new ShopOsMutationConflict()
  const graphById = new Map(scope.tickets.map((graph) => [graph.ticket.id, graph] as const))
  for (let index = 0; index < discovery.separateChainIds.length; index += 1) {
    const graph = graphById.get(discovery.separateChainIds[index])
    if (!graph || graph.ticket.separateFromTicketId !==
      (discovery.separateChainIds[index + 1] ?? null)) throw new ShopOsMutationConflict()
  }
  const session = scope.sessions.find(({ id }) => id === sessionId)
  const targetJobs = scope.tickets.flatMap(({ jobs }) => jobs)
    .filter(({ id, sessionId: linkedSessionId }) =>
      id === discovery.targetJobId && linkedSessionId === sessionId)
  if (!session || targetJobs.length !== 1) throw new ShopOsMutationConflict()
  return { session, requestEvents: scope.sessionEvents }
}

export async function updateAdaptiveModeForUser(opts: {
  db: AppDb
  actor: AdaptiveMutationActor
  sessionId: string
  requestKey: string
  expectedRevision: number
  body: unknown
  dependencies?: AdaptiveModeMutationDependencies
}): Promise<UpdateAdaptiveModeResult> {
  const parsed = updateAdaptiveModeSchema.safeParse(opts.body)
  if (
    !parsed.success
    || parsed.data.requestKey !== opts.requestKey
    || parsed.data.expectedRevision !== opts.expectedRevision
  ) {
    return { ok: false, status: 400, error: 'invalid_input' }
  }

  const input = parsed.data
  const fingerprint = adaptiveRequestFingerprint('mode', input)
  const dependencies: AdaptiveModeMutationDependencies =
    opts.dependencies ?? adaptiveMutationDependencies

  try {
    return await runBoundedShopOsMutationV1(opts.db, {
      discover: async (tx) => discoverAdaptiveMutation(tx, {
        actor: opts.actor,
        sessionId: opts.sessionId,
        requestKey: input.requestKey,
      }, dependencies),
      executeLocked: async (tx, scope, discovery) => {
        const resolved = resolveAdaptiveMutationScope(tx, scope, discovery, opts.sessionId)
        if ('ok' in resolved) return resolved
        const authorized = authorizeAdaptiveMutationInLockedScopeV1(tx, scope, {
          actor: opts.actor,
          sessionId: opts.sessionId,
          expectedRevision: resolved.session.adaptiveRevision,
        })
        if (!authorized) {
          return { ok: false, status: 409, error: 'not_eligible' } as const
        }

        const priorEvent = resolved.requestEvents[0]
        if (resolved.requestEvents.length > 1 || (priorEvent && (
          priorEvent.requestActorProfileId !== opts.actor.profileId ||
          priorEvent.requestFingerprint !== fingerprint
        ))) {
          return { ok: false, status: 409, error: 'not_eligible' } as const
        }
        if (priorEvent) {
          const snapshot = adaptiveModeResponseSchema.safeParse(
            priorEvent.aiResponse?.adaptiveModeChange,
          )
          if (!snapshot.success) {
            return { ok: false, status: 409, error: 'not_eligible' } as const
          }
          return {
            ok: true,
            state: snapshot.data.state,
            revision: snapshot.data.revision,
          } as const
        }

        if (resolved.session.adaptiveRevision !== input.expectedRevision) {
          return { ok: false, status: 409, error: 'not_eligible' } as const
        }
        const storedState = resolved.session.adaptiveDiagnosticState === null
          ? await initializeAdaptiveState(tx, resolved.session.intake)
          : adaptiveDiagnosticStateSchema.safeParse(
              resolved.session.adaptiveDiagnosticState,
            ).data
        if (!storedState || (input.mode === 'guided' && !canUseGuidedMode(storedState))) {
          return { ok: false, status: 409, error: 'not_eligible' } as const
        }

        const nextState = changeDiagnosticMode(storedState, input.mode)
        const inserted = await tx.insert(sessionEvents).values({
          sessionId: opts.sessionId,
          nodeId: 'adaptive-mode',
          eventType: 'tree_update',
          aiResponse: {
            adaptiveModeChange: {
              schemaVersion: 1,
              from: storedState.mode,
              to: input.mode,
              state: nextState,
              revision: input.expectedRevision + 1,
            },
          },
          requestKey: input.requestKey,
          requestActorProfileId: opts.actor.profileId,
          requestFingerprint: fingerprint,
        }).onConflictDoNothing().returning()
        if (inserted.length === 0) throw new ShopOsMutationConflict()
        await dependencies.afterEventInsert?.(tx)

        const [updated] = await tx.update(sessions).set({
          adaptiveDiagnosticState: nextState,
          adaptiveRevision: input.expectedRevision + 1,
        }).where(and(
          eq(sessions.id, opts.sessionId),
          eq(sessions.adaptiveRevision, input.expectedRevision),
        )).returning()
        if (!updated) throw new ShopOsMutationConflict()
        return { ok: true, state: nextState, revision: updated.adaptiveRevision } as const
      },
    })
  } catch (error) {
    if (
      error instanceof AdaptiveMutationNotEligible ||
      error instanceof ShopOsMutationNotFound ||
      error instanceof ShopOsMutationConflict
    ) {
      return { ok: false, status: 409, error: 'not_eligible' }
    }
    throw error
  }
}
