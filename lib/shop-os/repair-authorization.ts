import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
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
} from '@/lib/db/schema'
import { quoteSnapshotContainsJob } from '@/lib/shop-os/quotes'
import { assertLiveLockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import { ShopOsMutationNotFound } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { ShopOsMutationConflict } from '@/lib/shop-os/continuity/mutation-foundation/conflicts'
import type {
  LockedMutationScopeV1,
  MutationLockRequestV1,
} from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import { runBoundedShopOsMutationV1 } from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'

export type DiagnosticRepairAccess =
  | { state: 'legacy' }
  | { state: 'approved'; ticketId: string; jobId: string; quoteVersionId: string }
  | { state: 'declined'; ticketId: string; jobId: string }
  | { state: 'awaiting_approval'; ticketId: string; jobId: string }
  | { state: 'unavailable' }

export type LockedDiagnosticRepairAccess =
  | Exclude<DiagnosticRepairAccess, { state: 'declined' }>
  | {
      state: 'declined'
      ticketId: string
      jobId: string
      lockedDiagnosis: { rootCauseSummary?: string; createdAt: Date }
    }

type JobTruth = Pick<
  typeof ticketJobs.$inferSelect,
  | 'id'
  | 'shopId'
  | 'ticketId'
  | 'kind'
  | 'sessionId'
  | 'assignedTechId'
  | 'workStatus'
  | 'approvalState'
  | 'approvedQuoteVersionId'
>

type VersionTruth = Pick<
  typeof quoteVersions.$inferSelect,
  'id' | 'ticketId' | 'snapshot' | 'supersededAt'
>

type DecisionTruth = Pick<
  typeof quoteEvents.$inferSelect,
  'id' | 'jobId' | 'quoteVersionId' | 'kind' | 'createdAt'
>

function latestDecision(events: DecisionTruth[]): DecisionTruth | null {
  return [...events].sort((left, right) => {
    const byTime = left.createdAt.getTime() - right.createdAt.getTime()
    return byTime === 0 ? left.id.localeCompare(right.id) : byTime
  }).at(-1) ?? null
}

function classifyAccess(input: {
  expectedShopId: string
  ticketOpen: boolean
  sessionActionable: boolean
  job: JobTruth
  versions: VersionTruth[]
  decisions: DecisionTruth[]
}): DiagnosticRepairAccess {
  const { job } = input
  if (
    job.shopId !== input.expectedShopId
    || !input.ticketOpen
    || !input.sessionActionable
    || job.kind !== 'diagnostic'
    || job.sessionId === null
    || job.assignedTechId === null
    || job.workStatus !== 'in_progress'
  ) {
    return { state: 'unavailable' }
  }

  const base = { ticketId: job.ticketId, jobId: job.id }
  if (
    job.approvalState === 'pending_quote'
    || job.approvalState === 'quote_ready'
    || job.approvalState === 'sent'
  ) {
    return job.approvedQuoteVersionId === null
      ? { state: 'awaiting_approval', ...base }
      : { state: 'unavailable' }
  }

  const decision = latestDecision(input.decisions)
  if (job.approvalState === 'declined') {
    if (job.approvedQuoteVersionId !== null || decision?.kind !== 'declined') {
      return { state: 'unavailable' }
    }
    const version = input.versions.find((candidate) => candidate.id === decision.quoteVersionId)
    return version
      && version.ticketId === job.ticketId
      && version.supersededAt === null
      && quoteSnapshotContainsJob(version.snapshot, base)
      ? { state: 'declined', ...base }
      : { state: 'unavailable' }
  }

  if (job.approvalState !== 'approved' || job.approvedQuoteVersionId === null) {
    return { state: 'unavailable' }
  }
  const version = input.versions.find((candidate) => candidate.id === job.approvedQuoteVersionId)
  if (
    !version
    || version.ticketId !== job.ticketId
    || version.supersededAt !== null
    || !quoteSnapshotContainsJob(version.snapshot, base)
    || decision?.kind !== 'approved'
    || decision.jobId !== job.id
    || decision.quoteVersionId !== version.id
  ) {
    return { state: 'unavailable' }
  }
  return { state: 'approved', ...base, quoteVersionId: version.id }
}

async function loadDecisionTruth(db: AppDb, input: { shopId: string; ticketId: string; jobId: string }) {
  return db
    .select({
      id: quoteEvents.id,
      jobId: quoteEvents.jobId,
      quoteVersionId: quoteEvents.quoteVersionId,
      kind: quoteEvents.kind,
      createdAt: quoteEvents.createdAt,
    })
    .from(quoteEvents)
    .where(and(
      eq(quoteEvents.shopId, input.shopId),
      eq(quoteEvents.ticketId, input.ticketId),
      eq(quoteEvents.jobId, input.jobId),
      inArray(quoteEvents.kind, ['approved', 'declined']),
    ))
    .orderBy(asc(quoteEvents.createdAt), asc(quoteEvents.id)) as Promise<DecisionTruth[]>
}

export async function resolveDiagnosticRepairAccess(
  db: AppDb,
  input: { shopId: string; sessionId: string },
): Promise<DiagnosticRepairAccess> {
  const linkedJobs = await db
    .select({
      id: ticketJobs.id,
      shopId: ticketJobs.shopId,
      ticketId: ticketJobs.ticketId,
      kind: ticketJobs.kind,
      sessionId: ticketJobs.sessionId,
      assignedTechId: ticketJobs.assignedTechId,
      workStatus: ticketJobs.workStatus,
      approvalState: ticketJobs.approvalState,
      approvedQuoteVersionId: ticketJobs.approvedQuoteVersionId,
    })
    .from(ticketJobs)
    .where(eq(ticketJobs.sessionId, input.sessionId))
    .limit(2)
  if (linkedJobs.length === 0) return { state: 'legacy' }
  if (linkedJobs.length !== 1 || linkedJobs[0].shopId !== input.shopId) {
    return { state: 'unavailable' }
  }
  const job = linkedJobs[0]
  if (job.assignedTechId === null) return { state: 'unavailable' }
  const [[session], [assignedTech]] = await Promise.all([
    db
      .select({ status: sessions.status, techId: sessions.techId, treeState: sessions.treeState })
      .from(sessions)
      .where(and(eq(sessions.shopId, input.shopId), eq(sessions.id, input.sessionId)))
      .limit(1),
    db
      .select({ id: profiles.id })
      .from(profiles)
      .where(and(
        eq(profiles.id, job.assignedTechId),
        eq(profiles.shopId, input.shopId),
        eq(profiles.membershipStatus, 'active'),
        isNull(profiles.deactivatedAt),
      ))
      .limit(1),
  ])
  const [ticket] = await db
    .select({ status: tickets.status })
    .from(tickets)
    .where(and(eq(tickets.shopId, input.shopId), eq(tickets.id, job.ticketId)))
    .limit(1)
  const versions = await db
    .select({
      id: quoteVersions.id,
      ticketId: quoteVersions.ticketId,
      snapshot: quoteVersions.snapshot,
      supersededAt: quoteVersions.supersededAt,
    })
    .from(quoteVersions)
    .where(and(eq(quoteVersions.shopId, input.shopId), eq(quoteVersions.ticketId, job.ticketId)))
  const decisions = await loadDecisionTruth(db, {
    shopId: input.shopId,
    ticketId: job.ticketId,
    jobId: job.id,
  })
  return classifyAccess({
    expectedShopId: input.shopId,
    ticketOpen: ticket?.status === 'open',
    sessionActionable: session?.status === 'open'
      && session.treeState.phase === 'repairing'
      && session.techId === job.assignedTechId
      && assignedTech?.id === job.assignedTechId,
    job,
    versions,
    decisions,
  })
}

type RepairDiscovery = Readonly<{
  kind: 'unavailable' | 'legacy' | 'ticketed'
  separateChainIds: readonly string[]
  targetJobId: string | null
  targetSessionId: string | null
  targetSessionEventIds: readonly string[]
  closureFingerprint: string | null
}>

type RepairLockDependencies = Readonly<{
  afterDiscovery?: (tx: AppDb) => Promise<void>
}>

function emptyInsertionIntents() {
  return Object.freeze({
    sessions: Object.freeze([]),
    customers: Object.freeze([]),
    vehicles: Object.freeze([]),
    tickets: Object.freeze([]),
    jobs: Object.freeze([]),
  })
}

function uuidList(values: readonly (string | null)[]): readonly string[] {
  return Object.freeze([...new Set(values.filter((value): value is string => value !== null))].sort())
}

function rowsById<T extends Readonly<{ id: string }>>(rows: readonly T[]): readonly T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id))
}

function repairFingerprint(value: unknown): string {
  function normalize(member: unknown): unknown {
    if (member === null || typeof member === 'string' || typeof member === 'boolean') return member
    if (typeof member === 'number') {
      if (!Number.isFinite(member)) throw new TypeError('invalid_repair_authorization_discovery')
      return member
    }
    if (typeof member === 'bigint') return { $bigint: member.toString() }
    if (member instanceof Date) return { $date: member.toISOString() }
    if (Array.isArray(member)) return member.map(normalize)
    if (typeof member !== 'object') throw new TypeError('invalid_repair_authorization_discovery')
    return Object.fromEntries(Object.keys(member as Record<string, unknown>).sort()
      .map((key) => [key, normalize((member as Record<string, unknown>)[key])]))
  }
  return JSON.stringify(normalize(value))
}

function actorOnlyRequest(input: {
  shopId: string
  actorProfileId: string
}): MutationLockRequestV1 {
  return Object.freeze({
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
    insertionIntents: emptyInsertionIntents(),
  })
}

function unavailableDiscovery(input: {
  shopId: string
  actorProfileId: string
}): Readonly<{ lockRequest: MutationLockRequestV1; payload: RepairDiscovery }> {
  return Object.freeze({
    lockRequest: actorOnlyRequest(input),
    payload: Object.freeze({
      kind: 'unavailable',
      separateChainIds: Object.freeze([]),
      targetJobId: null,
      targetSessionId: null,
      targetSessionEventIds: Object.freeze([]),
      closureFingerprint: null,
    }),
  })
}

async function discoverDiagnosticRepairAccess(
  tx: AppDb,
  input: { shopId: string; sessionId: string; actorProfileId: string },
): Promise<Readonly<{ lockRequest: MutationLockRequestV1; payload: RepairDiscovery }>> {
  const linkedJobs = await tx.select().from(ticketJobs)
    .where(eq(ticketJobs.sessionId, input.sessionId)).limit(2)
  if (
    linkedJobs.length > 1 ||
    (linkedJobs.length === 1 && linkedJobs[0].shopId !== input.shopId)
  ) {
    return unavailableDiscovery(input)
  }

  if (linkedJobs.length === 0) {
    const [targetSession] = await tx.select().from(sessions).where(and(
      eq(sessions.shopId, input.shopId), eq(sessions.id, input.sessionId),
    )).limit(1)
    if (!targetSession) return unavailableDiscovery(input)
    const targetEvents = await tx.select().from(sessionEvents)
      .where(eq(sessionEvents.sessionId, targetSession.id))
      .orderBy(asc(sessionEvents.createdAt), asc(sessionEvents.id))
    const vehicleRows = targetSession.vehicleId === null ? [] : (await tx.select({ row: vehicles })
      .from(vehicles).innerJoin(customers, eq(customers.id, vehicles.customerId))
      .where(and(
        eq(customers.shopId, input.shopId), eq(vehicles.id, targetSession.vehicleId),
      ))).map(({ row }) => row)
    const customerIds = uuidList(vehicleRows.map(({ customerId }) => customerId))
    const customerRows = customerIds.length === 0 ? [] : await tx.select().from(customers)
      .where(and(eq(customers.shopId, input.shopId), inArray(customers.id, customerIds)))
      .orderBy(customers.id)
    const profileIds = uuidList([
      input.actorProfileId,
      targetSession.techId,
      ...targetEvents.map(({ requestActorProfileId }) => requestActorProfileId),
    ])
    const profileRows = await tx.select().from(profiles).where(and(
      eq(profiles.shopId, input.shopId), inArray(profiles.id, profileIds),
    )).orderBy(profiles.id)
    const targetSessionEventIds = uuidList(targetEvents.map(({ id }) => id))
    const closureFingerprint = repairFingerprint({
      profiles: rowsById(profileRows),
      customers: rowsById(customerRows),
      vehicles: rowsById(vehicleRows),
      tickets: [], jobs: [], lines: [], versions: [], events: [],
      sessions: [targetSession],
      sessionEvents: rowsById(targetEvents),
      vendors: [],
    })
    return Object.freeze({
      lockRequest: Object.freeze({
        shopId: input.shopId,
        actorProfileId: input.actorProfileId,
        profileIds,
        lockShop: false,
        customerIds,
        vehicleIds: uuidList(vehicleRows.map(({ id }) => id)),
        ticketIds: Object.freeze([]),
        jobIds: Object.freeze([]),
        includeAllJobsForTickets: false,
        includeAllLinesForJobs: false,
        includeAllQuoteVersionsForTickets: false,
        includeAllQuoteEventsForTickets: false,
        sessionIds: Object.freeze([targetSession.id]),
        sessionEventIds: targetSessionEventIds,
        vendorAccountIds: Object.freeze([]),
        cannedJobIds: Object.freeze([]),
        receiptRequestKey: null,
        receiptConditionalInsert: null,
        insertionIntents: emptyInsertionIntents(),
      }),
      payload: Object.freeze({
        kind: 'legacy',
        separateChainIds: Object.freeze([]),
        targetJobId: null,
        targetSessionId: targetSession.id,
        targetSessionEventIds,
        closureFingerprint,
      }),
    })
  }

  const linkedJob = linkedJobs[0]
  const [targetTicket] = await tx.select().from(tickets).where(and(
    eq(tickets.shopId, input.shopId), eq(tickets.id, linkedJob.ticketId),
  )).limit(1)
  if (!targetTicket) return unavailableDiscovery(input)
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
  const ticketIds = uuidList(ticketRows.map(({ id }) => id))
  const jobs = await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.shopId), inArray(ticketJobs.ticketId, ticketIds),
  )).orderBy(ticketJobs.id)
  const targetJob = jobs.find(({ id }) => id === linkedJob.id)
  if (!targetJob || targetJob.sessionId !== input.sessionId) return unavailableDiscovery(input)
  const jobIds = uuidList(jobs.map(({ id }) => id))
  const lines = jobIds.length === 0 ? [] : await tx.select().from(jobLines).where(and(
    eq(jobLines.shopId, input.shopId), inArray(jobLines.jobId, jobIds),
  )).orderBy(jobLines.id)
  const versions = await tx.select().from(quoteVersions).where(and(
    eq(quoteVersions.shopId, input.shopId), inArray(quoteVersions.ticketId, ticketIds),
  )).orderBy(quoteVersions.id)
  const events = await tx.select().from(quoteEvents).where(and(
    eq(quoteEvents.shopId, input.shopId), inArray(quoteEvents.ticketId, ticketIds),
  )).orderBy(quoteEvents.id)
  const sessionIds = uuidList(jobs.map(({ sessionId }) => sessionId))
  const sessionRows = sessionIds.length === 0 ? [] : await tx.select().from(sessions).where(and(
    eq(sessions.shopId, input.shopId), inArray(sessions.id, sessionIds),
  )).orderBy(sessions.id)
  const targetSessionEvents = await tx.select().from(sessionEvents)
    .where(eq(sessionEvents.sessionId, input.sessionId))
    .orderBy(asc(sessionEvents.createdAt), asc(sessionEvents.id))
  const vehicleIds = uuidList([
    ...ticketRows.map(({ vehicleId }) => vehicleId),
    ...sessionRows.map(({ vehicleId }) => vehicleId),
  ])
  const vehicleRows = vehicleIds.length === 0 ? [] : (await tx.select({ row: vehicles })
    .from(vehicles).innerJoin(customers, eq(customers.id, vehicles.customerId))
    .where(and(eq(customers.shopId, input.shopId), inArray(vehicles.id, vehicleIds)))
    .orderBy(vehicles.id)).map(({ row }) => row)
  const customerIds = uuidList([
    ...ticketRows.map(({ customerId }) => customerId),
    ...vehicleRows.map(({ customerId }) => customerId),
  ])
  const customerRows = customerIds.length === 0 ? [] : await tx.select().from(customers)
    .where(and(eq(customers.shopId, input.shopId), inArray(customers.id, customerIds)))
    .orderBy(customers.id)
  const vendorAccountIds = uuidList(lines.map(({ vendorAccountId }) => vendorAccountId))
  const vendorRows = vendorAccountIds.length === 0 ? [] : await tx.select().from(vendorAccounts)
    .where(and(
      eq(vendorAccounts.shopId, input.shopId), inArray(vendorAccounts.id, vendorAccountIds),
    )).orderBy(vendorAccounts.id)
  const profileIds = uuidList([
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
    eq(profiles.shopId, input.shopId), inArray(profiles.id, profileIds),
  )).orderBy(profiles.id)
  const targetSessionEventIds = uuidList(targetSessionEvents.map(({ id }) => id))
  const closureFingerprint = repairFingerprint({
    profiles: rowsById(profileRows),
    customers: rowsById(customerRows),
    vehicles: rowsById(vehicleRows),
    tickets: rowsById(ticketRows),
    jobs: rowsById(jobs),
    lines: rowsById(lines),
    versions: rowsById(versions),
    events: rowsById(events),
    sessions: rowsById(sessionRows),
    sessionEvents: rowsById(targetSessionEvents),
    vendors: rowsById(vendorRows),
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
      insertionIntents: emptyInsertionIntents(),
    }),
    payload: Object.freeze({
      kind: 'ticketed',
      separateChainIds: Object.freeze(ticketRows.map(({ id }) => id)),
      targetJobId: targetJob.id,
      targetSessionId: input.sessionId,
      targetSessionEventIds,
      closureFingerprint,
    }),
  })
}

function scopeFingerprint(scope: LockedMutationScopeV1): string {
  return repairFingerprint({
    profiles: rowsById(scope.profiles),
    customers: rowsById(scope.customers),
    vehicles: rowsById(scope.vehicles),
    tickets: rowsById(scope.tickets.map(({ ticket }) => ticket)),
    jobs: rowsById(scope.tickets.flatMap(({ jobs }) => jobs)),
    lines: rowsById(scope.tickets.flatMap(({ lines }) => lines)),
    versions: rowsById(scope.tickets.flatMap(({ versions }) => versions)),
    events: rowsById(scope.tickets.flatMap(({ events }) => events)),
    sessions: rowsById(scope.sessions),
    sessionEvents: rowsById(scope.sessionEvents),
    vendors: rowsById(scope.vendorAccounts),
  })
}

function classifyLockedDiagnosticRepairAccess(
  scope: LockedMutationScopeV1,
  discovery: RepairDiscovery,
  input: { shopId: string; sessionId: string; actorProfileId: string },
): LockedDiagnosticRepairAccess {
  if (discovery.kind === 'unavailable') return { state: 'unavailable' }
  if (
    discovery.closureFingerprint === null ||
    discovery.closureFingerprint !== scopeFingerprint(scope) ||
    scope.profiles.length !== scope.request.profileIds.length ||
    scope.profiles.some(({ id, shopId }) =>
      shopId !== input.shopId || !scope.request.profileIds.includes(id))
  ) throw new ShopOsMutationConflict()
  const session = scope.sessions.find(({ id }) => id === input.sessionId)
  if (
    !session || session.status !== 'open' || session.treeState.phase !== 'repairing' ||
    session.techId !== scope.actor.id || scope.actor.id !== input.actorProfileId ||
    scope.actor.role !== 'tech' ||
    typeof scope.actor.skillTier !== 'number'
  ) return { state: 'unavailable' }
  if (discovery.kind === 'legacy') return { state: 'legacy' }

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
  if (
    !graph || !job || job.sessionId !== input.sessionId ||
    job.assignedTechId !== scope.actor.id ||
    scope.actor.skillTier < job.requiredSkillTier ||
    session.vehicleId !== graph.ticket.vehicleId
  ) return { state: 'unavailable' }
  const decisions = graph.events
    .filter((event) =>
      event.jobId === job.id && (event.kind === 'approved' || event.kind === 'declined'))
    .map((event): DecisionTruth => ({
      id: event.id,
      jobId: event.jobId,
      quoteVersionId: event.quoteVersionId,
      kind: event.kind,
      createdAt: event.createdAt,
    }))
  const access = classifyAccess({
    expectedShopId: input.shopId,
    ticketOpen: graph.ticket.status === 'open',
    sessionActionable: true,
    job,
    versions: [...graph.versions],
    decisions,
  })
  return access.state === 'declined'
    ? Object.freeze({
        ...access,
        lockedDiagnosis: Object.freeze({
          rootCauseSummary: session.treeState.rootCauseSummary,
          createdAt: session.createdAt,
        }),
      })
    : access
}

export async function lockDiagnosticRepairAccess(
  db: AppDb,
  input: { shopId: string; sessionId: string; actorProfileId: string },
  dependencies: RepairLockDependencies = {},
): Promise<LockedDiagnosticRepairAccess> {
  try {
    return await runBoundedShopOsMutationV1<LockedDiagnosticRepairAccess, RepairDiscovery>(db, {
      discover: async (tx) => {
        const discovery = await discoverDiagnosticRepairAccess(tx, input)
        await dependencies.afterDiscovery?.(tx)
        return discovery
      },
      executeLocked: async (tx, scope, discovery) => {
        assertLiveLockedMutationScopeV1(tx, scope)
        if (discovery.targetSessionId !== null) {
          const liveEventIds = uuidList((await tx.select({ id: sessionEvents.id })
            .from(sessionEvents)
            .where(eq(sessionEvents.sessionId, discovery.targetSessionId))
            .orderBy(sessionEvents.id)).map(({ id }) => id))
          if (
            liveEventIds.length !== discovery.targetSessionEventIds.length ||
            liveEventIds.some((id, index) => id !== discovery.targetSessionEventIds[index])
          ) throw new ShopOsMutationConflict()
        }
        return classifyLockedDiagnosticRepairAccess(scope, discovery, input)
      },
    })
  } catch (error) {
    if (error instanceof ShopOsMutationNotFound) return { state: 'unavailable' }
    throw error
  }
}
