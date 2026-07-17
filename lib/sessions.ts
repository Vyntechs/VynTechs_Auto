import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { intakeSchema, outcomeSchema } from './types'
import type { AmbientConditions } from './types'
import {
  getProfileByUserId,
  getSessionById,
  appendSessionEvent,
  updateSessionTreeState,
  updateSessionIntake,
  closeSession,
  setSessionTerminalStatus,
  recordTechAssistRequest,
  listArtifactsForSession,
} from './db/queries'
import type { AppDb } from './db/queries'
import type { TreeState } from './ai/tree-engine'
import type { IntakePayload } from './types'
import type { ValidatorResult } from './ai/outcome-validator'
import type {
  DeclineLanguage,
  DeclineLanguageInput,
} from './gating/decline-language'
import type { Artifact, NewArtifact, OutcomePayload as StoredOutcomePayload } from './db/schema'
import {
  customers,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  sessions,
  sessionEvents,
  ticketJobs,
  tickets,
  vehicles,
  vendorAccounts,
} from './db/schema'
import {
  finalizeResolvedTicketCreationInTransactionV1,
  insertResolvedTicketBatchInTransactionV1,
  isTicketCreationKernelInvalidV1,
  readFinalizedTicketCreationResultV1,
  readResolvedTechQuickReplayResultV1,
  resolveTicketCreationInLockedScopeV1,
} from './tickets'
import { createTechQuickTicketOriginV1 } from './shop-os/continuity/mutation-foundation/ticket-origin.server'
import { ShopOsMutationNotFound } from './shop-os/continuity/mutation-foundation/contracts'
import { ShopOsMutationConflict } from './shop-os/continuity/mutation-foundation/conflicts'
import type {
  LockedMutationScopeV1,
  MutationLockRequestV1,
} from './shop-os/continuity/mutation-foundation/lock-order'
import { runBoundedShopOsMutationV1 } from './shop-os/continuity/mutation-foundation/transaction-runner'
import { assertLiveLockedMutationScopeV1 } from './shop-os/continuity/mutation-foundation/attempt-capability'
import { finalizeMutationRevisionsV1 } from './shop-os/continuity/mutation-foundation/revisions'
import { gateProposedAction, type GateDecision } from './gating/gap-handler'
import { HIGH_SIGNAL_KINDS } from './ai/artifact-kinds'
import type { ProposedAction } from './ai/tree-engine'
import { inferSymptomTags, type CorpusPromotionInput } from './corpus/promotion'
import type {
  RecordDiagnosticSessionInput,
  RecordDiagnosticSessionResult,
} from './diagnostics/record-diagnostic-session'
import type { ScheduleFollowUpsFn } from './comeback/schedule'
import type { RepairGuidanceResult, RepairGuidancePromptInput } from './ai/repair-guidance'
import type { AdvanceStreamEvent } from './advance-stream-events'
import type { Finding, WizardState } from './flows/types'
import { synthesizeHandoffFromFinding } from './wizard-state'
import { isShopRole } from './shop-os/capabilities'
import {
  lockDiagnosticRepairAccess,
  resolveDiagnosticRepairAccess,
} from './shop-os/repair-authorization'
import { isLockUnavailable, quoteSnapshotContainsJob } from './shop-os/quotes'
type EnqueueIfNovelPatternFn = (db: AppDb, sessionId: string, maxSimilarity: number) => Promise<void>

export type PromoteToCorpusFn = (
  db: AppDb,
  input: CorpusPromotionInput,
) => Promise<string | null>

export type RecordDiagnosticOutcomeFn = (
  db: AppDb,
  input: RecordDiagnosticSessionInput,
) => Promise<RecordDiagnosticSessionResult>

export type CreateSessionResult =
  | { ok: true; id: string; ticketId: string; jobId: string }
  | { ok: false; status: 400 | 401 | 500; error: string }

const createSessionBodySchema = intakeSchema.extend({ requestKey: z.uuid() }).strict()

type OwnedTechQuickRequest = Readonly<{
  userId: string
  requestKey: string
  intake: IntakePayload
  treeState: TreeState | null
}>

type TechQuickActorSnapshot = Readonly<{
  id: string
  shopId: string | null
  role: string
  skillTier: number | null
  membershipStatus: string
  deactivatedAt: Date | null
}>

type ActiveTechQuickActor = Readonly<{
  id: string
  shopId: string
  role: 'tech' | 'advisor' | 'parts' | 'owner'
  skillTier: 1 | 2 | 3
  membershipStatus: 'active'
  deactivatedAt: null
}>

type TechQuickDiscovery =
  | Readonly<{ kind: 'insert'; ticketId: string; jobId: string }>
  | Readonly<{
      kind: 'replay'
      candidateTicketIds: readonly string[]
      candidateJobIds: readonly string[]
    }>
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'occupied' }>

class TechQuickRequestUnavailable extends Error {
  constructor() {
    super('tech_quick_request_unavailable')
    this.name = 'TechQuickRequestUnavailable'
  }
}

const EMPTY_INSERTION_INTENTS = Object.freeze({
  sessions: Object.freeze([]),
  customers: Object.freeze([]),
  vehicles: Object.freeze([]),
  tickets: Object.freeze([]),
  jobs: Object.freeze([]),
})

function canonicalUuid(value: unknown): string | null {
  const parsed = z.uuid().safeParse(value)
  return parsed.success ? parsed.data.toLowerCase() : null
}

function ownTechQuickRequest(
  userId: unknown,
  body: unknown,
  treeState?: TreeState,
): { ok: true; value: OwnedTechQuickRequest } | { ok: false; error: string } {
  const ownedUserId = canonicalUuid(userId)
  if (ownedUserId === null) return { ok: false, error: 'no profile' }
  const parsed = createSessionBodySchema.safeParse(body)
  if (!parsed.success) return { ok: false, error: parsed.error.message }
  let ownedTreeState: TreeState | null = null
  if (treeState !== undefined) {
    try {
      ownedTreeState = structuredClone(treeState)
    } catch {
      return { ok: false, error: 'invalid tree state' }
    }
  }
  const { requestKey: rawRequestKey, ...intake } = parsed.data
  const requestKey = canonicalUuid(rawRequestKey)
  if (requestKey === null) return { ok: false, error: 'invalid request key' }
  return {
    ok: true,
    value: Object.freeze({
      userId: ownedUserId,
      requestKey,
      intake: Object.freeze(structuredClone(intake)),
      treeState: ownedTreeState,
    }),
  }
}

function ownTechQuickActor(
  profile: Awaited<ReturnType<typeof getProfileByUserId>>,
): TechQuickActorSnapshot | null {
  if (!profile) return null
  const id = canonicalUuid(profile.id)
  const shopId = profile.shopId === null ? null : canonicalUuid(profile.shopId)
  if (id === null || (profile.shopId !== null && shopId === null)) return null
  return Object.freeze({
    id,
    shopId,
    role: String(profile.role),
    skillTier: profile.skillTier,
    membershipStatus: String(profile.membershipStatus),
    deactivatedAt: profile.deactivatedAt === null
      ? null
      : new Date(profile.deactivatedAt.getTime()),
  })
}

function activeTechQuickActor(
  actor: TechQuickActorSnapshot | null,
): ActiveTechQuickActor | null {
  if (
    actor === null || actor.shopId === null || !isShopRole(actor.role) ||
    actor.membershipStatus !== 'active' || actor.deactivatedAt !== null ||
    !Number.isInteger(actor.skillTier) || ![1, 2, 3].includes(actor.skillTier as number)
  ) return null
  return actor as ActiveTechQuickActor
}

function sameIntake(left: unknown, right: IntakePayload): boolean {
  const parsed = intakeSchema.safeParse(left)
  return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(right)
}

function canonicalJson(value: unknown): string {
  const normalize = (member: unknown): unknown => {
    if (Array.isArray(member)) return member.map(normalize)
    if (typeof member !== 'object' || member === null) return member
    const result: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(member).sort()) {
      result[key] = normalize((member as Record<string, unknown>)[key])
    }
    return result
  }
  return JSON.stringify(normalize(value))
}

function canonicalReplayTuple(
  ticket: typeof tickets.$inferSelect,
  job: typeof ticketJobs.$inferSelect,
): boolean {
  if (
    typeof ticket.projectionRevision !== 'bigint' || ticket.projectionRevision < 0n ||
    typeof ticket.continuityRevision !== 'bigint' || ticket.continuityRevision < 0n ||
    typeof job.revision !== 'bigint' || job.revision < 0n ||
    job.createdFromJobId !== null
  ) return false
  const legacy = job.sequenceNumber === null &&
    job.createdByProfileId === null && job.creatorProvenance === null
  const migrated = job.sequenceNumber === 1 &&
    job.createdByProfileId === ticket.createdByProfileId &&
    job.creatorProvenance === 'ticket_creator_backfill'
  const direct = job.sequenceNumber === 1 &&
    job.createdByProfileId === ticket.createdByProfileId &&
    job.creatorProvenance === 'direct' && job.revision >= 1n &&
    ticket.projectionRevision >= 1n && ticket.continuityRevision >= 1n
  return legacy || migrated || direct
}

async function completedTechQuickHint(
  db: AppDb,
  actor: ActiveTechQuickActor,
  request: OwnedTechQuickRequest,
): Promise<'missing' | 'match' | 'collision'> {
  const [session] = await db.select().from(sessions)
    .where(eq(sessions.id, request.requestKey)).limit(1)
  if (!session) return 'missing'
  if (
    session.shopId !== actor.shopId || session.techId !== actor.id ||
    !sameIntake(session.intake, request.intake)
  ) return 'collision'
  const linked = await db.select({ job: ticketJobs, ticket: tickets })
    .from(ticketJobs)
    .innerJoin(tickets, and(
      eq(tickets.shopId, ticketJobs.shopId),
      eq(tickets.id, ticketJobs.ticketId),
    ))
    .where(and(
      eq(ticketJobs.shopId, actor.shopId),
      eq(ticketJobs.sessionId, request.requestKey),
    ))
  if (linked.length !== 1) return 'collision'
  const { job, ticket } = linked[0]!
  if (
    ticket.source !== 'tech_quick' || ticket.concern !== request.intake.customerComplaint ||
    ticket.createdByProfileId !== actor.id || ticket.separateFromTicketId !== null ||
    (ticket.customerId === null) !== (ticket.vehicleId === null) ||
    job.assignedTechId !== actor.id || job.kind !== 'diagnostic' ||
    job.title !== request.intake.customerComplaint ||
    ![1, 2, 3].includes(job.requiredSkillTier) || !canonicalReplayTuple(ticket, job)
  ) return 'collision'
  return 'match'
}

function baseTechQuickLockRequest(
  actor: ActiveTechQuickActor,
): MutationLockRequestV1 {
  return {
    shopId: actor.shopId,
    actorProfileId: actor.id,
    profileIds: [actor.id],
    lockShop: true,
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
    insertionIntents: EMPTY_INSERTION_INTENTS,
  }
}

async function occupiedTechQuickDiscovery(
  tx: AppDb,
  actor: ActiveTechQuickActor,
  occupant: typeof sessions.$inferSelect,
): Promise<Readonly<{ lockRequest: MutationLockRequestV1; payload: TechQuickDiscovery }>> {
  const [vehicle] = occupant.vehicleId === null ? [] : await tx.select({
    id: vehicles.id,
    customerId: vehicles.customerId,
  }).from(vehicles).where(eq(vehicles.id, occupant.vehicleId)).limit(1)
  return {
    lockRequest: {
      ...baseTechQuickLockRequest(actor),
      profileIds: [...new Set([actor.id, occupant.techId])].sort(),
      customerIds: vehicle ? [vehicle.customerId] : [],
      vehicleIds: occupant.vehicleId === null ? [] : [occupant.vehicleId],
      sessionIds: [occupant.id],
    },
    payload: { kind: 'occupied' },
  }
}

async function discoverTechQuickMutation(
  tx: AppDb,
  actor: ActiveTechQuickActor,
  request: OwnedTechQuickRequest,
  allowInsert: boolean,
): Promise<Readonly<{ lockRequest: MutationLockRequestV1; payload: TechQuickDiscovery }>> {
  const [occupant] = await tx.select().from(sessions)
    .where(eq(sessions.id, request.requestKey)).limit(1)
  if (!occupant) {
    if (!allowInsert) {
      return { lockRequest: baseTechQuickLockRequest(actor), payload: { kind: 'missing' } }
    }
    const ticketId = randomUUID()
    const jobId = randomUUID()
    return {
      lockRequest: {
        ...baseTechQuickLockRequest(actor),
        includeAllJobsForTickets: true,
        includeAllLinesForJobs: true,
        insertionIntents: {
          ...EMPTY_INSERTION_INTENTS,
          sessions: [{ id: request.requestKey, shopId: actor.shopId, techId: actor.id }],
          tickets: [ticketId],
          jobs: [{ id: jobId, ticketId }],
        },
      },
      payload: { kind: 'insert', ticketId, jobId },
    }
  }
  if (occupant.shopId !== actor.shopId) {
    return { lockRequest: baseTechQuickLockRequest(actor), payload: { kind: 'occupied' } }
  }

  const linkedJobs = await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, actor.shopId),
    eq(ticketJobs.sessionId, request.requestKey),
  ))
  const candidateJobIds = [...new Set(linkedJobs.map(({ id }) => id))].sort()
  const candidateTicketIds = [...new Set(linkedJobs.map(({ ticketId }) => ticketId))].sort()
  if (candidateJobIds.length === 0 || candidateTicketIds.length === 0) {
    return occupiedTechQuickDiscovery(tx, actor, occupant)
  }
  const candidateTickets = candidateTicketIds.length === 0 ? [] : await tx.select()
    .from(tickets).where(and(
      eq(tickets.shopId, actor.shopId),
      inArray(tickets.id, candidateTicketIds),
    ))
  const completeJobs = candidateTicketIds.length === 0 ? [] : await tx.select()
    .from(ticketJobs).where(and(
      eq(ticketJobs.shopId, actor.shopId),
      inArray(ticketJobs.ticketId, candidateTicketIds),
    ))
  const completeJobIds = completeJobs.map(({ id }) => id)
  const completeLines = completeJobIds.length === 0 ? [] : await tx.select()
    .from(jobLines).where(and(
      eq(jobLines.shopId, actor.shopId),
      inArray(jobLines.jobId, completeJobIds),
    ))
  const sessionIds = [...new Set([
    request.requestKey,
    ...completeJobs.flatMap(({ sessionId }) => sessionId === null ? [] : [sessionId]),
  ])].sort()
  const replaySessions = await tx.select().from(sessions).where(and(
    eq(sessions.shopId, actor.shopId),
    inArray(sessions.id, sessionIds),
  ))
  const vehicleIds = [...new Set([
    ...candidateTickets.flatMap(({ vehicleId }) => vehicleId === null ? [] : [vehicleId]),
    ...replaySessions.flatMap(({ vehicleId }) => vehicleId === null ? [] : [vehicleId]),
  ])].sort()
  const replayVehicles = vehicleIds.length === 0 ? [] : await tx.select().from(vehicles)
    .where(inArray(vehicles.id, vehicleIds))
  const customerIds = [...new Set([
    ...candidateTickets.flatMap(({ customerId }) => customerId === null ? [] : [customerId]),
    ...replayVehicles.map(({ customerId }) => customerId),
  ])].sort()
  const quoteClosure = completeJobs.some((job) =>
    job.approvedQuoteVersionId !== null || job.approvedApprovalEventId !== null)
  const versions = !quoteClosure || candidateTicketIds.length === 0 ? [] : await tx.select()
    .from(quoteVersions).where(and(
      eq(quoteVersions.shopId, actor.shopId),
      inArray(quoteVersions.ticketId, candidateTicketIds),
    ))
  const events = !quoteClosure || candidateTicketIds.length === 0 ? [] : await tx.select()
    .from(quoteEvents).where(and(
      eq(quoteEvents.shopId, actor.shopId),
      inArray(quoteEvents.ticketId, candidateTicketIds),
    ))
  const candidateTicketIdSet = new Set(candidateTicketIds)
  const completeJobIdSet = new Set(completeJobIds)
  const jobById = new Map(completeJobs.map((job) => [job.id, job] as const))
  const versionById = new Map(versions.map((version) => [version.id, version] as const))
  const eventById = new Map(events.map((event) => [event.id, event] as const))
  const incompleteReferenceClosure =
    candidateTickets.length !== candidateTicketIds.length ||
    !candidateJobIds.every((id) => completeJobIdSet.has(id)) ||
    replaySessions.length !== sessionIds.length ||
    replayVehicles.length !== vehicleIds.length ||
    candidateTickets.some((ticket) =>
      ticket.separateFromTicketId !== null &&
      !candidateTicketIdSet.has(ticket.separateFromTicketId)) ||
    completeJobs.some((job) => {
      if (
        job.createdFromJobId !== null &&
        !completeJobIdSet.has(job.createdFromJobId)
      ) return true
      if (job.approvedQuoteVersionId !== null) {
        const version = versionById.get(job.approvedQuoteVersionId)
        if (!version || version.ticketId !== job.ticketId) return true
      }
      if (job.approvedApprovalEventId !== null) {
        const event = eventById.get(job.approvedApprovalEventId)
        if (!event || event.ticketId !== job.ticketId || event.jobId !== job.id) return true
      }
      return false
    }) ||
    events.some((event) => {
      const eventJob = event.jobId === null ? null : jobById.get(event.jobId)
      const eventVersion = event.quoteVersionId === null
        ? null
        : versionById.get(event.quoteVersionId)
      return !candidateTicketIdSet.has(event.ticketId) ||
        (event.jobId !== null && (!eventJob || eventJob.ticketId !== event.ticketId)) ||
        (event.quoteVersionId !== null && (
          !eventVersion || eventVersion.ticketId !== event.ticketId
        ))
    })
  if (incompleteReferenceClosure) {
    return occupiedTechQuickDiscovery(tx, actor, occupant)
  }
  const profileIds = [...new Set([
    actor.id,
    ...candidateTickets.flatMap((ticket) => [
      ticket.createdByProfileId,
      ticket.canceledByProfileId,
      ticket.deliveredByProfileId,
      ticket.closedByProfileId,
    ].filter((id): id is string => id !== null)),
    ...completeJobs.flatMap((job) => [
      job.assignedTechId,
      job.createdByProfileId,
      job.statementConfirmedByProfileId,
    ].filter((id): id is string => id !== null)),
    ...completeLines.flatMap((line) => [
      line.orderedByProfileId,
      line.receivedByProfileId,
    ].filter((id): id is string => id !== null)),
    ...replaySessions.map(({ techId }) => techId),
    ...versions.map(({ createdByProfileId }) => createdByProfileId),
    ...events.flatMap(({ actorProfileId }) => actorProfileId === null ? [] : [actorProfileId]),
  ])].sort()
  const vendorAccountIds = [...new Set(completeLines.flatMap(({ vendorAccountId }) =>
    vendorAccountId === null ? [] : [vendorAccountId]))].sort()
  return {
    lockRequest: {
      ...baseTechQuickLockRequest(actor),
      profileIds,
      customerIds,
      vehicleIds,
      ticketIds: candidateTicketIds,
      jobIds: candidateJobIds,
      includeAllJobsForTickets: true,
      includeAllLinesForJobs: true,
      includeAllQuoteVersionsForTickets: quoteClosure,
      includeAllQuoteEventsForTickets: quoteClosure,
      sessionIds,
      vendorAccountIds,
    },
    payload: { kind: 'replay', candidateTicketIds, candidateJobIds },
  }
}

function sameLockedActorIdentity(
  actor: ActiveTechQuickActor,
  scopeActor: Readonly<{ id: string; shopId: string; role: string; skillTier: number | null }>,
): boolean {
  return scopeActor.id === actor.id && scopeActor.shopId === actor.shopId
}

async function runTechQuickMutation(
  db: AppDb,
  actor: ActiveTechQuickActor,
  request: OwnedTechQuickRequest,
  allowInsert: boolean,
): Promise<Readonly<{ id: string; ticketId: string; jobId: string }>> {
  const origin = createTechQuickTicketOriginV1(request.requestKey)
  const executeLocked = async (
    tx: AppDb,
    scope: Parameters<typeof resolveTicketCreationInLockedScopeV1>[1],
    discovery: TechQuickDiscovery,
  ): Promise<Readonly<{ id: string; ticketId: string; jobId: string }>> => {
    if (!sameLockedActorIdentity(actor, scope.actor)) throw new TechQuickRequestUnavailable()
    const skillTier = scope.actor.skillTier
    if (
      !isShopRole(scope.actor.role) || skillTier === null ||
      ![1, 2, 3].includes(skillTier)
    ) throw new TechQuickRequestUnavailable()
    if (discovery.kind === 'missing' || discovery.kind === 'occupied') {
      throw new TechQuickRequestUnavailable()
    }
    if (discovery.kind === 'replay') {
      try {
        const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
          mode: 'tech_quick_replay',
          origin,
          sessionId: request.requestKey,
          intake: request.intake,
          candidateTicketIds: discovery.candidateTicketIds,
          candidateJobIds: discovery.candidateJobIds,
        })
        return readResolvedTechQuickReplayResultV1(tx, scope, resolved)
      } catch (error) {
        if (isTicketCreationKernelInvalidV1(error)) {
          throw new TechQuickRequestUnavailable()
        }
        throw error
      }
    }
    if (!allowInsert || request.treeState === null) throw new ShopOsMutationNotFound()
    const resolved = resolveTicketCreationInLockedScopeV1(tx, scope, {
      mode: 'insert',
      origin,
      ticket: {
        id: discovery.ticketId,
        customerId: null,
        vehicleId: null,
        concern: request.intake.customerComplaint,
        whenStarted: null,
        howOften: null,
        diagnosticAuthorizedCents: null,
        diagnosticAuthorizationNote: null,
      },
      jobs: [{
        id: discovery.jobId,
        title: request.intake.customerComplaint,
        kind: 'diagnostic',
        requiredSkillTier: skillTier as 1 | 2 | 3,
        assignedTechId: scope.actor.id,
        sessionId: request.requestKey,
        createdFromJobId: null,
      }],
      seededLinesByJobIndex: new Map(),
    })
    const [createdSession] = await tx.insert(sessions).values({
      id: request.requestKey,
      shopId: scope.actor.shopId,
      techId: scope.actor.id,
      intake: request.intake,
      treeState: request.treeState,
    }).returning()
    if (
      !createdSession || createdSession.id !== request.requestKey ||
      createdSession.shopId !== scope.actor.shopId ||
      createdSession.techId !== scope.actor.id || createdSession.vehicleId !== null ||
      createdSession.status !== 'open' || !sameIntake(createdSession.intake, request.intake) ||
      canonicalJson(createdSession.treeState) !== canonicalJson(request.treeState)
    ) throw new ShopOsMutationConflict()
    const batch = await insertResolvedTicketBatchInTransactionV1(tx, scope, resolved)
    const finalized = await finalizeResolvedTicketCreationInTransactionV1(
      tx,
      scope,
      resolved,
      [{
        ticketId: discovery.ticketId,
        createdTicket: true,
        createdJobIds: [discovery.jobId],
        existingChangedJobIds: [],
        actorVisibleTicketFieldsChanged: true,
      }],
    )
    const result = readFinalizedTicketCreationResultV1(tx, scope, finalized)
    if (
      createdSession.id !== request.requestKey || batch.ticketId !== discovery.ticketId ||
      batch.jobIds.length !== 1 || batch.jobIds[0] !== discovery.jobId ||
      result.ticketId !== discovery.ticketId || result.jobIds.length !== 1 ||
      result.jobIds[0] !== discovery.jobId
    ) throw new ShopOsMutationConflict()
    return Object.freeze({
      id: createdSession.id,
      ticketId: result.ticketId,
      jobId: result.jobIds[0]!,
    })
  }

  try {
    return await runBoundedShopOsMutationV1<
      Readonly<{ id: string; ticketId: string; jobId: string }>,
      TechQuickDiscovery
    >(db, {
      discover: async (tx) => {
        const discovered = await discoverTechQuickMutation(tx, actor, request, allowInsert)
        return discovered
      },
      executeLocked: async (tx, scope, discovery) =>
        executeLocked(tx, scope, discovery),
      uniqueCollisionRecovery: allowInsert ? {
        allowedConstraints: ['sessions_pkey'],
        executeLocked: async (tx, scope, discovery, _attempt, constraint) => {
          if (
            constraint !== 'sessions_pkey' ||
            (discovery.kind !== 'replay' && discovery.kind !== 'occupied')
          ) {
            return { kind: 'unresolved' as const }
          }
          return {
            kind: 'recovered' as const,
            value: await executeLocked(tx, scope, discovery),
          }
        },
      } : undefined,
    })
  } catch (error) {
    if (
      error instanceof TechQuickRequestUnavailable ||
      error instanceof ShopOsMutationNotFound
    ) {
      throw new TechQuickRequestUnavailable()
    }
    throw error
  }
}

async function authorizeTechQuickRequest(
  db: AppDb,
  request: OwnedTechQuickRequest,
): Promise<ActiveTechQuickActor | null> {
  const ownedActor = ownTechQuickActor(await getProfileByUserId(db, request.userId))
  return activeTechQuickActor(ownedActor)
}

export type FindCompletedTechQuickSessionResult =
  | { ok: true; state: 'match' }
  | { ok: true; state: 'missing' }
  | { ok: false; status: 400; error: string }

export async function findCompletedTechQuickSessionForUser(opts: {
  db: AppDb
  userId: string
  body: unknown
}): Promise<FindCompletedTechQuickSessionResult> {
  const db = opts.db
  const owned = ownTechQuickRequest(opts.userId, opts.body)
  if (!owned.ok) return { ok: false, status: 400, error: owned.error }
  const actor = await authorizeTechQuickRequest(db, owned.value)
  if (!actor) return { ok: false, status: 400, error: 'inactive wrenching profile' }
  const state = await completedTechQuickHint(db, actor, owned.value)
  if (state === 'missing') return { ok: true, state: 'missing' }
  if (state === 'collision') {
    return { ok: false, status: 400, error: 'request key unavailable' }
  }
  return { ok: true, state: 'match' }
}

export async function replayCompletedTechQuickSessionForUser(opts: {
  db: AppDb
  userId: string
  body: unknown
}): Promise<CreateSessionResult> {
  const db = opts.db
  const owned = ownTechQuickRequest(opts.userId, opts.body)
  if (!owned.ok) return { ok: false, status: 400, error: owned.error }
  const actor = await authorizeTechQuickRequest(db, owned.value)
  if (!actor) return { ok: false, status: 400, error: 'inactive wrenching profile' }
  try {
    const result = await runTechQuickMutation(db, actor, owned.value, false)
    return { ok: true, ...result }
  } catch (error) {
    return error instanceof TechQuickRequestUnavailable
      ? { ok: false, status: 400, error: 'request key unavailable' }
      : { ok: false, status: 500, error: 'session create failed' }
  }
}

export async function createSessionForUser(opts: {
  db: AppDb
  userId: string
  body: unknown
  treeState: TreeState
}): Promise<CreateSessionResult> {
  const db = opts.db
  const owned = ownTechQuickRequest(opts.userId, opts.body, opts.treeState)
  if (!owned.ok) return { ok: false, status: 400, error: owned.error }
  const actor = await authorizeTechQuickRequest(db, owned.value)
  if (!actor) return { ok: false, status: 400, error: 'inactive wrenching profile' }
  try {
    const result = await runTechQuickMutation(db, actor, owned.value, true)
    return { ok: true, ...result }
  } catch (error) {
    return error instanceof TechQuickRequestUnavailable
      ? { ok: false, status: 400, error: 'request key unavailable' }
      : { ok: false, status: 500, error: 'session create failed' }
  }
}

export type GetSessionResult =
  | { ok: true; session: NonNullable<Awaited<ReturnType<typeof getSessionById>>> }
  | { ok: false; status: 400 | 404; error: string }

export async function getSessionForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
}): Promise<GetSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }
  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  return { ok: true, session }
}

const advanceSchema = z.object({
  observation: z.string().min(1).max(5000),
})

export type AdvanceSessionResult =
  | { ok: true; tree: TreeState }
  | { ok: false; status: 400 | 401 | 404 | 500; error: string }

export type GateActionFn = (input: {
  db: AppDb
  action: ProposedAction
  vehicleFamily?: string
  symptomClass?: string
}) => Promise<GateDecision>

export type ListArtifactsFn = (db: AppDb, sessionId: string) => Promise<Artifact[]>

export async function advanceSession(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  updateTree: (input: {
    intake: IntakePayload
    currentTree: TreeState
    observation: string
    artifacts?: Array<{
      kind: string
      summary?: string
      structured?: Record<string, unknown>
      text?: string
    }>
    sessionDtcs?: string[]
  }) => Promise<TreeState>
  gateAction?: GateActionFn
  listArtifacts?: ListArtifactsFn
  /** Optional. Called as the function moves through narratable stages
   *  (`Recording observation`, `Parsing photo · N frames` when photos exist,
   *  `Advancing to next step`). The retrieval wrapper emits its own stages.
   *  Default is no-op so the JSON `/advance` route and tests are unaffected. */
  onProgress?: (event: AdvanceStreamEvent) => void
}): Promise<AdvanceSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const parsed = advanceSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  // Fetch artifacts for the current node that have completed extraction
  const currentNodeId = session.treeState.currentNodeId
  const listFn = opts.listArtifacts ?? listArtifactsForSession
  const allArtifacts = await listFn(opts.db, opts.sessionId)
  const nodeArtifacts = allArtifacts
    .filter((a) => a.nodeId === currentNodeId && a.extractionStatus === 'done')
    .map((a) => ({
      kind: a.kind,
      summary: a.extraction?.summary,
      structured: a.extraction?.structured,
      text: a.extraction?.text,
    }))

  // Compile DTCs across the whole session (not just the current node) so retrieval
  // keeps its DTC anchor after the tree advances past `scan-codes`. Without this,
  // every observation after scan-codes resolves loses its DTC token, halving cache
  // reuse and degrading Reddit/YouTube/forum retrieval quality.
  const sessionDtcs = allArtifacts
    .filter((a) => a.kind === 'scan_screen' && a.extractionStatus === 'done')
    .flatMap((a) => {
      const codes = (
        a.extraction?.structured as { dtcs?: Array<{ code?: string }> } | undefined
      )?.dtcs
      return Array.isArray(codes)
        ? codes.map((d) => d?.code).filter((c): c is string => typeof c === 'string')
        : []
    })

  opts.onProgress?.({
    type: 'stage',
    idx: -1,
    label: 'Recording observation',
  })

  const photoArtifactCount = nodeArtifacts.filter((a) =>
    ['photo', 'scan_screen', 'wiring_diagram'].includes(a.kind),
  ).length
  if (photoArtifactCount > 0) {
    opts.onProgress?.({
      type: 'stage',
      idx: -1,
      label: `Parsing photo · ${photoArtifactCount} frames`,
    })
  }

  let nextTree: TreeState
  try {
    nextTree = await opts.updateTree({
      intake: session.intake,
      currentTree: session.treeState,
      observation: parsed.data.observation,
      artifacts: nodeArtifacts.length > 0 ? nodeArtifacts : undefined,
      sessionDtcs: sessionDtcs.length > 0 ? sessionDtcs : undefined,
    })
  } catch (err) {
    console.error('tree update failed:', err)
    return { ok: false, status: 500, error: 'tree update failed' }
  }

  if (nextTree.proposedAction) {
    const gateFn = opts.gateAction ?? gateProposedAction
    nextTree = {
      ...nextTree,
      gateDecision: await gateFn({
        db: opts.db,
        action: nextTree.proposedAction,
        vehicleFamily: vehicleFamilyKey(session.intake),
        symptomClass: primarySymptomClass(session.intake.customerComplaint),
      }),
    }
  }

  if (
    nextTree.requestedArtifact &&
    (nextTree.requestedArtifact.kind === 'wiring_diagram' ||
      nextTree.requestedArtifact.kind === 'scan_screen')
  ) {
    const audit = await recordTechAssistRequest(opts.db, {
      sessionId: opts.sessionId,
      nodeId: session.treeState.currentNodeId,
      artifactKind: nextTree.requestedArtifact.kind,
      requestPrompt: nextTree.requestedArtifact.prompt,
      gapDescription: nextTree.message.slice(0, 1000),
    })
    if (audit.exhausted) {
      nextTree = {
        ...nextTree,
        requestedArtifact: undefined,
        message: `${nextTree.message} (Rung-2 budget exhausted — consider Decline-or-Defer.)`,
      }
    }
  }

  opts.onProgress?.({
    type: 'stage',
    idx: -1,
    label: 'Advancing to next step',
  })

  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'observation',
    observationText: parsed.data.observation,
    aiResponse: {
      nextNodeId: nextTree.currentNodeId,
      messageText: nextTree.message,
    },
  })
  await updateSessionTreeState(opts.db, opts.sessionId, nextTree)

  return { ok: true, tree: nextTree }
}

type TicketedSessionMutationDiscovery = Readonly<{
  kind: 'not_found' | 'ready'
  separateChainIds: readonly string[]
  targetJobId: string | null
  targetSessionEventIds: readonly string[]
  closureFingerprint: string | null
}>

type LockedTicketedRepairContext = Readonly<{
  decision: 'approved' | 'declined'
  ticket: typeof tickets.$inferSelect
  job: typeof ticketJobs.$inferSelect
  session: typeof sessions.$inferSelect
  sessionEvents: readonly (typeof sessionEvents.$inferSelect)[]
}>

type TicketedSessionMutationSeams = Readonly<{
  afterTicketedWrite?: () => Promise<void>
  afterTicketedFinalization?: () => Promise<void>
  afterObservationWrite?: () => Promise<void>
  afterGuidanceWrite?: () => Promise<void>
}>

const EMPTY_SESSION_MUTATION_INSERTIONS = Object.freeze({
  sessions: Object.freeze([]),
  customers: Object.freeze([]),
  vehicles: Object.freeze([]),
  tickets: Object.freeze([]),
  jobs: Object.freeze([]),
})

function sessionMutationIds(values: readonly (string | null)[]): readonly string[] {
  return Object.freeze([...new Set(values.filter((value): value is string => value !== null))].sort())
}

function sessionMutationRowsById<T extends Readonly<{ id: string }>>(
  rows: readonly T[],
): readonly T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id))
}

function sessionMutationFingerprint(value: unknown): string {
  function normalize(member: unknown): unknown {
    if (member === null || typeof member === 'string' || typeof member === 'boolean') return member
    if (typeof member === 'number') {
      if (!Number.isFinite(member)) throw new TypeError('invalid_session_mutation_discovery')
      return member
    }
    if (typeof member === 'bigint') return { $bigint: member.toString() }
    if (member instanceof Date) return { $date: member.toISOString() }
    if (Array.isArray(member)) return member.map(normalize)
    if (typeof member !== 'object') throw new TypeError('invalid_session_mutation_discovery')
    return Object.fromEntries(Object.keys(member as Record<string, unknown>).sort()
      .map((key) => [key, normalize((member as Record<string, unknown>)[key])]))
  }
  return JSON.stringify(normalize(value))
}

function emptyTicketedSessionRequest(input: {
  shopId: string
  actorProfileId: string
}): Readonly<{ lockRequest: MutationLockRequestV1; payload: TicketedSessionMutationDiscovery }> {
  return Object.freeze({
    lockRequest: Object.freeze({
      shopId: input.shopId,
      actorProfileId: input.actorProfileId,
      profileIds: Object.freeze([input.actorProfileId]),
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
      insertionIntents: EMPTY_SESSION_MUTATION_INSERTIONS,
    }),
    payload: Object.freeze({
      kind: 'not_found' as const,
      separateChainIds: Object.freeze([]),
      targetJobId: null,
      targetSessionEventIds: Object.freeze([]),
      closureFingerprint: null,
    }),
  })
}

async function discoverTicketedSessionMutation(
  tx: AppDb,
  input: { shopId: string; sessionId: string; actorProfileId: string },
): Promise<Readonly<{
  lockRequest: MutationLockRequestV1
  payload: TicketedSessionMutationDiscovery
}>> {
  const linkedJobs = await tx.select().from(ticketJobs)
    .where(eq(ticketJobs.sessionId, input.sessionId)).limit(2)
  if (linkedJobs.length !== 1 || linkedJobs[0].shopId !== input.shopId) {
    return emptyTicketedSessionRequest(input)
  }
  const linkedJob = linkedJobs[0]
  const [targetTicket] = await tx.select().from(tickets).where(and(
    eq(tickets.shopId, input.shopId), eq(tickets.id, linkedJob.ticketId),
  )).limit(1)
  if (!targetTicket) return emptyTicketedSessionRequest(input)

  const ticketRows = [targetTicket]
  const seenTicketIds = new Set([targetTicket.id])
  let parentId = targetTicket.separateFromTicketId
  while (parentId !== null) {
    if (ticketRows.length >= 64 || seenTicketIds.has(parentId)) {
      throw new ShopOsMutationConflict()
    }
    const [parent] = await tx.select().from(tickets).where(and(
      eq(tickets.shopId, input.shopId), eq(tickets.id, parentId),
    )).limit(1)
    if (!parent) throw new ShopOsMutationConflict()
    ticketRows.push(parent)
    seenTicketIds.add(parent.id)
    parentId = parent.separateFromTicketId
  }

  const ticketIds = sessionMutationIds(ticketRows.map(({ id }) => id))
  const jobs = await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.shopId), inArray(ticketJobs.ticketId, ticketIds),
  )).orderBy(ticketJobs.id)
  const targetJob = jobs.find(({ id }) => id === linkedJob.id)
  if (!targetJob || targetJob.sessionId !== input.sessionId) {
    return emptyTicketedSessionRequest(input)
  }
  const jobIds = sessionMutationIds(jobs.map(({ id }) => id))
  const lines = jobIds.length === 0 ? [] : await tx.select().from(jobLines).where(and(
    eq(jobLines.shopId, input.shopId), inArray(jobLines.jobId, jobIds),
  )).orderBy(jobLines.id)
  const versions = await tx.select().from(quoteVersions).where(and(
    eq(quoteVersions.shopId, input.shopId), inArray(quoteVersions.ticketId, ticketIds),
  )).orderBy(quoteVersions.id)
  const events = await tx.select().from(quoteEvents).where(and(
    eq(quoteEvents.shopId, input.shopId), inArray(quoteEvents.ticketId, ticketIds),
  )).orderBy(quoteEvents.id)
  const sessionIds = sessionMutationIds(jobs.map(({ sessionId }) => sessionId))
  const sessionRows = sessionIds.length === 0 ? [] : await tx.select().from(sessions).where(and(
    eq(sessions.shopId, input.shopId), inArray(sessions.id, sessionIds),
  )).orderBy(sessions.id)
  const targetEvents = await tx.select().from(sessionEvents)
    .where(eq(sessionEvents.sessionId, input.sessionId))
    .orderBy(asc(sessionEvents.createdAt), asc(sessionEvents.id))
  const vehicleIds = sessionMutationIds([
    ...ticketRows.map(({ vehicleId }) => vehicleId),
    ...sessionRows.map(({ vehicleId }) => vehicleId),
  ])
  const vehicleRows = vehicleIds.length === 0 ? [] : (await tx.select({ row: vehicles })
    .from(vehicles).innerJoin(customers, eq(customers.id, vehicles.customerId))
    .where(and(eq(customers.shopId, input.shopId), inArray(vehicles.id, vehicleIds)))
    .orderBy(vehicles.id)).map(({ row }) => row)
  const customerIds = sessionMutationIds([
    ...ticketRows.map(({ customerId }) => customerId),
    ...vehicleRows.map(({ customerId }) => customerId),
  ])
  const customerRows = customerIds.length === 0 ? [] : await tx.select().from(customers)
    .where(and(eq(customers.shopId, input.shopId), inArray(customers.id, customerIds)))
    .orderBy(customers.id)
  const vendorAccountIds = sessionMutationIds(lines.map(({ vendorAccountId }) => vendorAccountId))
  const vendorRows = vendorAccountIds.length === 0 ? [] : await tx.select().from(vendorAccounts)
    .where(and(
      eq(vendorAccounts.shopId, input.shopId), inArray(vendorAccounts.id, vendorAccountIds),
    )).orderBy(vendorAccounts.id)
  const profileIds = sessionMutationIds([
    input.actorProfileId,
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
    ...sessionRows.map(({ techId }) => techId),
    ...targetEvents.map(({ requestActorProfileId }) => requestActorProfileId),
    ...versions.map(({ createdByProfileId }) => createdByProfileId),
    ...events.map(({ actorProfileId }) => actorProfileId),
  ])
  const profileRows = await tx.select().from(profiles).where(and(
    eq(profiles.shopId, input.shopId), inArray(profiles.id, profileIds),
  )).orderBy(profiles.id)
  const targetSessionEventIds = sessionMutationIds(targetEvents.map(({ id }) => id))
  const closureFingerprint = sessionMutationFingerprint({
    profiles: sessionMutationRowsById(profileRows),
    customers: sessionMutationRowsById(customerRows),
    vehicles: sessionMutationRowsById(vehicleRows),
    tickets: sessionMutationRowsById(ticketRows),
    jobs: sessionMutationRowsById(jobs),
    lines: sessionMutationRowsById(lines),
    versions: sessionMutationRowsById(versions),
    events: sessionMutationRowsById(events),
    sessions: sessionMutationRowsById(sessionRows),
    sessionEvents: sessionMutationRowsById(targetEvents),
    vendors: sessionMutationRowsById(vendorRows),
  })

  return Object.freeze({
    lockRequest: Object.freeze({
      shopId: input.shopId,
      actorProfileId: input.actorProfileId,
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
      sessionEventIds: targetSessionEventIds,
      vendorAccountIds,
      cannedJobIds: Object.freeze([]),
      receiptRequestKey: null,
      receiptConditionalInsert: null,
      insertionIntents: EMPTY_SESSION_MUTATION_INSERTIONS,
    }),
    payload: Object.freeze({
      kind: 'ready' as const,
      separateChainIds: Object.freeze(ticketRows.map(({ id }) => id)),
      targetJobId: targetJob.id,
      targetSessionEventIds,
      closureFingerprint,
    }),
  })
}

function ticketedSessionScopeFingerprint(scope: LockedMutationScopeV1): string {
  return sessionMutationFingerprint({
    profiles: sessionMutationRowsById(scope.profiles),
    customers: sessionMutationRowsById(scope.customers),
    vehicles: sessionMutationRowsById(scope.vehicles),
    tickets: sessionMutationRowsById(scope.tickets.map(({ ticket }) => ticket)),
    jobs: sessionMutationRowsById(scope.tickets.flatMap(({ jobs }) => jobs)),
    lines: sessionMutationRowsById(scope.tickets.flatMap(({ lines }) => lines)),
    versions: sessionMutationRowsById(scope.tickets.flatMap(({ versions }) => versions)),
    events: sessionMutationRowsById(scope.tickets.flatMap(({ events }) => events)),
    sessions: sessionMutationRowsById(scope.sessions),
    sessionEvents: sessionMutationRowsById(scope.sessionEvents),
    vendors: sessionMutationRowsById(scope.vendorAccounts),
  })
}

function latestTicketedRepairDecision(
  events: readonly (typeof quoteEvents.$inferSelect)[],
  jobId: string,
) {
  return [...events]
    .filter((event) =>
      event.jobId === jobId && (event.kind === 'approved' || event.kind === 'declined'))
    .sort((left, right) => {
      const byTime = left.createdAt.getTime() - right.createdAt.getTime()
      return byTime === 0 ? left.id.localeCompare(right.id) : byTime
    }).at(-1) ?? null
}

async function resolveLockedTicketedRepairContext(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  discovery: TicketedSessionMutationDiscovery,
  input: { shopId: string; sessionId: string; actorProfileId: string },
): Promise<LockedTicketedRepairContext> {
  assertLiveLockedMutationScopeV1(tx, scope)
  if (discovery.kind !== 'ready' || discovery.closureFingerprint === null) {
    throw new ShopOsMutationNotFound()
  }
  if (
    scope.profiles.length !== scope.request.profileIds.length ||
    scope.profiles.some(({ id, shopId }) =>
      shopId !== input.shopId || !scope.request.profileIds.includes(id)) ||
    discovery.closureFingerprint !== ticketedSessionScopeFingerprint(scope)
  ) throw new ShopOsMutationConflict()

  const graphById = new Map(scope.tickets.map((graph) => [graph.ticket.id, graph] as const))
  if (
    discovery.separateChainIds.length < 1 ||
    discovery.separateChainIds.length !== scope.tickets.length ||
    new Set(discovery.separateChainIds).size !== discovery.separateChainIds.length
  ) throw new ShopOsMutationConflict()
  for (let index = 0; index < discovery.separateChainIds.length; index += 1) {
    const graph = graphById.get(discovery.separateChainIds[index]!)
    if (!graph || graph.ticket.separateFromTicketId !==
      (discovery.separateChainIds[index + 1] ?? null)) throw new ShopOsMutationConflict()
  }

  const graph = graphById.get(discovery.separateChainIds[0]!)
  const job = graph?.jobs.find(({ id }) => id === discovery.targetJobId)
  const session = scope.sessions.find(({ id }) => id === input.sessionId)
  if (
    !graph || !job || !session || graph.ticket.status !== 'open' ||
    job.kind !== 'diagnostic' || job.sessionId !== session.id ||
    job.assignedTechId !== scope.actor.id || job.workStatus !== 'in_progress' ||
    session.status !== 'open' || session.treeState.phase !== 'repairing' ||
    session.techId !== scope.actor.id || session.vehicleId !== graph.ticket.vehicleId ||
    scope.actor.id !== input.actorProfileId || scope.actor.role !== 'tech' ||
    typeof scope.actor.skillTier !== 'number' || scope.actor.skillTier < job.requiredSkillTier
  ) throw new ShopOsMutationNotFound()

  const liveEventIds = sessionMutationIds((await tx.select({ id: sessionEvents.id })
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, session.id))
    .orderBy(sessionEvents.id)).map(({ id }) => id))
  if (
    liveEventIds.length !== discovery.targetSessionEventIds.length ||
    liveEventIds.some((id, index) => id !== discovery.targetSessionEventIds[index])
  ) throw new ShopOsMutationConflict()

  const decision = latestTicketedRepairDecision(graph.events, job.id)
  if (job.approvalState === 'declined') {
    const version = decision?.kind === 'declined'
      ? graph.versions.find(({ id }) => id === decision.quoteVersionId)
      : undefined
    if (
      job.approvedQuoteVersionId !== null || !decision || !version ||
      version.supersededAt !== null ||
      !quoteSnapshotContainsJob(version.snapshot, { ticketId: job.ticketId, jobId: job.id })
    ) throw new ShopOsMutationNotFound()
    return Object.freeze({
      decision: 'declined' as const,
      ticket: graph.ticket,
      job,
      session,
      sessionEvents: scope.sessionEvents,
    })
  }

  const version = job.approvalState === 'approved' && job.approvedQuoteVersionId !== null
    ? graph.versions.find(({ id }) => id === job.approvedQuoteVersionId)
    : undefined
  if (
    !version || version.supersededAt !== null || decision?.kind !== 'approved' ||
    decision.jobId !== job.id || decision.quoteVersionId !== version.id ||
    !quoteSnapshotContainsJob(version.snapshot, { ticketId: job.ticketId, jobId: job.id })
  ) throw new ShopOsMutationNotFound()
  return Object.freeze({
    decision: 'approved' as const,
    ticket: graph.ticket,
    job,
    session,
    sessionEvents: scope.sessionEvents,
  })
}

async function runTicketedSessionMutation<T>(
  db: AppDb,
  input: {
    shopId: string
    sessionId: string
    actorProfileId: string
    expectedDecision: 'approved' | 'declined'
  },
  execute: (
    tx: AppDb,
    scope: LockedMutationScopeV1,
    context: LockedTicketedRepairContext,
  ) => Promise<T>,
): Promise<T> {
  return runBoundedShopOsMutationV1<T, TicketedSessionMutationDiscovery>(db, {
    discover: async (tx) => discoverTicketedSessionMutation(tx, input),
    executeLocked: async (tx, scope, discovery) => {
      const context = await resolveLockedTicketedRepairContext(tx, scope, discovery, input)
      if (context.decision !== input.expectedDecision) throw new ShopOsMutationNotFound()
      return execute(tx, scope, context)
    },
  })
}

function ticketedSessionMutationFailure(error: unknown): CloseSessionResult | null {
  if (error instanceof ShopOsMutationNotFound) {
    return { ok: false, status: 409, error: 'repair_not_authorized' }
  }
  if (error instanceof ShopOsMutationConflict || isLockUnavailable(error)) {
    return { ok: false, status: 409, error: 'conflict', retryable: true }
  }
  return null
}

export type CloseSessionResult =
  | { ok: true }
  | { ok: false; status: 400 | 404 | 409 | 500; error: string; retryable?: true }
  | { ok: false; status: 422; error: 'specificity_required'; feedback: string }

const declinedNoRepairSchema = z.object({
  mode: z.literal('declined_no_repair'),
  note: z.string().trim().min(1).max(2000).optional(),
})

export async function closeSessionForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  validateSpecificity: (input: { rootCause: string; notes?: string }) => Promise<ValidatorResult>
  /** Phase K corpus promotion. Optional — when omitted, no promotion runs.
   *  Failures are non-fatal; the session still closes successfully. */
  promoteToCorpus?: PromoteToCorpusFn
  /** Phase R comeback follow-up scheduling. Optional — when omitted, no
   *  follow-ups are written. Failures are non-fatal; the session still
   *  closes (and corpus promotion still runs) regardless. */
  scheduleFollowUps?: ScheduleFollowUpsFn
  /** Phase P novel-pattern trigger. Optional — when omitted, no queue entry
   *  is written. The caller pre-binds the max corpus similarity score for this
   *  session so the trigger can decide whether to enqueue. Failures are
   *  non-fatal; the session still closes regardless. */
  enqueueNovelPattern?: EnqueueIfNovelPatternFn
  /** Max corpus retrieval similarity score for this session (0–1). Required
   *  when enqueueNovelPattern is provided; ignored otherwise. Defaults to 0
   *  when not supplied (treats as no corpus hits). */
  maxCorpusSimilarity?: number
  /** Proof-of-fix writer. Optional — when omitted, no diagnostic_sessions row is
   *  written. Failures are non-fatal; the session still closes regardless. */
  recordDiagnosticOutcome?: RecordDiagnosticOutcomeFn
  /** Test-only race seams around the two ticket authorization locks. */
  beforeAuthorizationPreflight?: () => Promise<void>
  beforeTicketedCloseLock?: () => Promise<void>
  /** Test-only rollback seams inside the ticketed close transaction. */
  afterTicketedWrite?: TicketedSessionMutationSeams['afterTicketedWrite']
  afterTicketedFinalization?: TicketedSessionMutationSeams['afterTicketedFinalization']
}): Promise<CloseSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const repairAccess = await resolveDiagnosticRepairAccess(opts.db, {
    shopId: session.shopId,
    sessionId: session.id,
  })
  const declinedNoRepair = declinedNoRepairSchema.safeParse(opts.body)

  if (declinedNoRepair.success) {
    if (repairAccess.state !== 'declined') {
      return { ok: false, status: 409, error: 'repair_not_authorized' }
    }
    try {
      await opts.beforeTicketedCloseLock?.()
      await runTicketedSessionMutation(opts.db, {
        shopId: session.shopId,
        sessionId: session.id,
        actorProfileId: profile.id,
        expectedDecision: 'declined',
      }, async (transactionDb, scope, locked) => {
        const rootCause = locked.session.treeState.rootCauseSummary?.trim()
        if (!rootCause || rootCause.length < 10) throw new ShopOsMutationNotFound()
        const outcome: StoredOutcomePayload = {
          rootCause,
          actionType: 'no_fix',
          verification: {
            codesCleared: false,
            testDrive: false,
            symptomsResolved: 'no',
          },
          diagMinutes: Math.max(
            0,
            Math.floor((Date.now() - locked.session.createdAt.getTime()) / 60_000),
          ),
          repairMinutes: 0,
          ...(declinedNoRepair.data.note ? { notes: declinedNoRepair.data.note } : {}),
          closeout: { kind: 'declined_no_repair' },
        }
        await closeSession(transactionDb, locked.session.id, outcome)
        await appendSessionEvent(transactionDb, {
          sessionId: locked.session.id,
          nodeId: locked.session.treeState.currentNodeId,
          eventType: 'close',
          aiResponse: {
            shopOsCloseout: { kind: 'declined_no_repair', jobId: locked.job.id },
          },
        })
        const canceled = await transactionDb
          .update(ticketJobs)
          .set({ workStatus: 'canceled', updatedAt: new Date() })
          .where(and(
            eq(ticketJobs.shopId, locked.session.shopId),
            eq(ticketJobs.id, locked.job.id),
            eq(ticketJobs.sessionId, locked.session.id),
            eq(ticketJobs.workStatus, 'in_progress'),
          ))
          .returning()
        if (canceled.length !== 1) throw new ShopOsMutationConflict()
        await opts.afterTicketedWrite?.()
        await finalizeMutationRevisionsV1(transactionDb, scope, {
          sessionIds: [], customerIds: [], vehicleIds: [],
        }, [{
          ticketId: locked.ticket.id,
          createdTicket: false,
          createdJobIds: [],
          existingChangedJobIds: [locked.job.id],
          actorVisibleTicketFieldsChanged: true,
        }])
        await opts.afterTicketedFinalization?.()
      })
      return { ok: true }
    } catch (error) {
      const failure = ticketedSessionMutationFailure(error)
      if (failure) return failure
      throw error
    }
  }

  if (repairAccess.state !== 'legacy' && repairAccess.state !== 'approved') {
    return { ok: false, status: 409, error: 'repair_not_authorized' }
  }

  const parsed = outcomeSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  if (repairAccess.state === 'approved') {
    try {
      await opts.beforeAuthorizationPreflight?.()
      const locked = await lockDiagnosticRepairAccess(opts.db, {
        shopId: session.shopId,
        sessionId: session.id,
        actorProfileId: profile.id,
      })
      if (locked.state !== 'approved') {
        return { ok: false, status: 409, error: 'repair_not_authorized' }
      }
    } catch (error) {
      const failure = ticketedSessionMutationFailure(error)
      if (failure) return failure
      throw error
    }
  }

  // Override path: tech retried after one rejection. Skip the validator entirely;
  // the override metadata is persisted on the outcome row for admin review.
  if (!parsed.data.override) {
    let validation: ValidatorResult
    try {
      validation = await opts.validateSpecificity({
        rootCause: parsed.data.rootCause,
        notes: parsed.data.notes,
      })
    } catch {
      return { ok: false, status: 500, error: 'session close failed' }
    }
    if (!validation.ok) {
      return {
        ok: false,
        status: 422,
        error: 'specificity_required',
        feedback: validation.feedback ?? 'Be more specific.',
      }
    }
  }

  if (repairAccess.state === 'approved') {
    try {
      await opts.beforeTicketedCloseLock?.()
      await runTicketedSessionMutation(opts.db, {
        shopId: session.shopId,
        sessionId: session.id,
        actorProfileId: profile.id,
        expectedDecision: 'approved',
      }, async (transactionDb, scope, locked) => {
        await closeSession(transactionDb, locked.session.id, parsed.data)
        await appendSessionEvent(transactionDb, {
          sessionId: locked.session.id,
          nodeId: locked.session.treeState.currentNodeId,
          eventType: 'close',
        })
        const completed = await transactionDb
          .update(ticketJobs)
          .set({ workStatus: 'done', updatedAt: new Date() })
          .where(and(
            eq(ticketJobs.shopId, locked.session.shopId),
            eq(ticketJobs.id, locked.job.id),
            eq(ticketJobs.sessionId, locked.session.id),
            eq(ticketJobs.workStatus, 'in_progress'),
          ))
          .returning()
        if (completed.length !== 1) throw new ShopOsMutationConflict()
        await opts.afterTicketedWrite?.()
        await finalizeMutationRevisionsV1(transactionDb, scope, {
          sessionIds: [], customerIds: [], vehicleIds: [],
        }, [{
          ticketId: locked.ticket.id,
          createdTicket: false,
          createdJobIds: [],
          existingChangedJobIds: [locked.job.id],
          actorVisibleTicketFieldsChanged: true,
        }])
        await opts.afterTicketedFinalization?.()
      })
    } catch (error) {
      const failure = ticketedSessionMutationFailure(error)
      if (failure) return failure
      throw error
    }
  } else {
    await closeSession(opts.db, opts.sessionId, parsed.data)
    await appendSessionEvent(opts.db, {
      sessionId: opts.sessionId,
      nodeId: session.treeState.currentNodeId,
      eventType: 'close',
    })
  }

  if (opts.promoteToCorpus) {
    try {
      const arts = await listArtifactsForSession(opts.db, opts.sessionId)
      const extractedDtcs = arts.flatMap((a) => {
        if (a.extractionStatus !== 'done') return []
        const structured = a.extraction?.structured as
          | { dtcs?: Array<{ code?: string }> }
          | undefined
        return structured?.dtcs?.map((d) => d.code).filter((c): c is string => Boolean(c)) ?? []
      })
      const extractedSymptomTags = inferSymptomTags(session.intake.customerComplaint)
      await opts.promoteToCorpus(opts.db, {
        sessionId: opts.sessionId,
        shopId: session.shopId,
        intake: session.intake,
        outcome: parsed.data,
        extractedDtcs,
        extractedSymptomTags,
      })
    } catch (err) {
      console.warn('corpus promotion failed (session still closed):', err)
    }
  }

  if (opts.scheduleFollowUps) {
    try {
      await opts.scheduleFollowUps(opts.db, {
        sessionId: opts.sessionId,
        shopId: session.shopId,
        techId: session.techId,
      })
    } catch (err) {
      console.warn('follow-up scheduling failed (session still closed):', err)
    }
  }

  if (opts.enqueueNovelPattern) {
    try {
      await opts.enqueueNovelPattern(
        opts.db,
        opts.sessionId,
        opts.maxCorpusSimilarity ?? 0,
      )
    } catch (err) {
      console.warn('novel-pattern queue enqueue failed (session still closed):', err)
    }
  }

  if (opts.recordDiagnosticOutcome) {
    try {
      await opts.recordDiagnosticOutcome(opts.db, {
        vehicleId: session.vehicleId,
        shopId: session.shopId,
        techId: session.techId,
        complaintText: session.intake.customerComplaint,
        outcome: parsed.data,
      })
    } catch (err) {
      console.warn('diagnostic-session record failed (session still closed):', err)
    }
  }

  return { ok: true }
}

type CaptureKind = Artifact['kind']
const ALLOWED_CAPTURE_KINDS = ['photo', 'video', 'audio', 'scan_screen', 'wiring_diagram'] as Array<CaptureKind>
export const MAX_CAPTURE_BYTES = 25 * 1024 * 1024 // 25 MB

export type CaptureArtifactResult =
  | { ok: true; artifactId: string; storageKey: string; kind: CaptureKind; extractionStatus: 'pending' | 'done' | 'failed' }
  | { ok: false; status: 400 | 404; error: string }

export async function captureArtifact(opts: {
  db: AppDb
  userId: string
  sessionId: string
  kind: string
  nodeId?: string
  file: { bytes: Uint8Array; mimeType: string; size: number }
  durationMs?: number
  uploadArtifact: (input: {
    sessionId: string
    kind: CaptureKind
    bytes: Uint8Array
    mimeType: string
  }) => Promise<string>
  createArtifact: (db: AppDb, input: NewArtifact) => Promise<string>
  /** Optional: auto-run extraction for high-signal kinds inline after capture.
   *  Injected so existing tests remain unaffected (omit = no auto-extraction). */
  processExtraction?: (db: AppDb, artifactId: string) => Promise<void>
}): Promise<CaptureArtifactResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session not open' }
  }

  if (!ALLOWED_CAPTURE_KINDS.includes(opts.kind as CaptureKind)) {
    return { ok: false, status: 400, error: 'invalid kind' }
  }
  const kind = opts.kind as CaptureKind

  if (opts.file.size === 0 || opts.file.size > MAX_CAPTURE_BYTES) {
    return { ok: false, status: 400, error: 'invalid size' }
  }

  const nodeId = opts.nodeId ?? session.treeState.currentNodeId

  // Upload receives the FULL mimeType (with codec) so storage object metadata is accurate.
  const storageKey = await opts.uploadArtifact({
    sessionId: opts.sessionId,
    kind,
    bytes: opts.file.bytes,
    mimeType: opts.file.mimeType,
  })

  // DB column stores only the base MIME type — codec parameters (e.g. ;codecs=opus)
  // are stripped so consumers (vision.ts MIME gate, etc.) see a clean value.
  const baseMimeType = opts.file.mimeType.split(';')[0].trim()
  const artifactId = await opts.createArtifact(opts.db, {
    sessionId: opts.sessionId,
    nodeId,
    kind,
    storageKey,
    mimeType: baseMimeType,
    bytes: opts.file.size,
    durationMs: opts.durationMs,
    extractionStatus: 'pending',
  })

  // Auto-extract inline for high-signal kinds when a processor is injected.
  // On failure: log and continue — the artifact exists; the tech can retry
  // via POST /api/artifacts/:id/extract.
  let extractionStatus: 'pending' | 'done' | 'failed' = 'pending'
  if (opts.processExtraction && HIGH_SIGNAL_KINDS.has(kind)) {
    try {
      await opts.processExtraction(opts.db, artifactId)
      extractionStatus = 'done'
    } catch (err) {
      console.error(`[captureArtifact] inline extraction failed for ${artifactId}:`, err)
      extractionStatus = 'failed'
    }
  }

  return { ok: true, artifactId, storageKey, kind, extractionStatus }
}

const ambientGeoSchema = z.object({
  source: z.literal('geolocation'),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})

const ambientManualSchema = z.object({
  source: z.literal('manual'),
  temperatureF: z.number().finite().min(-80).max(160),
  humidityPct: z.number().min(0).max(100).optional(),
})

const ambientBodySchema = z.discriminatedUnion('source', [
  ambientGeoSchema,
  ambientManualSchema,
])

export type AmbientLookupFn = (input: {
  latitude: number
  longitude: number
}) => Promise<{
  temperatureC: number
  temperatureF: number
  humidityPct?: number
  windKph?: number
  conditions?: string
}>

export type RecordAmbientConditionsResult =
  | { ok: true; conditions: AmbientConditions; tree: TreeState }
  | { ok: false; status: 400 | 404 | 500 | 502; error: string }

/**
 * Capture ambient conditions for a session. Two paths:
 *   - source=geolocation: server-side weather lookup from the tech's lat/lon
 *     (Open-Meteo). Lat/lon are rounded to ~11km before persistence so the
 *     stored intake can't pinpoint the tech.
 *   - source=manual: tech-entered temperature override (used when the
 *     geolocation lookup looks wrong, e.g. VPN or data-center IP).
 *
 * In both cases the conditions are written to session.intake.ambientConditions
 * and the tree is advanced with a synthetic observation describing the
 * captured value, so the AI can incorporate it on the next turn instead of
 * generating a "look up the temp" step.
 */
export async function recordAmbientConditions(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  lookupAmbient: AmbientLookupFn
  updateTree: (input: {
    intake: IntakePayload
    currentTree: TreeState
    observation: string
  }) => Promise<TreeState>
}): Promise<RecordAmbientConditionsResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const parsed = ambientBodySchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  let conditions: AmbientConditions
  if (parsed.data.source === 'geolocation') {
    try {
      const weather = await opts.lookupAmbient({
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
      })
      conditions = {
        temperatureF: round1(weather.temperatureF),
        humidityPct:
          weather.humidityPct !== undefined ? Math.round(weather.humidityPct) : undefined,
        windKph: weather.windKph !== undefined ? round1(weather.windKph) : undefined,
        conditions: weather.conditions,
        source: 'geolocation',
        capturedAt: new Date().toISOString(),
        approxLat: round1(parsed.data.latitude),
        approxLon: round1(parsed.data.longitude),
      }
    } catch (err) {
      console.error('ambient lookup failed:', err)
      return { ok: false, status: 502, error: 'ambient lookup failed' }
    }
  } else {
    conditions = {
      temperatureF: round1(parsed.data.temperatureF),
      humidityPct:
        parsed.data.humidityPct !== undefined
          ? Math.round(parsed.data.humidityPct)
          : undefined,
      source: 'manual',
      capturedAt: new Date().toISOString(),
    }
  }

  const nextIntake: IntakePayload = { ...session.intake, ambientConditions: conditions }
  await updateSessionIntake(opts.db, opts.sessionId, nextIntake)

  const observation = formatAmbientObservation(conditions)

  let nextTree: TreeState
  try {
    nextTree = await opts.updateTree({
      intake: nextIntake,
      currentTree: session.treeState,
      observation,
    })
  } catch (err) {
    console.error('tree update after ambient capture failed:', err)
    return { ok: false, status: 500, error: 'tree update failed' }
  }

  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'observation',
    observationText: observation,
    aiResponse: { nextNodeId: nextTree.currentNodeId },
  })
  await updateSessionTreeState(opts.db, opts.sessionId, nextTree)

  return { ok: true, conditions, tree: nextTree }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function formatAmbientObservation(c: AmbientConditions): string {
  const parts = [`Ambient ${c.temperatureF.toFixed(0)}°F`]
  if (typeof c.humidityPct === 'number') parts.push(`${c.humidityPct}% RH`)
  if (typeof c.windKph === 'number') parts.push(`wind ${c.windKph.toFixed(0)} kph`)
  if (c.conditions) parts.push(c.conditions)
  const tag = c.source === 'geolocation' ? 'geolocation lookup' : 'tech-entered'
  return `${parts.join(', ')} (${tag}).`
}

function vehicleFamilyKey(intake: IntakePayload): string {
  return `${intake.vehicleMake.toLowerCase()}-${intake.vehicleModel.toLowerCase()}`
}

function primarySymptomClass(complaint: string): string {
  const text = complaint.toLowerCase()
  if (/power|stall|hesit|sluggish|underboost|boost/.test(text)) return 'power_loss'
  if (/start|crank|no.?start/.test(text)) return 'starting_issue'
  if (/misfire|rough/.test(text)) return 'misfire'
  if (/overheat|temp/.test(text)) return 'overheat'
  return '*'
}

// Tech-initiated gate release. The Decline screen calls this from every
// non-defer exit (Yes/No on the hero confirm card, Snap-it on the photo
// card, Gather more low-risk data) so that after the user takes an action,
// the session-routing layer doesn't redirect them right back to the same
// Decline screen on the next page load. The next observation re-runs gating
// naturally — this isn't a bypass, just a release of the *current displayed*
// gate so the tech can act on the AI's updated context.
export type ReleaseGateResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: string }

export async function releaseGateForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
}): Promise<ReleaseGateResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const { gateDecision: _drop, ...nextTree } = session.treeState
  await updateSessionTreeState(opts.db, opts.sessionId, nextTree as TreeState)
  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'tree_update',
  })
  return { ok: true }
}

// Decline-this-job was removed from the product 2026-05-09 — defer-for-curator
// is the only escalation path. Stale clients posting reason='decline' get a
// 400 from zod's literal('defer') here. The session.status enum still carries
// 'declined' for back-compat with existing closed rows; the curator case page
// reads them fine.
const declineOrDeferSchema = z.object({
  reason: z.literal('defer'),
  gap: z.string().min(5).max(2000),
  riskClass: z.enum(['low', 'medium', 'high', 'destructive']),
})

export type DeclineOrDeferSessionResult =
  | { ok: true; status: 'deferred'; language: DeclineLanguage }
  | { ok: false; status: 400 | 404 | 500; error: string }

export async function declineOrDeferSessionForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  generateLanguage: (input: DeclineLanguageInput) => Promise<DeclineLanguage>
}): Promise<DeclineOrDeferSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const parsed = declineOrDeferSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  const engine = session.intake.vehicleEngine ? ` (${session.intake.vehicleEngine})` : ''
  const vehicleSummary = `${session.intake.vehicleYear} ${session.intake.vehicleMake} ${session.intake.vehicleModel}${engine}`

  let language: DeclineLanguage
  try {
    language = await opts.generateLanguage({
      vehicleSummary,
      complaint: session.intake.customerComplaint,
      gap: parsed.data.gap,
      riskClass: parsed.data.riskClass,
      reason: 'defer',
    })
  } catch (err) {
    console.error('decline language generation failed:', err)
    return { ok: false, status: 500, error: 'language generation failed' }
  }

  await setSessionTerminalStatus(opts.db, opts.sessionId, 'deferred')
  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'close',
    aiResponse: {
      declineOrDefer: {
        reason: 'defer',
        gap: parsed.data.gap,
        riskClass: parsed.data.riskClass,
        language,
      },
    },
  })

  return { ok: true, status: 'deferred', language }
}

const abandonSchema = z.object({
  reason: z.enum(['mistake', 'test', 'wrong_vehicle', 'customer_left', 'other']).optional(),
  note: z.string().max(500).optional(),
})

export type AbandonSessionResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: string }

/**
 * User-initiated abandonment: closes an open session as 'deferred' without
 * the outcome form / AI specificity validation / corpus promotion. Use when
 * the tech started by mistake, it was a test, or the customer left without
 * finishing. The session lands in the curator's "Incomplete" bucket.
 *
 * Distinct from declineOrDeferSessionForUser, which closes a session that
 * the AI itself is gating (low confidence) and generates customer-facing
 * language. This path generates no language and runs no AI.
 */
export async function abandonSessionForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
}): Promise<AbandonSessionResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }

  const parsed = abandonSchema.safeParse(opts.body ?? {})
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  await setSessionTerminalStatus(opts.db, opts.sessionId, 'deferred')
  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'close',
    aiResponse: {
      abandon: {
        reason: parsed.data.reason ?? 'mistake',
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
      },
    },
  })

  return { ok: true }
}

export type LockDiagnosisResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: string }

/**
 * Tech-initiated diagnostic-phase lock-in. Transitions session from
 * phase=diagnosing (with done=true) to phase=repairing. After this:
 * - rootCauseSummary is frozen (the repair-guidance prompt explicitly
 *   instructs the AI not to revise it; server-side parser drops any
 *   attempt to set rootCauseSummary in the response)
 * - subsequent tech inputs go through /api/sessions/[id]/repair-observation
 * - the repair phase ends when the tech closes the case via /outcome OR
 *   marks it incomplete via abandon
 */
export async function lockDiagnosisForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
}): Promise<LockDiagnosisResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }
  if (session.treeState.phase === 'repairing') {
    return { ok: false, status: 400, error: 'diagnosis already locked' }
  }
  if (!session.treeState.done) {
    return { ok: false, status: 400, error: 'diagnosis not done — cannot lock' }
  }

  const lockedAt = new Date().toISOString()
  const nextTree = {
    ...session.treeState,
    phase: 'repairing' as const,
    diagnosisLockedAt: lockedAt,
  }

  await updateSessionTreeState(opts.db, opts.sessionId, nextTree)
  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'tree_update',
  })

  return { ok: true }
}

export type LockDiagnosisFromWizardResult =
  | { ok: true }
  | { ok: false; status: 400 | 404; error: 'not found' | 'session is not open' | 'diagnosis already locked' }

/**
 * Lock-in handoff from the curator-guided wizard to the existing repair surface.
 *
 * Merges the wizard's terminal Finding into the session's existing treeState
 * (phase -> 'repairing', rootCauseSummary, proposedAction, diagnosisLockedAt) so
 * ActiveSession -> RepairPhaseView renders WITH NO CHANGES to those components. The
 * merge preserves the session's real nodes[]/currentNodeId/message — we never fabricate
 * tree nodes (#98: nothing rendered downstream is invented). Clears sessions.wizardState.
 * Inserts exactly one 'wizard_lock_in' session_event. Idempotent: the already-locked
 * guard rejects a second call BEFORE any insert, so no duplicate event is written.
 *
 * Unlike lockDiagnosisForUser, this path does NOT require treeState.done — the wizard's
 * terminal Finding is itself the readiness signal (the wizard bypasses the AI tree).
 * Ownership failures (no profile / not the session's tech) intentionally collapse into a
 * single 404 'not found' so the response never leaks whether a profile or session exists;
 * this is why the result type omits the peers' 400 'no profile'.
 */
export async function lockDiagnosisFromWizard(opts: {
  db: AppDb
  userId: string
  sessionId: string
  finding: Finding
  // Forwarded from the route's lock-in payload; unused here in N4. Reserved for the
  // PR-N5 audit/outcome work, kept in the signature so the route call site stays flat.
  history: WizardState['history']
  flowVersionId: string
}): Promise<LockDiagnosisFromWizardResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  // Uniform 404 (not the peers' 400 'no profile') — see JSDoc: don't leak existence.
  if (!profile) return { ok: false, status: 404, error: 'not found' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }
  if (session.treeState.phase === 'repairing' || session.treeState.diagnosisLockedAt) {
    return { ok: false, status: 400, error: 'diagnosis already locked' }
  }

  const handoff = synthesizeHandoffFromFinding({ finding: opts.finding })
  const mergedTreeState: TreeState = { ...session.treeState, ...handoff }

  await opts.db
    .update(sessions)
    .set({ treeState: mergedTreeState, wizardState: null })
    .where(eq(sessions.id, opts.sessionId))

  await appendSessionEvent(opts.db, {
    sessionId: opts.sessionId,
    nodeId: session.treeState.currentNodeId,
    eventType: 'wizard_lock_in',
    observationText: opts.finding.verdict,
    aiResponse: { wizardLockIn: { flowVersionId: opts.flowVersionId } },
  })

  return { ok: true }
}

const repairObservationSchema = z.object({
  observation: z.string().min(1).max(2000),
})

export type SubmitRepairObservationResult =
  | { ok: true; guidance: RepairGuidanceResult }
  | { ok: false; status: 400 | 404 | 409 | 502; error: string; retryable?: true }

export type GetRepairGuidanceFn = (
  input: RepairGuidancePromptInput,
) => Promise<RepairGuidanceResult>

type RepairObservationStage1 = Readonly<{
  prompt: RepairGuidancePromptInput
  anchor: Readonly<{ id: string; createdAtMs: number }>
}>

function orderedRepairEvents(
  events: readonly (typeof sessionEvents.$inferSelect)[],
): readonly (typeof sessionEvents.$inferSelect)[] {
  return [...events].sort((left, right) => {
    const byTime = left.createdAt.getTime() - right.createdAt.getTime()
    return byTime === 0 ? left.id.localeCompare(right.id) : byTime
  })
}

/**
 * Tech-submitted observation during the repair phase. Persists the
 * observation as a session_event, then calls the repair-guidance AI
 * prompt for a reply, and persists the AI's reply as a separate
 * session_event. Both events are queryable via session_events for the
 * chat-thread render.
 *
 * On AI failure: observation is persisted, guidance is NOT persisted,
 * caller receives 502. UI surfaces this as "AI unavailable, retry?"
 * without losing the tech's input.
 */
export async function submitRepairObservationForUser(opts: {
  db: AppDb
  userId: string
  sessionId: string
  body: unknown
  /** Injected for testability. Production wires this to lib/ai/repair-guidance#getRepairGuidance. */
  getGuidance: GetRepairGuidanceFn
  /** Test-only rollback seams inside the two observation transactions. */
  afterObservationWrite?: TicketedSessionMutationSeams['afterObservationWrite']
  afterGuidanceWrite?: TicketedSessionMutationSeams['afterGuidanceWrite']
}): Promise<SubmitRepairObservationResult> {
  const profile = await getProfileByUserId(opts.db, opts.userId)
  if (!profile) return { ok: false, status: 400, error: 'no profile' }

  const session = await getSessionById(opts.db, opts.sessionId)
  if (!session || session.techId !== profile.id) {
    return { ok: false, status: 404, error: 'not found' }
  }
  if (session.status !== 'open') {
    return { ok: false, status: 400, error: 'session is not open' }
  }
  if (session.treeState.phase !== 'repairing') {
    return { ok: false, status: 400, error: 'session is not in repair phase' }
  }

  const parsed = repairObservationSchema.safeParse(opts.body)
  if (!parsed.success) {
    return { ok: false, status: 400, error: parsed.error.message }
  }

  const initialAccess = await resolveDiagnosticRepairAccess(opts.db, {
    shopId: session.shopId,
    sessionId: session.id,
  })
  if (initialAccess.state === 'legacy') {
    try {
      const committed = await opts.db.transaction(async (tx) => {
        const transactionDb = tx as AppDb
        const access = await lockDiagnosticRepairAccess(transactionDb, {
          shopId: session.shopId,
          sessionId: session.id,
          actorProfileId: profile.id,
        })
        if (access.state !== 'legacy') return false
        await appendSessionEvent(transactionDb, {
          sessionId: opts.sessionId,
          nodeId: session.treeState.currentNodeId,
          eventType: 'repair_observation',
          observationText: parsed.data.observation,
        })
        return true
      })
      if (!committed) return { ok: false, status: 409, error: 'repair_not_authorized' }
    } catch (error) {
      if (isLockUnavailable(error) || error instanceof ShopOsMutationConflict) {
        return { ok: false, status: 409, error: 'conflict', retryable: true }
      }
      throw error
    }
    const allEvents = await opts.db.select().from(sessionEvents)
      .where(eq(sessionEvents.sessionId, opts.sessionId))
      .orderBy(asc(sessionEvents.createdAt), asc(sessionEvents.id))
    let guidance: RepairGuidanceResult
    try {
      guidance = await opts.getGuidance({
        tree: session.treeState,
        recentEvents: allEvents.slice(0, -1),
        observation: parsed.data.observation,
      })
    } catch {
      return { ok: false, status: 502, error: 'repair_guidance_unavailable' }
    }
    await appendSessionEvent(opts.db, {
      sessionId: opts.sessionId,
      nodeId: session.treeState.currentNodeId,
      eventType: 'repair_guidance',
      aiResponse: { repairGuidance: guidance },
    })
    return { ok: true, guidance }
  }
  if (initialAccess.state !== 'approved') {
    return { ok: false, status: 409, error: 'repair_not_authorized' }
  }

  let stage1: RepairObservationStage1
  try {
    stage1 = await runTicketedSessionMutation(opts.db, {
      shopId: session.shopId,
      sessionId: session.id,
      actorProfileId: profile.id,
      expectedDecision: 'approved',
    }, async (tx, _scope, context) => {
      const observationId = randomUUID()
      const observation = await appendSessionEvent(tx, {
        id: observationId,
        sessionId: context.session.id,
        nodeId: context.session.treeState.currentNodeId,
        eventType: 'repair_observation',
        observationText: parsed.data.observation,
      })
      await opts.afterObservationWrite?.()
      const priorEvents = Object.freeze(orderedRepairEvents(context.sessionEvents)
        .filter(({ id }) => id !== observationId)) as unknown as RepairGuidancePromptInput['recentEvents']
      const prompt = Object.freeze({
        tree: context.session.treeState,
        recentEvents: priorEvents,
        observation: parsed.data.observation,
      })
      return Object.freeze({
        prompt,
        anchor: Object.freeze({ id: observation.id, createdAtMs: observation.createdAt.getTime() }),
      })
    })
  } catch (error) {
    if (error instanceof ShopOsMutationNotFound) {
      return { ok: false, status: 409, error: 'repair_not_authorized' }
    }
    if (error instanceof ShopOsMutationConflict || isLockUnavailable(error)) {
      return { ok: false, status: 409, error: 'conflict', retryable: true }
    }
    throw error
  }

  let guidance: RepairGuidanceResult
  try {
    guidance = await opts.getGuidance(stage1.prompt)
  } catch {
    return { ok: false, status: 502, error: 'repair_guidance_unavailable' }
  }

  try {
    await runTicketedSessionMutation(opts.db, {
      shopId: session.shopId,
      sessionId: session.id,
      actorProfileId: profile.id,
      expectedDecision: 'approved',
    }, async (tx, _scope, context) => {
      const lastEvent = orderedRepairEvents(context.sessionEvents).at(-1)
      if (
        !lastEvent || lastEvent.id !== stage1.anchor.id ||
        lastEvent.createdAt.getTime() !== stage1.anchor.createdAtMs
      ) throw new ShopOsMutationConflict()
      await appendSessionEvent(tx, {
        sessionId: context.session.id,
        nodeId: context.session.treeState.currentNodeId,
        eventType: 'repair_guidance',
        aiResponse: { repairGuidance: guidance },
      })
      await opts.afterGuidanceWrite?.()
    })
  } catch (error) {
    if (error instanceof ShopOsMutationNotFound) {
      return { ok: false, status: 409, error: 'repair_not_authorized' }
    }
    if (error instanceof ShopOsMutationConflict || isLockUnavailable(error)) {
      return { ok: false, status: 409, error: 'conflict', retryable: true }
    }
    throw error
  }

  return { ok: true, guidance }
}
