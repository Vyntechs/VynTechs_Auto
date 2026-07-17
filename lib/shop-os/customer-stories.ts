import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  sessionEvents,
  sessions,
  ticketJobs,
  tickets,
  vehicles,
  vendorAccounts,
  type CustomerStory,
  type CustomerStoryMeta,
  type TreeState,
} from '@/lib/db/schema'
import {
  CustomerStoryProviderError,
  type CustomerStoryGenerationInput,
  type GenerateCustomerStoryFn,
  type GeneratedEvidenceSelection,
} from '@/lib/ai/customer-story'
import {
  invalidateActiveQuoteVersion,
  invalidateActiveQuoteVersionDeltaV1,
} from '@/lib/shop-os/quotes'
import {
  CUSTOMER_STORY_WAIVER,
  customerStoryReviewTextSchema,
  parsePersistedCustomerStory,
  parsePersistedCustomerStoryMeta,
} from '@/lib/shop-os/customer-story-contracts'
import { assertLiveLockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import { ShopOsMutationNotFound } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { ShopOsMutationConflict } from '@/lib/shop-os/continuity/mutation-foundation/conflicts'
import type {
  LockedMutationScopeV1,
  MutationLockRequestV1,
} from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import { finalizeMutationRevisionsV1 } from '@/lib/shop-os/continuity/mutation-foundation/revisions'
import { runBoundedShopOsMutationV1 } from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'

const MAX_SELECTED = 20
const PAGE_SIZE = 25
const MAX_LOCK_FUTURE_MS = 5 * 60 * 1000
const MAX_CANONICAL_FIELD_BYTES = 5_000
const MAX_EVENT_BYTES = 2_000
const MAX_PROVIDER_BYTES = 64_000
const WORKSPACE_SCAN_CHUNK = 50
const MAX_WORKSPACE_SCAN_CHUNKS = 4
const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength
const uuidSchema = z.uuid().transform((value) => value.toLowerCase())
const idListSchema = z.array(uuidSchema).max(MAX_SELECTED).superRefine((ids, ctx) => {
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'IDs must be unique' })
})

export type CustomerStoryActor = { profileId: string }
export type CustomerStoryError =
  | 'invalid_input'
  | 'not_found'
  | 'forbidden'
  | 'state_conflict'
  | 'unsupported_path'
  | 'invalid_evidence'
  | 'conflict'
  | 'provider_timeout'
  | 'provider_failed'

type Failure = { ok: false; error: CustomerStoryError; retryable?: boolean }
type SafeStoryMeta = Pick<CustomerStoryMeta, 'source' | 'sessionId' | 'generatedAt' | 'lastEditedByProfileId' | 'lastEditedAt' | 'reviewStatus'>
type EvidenceListItem = {
  id: string
  kind: string
  createdAt: string
  label: string
}

export type CustomerStoryWorkspaceResult =
  | {
      ok: true
      workspace: {
        story: CustomerStory | null
        storyMeta: SafeStoryMeta | null
        storyRevision: number
        evidence: {
          events: EvidenceListItem[]
          artifacts: EvidenceListItem[]
          nextEventCursor: string | null
          nextArtifactCursor: string | null
        }
      }
    }
  | Failure

export type CustomerStoryGenerationResult =
  | {
      ok: true
      changed: boolean
      story: CustomerStory
      storyMeta: CustomerStoryMeta
      storyRevision: number
    }
  | Failure

export type CustomerStoryGenerationDependencies = {
  generateCustomerStory: GenerateCustomerStoryFn
  beforeFinalTransaction?: () => Promise<void>
  afterLocks?: () => Promise<void>
  afterWrite?: () => Promise<void>
  afterFinalization?: () => Promise<void>
}

export type CustomerStoryReviewDependencies = {
  afterLocks?: () => Promise<void>
  captureLockSql?: (statements: string[]) => void
}

export type CustomerStoryWorkspaceDependencies = {
  onEvidenceQuery?: (kind: 'event') => void
}

const workspaceInputSchema = z.strictObject({
  actor: z.strictObject({ profileId: uuidSchema }),
  ticketId: uuidSchema,
  jobId: uuidSchema,
  eventCursor: z.string().max(1_000).optional(),
})

const generationInputSchema = z.strictObject({
  actor: z.strictObject({ profileId: uuidSchema }),
  ticketId: uuidSchema,
  jobId: uuidSchema,
  clientKey: uuidSchema,
  expectedStoryRevision: z.number().int().nonnegative(),
  sourceEventIds: idListSchema,
  sourceArtifactIds: z.array(z.never()).length(0),
})

const reviewInputSchema = z.strictObject({
  actor: z.strictObject({ profileId: uuidSchema }),
  ticketId: uuidSchema,
  jobId: uuidSchema,
  clientKey: uuidSchema,
  expectedStoryRevision: z.number().int().nonnegative(),
  whatWeFound: customerStoryReviewTextSchema,
  whatWeRecommend: customerStoryReviewTextSchema,
})

type GenerationInput = z.infer<typeof generationInputSchema>
type SelectedEvent = typeof sessionEvents.$inferSelect
type Context = {
  actor: Pick<typeof profiles.$inferSelect, 'id' | 'shopId' | 'role' | 'skillTier' | 'membershipStatus' | 'deactivatedAt'>
  ticket: typeof tickets.$inferSelect
  targetJob: typeof ticketJobs.$inferSelect
  jobs: Array<typeof ticketJobs.$inferSelect>
  versions: Array<typeof quoteVersions.$inferSelect>
  session: typeof sessions.$inferSelect
  wizardEvents: SelectedEvent[]
  selectedEvents: SelectedEvent[]
  providerInput: CustomerStoryGenerationInput
  lockAt: Date
  now: Date
  concern: string
  rootCause: string
  action: string
  confidence: number
}

type LoadedContext = { ok: true; context: Context } | { ok: false; failure: Failure }

const fail = (error: CustomerStoryError, retryable?: boolean): Failure =>
  retryable === undefined ? { ok: false, error } : { ok: false, error, retryable }

export function customerStoryDomainStatus(result: { ok: boolean; error?: CustomerStoryError }): number {
  if (result.ok) return 200
  if (result.error === 'invalid_input' || result.error === 'invalid_evidence') return 422
  if (result.error === 'not_found') return 404
  if (result.error === 'forbidden') return 403
  if (result.error === 'provider_timeout') return 504
  if (result.error === 'provider_failed') return 502
  return 409
}

export function customerStoryErrorBody(result: Failure): { error: CustomerStoryError; retryable?: true } {
  return result.retryable ? { error: result.error, retryable: true } : { error: result.error }
}

function stableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return { __shopOsBigIntV1: value.toString() }
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite value')
    return value
  }
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, stableValue((value as Record<string, unknown>)[key])]),
  )
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')
}

function boundedRequiredText(value: unknown, max = MAX_CANONICAL_FIELD_BYTES): value is string {
  return typeof value === 'string' && value.length > 0 && utf8Bytes(value) <= max
}

function evidenceLabel(value: string): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`
}

function providerEvidence(events: SelectedEvent[]): CustomerStoryGenerationInput | null {
  const evidence: CustomerStoryGenerationInput['evidence'] = []
  for (const row of events) {
    if (row.eventType !== 'observation' || !boundedRequiredText(row.observationText, MAX_EVENT_BYTES)) return null
    evidence.push({
      sourceKind: 'event', sourceId: row.id,
      label: evidenceLabel(row.observationText), content: row.observationText,
    })
  }
  const input = { evidence }
  return utf8Bytes(JSON.stringify(input)) <= MAX_PROVIDER_BYTES ? input : null
}

function canWriteGeneratedStory(
  actor: Pick<typeof profiles.$inferSelect, 'id' | 'role' | 'skillTier'>,
  job: Pick<typeof ticketJobs.$inferSelect, 'assignedTechId' | 'requiredSkillTier'>,
): boolean {
  if (actor.role === 'advisor' || actor.role === 'owner') return true
  return actor.role === 'tech' &&
    job.assignedTechId === actor.id &&
    typeof actor.skillTier === 'number' &&
    actor.skillTier >= job.requiredSkillTier
}

async function databaseNow(db: AppDb): Promise<Date> {
  const result = await db.execute<{ now: string | Date }>(sql`select now() as "now"`)
  const rows = ('rows' in result ? result.rows : result) as Array<{ now: string | Date }>
  return new Date(rows[0].now)
}

async function loadGenerationContext(
  db: AppDb,
  input: Pick<GenerationInput, 'actor' | 'ticketId' | 'jobId' | 'sourceEventIds' | 'sourceArtifactIds'>,
): Promise<LoadedContext> {
  const [actor] = await db.select({
    id: profiles.id, shopId: profiles.shopId, role: profiles.role,
    skillTier: profiles.skillTier,
    membershipStatus: profiles.membershipStatus, deactivatedAt: profiles.deactivatedAt,
  }).from(profiles).where(eq(profiles.id, input.actor.profileId)).limit(1)
  if (!actor?.shopId) return { ok: false, failure: fail('not_found') }

  const [ticket] = await db.select().from(tickets).where(and(
    eq(tickets.id, input.ticketId), eq(tickets.shopId, actor.shopId),
  )).limit(1)
  const [targetJob] = await db.select().from(ticketJobs).where(and(
    eq(ticketJobs.id, input.jobId), eq(ticketJobs.ticketId, input.ticketId), eq(ticketJobs.shopId, actor.shopId),
  )).limit(1)
  if (!ticket || !targetJob || !targetJob.sessionId) return { ok: false, failure: fail('not_found') }
  const [session] = await db.select().from(sessions).where(and(
    eq(sessions.id, targetJob.sessionId), eq(sessions.shopId, actor.shopId),
  )).limit(1)
  if (!session) return { ok: false, failure: fail('not_found') }
  if (actor.membershipStatus !== 'active' || actor.deactivatedAt || !['tech', 'advisor', 'owner'].includes(actor.role)) {
    return { ok: false, failure: fail('forbidden') }
  }
  if (!canWriteGeneratedStory(actor, targetJob)) {
    return { ok: false, failure: fail('forbidden', false) }
  }
  if (
    ticket.status !== 'open' || targetJob.kind !== 'diagnostic' ||
    ['done', 'canceled'].includes(targetJob.workStatus) || session.status !== 'open'
  ) {
    return { ok: false, failure: fail('state_conflict', false) }
  }

  const tree = session.treeState as TreeState
  const lockAt = typeof tree?.diagnosisLockedAt === 'string' ? new Date(tree.diagnosisLockedAt) : new Date(Number.NaN)
  const now = await databaseNow(db)
  if (
    tree?.phase !== 'repairing' || tree.currentNodeId === '_topology' ||
    Number.isNaN(lockAt.getTime()) || lockAt.toISOString() !== tree.diagnosisLockedAt ||
    lockAt.getTime() > now.getTime() + MAX_LOCK_FUTURE_MS ||
    !boundedRequiredText(ticket.concern) || !boundedRequiredText(tree.rootCauseSummary) ||
    !boundedRequiredText(tree.proposedAction?.description) ||
    typeof tree.proposedAction?.confidence !== 'number' || !Number.isFinite(tree.proposedAction.confidence) ||
    tree.proposedAction.confidence < 0 || tree.proposedAction.confidence > 1
  ) return { ok: false, failure: fail('state_conflict', false) }

  const wizardEvents = await db.select().from(sessionEvents).where(and(
    eq(sessionEvents.sessionId, session.id), eq(sessionEvents.eventType, 'wizard_lock_in'),
  )).orderBy(sessionEvents.id)
  if (wizardEvents.length > 0) return { ok: false, failure: fail('unsupported_path', false) }
  if (tree.done !== true) return { ok: false, failure: fail('state_conflict', false) }

  const selectedEvents = input.sourceEventIds.length === 0 ? [] : await db.select().from(sessionEvents)
    .where(inArray(sessionEvents.id, input.sourceEventIds)).orderBy(sessionEvents.id)
  if (selectedEvents.length !== input.sourceEventIds.length) {
    return { ok: false, failure: fail('not_found') }
  }
  if (
    selectedEvents.some((row) => row.sessionId !== session.id || row.createdAt.getTime() > lockAt.getTime())
  ) return { ok: false, failure: fail('not_found') }
  const safeProviderInput = providerEvidence(selectedEvents)
  if (!safeProviderInput) return { ok: false, failure: fail('invalid_evidence') }

  const jobs = await db.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, actor.shopId), eq(ticketJobs.ticketId, ticket.id),
  )).orderBy(ticketJobs.id)
  const versions = await db.select().from(quoteVersions).where(and(
    eq(quoteVersions.shopId, actor.shopId), eq(quoteVersions.ticketId, ticket.id),
  )).orderBy(quoteVersions.id)
  if (versions.filter((version) => version.supersededAt === null).length > 1) {
    return { ok: false, failure: fail('conflict', false) }
  }
  return {
    ok: true,
    context: {
      actor, ticket, targetJob, jobs, versions, session, wizardEvents, selectedEvents,
      providerInput: safeProviderInput, lockAt, now, concern: ticket.concern,
      rootCause: tree.rootCauseSummary, action: tree.proposedAction.description,
      confidence: tree.proposedAction.confidence,
    },
  }
}

function requestFingerprint(context: Context, input: GenerationInput): string {
  return fingerprint({
    actorProfileId: context.actor.id,
    clientKey: input.clientKey,
    sourceEventIds: [...input.sourceEventIds].sort(),
    sourceArtifactIds: [...input.sourceArtifactIds].sort(),
    concern: context.concern,
    rootCause: context.rootCause,
    action: context.action,
    confidence: context.confidence,
    diagnosisLockedAt: context.lockAt,
    evidence: context.providerInput.evidence,
    reviewStatus: 'pending',
  })
}

type StoryMutationDiscovery = Readonly<{
  kind: 'ready' | 'not_found'
  separateChainIds: readonly string[]
  targetSessionId: string | null
  closureFingerprint: string | null
}>

function storyUuidList(values: readonly (string | null | undefined)[]): readonly string[] {
  return Object.freeze([...new Set(values.filter((value): value is string =>
    typeof value === 'string'))].sort())
}

function storyRowsById<T extends { id: string }>(rows: readonly T[]): readonly T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id))
}

function emptyStoryInsertionIntents() {
  return Object.freeze({
    sessions: Object.freeze([]),
    customers: Object.freeze([]),
    vehicles: Object.freeze([]),
    tickets: Object.freeze([]),
    jobs: Object.freeze([]),
  })
}

function storyActorOnlyRequest(
  shopId: string,
  actorProfileId: string,
): MutationLockRequestV1 {
  return Object.freeze({
    shopId,
    actorProfileId,
    profileIds: Object.freeze([actorProfileId]),
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
    insertionIntents: emptyStoryInsertionIntents(),
  })
}

function storyClosureFingerprint(input: Readonly<{
  profiles: readonly (typeof profiles.$inferSelect)[]
  customers: readonly (typeof customers.$inferSelect)[]
  vehicles: readonly (typeof vehicles.$inferSelect)[]
  tickets: readonly (typeof tickets.$inferSelect)[]
  jobs: readonly (typeof ticketJobs.$inferSelect)[]
  lines: readonly (typeof jobLines.$inferSelect)[]
  versions: readonly (typeof quoteVersions.$inferSelect)[]
  events: readonly (typeof quoteEvents.$inferSelect)[]
  sessions: readonly (typeof sessions.$inferSelect)[]
  sessionEvents: readonly SelectedEvent[]
  vendors: readonly (typeof vendorAccounts.$inferSelect)[]
}>): string {
  return fingerprint(input)
}

async function discoverStoryMutation(
  tx: AppDb,
  input: Readonly<{
    shopId: string
    actorProfileId: string
    ticketId: string
    jobId: string
  }>,
): Promise<Readonly<{
  lockRequest: MutationLockRequestV1
  payload: StoryMutationDiscovery
}>> {
  const [targetTicket] = await tx.select().from(tickets).where(and(
    eq(tickets.shopId, input.shopId),
    eq(tickets.id, input.ticketId),
  )).limit(1)
  const [targetJob] = targetTicket ? await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.shopId),
    eq(ticketJobs.ticketId, input.ticketId),
    eq(ticketJobs.id, input.jobId),
  )).limit(1) : []
  if (!targetTicket || !targetJob) return Object.freeze({
    lockRequest: storyActorOnlyRequest(input.shopId, input.actorProfileId),
    payload: Object.freeze({
      kind: 'not_found',
      separateChainIds: Object.freeze([]),
      targetSessionId: null,
      closureFingerprint: null,
    }),
  })

  const ticketRows = [targetTicket]
  const seenTicketIds = new Set([targetTicket.id])
  let parentId = targetTicket.separateFromTicketId
  while (parentId !== null) {
    if (ticketRows.length >= 64 || seenTicketIds.has(parentId)) {
      throw new ShopOsMutationConflict()
    }
    const [parent] = await tx.select().from(tickets).where(and(
      eq(tickets.shopId, input.shopId),
      eq(tickets.id, parentId),
    )).limit(1)
    if (!parent) throw new ShopOsMutationConflict()
    ticketRows.push(parent)
    seenTicketIds.add(parent.id)
    parentId = parent.separateFromTicketId
  }

  const ticketIds = storyUuidList(ticketRows.map(({ id }) => id))
  const jobs = await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.shopId),
    inArray(ticketJobs.ticketId, ticketIds),
  )).orderBy(ticketJobs.id)
  const jobIds = storyUuidList(jobs.map(({ id }) => id))
  const lines = jobIds.length === 0 ? [] : await tx.select().from(jobLines).where(and(
    eq(jobLines.shopId, input.shopId),
    inArray(jobLines.jobId, jobIds),
  )).orderBy(jobLines.id)
  const versions = await tx.select().from(quoteVersions).where(and(
    eq(quoteVersions.shopId, input.shopId),
    inArray(quoteVersions.ticketId, ticketIds),
  )).orderBy(quoteVersions.id)
  const events = await tx.select().from(quoteEvents).where(and(
    eq(quoteEvents.shopId, input.shopId),
    inArray(quoteEvents.ticketId, ticketIds),
  )).orderBy(quoteEvents.id)
  const sessionIds = storyUuidList(jobs.map(({ sessionId }) => sessionId))
  const sessionRows = sessionIds.length === 0 ? [] : await tx.select().from(sessions).where(and(
    eq(sessions.shopId, input.shopId),
    inArray(sessions.id, sessionIds),
  )).orderBy(sessions.id)
  const targetSessionEvents = targetJob.sessionId === null ? [] : await tx.select()
    .from(sessionEvents)
    .where(eq(sessionEvents.sessionId, targetJob.sessionId))
    .orderBy(sessionEvents.id)
  const vehicleIds = storyUuidList([
    ...ticketRows.map(({ vehicleId }) => vehicleId),
    ...sessionRows.map(({ vehicleId }) => vehicleId),
  ])
  const vehicleRows = vehicleIds.length === 0 ? [] : (await tx.select({ row: vehicles })
    .from(vehicles)
    .innerJoin(customers, eq(customers.id, vehicles.customerId))
    .where(and(
      eq(customers.shopId, input.shopId),
      inArray(vehicles.id, vehicleIds),
    )).orderBy(vehicles.id)).map(({ row }) => row)
  const customerIds = storyUuidList([
    ...ticketRows.map(({ customerId }) => customerId),
    ...vehicleRows.map(({ customerId }) => customerId),
  ])
  const customerRows = customerIds.length === 0 ? [] : await tx.select().from(customers).where(and(
    eq(customers.shopId, input.shopId),
    inArray(customers.id, customerIds),
  )).orderBy(customers.id)
  const vendorAccountIds = storyUuidList(lines.map(({ vendorAccountId }) => vendorAccountId))
  const vendorRows = vendorAccountIds.length === 0 ? [] : await tx.select().from(vendorAccounts)
    .where(and(
      eq(vendorAccounts.shopId, input.shopId),
      inArray(vendorAccounts.id, vendorAccountIds),
    )).orderBy(vendorAccounts.id)
  const profileIds = storyUuidList([
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
    ...targetSessionEvents.map(({ requestActorProfileId }) => requestActorProfileId),
    ...versions.map(({ createdByProfileId }) => createdByProfileId),
    ...events.map(({ actorProfileId }) => actorProfileId),
  ])
  const profileRows = await tx.select().from(profiles).where(and(
    eq(profiles.shopId, input.shopId),
    inArray(profiles.id, profileIds),
  )).orderBy(profiles.id)
  const closureFingerprint = storyClosureFingerprint({
    profiles: storyRowsById(profileRows),
    customers: storyRowsById(customerRows),
    vehicles: storyRowsById(vehicleRows),
    tickets: storyRowsById(ticketRows),
    jobs: storyRowsById(jobs),
    lines: storyRowsById(lines),
    versions: storyRowsById(versions),
    events: storyRowsById(events),
    sessions: storyRowsById(sessionRows),
    sessionEvents: storyRowsById(targetSessionEvents),
    vendors: storyRowsById(vendorRows),
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
      sessionEventIds: storyUuidList(targetSessionEvents.map(({ id }) => id)),
      vendorAccountIds,
      cannedJobIds: Object.freeze([]),
      receiptRequestKey: null,
      receiptConditionalInsert: null,
      insertionIntents: emptyStoryInsertionIntents(),
    }),
    payload: Object.freeze({
      kind: 'ready',
      separateChainIds: Object.freeze(ticketRows.map(({ id }) => id)),
      targetSessionId: targetJob.sessionId,
      closureFingerprint,
    }),
  })
}

function resolveStoryMutationScope(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  discovery: StoryMutationDiscovery,
  ticketId: string,
  jobId: string,
): Readonly<{
  graph: LockedMutationScopeV1['tickets'][number]
  targetJob: LockedMutationScopeV1['tickets'][number]['jobs'][number]
  targetSession: (typeof sessions.$inferSelect) | null
  targetSessionEvents: readonly SelectedEvent[]
}> {
  assertLiveLockedMutationScopeV1(tx, scope)
  if (discovery.kind === 'not_found') throw new ShopOsMutationNotFound()
  if (
    !['tech', 'advisor', 'owner'].includes(scope.actor.role) ||
    scope.profiles.length !== scope.request.profileIds.length ||
    scope.profiles.some(({ id, shopId }) =>
      shopId !== scope.actor.shopId || !scope.request.profileIds.includes(id))
  ) throw new ShopOsMutationNotFound()

  const graphById = new Map(scope.tickets.map((graph) => [graph.ticket.id, graph] as const))
  if (
    discovery.separateChainIds.length < 1 || discovery.separateChainIds[0] !== ticketId ||
    discovery.separateChainIds.length !== scope.tickets.length ||
    new Set(discovery.separateChainIds).size !== discovery.separateChainIds.length
  ) throw new ShopOsMutationConflict()
  for (let index = 0; index < discovery.separateChainIds.length; index += 1) {
    const graph = graphById.get(discovery.separateChainIds[index]!)
    if (!graph || graph.ticket.separateFromTicketId !==
      (discovery.separateChainIds[index + 1] ?? null)) throw new ShopOsMutationConflict()
  }

  const lockedFingerprint = storyClosureFingerprint({
    profiles: storyRowsById(scope.profiles),
    customers: storyRowsById(scope.customers),
    vehicles: storyRowsById(scope.vehicles),
    tickets: storyRowsById(scope.tickets.map(({ ticket }) => ticket)),
    jobs: storyRowsById(scope.tickets.flatMap(({ jobs }) => jobs)),
    lines: storyRowsById(scope.tickets.flatMap(({ lines }) => lines)),
    versions: storyRowsById(scope.tickets.flatMap(({ versions }) => versions)),
    events: storyRowsById(scope.tickets.flatMap(({ events }) => events)),
    sessions: storyRowsById(scope.sessions),
    sessionEvents: storyRowsById(scope.sessionEvents),
    vendors: storyRowsById(scope.vendorAccounts),
  })
  if (lockedFingerprint !== discovery.closureFingerprint) throw new ShopOsMutationConflict()

  const graph = graphById.get(ticketId)
  const targetJob = graph?.jobs.find(({ id }) => id === jobId)
  if (!graph || !targetJob || targetJob.sessionId !== discovery.targetSessionId) {
    throw new ShopOsMutationConflict()
  }
  const targetSession = discovery.targetSessionId === null
    ? null
    : scope.sessions.find(({ id }) => id === discovery.targetSessionId) ?? null
  if ((discovery.targetSessionId === null) !== (targetSession === null)) {
    throw new ShopOsMutationConflict()
  }
  return Object.freeze({ graph, targetJob, targetSession, targetSessionEvents: scope.sessionEvents })
}

function safeStory(value: unknown): CustomerStory | null {
  return parsePersistedCustomerStory(value)
}

function safePersistedMeta(value: unknown): CustomerStoryMeta | null {
  return parsePersistedCustomerStoryMeta(value)
}

function workspaceMeta(value: CustomerStoryMeta): SafeStoryMeta {
  return {
    source: value.source,
    ...(value.sessionId ? { sessionId: value.sessionId } : {}),
    ...(value.generatedAt ? { generatedAt: value.generatedAt } : {}),
    lastEditedByProfileId: value.lastEditedByProfileId,
    lastEditedAt: value.lastEditedAt,
    ...(value.reviewStatus ? { reviewStatus: value.reviewStatus } : {}),
  }
}

function persistedRevision(meta: unknown): number {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return 0
  const revision = (meta as Partial<CustomerStoryMeta>).storyRevision
  return typeof revision === 'number' && Number.isInteger(revision) && revision >= 0 ? revision : 0
}

type Cursor = { kind: 'event'; sessionId: string; createdAt: Date; id: string }
function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ v: 1, k: cursor.kind, s: cursor.sessionId, t: cursor.createdAt.toISOString(), i: cursor.id })).toString('base64url')
}

function parseCursor(raw: string | undefined, kind: Cursor['kind']): Cursor | null | false {
  if (raw === undefined) return null
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Record<string, unknown>
    if (Object.keys(value).sort().join(',') !== 'i,k,s,t,v' || value.v !== 1 || value.k !== kind || typeof value.s !== 'string' || typeof value.t !== 'string' || typeof value.i !== 'string') return false
    const id = uuidSchema.safeParse(value.i)
    const sessionId = uuidSchema.safeParse(value.s)
    const createdAt = new Date(value.t)
    if (!id.success || !sessionId.success || Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== value.t) return false
    if (encodeCursor({ kind, sessionId: sessionId.data, createdAt, id: id.data }) !== raw) return false
    return { kind, sessionId: sessionId.data, createdAt, id: id.data }
  } catch {
    return false
  }
}

function cursorCondition(columnDate: typeof sessionEvents.createdAt, columnId: typeof sessionEvents.id, cursor: Cursor | null) {
  return cursor ? or(lt(columnDate, cursor.createdAt), and(eq(columnDate, cursor.createdAt), lt(columnId, cursor.id))) : undefined
}

type EligiblePage<T> = { rows: T[]; nextCursor: string | null }

async function eligibleEventPage(db: AppDb, sessionId: string, lockAt: Date, initialCursor: Cursor | null, dependencies: CustomerStoryWorkspaceDependencies): Promise<EligiblePage<SelectedEvent>> {
  const eligible: SelectedEvent[] = []
  let scanCursor = initialCursor
  let lastRaw: SelectedEvent | null = null
  let capped = false
  let exhausted = false
  for (let chunk = 0; chunk < MAX_WORKSPACE_SCAN_CHUNKS && eligible.length < PAGE_SIZE + 1; chunk += 1) {
    dependencies.onEvidenceQuery?.('event')
    const rows = await db.select().from(sessionEvents).where(and(
      eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.eventType, 'observation'),
      sql`${sessionEvents.createdAt} <= ${lockAt}`,
      cursorCondition(sessionEvents.createdAt, sessionEvents.id, scanCursor),
    )).orderBy(desc(sessionEvents.createdAt), desc(sessionEvents.id)).limit(WORKSPACE_SCAN_CHUNK)
    lastRaw = rows.at(-1) ?? lastRaw
    eligible.push(...rows.filter((row) => providerEvidence([row]) !== null))
    if (rows.length < WORKSPACE_SCAN_CHUNK) {
      exhausted = true
      break
    }
    const last = rows[rows.length - 1]
    scanCursor = { kind: 'event', sessionId, createdAt: last.createdAt, id: last.id }
    capped = chunk === MAX_WORKSPACE_SCAN_CHUNKS - 1
  }
  const rows = eligible.slice(0, PAGE_SIZE)
  const nextCursor = eligible.length > PAGE_SIZE
    ? encodeCursor({ kind: 'event', sessionId, createdAt: rows[PAGE_SIZE - 1].createdAt, id: rows[PAGE_SIZE - 1].id })
    : capped && eligible.length < PAGE_SIZE && lastRaw
      ? encodeCursor({ kind: 'event', sessionId, createdAt: lastRaw.createdAt, id: lastRaw.id })
      : eligible.length === PAGE_SIZE && !exhausted
        ? encodeCursor({ kind: 'event', sessionId, createdAt: rows[PAGE_SIZE - 1].createdAt, id: rows[PAGE_SIZE - 1].id })
        : null
  return { rows, nextCursor }
}


export async function getCustomerStoryWorkspace(db: AppDb, rawInput: unknown, dependencies: CustomerStoryWorkspaceDependencies = {}): Promise<CustomerStoryWorkspaceResult> {
  const parsed = workspaceInputSchema.safeParse(rawInput)
  if (!parsed.success) return fail('invalid_input')
  const eventCursor = parseCursor(parsed.data.eventCursor, 'event')
  if (eventCursor === false) return fail('invalid_input')
  const loaded = await loadGenerationContext(db, { ...parsed.data, sourceEventIds: [], sourceArtifactIds: [] })
  if (!loaded.ok) return loaded.failure
  const context = loaded.context
  if (eventCursor && eventCursor.sessionId !== context.session.id) return fail('invalid_input')

  const eventPage = await eligibleEventPage(db, context.session.id, context.lockAt, eventCursor, dependencies)
  const pageEvents = eventPage.rows
  const story = context.targetJob.customerStory === null ? null : safeStory(context.targetJob.customerStory)
  const persistedMeta = context.targetJob.storyMeta === null ? null : safePersistedMeta(context.targetJob.storyMeta)
  const storyMeta = persistedMeta === null ? null : workspaceMeta(persistedMeta)
  if ((context.targetJob.customerStory !== null && !story) || (context.targetJob.storyMeta !== null && !storyMeta)) return fail('conflict', false)
  return {
    ok: true,
    workspace: {
      story,
      storyMeta,
      storyRevision: persistedRevision(context.targetJob.storyMeta),
      evidence: {
        events: pageEvents.map((row) => ({ id: row.id, kind: 'observation', createdAt: row.createdAt.toISOString(), label: evidenceLabel(row.observationText!) })),
        artifacts: [],
        nextEventCursor: eventPage.nextCursor,
        nextArtifactCursor: null,
      },
    },
  }
}

function commonWordOnly(value: string): boolean {
  const common = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'had', 'has',
    'have', 'he', 'her', 'his', 'i', 'if', 'in', 'is', 'it', 'its', 'not', 'of', 'on', 'or',
    'our', 'she', 'so', 'that', 'the', 'their', 'them', 'then', 'there', 'they', 'this', 'to',
    'was', 'we', 'were', 'with', 'you', 'your',
  ])
  const words = value.match(/[\p{L}\p{N}]+(?:[.-][\p{L}\p{N}]+)*/gu) ?? []
  return words.length === 0 || words.every((word) => common.has(word.toLocaleLowerCase()))
}

function assembleStory(context: Context, selected: GeneratedEvidenceSelection): CustomerStory | null {
  const parsedSelection = z.strictObject({
    selections: z.array(z.strictObject({
      sourceKind: z.literal('event'), sourceId: uuidSchema, excerpt: z.string(),
    })).max(5),
  }).safeParse(selected)
  if (!parsedSelection.success) return null
  const sources = new Map(context.providerInput.evidence.map((row) => [`${row.sourceKind}:${row.sourceId}`, row.content]))
  const rawSources = new Map<string, readonly string[]>(
    context.selectedEvents.map((row) => [`event:${row.id}`, [row.observationText!]] as const),
  )
  const identities = new Set<string>()
  const howWeKnow: CustomerStory['howWeKnow'] = []
  for (const selection of parsedSelection.data.selections) {
    const identity = `${selection.sourceKind}:${selection.sourceId}`
    const source = sources.get(identity)
    const words = selection.excerpt.trim().split(/\s+/u)
    if (
      identities.has(identity) || !source ||
      !rawSources.get(identity)?.some((raw) => raw.includes(selection.excerpt)) ||
      utf8Bytes(selection.excerpt) < 12 || utf8Bytes(selection.excerpt) > 2_000 ||
      words.length < 3 || commonWordOnly(selection.excerpt) || !source.includes(selection.excerpt)
    ) return null
    identities.add(identity)
    howWeKnow.push({
      claim: selection.excerpt,
      sourceEventIds: [selection.sourceId],
      sourceArtifactIds: [],
    })
  }
  return {
    whatYouToldUs: context.concern,
    whatWeFound: context.rootCause,
    howWeKnow,
    whatItMeansIfWaived: CUSTOMER_STORY_WAIVER,
    whatWeRecommend: context.action,
  }
}

class AbortGeneration extends Error {
  constructor(readonly failure: Failure) {
    super('abort_customer_story_generation')
  }
}

function providerFailure(error: unknown): Failure {
  return error instanceof CustomerStoryProviderError && error.kind === 'timeout'
    ? fail('provider_timeout')
    : fail('provider_failed')
}

function lockUnavailable(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'code' in current && current.code === '55P03') return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

async function lockedGenerationContext(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  discovery: StoryMutationDiscovery,
  input: GenerationInput,
): Promise<Context> {
  const resolved = resolveStoryMutationScope(
    tx, scope, discovery, input.ticketId, input.jobId,
  )
  const { graph, targetJob, targetSession, targetSessionEvents } = resolved
  const actor = scope.profiles.find(({ id }) => id === scope.actor.id)
  if (!actor || !targetSession) throw new ShopOsMutationConflict()
  if (!canWriteGeneratedStory(actor, targetJob)) throw new ShopOsMutationConflict()
  if (
    graph.ticket.status !== 'open' || targetJob.kind !== 'diagnostic' ||
    ['done', 'canceled'].includes(targetJob.workStatus) || targetSession.status !== 'open'
  ) throw new AbortGeneration(fail('state_conflict', false))

  const tree = targetSession.treeState as TreeState
  const lockAt = typeof tree?.diagnosisLockedAt === 'string'
    ? new Date(tree.diagnosisLockedAt)
    : new Date(Number.NaN)
  const now = await databaseNow(tx)
  if (
    tree?.phase !== 'repairing' || tree.currentNodeId === '_topology' ||
    Number.isNaN(lockAt.getTime()) || lockAt.toISOString() !== tree.diagnosisLockedAt ||
    lockAt.getTime() > now.getTime() + MAX_LOCK_FUTURE_MS ||
    !boundedRequiredText(graph.ticket.concern) || !boundedRequiredText(tree.rootCauseSummary) ||
    !boundedRequiredText(tree.proposedAction?.description) ||
    typeof tree.proposedAction?.confidence !== 'number' ||
    !Number.isFinite(tree.proposedAction.confidence) ||
    tree.proposedAction.confidence < 0 || tree.proposedAction.confidence > 1 ||
    tree.done !== true
  ) throw new AbortGeneration(fail('state_conflict', false))

  const wizardEvents = targetSessionEvents.filter(({ eventType }) =>
    eventType === 'wizard_lock_in')
  if (wizardEvents.length > 0) {
    throw new AbortGeneration(fail('unsupported_path', false))
  }
  const selectedById = new Map(targetSessionEvents.map((event) => [event.id, event] as const))
  const selectedEvents = input.sourceEventIds.map((id) => selectedById.get(id))
  if (selectedEvents.some((event) => !event)) throw new AbortGeneration(fail('not_found'))
  const exactSelectedEvents = selectedEvents as SelectedEvent[]
  if (exactSelectedEvents.some((row) => row.createdAt.getTime() > lockAt.getTime())) {
    throw new AbortGeneration(fail('not_found'))
  }
  const safeProviderInput = providerEvidence(exactSelectedEvents)
  if (!safeProviderInput) throw new AbortGeneration(fail('invalid_evidence'))
  if (graph.versions.filter(({ supersededAt }) => supersededAt === null).length > 1) {
    throw new AbortGeneration(fail('conflict', false))
  }
  return {
    actor,
    ticket: graph.ticket,
    targetJob,
    jobs: [...graph.jobs],
    versions: [...graph.versions],
    session: targetSession,
    wizardEvents,
    selectedEvents: exactSelectedEvents,
    providerInput: safeProviderInput,
    lockAt,
    now,
    concern: graph.ticket.concern,
    rootCause: tree.rootCauseSummary,
    action: tree.proposedAction.description,
    confidence: tree.proposedAction.confidence,
  }
}

export async function generateAndSaveCustomerStory(
  db: AppDb,
  rawInput: unknown,
  dependencies: CustomerStoryGenerationDependencies,
): Promise<CustomerStoryGenerationResult> {
  const parsed = generationInputSchema.safeParse(rawInput)
  if (!parsed.success) return fail('invalid_input')
  const input = parsed.data
  const preflight = await loadGenerationContext(db, input)
  if (!preflight.ok) return preflight.failure
  const initial = preflight.context
  let initialDiscovery: Awaited<ReturnType<typeof discoverStoryMutation>>
  try {
    initialDiscovery = await discoverStoryMutation(db, {
      shopId: initial.actor.shopId!,
      actorProfileId: initial.actor.id,
      ticketId: input.ticketId,
      jobId: input.jobId,
    })
  } catch (error) {
    if (error instanceof ShopOsMutationConflict) return fail('conflict', true)
    throw error
  }
  if (
    initialDiscovery.payload.kind !== 'ready' ||
    initialDiscovery.payload.closureFingerprint === null
  ) return fail('not_found')
  const initialClosureFingerprint = initialDiscovery.payload.closureFingerprint
  const request = requestFingerprint(initial, input)
  const rawCurrentMeta = initial.targetJob.storyMeta
  const currentMeta = rawCurrentMeta === null ? null : safePersistedMeta(rawCurrentMeta)
  if (rawCurrentMeta !== null && !currentMeta) return fail('conflict', false)
  const replayCandidate = Boolean(
    currentMeta && 'generationClientKey' in currentMeta &&
    currentMeta.generationClientKey === input.clientKey,
  )
  if (!replayCandidate && persistedRevision(currentMeta) !== input.expectedStoryRevision) {
    return fail('conflict', false)
  }

  let story: CustomerStory | null = null
  if (!replayCandidate) {
    let selections: GeneratedEvidenceSelection
    try {
      selections = initial.providerInput.evidence.length === 0
        ? { selections: [] }
        : await dependencies.generateCustomerStory(initial.providerInput)
    } catch (error) {
      return providerFailure(error)
    }
    story = assembleStory(initial, selections)
    if (!story) return fail('provider_failed')
    await dependencies.beforeFinalTransaction?.()
  }

  try {
    return await runBoundedShopOsMutationV1<
      CustomerStoryGenerationResult,
      StoryMutationDiscovery
    >(db, {
      discover: async (tx) => discoverStoryMutation(tx, {
        shopId: initial.actor.shopId!,
        actorProfileId: initial.actor.id,
        ticketId: input.ticketId,
        jobId: input.jobId,
      }),
      executeLocked: async (tx, scope, discovery) => {
      assertLiveLockedMutationScopeV1(tx, scope)
      await dependencies.afterLocks?.()
      const context = await lockedGenerationContext(tx, scope, discovery, input)
      if (
        discovery.closureFingerprint !== initialClosureFingerprint ||
        requestFingerprint(context, input) !== request
      ) throw new ShopOsMutationConflict()
      const rawLockedMeta = context.targetJob.storyMeta
      const lockedMeta = rawLockedMeta === null ? null : safePersistedMeta(rawLockedMeta)
      if (rawLockedMeta !== null && !lockedMeta) throw new AbortGeneration(fail('conflict', false))
      if (lockedMeta && 'generationClientKey' in lockedMeta && lockedMeta.generationClientKey === input.clientKey) {
        if (lockedMeta.generatedByProfileId !== context.actor.id || lockedMeta.generationRequestFingerprint !== request) throw new AbortGeneration(fail('conflict', false))
        const lockedStory = safeStory(context.targetJob.customerStory)
        if (!lockedStory) throw new AbortGeneration(fail('conflict', false))
        return { ok: true as const, changed: false, story: lockedStory, storyMeta: lockedMeta, storyRevision: persistedRevision(lockedMeta) }
      }
      if (replayCandidate || !story) throw new AbortGeneration(fail('conflict', false))
      const lockedRevision = persistedRevision(lockedMeta)
      if (lockedRevision !== input.expectedStoryRevision) throw new AbortGeneration(fail('conflict', false))
      const previousStory = context.targetJob.customerStory === null ? null : safeStory(context.targetJob.customerStory)
      if (context.targetJob.customerStory !== null && !previousStory) throw new AbortGeneration(fail('conflict', false))
      const changed = previousStory === null || fingerprint(previousStory) !== fingerprint(story)
      const nextRevision = changed ? lockedRevision + 1 : lockedRevision
      const generatedAt = context.now.toISOString()
      const storyMeta: CustomerStoryMeta = {
        source: 'ai', sessionId: context.session.id, generatedAt,
        lastEditedByProfileId: context.actor.id, lastEditedAt: generatedAt,
        generationClientKey: input.clientKey, generationRequestFingerprint: request,
        generatedByProfileId: context.actor.id, storyRevision: nextRevision,
        reviewStatus: 'pending',
      }
      await tx.update(ticketJobs).set({ customerStory: story, storyMeta, updatedAt: context.now })
        .where(and(eq(ticketJobs.id, input.jobId), eq(ticketJobs.ticketId, input.ticketId), eq(ticketJobs.shopId, context.actor.shopId!)))
      let changedJobIds = [context.targetJob.id]
      if (changed) {
        const invalidation = await invalidateActiveQuoteVersionDeltaV1(tx, {
          shopId: context.actor.shopId!, ticketId: input.ticketId,
          jobIds: context.jobs.map((job) => job.id),
          activeVersions: context.versions.filter((version) => version.supersededAt === null),
          scope,
        })
        if ('ok' in invalidation) throw new AbortGeneration(invalidation)
        changedJobIds = [...new Set([...changedJobIds, ...invalidation.changedJobIds])]
      }
      await dependencies.afterWrite?.()
      await finalizeMutationRevisionsV1(tx, scope, {
        sessionIds: [], customerIds: [], vehicleIds: [],
      }, [{
        ticketId: input.ticketId,
        createdTicket: false,
        createdJobIds: [],
        existingChangedJobIds: changedJobIds,
        actorVisibleTicketFieldsChanged: true,
      }])
      await dependencies.afterFinalization?.()
      return { ok: true as const, changed, story, storyMeta, storyRevision: nextRevision }
      },
    })
  } catch (error) {
    if (error instanceof AbortGeneration) return error.failure
    if (error instanceof ShopOsMutationNotFound || error instanceof ShopOsMutationConflict) {
      return fail('conflict', true)
    }
    throw error
  }
}

type ReviewInput = z.infer<typeof reviewInputSchema>
type ReviewContext = {
  actor: Pick<typeof profiles.$inferSelect, 'id' | 'shopId' | 'role' | 'membershipStatus' | 'deactivatedAt'>
  ticket: typeof tickets.$inferSelect
  targetJob: typeof ticketJobs.$inferSelect
  jobs: Array<typeof ticketJobs.$inferSelect>
  versions: Array<typeof quoteVersions.$inferSelect>
  session: typeof sessions.$inferSelect
  wizardEvents: SelectedEvent[]
  now: Date
}

export type CustomerStoryReviewResult =
  | {
      ok: true
      changed: boolean
      story: CustomerStory
      storyMeta: CustomerStoryMeta
      storyRevision: number
    }
  | Failure

type ReviewBinding = {
  source: 'ai' | 'manual'
  // null for the sessionless manual-findings path (diagnostic job with no
  // session — shops without the diagnostics add-on).
  sessionId: string | null
  concern: string
  waiver: string
  proof: CustomerStory['howWeKnow']
  generation: null | {
    generatedAt: string
    generationClientKey: string
    generationRequestFingerprint: string
    generatedByProfileId: string
  }
}

function reviewRequestFingerprint(input: ReviewInput, binding: ReviewBinding): string {
  return fingerprint({
    actorProfileId: input.actor.profileId,
    ticketId: input.ticketId,
    jobId: input.jobId,
    clientKey: input.clientKey,
    expectedStoryRevision: input.expectedStoryRevision,
    whatWeFound: input.whatWeFound,
    whatWeRecommend: input.whatWeRecommend,
    binding,
  })
}

async function loadReviewContext(db: AppDb, input: ReviewInput): Promise<{ ok: true; context: ReviewContext } | { ok: false; failure: Failure }> {
  const [actor] = await db.select({
    id: profiles.id, shopId: profiles.shopId, role: profiles.role,
    membershipStatus: profiles.membershipStatus, deactivatedAt: profiles.deactivatedAt,
  }).from(profiles).where(eq(profiles.id, input.actor.profileId)).limit(1)
  if (!actor?.shopId) return { ok: false, failure: fail('not_found') }

  const [ticket] = await db.select().from(tickets).where(and(
    eq(tickets.id, input.ticketId), eq(tickets.shopId, actor.shopId),
  )).limit(1)
  const [targetJob] = await db.select().from(ticketJobs).where(and(
    eq(ticketJobs.id, input.jobId), eq(ticketJobs.ticketId, input.ticketId), eq(ticketJobs.shopId, actor.shopId),
  )).limit(1)
  if (!ticket || !targetJob || !targetJob.sessionId) return { ok: false, failure: fail('not_found') }
  const [session] = await db.select().from(sessions).where(and(
    eq(sessions.id, targetJob.sessionId), eq(sessions.shopId, actor.shopId),
  )).limit(1)
  if (!session) return { ok: false, failure: fail('not_found') }
  if (actor.membershipStatus !== 'active' || actor.deactivatedAt || !['tech', 'advisor', 'owner'].includes(actor.role)) {
    return { ok: false, failure: fail('forbidden') }
  }
  if (
    ticket.status !== 'open' || targetJob.kind !== 'diagnostic' ||
    !['open', 'in_progress', 'blocked'].includes(targetJob.workStatus) || session.status !== 'open'
  ) return { ok: false, failure: fail('state_conflict', false) }

  const [jobs, versions, wizardEvents, now] = await Promise.all([
    db.select().from(ticketJobs).where(and(
      eq(ticketJobs.shopId, actor.shopId), eq(ticketJobs.ticketId, ticket.id),
    )).orderBy(ticketJobs.id),
    db.select().from(quoteVersions).where(and(
      eq(quoteVersions.shopId, actor.shopId), eq(quoteVersions.ticketId, ticket.id),
    )).orderBy(quoteVersions.id),
    db.select().from(sessionEvents).where(and(
      eq(sessionEvents.sessionId, session.id), eq(sessionEvents.eventType, 'wizard_lock_in'),
    )).orderBy(sessionEvents.id),
    databaseNow(db),
  ])
  if (versions.filter((version) => version.supersededAt === null).length > 1) {
    return { ok: false, failure: fail('conflict', false) }
  }
  return { ok: true, context: { actor, ticket, targetJob, jobs, versions, session, wizardEvents, now } }
}

async function lockReviewContext(
  db: AppDb,
  input: ReviewInput,
  sessionId: string,
  shopId: string,
  dependencies: CustomerStoryReviewDependencies,
): Promise<void> {
  const ticketQuery = db.select().from(tickets).where(and(eq(tickets.id, input.ticketId), eq(tickets.shopId, shopId))).limit(1).for('update', { noWait: true })
  const jobsQuery = db.select().from(ticketJobs).where(and(eq(ticketJobs.ticketId, input.ticketId), eq(ticketJobs.shopId, shopId))).orderBy(ticketJobs.id).for('update', { noWait: true })
  const versionsQuery = db.select().from(quoteVersions).where(and(eq(quoteVersions.ticketId, input.ticketId), eq(quoteVersions.shopId, shopId))).orderBy(quoteVersions.id).for('update', { noWait: true })
  const sessionQuery = db.select().from(sessions).where(and(eq(sessions.id, sessionId), eq(sessions.shopId, shopId))).limit(1).for('update', { noWait: true })
  const actorQuery = db.select().from(profiles).where(and(eq(profiles.id, input.actor.profileId), eq(profiles.shopId, shopId))).limit(1).for('update', { noWait: true })
  dependencies.captureLockSql?.(
    [ticketQuery, jobsQuery, versionsQuery, sessionQuery, actorQuery].map((query) => query.toSQL().sql),
  )
  await ticketQuery
  await jobsQuery
  await versionsQuery
  await sessionQuery
  await actorQuery
}

class AbortReview extends Error {
  constructor(readonly failure: Failure) {
    super('abort_customer_story_review')
  }
}

function validateReviewBinding(
  context: ReviewContext,
  story: CustomerStory | null,
  meta: CustomerStoryMeta | null,
): { ok: true; source: 'ai' | 'manual'; binding: ReviewBinding } | { ok: false; failure: Failure } {
  const concern = customerStoryReviewTextSchema.safeParse(context.ticket.concern)
  if (!concern.success || concern.data !== context.ticket.concern) {
    return { ok: false, failure: fail('state_conflict', false) }
  }
  const tree = context.session.treeState as TreeState
  const topology = tree?.done === true && tree.currentNodeId === '_topology'
  if (context.wizardEvents.length > 0) {
    return { ok: false, failure: fail('unsupported_path', false) }
  }

  if (!story && !meta) {
    if (!topology) return { ok: false, failure: fail('unsupported_path', false) }
    return {
      ok: true,
      source: 'manual',
      binding: {
        source: 'manual', sessionId: context.session.id, concern: context.ticket.concern,
        waiver: CUSTOMER_STORY_WAIVER, proof: [], generation: null,
      },
    }
  }
  if (!story || !meta) return { ok: false, failure: fail('conflict', false) }

  if (meta.source === 'ai') {
    if (
      tree?.done !== true || tree.phase !== 'repairing' || topology ||
      meta.sessionId !== context.session.id
    ) return { ok: false, failure: fail('unsupported_path', false) }
    if (
      story.whatYouToldUs !== context.ticket.concern || story.whatItMeansIfWaived !== CUSTOMER_STORY_WAIVER ||
      !meta.generatedAt || !meta.generationClientKey || !meta.generationRequestFingerprint ||
      !meta.generatedByProfileId
    ) return { ok: false, failure: fail('conflict', false) }
    return {
      ok: true,
      source: 'ai',
      binding: {
        source: 'ai', sessionId: context.session.id, concern: context.ticket.concern,
        waiver: CUSTOMER_STORY_WAIVER, proof: story.howWeKnow,
        generation: {
          generatedAt: meta.generatedAt,
          generationClientKey: meta.generationClientKey,
          generationRequestFingerprint: meta.generationRequestFingerprint,
          generatedByProfileId: meta.generatedByProfileId,
        },
      },
    }
  }

  if (meta.source === 'manual') {
    if (!topology) {
      return { ok: false, failure: fail('unsupported_path', false) }
    }
    if (meta.sessionId !== context.session.id) {
      return { ok: false, failure: fail('conflict', false) }
    }
    if (
      meta.reviewStatus !== 'reviewed' || meta.storyRevision === undefined || meta.storyRevision < 1 ||
      !meta.reviewClientKey || !meta.reviewRequestFingerprint || !meta.reviewedByProfileId || !meta.reviewedAt ||
      story.whatYouToldUs !== context.ticket.concern || story.whatItMeansIfWaived !== CUSTOMER_STORY_WAIVER ||
      story.howWeKnow.length > 0
    ) return { ok: false, failure: fail('conflict', false) }
    return {
      ok: true,
      source: 'manual',
      binding: {
        source: 'manual', sessionId: context.session.id, concern: context.ticket.concern,
        waiver: CUSTOMER_STORY_WAIVER, proof: [], generation: null,
      },
    }
  }
  return { ok: false, failure: fail('unsupported_path', false) }
}

export async function saveReviewedCustomerStory(
  db: AppDb,
  rawInput: unknown,
  dependencies: CustomerStoryReviewDependencies = {},
): Promise<CustomerStoryReviewResult> {
  const parsed = reviewInputSchema.safeParse(rawInput)
  if (!parsed.success) return fail('invalid_input')
  const input = parsed.data
  const [preflightActor] = await db.select({ shopId: profiles.shopId }).from(profiles)
    .where(eq(profiles.id, input.actor.profileId)).limit(1)
  if (!preflightActor?.shopId) return fail('not_found')
  const preflightShopId = preflightActor.shopId
  const [preflightJob] = await db.select({ sessionId: ticketJobs.sessionId }).from(ticketJobs).where(and(
    eq(ticketJobs.id, input.jobId), eq(ticketJobs.ticketId, input.ticketId),
    eq(ticketJobs.shopId, preflightShopId),
  )).limit(1)
  if (!preflightJob) return fail('not_found')
  // Sessionless diagnostic job → manual findings (the Record-findings path
  // for shops without the diagnostics add-on). Writes the exact story shape
  // the session-bound paths write; downstream never knows which path filled
  // it. Everything with a session keeps the existing session-bound flow.
  if (!preflightJob.sessionId) {
    return saveManualFindingsStory(db, input, preflightShopId, dependencies)
  }
  try {
    return await db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      await lockReviewContext(
        transactionDb, input, preflightJob.sessionId!, preflightShopId, dependencies,
      )
      await dependencies.afterLocks?.()
      const loaded = await loadReviewContext(transactionDb, input)
      if (!loaded.ok) throw new AbortReview(loaded.failure)
      const context = loaded.context
      if (context.session.id !== preflightJob.sessionId) throw new AbortReview(fail('conflict', true))

      const rawMeta = context.targetJob.storyMeta
      const persistedMeta = rawMeta === null ? null : safePersistedMeta(rawMeta)
      const persistedStory = context.targetJob.customerStory === null ? null : safeStory(context.targetJob.customerStory)
      if (
        (rawMeta !== null && !persistedMeta) ||
        (context.targetJob.customerStory !== null && !persistedStory) ||
        (persistedMeta === null) !== (persistedStory === null)
      ) throw new AbortReview(fail('conflict', false))

      const validated = validateReviewBinding(context, persistedStory, persistedMeta)
      if (!validated.ok) throw new AbortReview(validated.failure)
      const reviewableStory = validated.source === 'ai' && persistedStory
        ? {
            ...persistedStory,
            howWeKnow: persistedStory.howWeKnow.filter(
              (claim) => claim.sourceArtifactIds.length === 0,
            ),
          }
        : persistedStory
      const requestBinding = validated.source === 'ai' && reviewableStory
        ? { ...validated.binding, proof: reviewableStory.howWeKnow }
        : validated.binding
      const request = reviewRequestFingerprint(input, requestBinding)

      if (persistedMeta?.reviewClientKey === input.clientKey) {
        if (persistedMeta.reviewedByProfileId !== context.actor.id || persistedMeta.reviewRequestFingerprint !== request || !persistedStory) {
          throw new AbortReview(fail('conflict', false))
        }
        return {
          ok: true as const, changed: false, story: persistedStory, storyMeta: persistedMeta,
          storyRevision: persistedRevision(persistedMeta),
        }
      }

      const revision = persistedRevision(persistedMeta)
      if (revision !== input.expectedStoryRevision) throw new AbortReview(fail('conflict', false))
      let nextStory: CustomerStory
      if (validated.source === 'ai' && reviewableStory) {
        nextStory = {
          ...reviewableStory,
          whatWeFound: input.whatWeFound,
          whatWeRecommend: input.whatWeRecommend,
        }
      } else if (validated.source === 'manual') {
        nextStory = {
          whatYouToldUs: context.ticket.concern,
          whatWeFound: input.whatWeFound,
          howWeKnow: [],
          whatItMeansIfWaived: CUSTOMER_STORY_WAIVER,
          whatWeRecommend: input.whatWeRecommend,
        }
      } else {
        throw new AbortReview(fail('unsupported_path', false))
      }

      const contentChanged = persistedStory === null || fingerprint(persistedStory) !== fingerprint(nextStory)
      const nextRevision = revision + 1
      const reviewedAt = context.now.toISOString()
      const reviewAudit = {
        reviewClientKey: input.clientKey,
        reviewRequestFingerprint: request,
        reviewedByProfileId: context.actor.id,
        reviewedAt,
      }
      const storyMeta: CustomerStoryMeta = validated.source === 'ai'
        ? {
            ...persistedMeta!,
            source: 'ai',
            lastEditedByProfileId: context.actor.id,
            lastEditedAt: reviewedAt,
            storyRevision: nextRevision,
            reviewStatus: 'reviewed',
            ...reviewAudit,
          }
        : {
            source: 'manual',
            sessionId: context.session.id,
            lastEditedByProfileId: context.actor.id,
            lastEditedAt: reviewedAt,
            storyRevision: nextRevision,
            reviewStatus: 'reviewed',
            ...reviewAudit,
          }
      await transactionDb.update(ticketJobs).set({
        customerStory: nextStory,
        storyMeta,
        updatedAt: context.now,
      }).where(and(
        eq(ticketJobs.id, input.jobId), eq(ticketJobs.ticketId, input.ticketId),
        eq(ticketJobs.shopId, context.actor.shopId!),
      ))
      if (contentChanged) {
        const invalidation = await invalidateActiveQuoteVersion(transactionDb, {
          shopId: context.actor.shopId!, ticketId: input.ticketId,
          jobIds: context.jobs.map((job) => job.id),
          activeVersions: context.versions.filter((version) => version.supersededAt === null),
        })
        if (invalidation) throw new AbortReview(invalidation as Failure)
      }
      return { ok: true as const, changed: contentChanged, story: nextStory, storyMeta, storyRevision: nextRevision }
    })
  } catch (error) {
    if (error instanceof AbortReview) return error.failure
    if (lockUnavailable(error)) return fail('conflict', true)
    throw error
  }
}

async function lockManualFindingsContext(
  db: AppDb,
  input: ReviewInput,
  shopId: string,
  dependencies: CustomerStoryReviewDependencies,
): Promise<void> {
  const ticketQuery = db.select().from(tickets).where(and(eq(tickets.id, input.ticketId), eq(tickets.shopId, shopId))).limit(1).for('update', { noWait: true })
  const jobsQuery = db.select().from(ticketJobs).where(and(eq(ticketJobs.ticketId, input.ticketId), eq(ticketJobs.shopId, shopId))).orderBy(ticketJobs.id).for('update', { noWait: true })
  const versionsQuery = db.select().from(quoteVersions).where(and(eq(quoteVersions.ticketId, input.ticketId), eq(quoteVersions.shopId, shopId))).orderBy(quoteVersions.id).for('update', { noWait: true })
  const actorQuery = db.select().from(profiles).where(and(eq(profiles.id, input.actor.profileId), eq(profiles.shopId, shopId))).limit(1).for('update', { noWait: true })
  dependencies.captureLockSql?.(
    [ticketQuery, jobsQuery, versionsQuery, actorQuery].map((query) => query.toSQL().sql),
  )
  await ticketQuery
  await jobsQuery
  await versionsQuery
  await actorQuery
}

// The sessionless manual review path: a diagnostic job with NO linked
// session (shop without the diagnostics add-on) gets its customer story
// filled by the tech via the same PUT contract the session-bound manual
// path uses. The persisted shape is identical to every other reviewed
// manual story except that storyMeta carries no sessionId — downstream
// (quote versions, approval, invoice) already consumes reviewed manual
// stories and never learns which path wrote them.
async function saveManualFindingsStory(
  db: AppDb,
  input: ReviewInput,
  shopId: string,
  dependencies: CustomerStoryReviewDependencies,
): Promise<CustomerStoryReviewResult> {
  try {
    return await db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      await lockManualFindingsContext(transactionDb, input, shopId, dependencies)
      await dependencies.afterLocks?.()

      const [actor] = await transactionDb.select({
        id: profiles.id, shopId: profiles.shopId, role: profiles.role,
        membershipStatus: profiles.membershipStatus, deactivatedAt: profiles.deactivatedAt,
      }).from(profiles).where(eq(profiles.id, input.actor.profileId)).limit(1)
      if (!actor?.shopId || actor.shopId !== shopId) throw new AbortReview(fail('not_found'))

      const [ticket] = await transactionDb.select().from(tickets).where(and(
        eq(tickets.id, input.ticketId), eq(tickets.shopId, shopId),
      )).limit(1)
      const [targetJob] = await transactionDb.select().from(ticketJobs).where(and(
        eq(ticketJobs.id, input.jobId), eq(ticketJobs.ticketId, input.ticketId),
        eq(ticketJobs.shopId, shopId),
      )).limit(1)
      if (!ticket || !targetJob || targetJob.kind !== 'diagnostic') {
        throw new AbortReview(fail('not_found'))
      }
      // A session was linked between preflight and lock — this job now
      // belongs to the session-bound path. Retryable so the client rereads.
      if (targetJob.sessionId) throw new AbortReview(fail('conflict', true))
      if (actor.membershipStatus !== 'active' || actor.deactivatedAt || !['tech', 'advisor', 'owner'].includes(actor.role)) {
        throw new AbortReview(fail('forbidden'))
      }
      if (
        ticket.status !== 'open' ||
        !['open', 'in_progress', 'blocked'].includes(targetJob.workStatus)
      ) throw new AbortReview(fail('state_conflict', false))
      const concern = customerStoryReviewTextSchema.safeParse(ticket.concern)
      if (!concern.success || concern.data !== ticket.concern) {
        throw new AbortReview(fail('state_conflict', false))
      }

      const [jobs, versions, now] = await Promise.all([
        transactionDb.select().from(ticketJobs).where(and(
          eq(ticketJobs.shopId, shopId), eq(ticketJobs.ticketId, ticket.id),
        )).orderBy(ticketJobs.id),
        transactionDb.select().from(quoteVersions).where(and(
          eq(quoteVersions.shopId, shopId), eq(quoteVersions.ticketId, ticket.id),
        )).orderBy(quoteVersions.id),
        databaseNow(transactionDb),
      ])
      if (versions.filter((version) => version.supersededAt === null).length > 1) {
        throw new AbortReview(fail('conflict', false))
      }

      const rawMeta = targetJob.storyMeta
      const persistedMeta = rawMeta === null ? null : safePersistedMeta(rawMeta)
      const persistedStory = targetJob.customerStory === null ? null : safeStory(targetJob.customerStory)
      if (
        (rawMeta !== null && !persistedMeta) ||
        (targetJob.customerStory !== null && !persistedStory) ||
        (persistedMeta === null) !== (persistedStory === null)
      ) throw new AbortReview(fail('conflict', false))

      if (persistedMeta && persistedStory) {
        // Only a previously saved sessionless manual finding may be
        // re-reviewed here. Session-bound metadata on a sessionless job is
        // drifted state — fail closed.
        if (
          persistedMeta.source !== 'manual' || persistedMeta.sessionId !== undefined ||
          persistedMeta.reviewStatus !== 'reviewed' || persistedMeta.storyRevision === undefined ||
          persistedMeta.storyRevision < 1 || !persistedMeta.reviewClientKey ||
          !persistedMeta.reviewRequestFingerprint || !persistedMeta.reviewedByProfileId ||
          !persistedMeta.reviewedAt ||
          persistedStory.whatYouToldUs !== ticket.concern ||
          persistedStory.whatItMeansIfWaived !== CUSTOMER_STORY_WAIVER ||
          persistedStory.howWeKnow.length > 0
        ) throw new AbortReview(fail('conflict', false))
      }

      const binding: ReviewBinding = {
        source: 'manual', sessionId: null, concern: ticket.concern,
        waiver: CUSTOMER_STORY_WAIVER, proof: [], generation: null,
      }
      const request = reviewRequestFingerprint(input, binding)

      if (persistedMeta?.reviewClientKey === input.clientKey) {
        if (persistedMeta.reviewedByProfileId !== actor.id || persistedMeta.reviewRequestFingerprint !== request || !persistedStory) {
          throw new AbortReview(fail('conflict', false))
        }
        return {
          ok: true as const, changed: false, story: persistedStory, storyMeta: persistedMeta,
          storyRevision: persistedRevision(persistedMeta),
        }
      }

      const revision = persistedRevision(persistedMeta)
      if (revision !== input.expectedStoryRevision) throw new AbortReview(fail('conflict', false))

      const nextStory: CustomerStory = {
        whatYouToldUs: ticket.concern,
        whatWeFound: input.whatWeFound,
        howWeKnow: [],
        whatItMeansIfWaived: CUSTOMER_STORY_WAIVER,
        whatWeRecommend: input.whatWeRecommend,
      }
      const contentChanged = persistedStory === null || fingerprint(persistedStory) !== fingerprint(nextStory)
      const nextRevision = revision + 1
      const reviewedAt = now.toISOString()
      const storyMeta: CustomerStoryMeta = {
        source: 'manual',
        lastEditedByProfileId: actor.id,
        lastEditedAt: reviewedAt,
        storyRevision: nextRevision,
        reviewStatus: 'reviewed',
        reviewClientKey: input.clientKey,
        reviewRequestFingerprint: request,
        reviewedByProfileId: actor.id,
        reviewedAt,
      }
      await transactionDb.update(ticketJobs).set({
        customerStory: nextStory,
        storyMeta,
        updatedAt: now,
      }).where(and(
        eq(ticketJobs.id, input.jobId), eq(ticketJobs.ticketId, input.ticketId),
        eq(ticketJobs.shopId, shopId),
      ))
      if (contentChanged) {
        const invalidation = await invalidateActiveQuoteVersion(transactionDb, {
          shopId, ticketId: input.ticketId,
          jobIds: jobs.map((job) => job.id),
          activeVersions: versions.filter((version) => version.supersededAt === null),
        })
        if (invalidation) throw new AbortReview(invalidation as Failure)
      }
      return { ok: true as const, changed: contentChanged, story: nextStory, storyMeta, storyRevision: nextRevision }
    })
  } catch (error) {
    if (error instanceof AbortReview) return error.failure
    if (lockUnavailable(error)) return fail('conflict', true)
    throw error
  }
}
