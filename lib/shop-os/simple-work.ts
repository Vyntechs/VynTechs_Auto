import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
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
} from '@/lib/db/schema'
import { isShopRole } from '@/lib/shop-os/capabilities'
import {
  isLockUnavailable,
  quoteSnapshotContainsExactJob,
} from '@/lib/shop-os/quotes'
import { assertLiveLockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import { ShopOsMutationNotFound } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { ShopOsMutationConflict } from '@/lib/shop-os/continuity/mutation-foundation/conflicts'
import type {
  LockedMutationScopeV1,
  MutationLockRequestV1,
} from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import {
  finalizeMutationRevisionsV1,
  reserveJobSequencesForInsertionV1,
} from '@/lib/shop-os/continuity/mutation-foundation/revisions'
import { runBoundedShopOsMutationV1 } from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'

export type SimpleWorkActor = { profileId: string; shopId: string }
export type SimpleWorkError = 'invalid_input' | 'not_found' | 'not_authorized' | 'not_ready' | 'conflict'
export type SimpleWorkFailure = { ok: false; error: SimpleWorkError; retryable?: true }

type WorkProjection = {
  status: 'open' | 'in_progress' | 'done'
  workNotes: string | null
  updatedAt: string
}

export type SimpleWorkMutationResult =
  | { ok: true; changed: boolean; work: WorkProjection }
  | SimpleWorkFailure

export type SimpleWorkMutationDependencies = Readonly<{
  afterLocks?: () => Promise<void>
  afterWrite?: () => Promise<void>
  afterFinalization?: () => Promise<void>
}>

const uuidSchema = z.uuid().transform((value) => value.toLowerCase())
const actionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('start') }),
  z.strictObject({
    action: z.literal('save_note'),
    note: z.string().trim().min(1).max(2_000),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  }),
  z.strictObject({
    action: z.literal('complete'),
    expectedUpdatedAt: z.string().datetime({ offset: true }),
  }),
])

type LockedContext = {
  ticket: Pick<typeof tickets.$inferSelect, 'id' | 'status'>
  job: typeof ticketJobs.$inferSelect
  versions: Array<typeof quoteVersions.$inferSelect>
  decisions: Array<Pick<typeof quoteEvents.$inferSelect, 'id' | 'kind' | 'jobId' | 'quoteVersionId' | 'createdAt'>>
}

function failure(error: SimpleWorkError, retryable = false): SimpleWorkFailure {
  return retryable ? { ok: false, error, retryable: true } : { ok: false, error }
}

function safeWork(job: Pick<typeof ticketJobs.$inferSelect, 'workStatus' | 'workNotes' | 'updatedAt'>): WorkProjection {
  if (job.workStatus !== 'open' && job.workStatus !== 'in_progress' && job.workStatus !== 'done') {
    throw new TypeError('simple work status is unavailable')
  }
  return {
    status: job.workStatus,
    workNotes: job.workNotes,
    updatedAt: job.updatedAt.toISOString(),
  }
}

function latestDecision(context: LockedContext) {
  return [...context.decisions].sort((left, right) => {
    const time = left.createdAt.getTime() - right.createdAt.getTime()
    return time === 0 ? left.id.localeCompare(right.id) : time
  }).at(-1)
}

function hasPinnedApproval(context: LockedContext, requireActive: boolean): boolean {
  const { job } = context
  if (job.approvalState !== 'approved' || !job.approvedQuoteVersionId) return false
  const version = context.versions.find((candidate) => candidate.id === job.approvedQuoteVersionId)
  if (!version || version.ticketId !== context.ticket.id) return false
  if (requireActive) {
    const active = context.versions.filter((candidate) => candidate.supersededAt === null)
    if (active.length !== 1 || active[0].id !== version.id) return false
  }
  const decision = latestDecision(context)
  return decision?.kind === 'approved'
    && decision.jobId === job.id
    && decision.quoteVersionId === version.id
    && quoteSnapshotContainsExactJob(version.snapshot, {
      ticketId: context.ticket.id,
      jobId: job.id,
      kind: job.kind,
    })
}

async function lockContext(
  db: AppDb,
  input: { actor: SimpleWorkActor; ticketId: string; jobId: string },
): Promise<LockedContext | null> {
  const [ticket] = await db
    .select({ id: tickets.id, status: tickets.status })
    .from(tickets)
    .where(and(eq(tickets.shopId, input.actor.shopId), eq(tickets.id, input.ticketId)))
    .limit(1)
    .for('update', { noWait: true })
  if (!ticket) return null

  const jobs = await db
    .select()
    .from(ticketJobs)
    .where(and(eq(ticketJobs.shopId, input.actor.shopId), eq(ticketJobs.ticketId, ticket.id)))
    .orderBy(asc(ticketJobs.id))
    .for('update', { noWait: true })
  const job = jobs.find((candidate) => candidate.id === input.jobId)

  const versions = await db
    .select()
    .from(quoteVersions)
    .where(and(eq(quoteVersions.shopId, input.actor.shopId), eq(quoteVersions.ticketId, ticket.id)))
    .orderBy(asc(quoteVersions.id))
    .for('update', { noWait: true })

  const [actor] = await db
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(and(
      eq(profiles.id, input.actor.profileId),
      eq(profiles.shopId, input.actor.shopId),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
    .for('update', { noWait: true })
  if (!job || !actor || !isShopRole(actor.role)
    || job.assignedTechId !== actor.id
    || (job.kind !== 'repair' && job.kind !== 'maintenance')
    || job.sessionId !== null) return null

  const decisions = await db
    .select({
      id: quoteEvents.id,
      kind: quoteEvents.kind,
      jobId: quoteEvents.jobId,
      quoteVersionId: quoteEvents.quoteVersionId,
      createdAt: quoteEvents.createdAt,
    })
    .from(quoteEvents)
    .where(and(
      eq(quoteEvents.shopId, input.actor.shopId),
      eq(quoteEvents.ticketId, ticket.id),
      eq(quoteEvents.jobId, job.id),
      inArray(quoteEvents.kind, ['approved', 'declined']),
    ))
    .orderBy(asc(quoteEvents.createdAt), asc(quoteEvents.id))
  return { ticket, job, versions, decisions }
}

type SimpleWorkDiscovery = Readonly<{
  kind: 'ready' | 'not_found'
  separateChainIds: readonly string[]
  closureFingerprint: string | null
  insertionState: 'none' | 'create' | 'existing' | 'collision'
  insertionJobId: string | null
}>

function simpleUuidList(values: readonly (string | null | undefined)[]): readonly string[] {
  return Object.freeze([...new Set(values.filter((value): value is string =>
    typeof value === 'string'))].sort())
}

function simpleRowsById<T extends { id: string }>(rows: readonly T[]): readonly T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id))
}

function simpleEmptyInsertionIntents() {
  return Object.freeze({
    sessions: Object.freeze([]), customers: Object.freeze([]),
    vehicles: Object.freeze([]), tickets: Object.freeze([]), jobs: Object.freeze([]),
  })
}

function simplePersistedFingerprint(value: unknown): string {
  const normalize = (member: unknown): unknown => {
    if (member instanceof Date) return { $date: member.toISOString() }
    if (typeof member === 'bigint') return { $bigint: member.toString() }
    if (member === null || member === undefined || ['string', 'number', 'boolean'].includes(typeof member)) {
      return member ?? null
    }
    if (Array.isArray(member)) return member.map(normalize)
    if (typeof member !== 'object') throw new TypeError('invalid_simple_work_discovery_value')
    return Object.fromEntries(Object.keys(member as Record<string, unknown>).sort()
      .map((key) => [key, normalize((member as Record<string, unknown>)[key])]))
  }
  return JSON.stringify(normalize(value))
}

async function discoverSimpleWorkMutation(
  tx: AppDb,
  input: Readonly<{
    shopId: string
    actorProfileId: string
    ticketId: string
    jobId: string
    insertionJobId: string | null
  }>,
): Promise<Readonly<{ lockRequest: MutationLockRequestV1; payload: SimpleWorkDiscovery }>> {
  const actorOnly = () => Object.freeze({
    lockRequest: Object.freeze({
      shopId: input.shopId,
      actorProfileId: input.actorProfileId,
      profileIds: Object.freeze([input.actorProfileId]),
      lockShop: false,
      customerIds: Object.freeze([]), vehicleIds: Object.freeze([]),
      ticketIds: Object.freeze([]), jobIds: Object.freeze([]),
      includeAllJobsForTickets: false, includeAllLinesForJobs: false,
      includeAllQuoteVersionsForTickets: false, includeAllQuoteEventsForTickets: false,
      sessionIds: Object.freeze([]), sessionEventIds: Object.freeze([]),
      vendorAccountIds: Object.freeze([]), cannedJobIds: Object.freeze([]),
      receiptRequestKey: null, receiptConditionalInsert: null,
      insertionIntents: simpleEmptyInsertionIntents(),
    }),
    payload: Object.freeze({
      kind: 'not_found' as const,
      separateChainIds: Object.freeze([]),
      closureFingerprint: null,
      insertionState: 'none' as const,
      insertionJobId: input.insertionJobId,
    }),
  })
  const [target] = await tx.select().from(tickets).where(and(
    eq(tickets.shopId, input.shopId), eq(tickets.id, input.ticketId),
  )).limit(1)
  const [targetJob] = target ? await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.shopId), eq(ticketJobs.ticketId, input.ticketId),
    eq(ticketJobs.id, input.jobId),
  )).limit(1) : []
  if (!target || !targetJob) return actorOnly()

  const ticketRows = [target]
  const seenTicketIds = new Set([target.id])
  let parentId = target.separateFromTicketId
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
  const ticketIds = simpleUuidList(ticketRows.map(({ id }) => id))
  const jobs = await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.shopId), inArray(ticketJobs.ticketId, ticketIds),
  )).orderBy(ticketJobs.id)
  const jobIds = simpleUuidList(jobs.map(({ id }) => id))
  const lines = jobIds.length === 0 ? [] : await tx.select().from(jobLines).where(and(
    eq(jobLines.shopId, input.shopId), inArray(jobLines.jobId, jobIds),
  )).orderBy(jobLines.id)
  const versions = await tx.select().from(quoteVersions).where(and(
    eq(quoteVersions.shopId, input.shopId), inArray(quoteVersions.ticketId, ticketIds),
  )).orderBy(quoteVersions.id)
  const events = await tx.select().from(quoteEvents).where(and(
    eq(quoteEvents.shopId, input.shopId), inArray(quoteEvents.ticketId, ticketIds),
  )).orderBy(quoteEvents.id)
  const sessionIds = simpleUuidList(jobs.map(({ sessionId }) => sessionId))
  const sessionRows = sessionIds.length === 0 ? [] : await tx.select().from(sessions).where(and(
    eq(sessions.shopId, input.shopId), inArray(sessions.id, sessionIds),
  )).orderBy(sessions.id)
  const vehicleIds = simpleUuidList([
    ...ticketRows.map(({ vehicleId }) => vehicleId),
    ...sessionRows.map(({ vehicleId }) => vehicleId),
  ])
  const vehicleRows = vehicleIds.length === 0 ? [] : (await tx.select({ row: vehicles })
    .from(vehicles).innerJoin(customers, eq(customers.id, vehicles.customerId))
    .where(and(eq(customers.shopId, input.shopId), inArray(vehicles.id, vehicleIds)))
    .orderBy(vehicles.id)).map(({ row }) => row)
  const customerIds = simpleUuidList([
    ...ticketRows.map(({ customerId }) => customerId),
    ...vehicleRows.map(({ customerId }) => customerId),
  ])
  const customerRows = customerIds.length === 0 ? [] : await tx.select().from(customers).where(and(
    eq(customers.shopId, input.shopId), inArray(customers.id, customerIds),
  )).orderBy(customers.id)
  const vendorAccountIds = simpleUuidList(lines.map(({ vendorAccountId }) => vendorAccountId))
  const vendorRows = vendorAccountIds.length === 0 ? [] : await tx.select().from(vendorAccounts)
    .where(and(eq(vendorAccounts.shopId, input.shopId), inArray(vendorAccounts.id, vendorAccountIds)))
    .orderBy(vendorAccounts.id)
  const profileIds = simpleUuidList([
    input.actorProfileId,
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
    eq(profiles.shopId, input.shopId), inArray(profiles.id, profileIds),
  )).orderBy(profiles.id)
  const existingInsertion = input.insertionJobId === null
    ? null
    : jobs.find(({ id }) => id === input.insertionJobId) ?? null
  const [foreignInsertion] = input.insertionJobId === null || existingInsertion !== null
    ? []
    : await tx.select({ id: ticketJobs.id, ticketId: ticketJobs.ticketId })
      .from(ticketJobs).where(eq(ticketJobs.id, input.insertionJobId)).limit(1)
  const insertionState = input.insertionJobId === null
    ? 'none' as const
    : existingInsertion !== null
      ? 'existing' as const
      : foreignInsertion
        ? 'collision' as const
        : 'create' as const
  const closureFingerprint = simplePersistedFingerprint({
    profiles: simpleRowsById(profileRows), customers: simpleRowsById(customerRows),
    vehicles: simpleRowsById(vehicleRows), tickets: simpleRowsById(ticketRows),
    jobs: simpleRowsById(jobs), lines: simpleRowsById(lines),
    versions: simpleRowsById(versions), events: simpleRowsById(events),
    sessions: simpleRowsById(sessionRows), vendors: simpleRowsById(vendorRows),
  })
  return Object.freeze({
    lockRequest: Object.freeze({
      shopId: input.shopId, actorProfileId: input.actorProfileId, profileIds,
      lockShop: insertionState === 'create', customerIds, vehicleIds, ticketIds, jobIds,
      includeAllJobsForTickets: true, includeAllLinesForJobs: true,
      includeAllQuoteVersionsForTickets: true, includeAllQuoteEventsForTickets: true,
      sessionIds, sessionEventIds: Object.freeze([]), vendorAccountIds,
      cannedJobIds: Object.freeze([]), receiptRequestKey: null,
      receiptConditionalInsert: null,
      insertionIntents: insertionState === 'create'
        ? Object.freeze({
            ...simpleEmptyInsertionIntents(),
            jobs: Object.freeze([{ id: input.insertionJobId!, ticketId: input.ticketId }]),
          })
        : simpleEmptyInsertionIntents(),
    }),
    payload: Object.freeze({
      kind: 'ready' as const,
      separateChainIds: Object.freeze(ticketRows.map(({ id }) => id)),
      closureFingerprint,
      insertionState,
      insertionJobId: input.insertionJobId,
    }),
  })
}

function resolveSimpleWorkScope(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  discovery: SimpleWorkDiscovery,
  ticketId: string,
  jobId: string,
): LockedContext {
  assertLiveLockedMutationScopeV1(tx, scope)
  if (discovery.kind === 'not_found') throw new ShopOsMutationNotFound()
  if (
    !isShopRole(scope.actor.role) || scope.profiles.length !== scope.request.profileIds.length ||
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
  const lockedFingerprint = simplePersistedFingerprint({
    profiles: simpleRowsById(scope.profiles), customers: simpleRowsById(scope.customers),
    vehicles: simpleRowsById(scope.vehicles),
    tickets: simpleRowsById(scope.tickets.map(({ ticket }) => ticket)),
    jobs: simpleRowsById(scope.tickets.flatMap(({ jobs }) => jobs)),
    lines: simpleRowsById(scope.tickets.flatMap(({ lines }) => lines)),
    versions: simpleRowsById(scope.tickets.flatMap(({ versions }) => versions)),
    events: simpleRowsById(scope.tickets.flatMap(({ events }) => events)),
    sessions: simpleRowsById(scope.sessions), vendors: simpleRowsById(scope.vendorAccounts),
  })
  if (lockedFingerprint !== discovery.closureFingerprint) throw new ShopOsMutationConflict()
  const graph = graphById.get(ticketId)
  const job = graph?.jobs.find(({ id }) => id === jobId)
  if (!graph || !job || job.assignedTechId !== scope.actor.id ||
    typeof scope.actor.skillTier !== 'number' || scope.actor.skillTier < job.requiredSkillTier ||
    (job.kind !== 'repair' && job.kind !== 'maintenance') || job.sessionId !== null) {
    throw new ShopOsMutationNotFound()
  }
  const decisions = graph.events.filter((event) =>
    event.jobId === job.id && (event.kind === 'approved' || event.kind === 'declined'))
    .map(({ id, kind, jobId: eventJobId, quoteVersionId, createdAt }) => ({
      id, kind, jobId: eventJobId, quoteVersionId, createdAt,
    }))
  return { ticket: graph.ticket, job, versions: [...graph.versions], decisions }
}

function nextTimestamp(previous: Date) {
  return sql`date_trunc('milliseconds', greatest(clock_timestamp(), ${sql.param(previous, ticketJobs.updatedAt)}::timestamptz)) + interval '1 millisecond'`
}

export async function mutateSimpleWork(
  db: AppDb,
  input: { actor: SimpleWorkActor; ticketId: unknown; jobId: unknown; body: unknown },
  dependencies: SimpleWorkMutationDependencies = {},
): Promise<SimpleWorkMutationResult> {
  const parsedActor = z.strictObject({ profileId: uuidSchema, shopId: uuidSchema }).safeParse(input.actor)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedJob = uuidSchema.safeParse(input.jobId)
  const parsedAction = actionSchema.safeParse(input.body)
  if (!parsedActor.success || !parsedTicket.success || !parsedJob.success || !parsedAction.success) {
    return failure('invalid_input')
  }
  try {
    return await runBoundedShopOsMutationV1<SimpleWorkMutationResult, SimpleWorkDiscovery>(db, {
      discover: async (tx) => discoverSimpleWorkMutation(tx, {
        shopId: parsedActor.data.shopId,
        actorProfileId: parsedActor.data.profileId,
        ticketId: parsedTicket.data,
        jobId: parsedJob.data,
        insertionJobId: null,
      }),
      executeLocked: async (tx, scope, discovery) => {
      const context = resolveSimpleWorkScope(
        tx, scope, discovery, parsedTicket.data, parsedJob.data,
      )
      await dependencies.afterLocks?.()
      const { job } = context
      const action = parsedAction.data

      if (action.action === 'complete' && job.workStatus === 'done') {
        return { ok: true, changed: false, work: safeWork(job) }
      }
      if (context.ticket.status !== 'open') return failure('not_found')

      let updated: typeof ticketJobs.$inferSelect | undefined
      if (action.action === 'start') {
        if (job.workStatus === 'in_progress') {
          return hasPinnedApproval(context, false)
            ? { ok: true, changed: false, work: safeWork(job) }
            : failure('not_authorized')
        }
        if (job.workStatus !== 'open') return failure('not_ready')
        if (!hasPinnedApproval(context, true)) return failure('not_authorized')
        ;[updated] = await tx
          .update(ticketJobs)
          .set({ workStatus: 'in_progress', updatedAt: nextTimestamp(job.updatedAt) })
          .where(and(
            eq(ticketJobs.shopId, parsedActor.data.shopId),
            eq(ticketJobs.id, job.id),
            eq(ticketJobs.workStatus, 'open'),
          ))
          .returning()
      } else {
        if (job.workStatus !== 'in_progress') return failure('not_ready')
        if (!hasPinnedApproval(context, false)) return failure('not_authorized')
        if (action.action === 'save_note') {
          if (job.workNotes === action.note) {
            return { ok: true, changed: false, work: safeWork(job) }
          }
          if (job.updatedAt.getTime() !== new Date(action.expectedUpdatedAt).getTime()) {
            return failure('conflict', true)
          }
          ;[updated] = await tx
            .update(ticketJobs)
            .set({ workNotes: action.note, updatedAt: nextTimestamp(job.updatedAt) })
            .where(and(
              eq(ticketJobs.shopId, parsedActor.data.shopId),
              eq(ticketJobs.id, job.id),
              eq(ticketJobs.updatedAt, job.updatedAt),
            ))
            .returning()
        } else {
          if (job.updatedAt.getTime() !== new Date(action.expectedUpdatedAt).getTime()) {
            return failure('conflict', true)
          }
          if (!job.workNotes?.trim()) return failure('not_ready')
          ;[updated] = await tx
            .update(ticketJobs)
            .set({ workStatus: 'done', updatedAt: nextTimestamp(job.updatedAt) })
            .where(and(
              eq(ticketJobs.shopId, parsedActor.data.shopId),
              eq(ticketJobs.id, job.id),
              eq(ticketJobs.workStatus, 'in_progress'),
              eq(ticketJobs.updatedAt, job.updatedAt),
            ))
            .returning()
        }
      }
      if (!updated) throw new ShopOsMutationConflict()
      await dependencies.afterWrite?.()
      await finalizeMutationRevisionsV1(tx, scope, {
        sessionIds: [], customerIds: [], vehicleIds: [],
      }, [{
        ticketId: parsedTicket.data, createdTicket: false, createdJobIds: [],
        existingChangedJobIds: [job.id], actorVisibleTicketFieldsChanged: true,
      }])
      await dependencies.afterFinalization?.()
      return { ok: true, changed: true, work: safeWork(updated) }
      },
    })
  } catch (error) {
    if (error instanceof ShopOsMutationNotFound) return failure('not_found')
    if (error instanceof ShopOsMutationConflict) return failure('conflict', true)
    throw error
  }
}

export async function getSimpleWorkWorkspace(
  db: AppDb,
  input: { actor: SimpleWorkActor; ticketId: unknown; jobId: unknown },
) {
  const parsedActor = z.strictObject({ profileId: uuidSchema, shopId: uuidSchema }).safeParse(input.actor)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedJob = uuidSchema.safeParse(input.jobId)
  if (!parsedActor.success || !parsedTicket.success || !parsedJob.success) return failure('invalid_input')

  return db.transaction(async (tx) => {
    const transactionDb = tx as AppDb
    const [actor] = await transactionDb.select({ id: profiles.id, role: profiles.role })
      .from(profiles).where(and(
        eq(profiles.id, parsedActor.data.profileId),
        eq(profiles.shopId, parsedActor.data.shopId),
        eq(profiles.membershipStatus, 'active'),
        isNull(profiles.deactivatedAt),
      )).limit(1)
    const [ticket] = await transactionDb.select({ id: tickets.id, status: tickets.status })
      .from(tickets).where(and(
        eq(tickets.shopId, parsedActor.data.shopId),
        eq(tickets.id, parsedTicket.data),
      )).limit(1)
    const [job] = await transactionDb.select().from(ticketJobs).where(and(
      eq(ticketJobs.shopId, parsedActor.data.shopId),
      eq(ticketJobs.ticketId, parsedTicket.data),
      eq(ticketJobs.id, parsedJob.data),
    )).limit(1)
    if (!actor || !isShopRole(actor.role) || !ticket || !job || job.assignedTechId !== actor.id
      || (job.kind !== 'repair' && job.kind !== 'maintenance')
      || job.sessionId !== null
      || job.workStatus === 'blocked' || job.workStatus === 'canceled'
      || (ticket.status !== 'open' && job.workStatus !== 'done')) return failure('not_found')
    const versions = await transactionDb.select().from(quoteVersions).where(and(
      eq(quoteVersions.shopId, parsedActor.data.shopId),
      eq(quoteVersions.ticketId, parsedTicket.data),
    )).orderBy(asc(quoteVersions.id))
    const decisions = await transactionDb.select({
      id: quoteEvents.id, kind: quoteEvents.kind, jobId: quoteEvents.jobId,
      quoteVersionId: quoteEvents.quoteVersionId, createdAt: quoteEvents.createdAt,
    }).from(quoteEvents).where(and(
      eq(quoteEvents.shopId, parsedActor.data.shopId),
      eq(quoteEvents.ticketId, parsedTicket.data),
      eq(quoteEvents.jobId, job.id),
      inArray(quoteEvents.kind, ['approved', 'declined']),
    )).orderBy(asc(quoteEvents.createdAt), asc(quoteEvents.id))
    const context: LockedContext = { ticket, job, versions, decisions }
    const authorization: 'approved' | 'declined' | 'awaiting_approval' = hasPinnedApproval(context, job.workStatus === 'open')
      ? 'approved'
      : job.approvalState === 'declined' ? 'declined' : 'awaiting_approval'
    return {
      ok: true as const,
      workspace: {
        id: job.id,
        title: job.title,
        kind: job.kind,
        workStatus: job.workStatus as 'open' | 'in_progress' | 'done',
        workNotes: job.workNotes,
        updatedAt: job.updatedAt.toISOString(),
        authorization,
      },
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

function derivedUuid(label: string, parts: string[]): string {
  const hash = createHash('sha256')
  hash.update(label)
  for (const part of parts) hash.update('\0').update(part)
  const bytes = hash.digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}


type SafeEscalatedJob = {
  id: string
  title: string
  kind: 'diagnostic'
  requiredSkillTier: number
  assignedTechId: null
  workStatus: 'open'
  approvalState: 'pending_quote'
  sessionId: null
}

export type WorkEscalationResult =
  | { ok: true; changed: boolean; job: SafeEscalatedJob }
  | SimpleWorkFailure

export type WorkEscalationDependencies = Readonly<{
  afterLocks?: () => Promise<void>
  afterWrite?: () => Promise<void>
  afterFinalization?: () => Promise<void>
}>

const escalationBodySchema = z.strictObject({
  requestKey: uuidSchema,
  concern: z.string().trim().min(5).max(500),
  requiredSkillTier: z.number().int().min(1).max(3),
})

function safeEscalatedJob(job: typeof ticketJobs.$inferSelect): SafeEscalatedJob | null {
  if (job.kind !== 'diagnostic' || job.assignedTechId !== null || job.workStatus !== 'open'
    || job.approvalState !== 'pending_quote' || job.sessionId !== null) return null
  return {
    id: job.id,
    title: job.title,
    kind: job.kind,
    requiredSkillTier: job.requiredSkillTier,
    assignedTechId: null,
    workStatus: job.workStatus,
    approvalState: job.approvalState,
    sessionId: null,
  }
}

function exactEscalation(
  job: typeof ticketJobs.$inferSelect,
  expected: {
    id: string
    shopId: string
    ticketId: string
    title: string
    concern: string
    requiredSkillTier: number
    actorProfileId: string
    sourceJobId: string
  },
): SafeEscalatedJob | null {
  if (job.id !== expected.id || job.shopId !== expected.shopId || job.ticketId !== expected.ticketId
    || job.title !== expected.title || job.requiredSkillTier !== expected.requiredSkillTier
    || job.claimedAt !== null || job.customerStory !== null || job.storyMeta !== null || job.workNotes !== null
    || job.approvedQuoteVersionId !== null || job.diagnosticStartState !== 'idle'
    || job.diagnosticStartAttemptKey !== null || job.diagnosticStartLeaseUntil !== null
    || job.diagnosticStartErrorCode !== null || job.sequenceNumber === null || job.revision !== 1n
    || job.workStatement !== expected.concern || job.statementSource !== 'technician_found'
    || job.statementReviewState !== 'confirmed'
    || job.statementConfirmedByProfileId !== expected.actorProfileId
    || job.statementConfirmedAt === null || job.createdByProfileId !== expected.actorProfileId
    || job.creatorProvenance !== 'direct' || job.createdFromJobId !== expected.sourceJobId) return null
  return safeEscalatedJob(job)
}

export async function createWorkEscalation(
  db: AppDb,
  input: {
    actor: SimpleWorkActor
    ticketId: unknown
    sourceJobId: unknown
    body: unknown
  },
  dependencies: WorkEscalationDependencies = {},
): Promise<WorkEscalationResult> {
  const parsedActor = z.strictObject({ profileId: uuidSchema, shopId: uuidSchema }).safeParse(input.actor)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedSource = uuidSchema.safeParse(input.sourceJobId)
  const parsedBody = escalationBodySchema.safeParse(input.body)
  if (!parsedActor.success || !parsedTicket.success || !parsedSource.success || !parsedBody.success) {
    return failure('invalid_input')
  }
  const title = `Diagnose: ${parsedBody.data.concern}`
  const jobId = derivedUuid('shop-os-work-escalation-v1', [
    parsedActor.data.shopId,
    parsedTicket.data,
    parsedSource.data,
    parsedActor.data.profileId,
    parsedBody.data.requestKey,
  ])
  const expected = {
    id: jobId,
    shopId: parsedActor.data.shopId,
    ticketId: parsedTicket.data,
    title,
    concern: parsedBody.data.concern,
    requiredSkillTier: parsedBody.data.requiredSkillTier,
    actorProfileId: parsedActor.data.profileId,
    sourceJobId: parsedSource.data,
  }

  try {
    return await runBoundedShopOsMutationV1<WorkEscalationResult, SimpleWorkDiscovery>(db, {
      discover: async (tx) => discoverSimpleWorkMutation(tx, {
        shopId: parsedActor.data.shopId,
        actorProfileId: parsedActor.data.profileId,
        ticketId: parsedTicket.data,
        jobId: parsedSource.data,
        insertionJobId: jobId,
      }),
      executeLocked: async (tx, scope, discovery) => {
      const context = resolveSimpleWorkScope(
        tx, scope, discovery, parsedTicket.data, parsedSource.data,
      )
      await dependencies.afterLocks?.()
      if (discovery.insertionState === 'collision') return failure('conflict')
      if (discovery.insertionState === 'existing') {
        const existing = scope.tickets.flatMap(({ jobs }) => jobs)
          .find(({ id }) => id === jobId)
        if (!existing) throw new ShopOsMutationConflict()
        const projected = exactEscalation(existing, expected)
        return projected
          ? { ok: true, changed: false, job: projected }
          : failure('conflict')
      }
      if (discovery.insertionState !== 'create') throw new ShopOsMutationConflict()
      if (context.ticket.status !== 'open' || context.job.workStatus !== 'in_progress') {
        return failure('not_ready')
      }
      if (!hasPinnedApproval(context, false)) return failure('not_authorized')
      const [reservation] = reserveJobSequencesForInsertionV1(tx, scope, parsedTicket.data, [jobId])
      if (!reservation || reservation.jobId !== jobId) throw new ShopOsMutationConflict()
      const [created] = await tx.insert(ticketJobs).values({
        id: jobId,
        shopId: parsedActor.data.shopId,
        ticketId: parsedTicket.data,
        title,
        kind: 'diagnostic',
        requiredSkillTier: parsedBody.data.requiredSkillTier,
        assignedTechId: null,
        sessionId: null,
        workStatus: 'open',
        approvalState: 'pending_quote',
        customerStory: null,
        storyMeta: null,
        workNotes: null,
        approvedQuoteVersionId: null,
        sequenceNumber: reservation.sequenceNumber,
        workStatement: parsedBody.data.concern,
        statementSource: 'technician_found',
        statementReviewState: 'confirmed',
        statementConfirmedByProfileId: parsedActor.data.profileId,
        statementConfirmedAt: sql`clock_timestamp()`,
        createdByProfileId: parsedActor.data.profileId,
        creatorProvenance: 'direct',
        createdFromJobId: parsedSource.data,
        revision: 1n,
      }).returning()
      const projected = created ? exactEscalation(created, expected) : null
      if (!projected) throw new TypeError('created escalation shape is invalid')
      await dependencies.afterWrite?.()
      await finalizeMutationRevisionsV1(tx, scope, {
        sessionIds: [], customerIds: [], vehicleIds: [],
      }, [{
        ticketId: parsedTicket.data,
        createdTicket: false,
        createdJobIds: [jobId],
        existingChangedJobIds: [],
        actorVisibleTicketFieldsChanged: true,
      }])
      await dependencies.afterFinalization?.()
      return { ok: true, changed: true, job: projected }
      },
    })
  } catch (error) {
    if (error instanceof ShopOsMutationNotFound) return failure('not_found')
    if (error instanceof ShopOsMutationConflict
      || (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')) {
      return failure('conflict', true)
    }
    throw error
  }
}
