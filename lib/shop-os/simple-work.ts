import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  profiles,
  quoteEvents,
  quoteVersions,
  ticketJobs,
  tickets,
} from '@/lib/db/schema'
import { isShopRole } from '@/lib/shop-os/capabilities'
import {
  isLockUnavailable,
  quoteSnapshotContainsExactJob,
} from '@/lib/shop-os/quotes'

export type SimpleWorkActor = { profileId: string; shopId: string }
export type SimpleWorkError = 'invalid_input' | 'not_found' | 'not_authorized' | 'not_ready' | 'conflict'
export type SimpleWorkFailure = { ok: false; error: SimpleWorkError; retryable?: true }

type WorkProjection = {
  status: 'open' | 'in_progress' | 'done'
  workNotes: string | null
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
}

export type SimpleWorkMutationResult =
  | { ok: true; changed: boolean; work: WorkProjection }
  | SimpleWorkFailure

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

function safeWork(job: Pick<typeof ticketJobs.$inferSelect, 'workStatus' | 'workNotes' | 'workStartedAt' | 'workCompletedAt' | 'updatedAt'>): WorkProjection {
  if (job.workStatus !== 'open' && job.workStatus !== 'in_progress' && job.workStatus !== 'done') {
    throw new TypeError('simple work status is unavailable')
  }
  return {
    status: job.workStatus,
    workNotes: job.workNotes,
    startedAt: job.workStartedAt ? job.workStartedAt.toISOString() : null,
    completedAt: job.workCompletedAt ? job.workCompletedAt.toISOString() : null,
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

function nextTimestamp(previous: Date) {
  return sql`greatest(clock_timestamp(), ${previous}::timestamptz + interval '1 millisecond')`
}

export async function mutateSimpleWork(
  db: AppDb,
  input: { actor: SimpleWorkActor; ticketId: unknown; jobId: unknown; body: unknown },
): Promise<SimpleWorkMutationResult> {
  const parsedActor = z.strictObject({ profileId: uuidSchema, shopId: uuidSchema }).safeParse(input.actor)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedJob = uuidSchema.safeParse(input.jobId)
  const parsedAction = actionSchema.safeParse(input.body)
  if (!parsedActor.success || !parsedTicket.success || !parsedJob.success || !parsedAction.success) {
    return failure('invalid_input')
  }
  try {
    return await db.transaction(async (tx) => {
      const context = await lockContext(tx as AppDb, {
        actor: parsedActor.data,
        ticketId: parsedTicket.data,
        jobId: parsedJob.data,
      })
      if (!context) return failure('not_found')
      const { job } = context
      const action = parsedAction.data

      if (action.action === 'complete' && job.workStatus === 'done') {
        return { ok: true, changed: false, work: safeWork(job) }
      }
      if (context.ticket.status !== 'open') return failure('not_found')

      if (action.action === 'start') {
        if (job.workStatus === 'in_progress') {
          return hasPinnedApproval(context, false)
            ? { ok: true, changed: false, work: safeWork(job) }
            : failure('not_authorized')
        }
        if (job.workStatus !== 'open') return failure('not_ready')
        if (!hasPinnedApproval(context, true)) return failure('not_authorized')
        const [updated] = await (tx as AppDb)
          .update(ticketJobs)
          .set({
            workStatus: 'in_progress',
            workStartedAt: sql`clock_timestamp()`,
            updatedAt: nextTimestamp(job.updatedAt),
          })
          .where(and(
            eq(ticketJobs.shopId, parsedActor.data.shopId),
            eq(ticketJobs.id, job.id),
            eq(ticketJobs.workStatus, 'open'),
          ))
          .returning()
        return updated
          ? { ok: true, changed: true, work: safeWork(updated) }
          : failure('conflict', true)
      }

      if (job.workStatus !== 'in_progress') return failure('not_ready')
      if (!hasPinnedApproval(context, false)) return failure('not_authorized')

      if (action.action === 'save_note') {
        if (job.workNotes === action.note) {
          return { ok: true, changed: false, work: safeWork(job) }
        }
        if (job.updatedAt.getTime() !== new Date(action.expectedUpdatedAt).getTime()) {
          return failure('conflict', true)
        }
        const [updated] = await (tx as AppDb)
          .update(ticketJobs)
          .set({ workNotes: action.note, updatedAt: nextTimestamp(job.updatedAt) })
          .where(and(
            eq(ticketJobs.shopId, parsedActor.data.shopId),
            eq(ticketJobs.id, job.id),
            eq(ticketJobs.updatedAt, job.updatedAt),
          ))
          .returning()
        return updated
          ? { ok: true, changed: true, work: safeWork(updated) }
          : failure('conflict', true)
      }

      if (job.updatedAt.getTime() !== new Date(action.expectedUpdatedAt).getTime()) {
        return failure('conflict', true)
      }
      if (!job.workNotes?.trim()) return failure('not_ready')
      const [updated] = await (tx as AppDb)
        .update(ticketJobs)
        .set({
          workStatus: 'done',
          workCompletedAt: sql`clock_timestamp()`,
          updatedAt: nextTimestamp(job.updatedAt),
        })
        .where(and(
          eq(ticketJobs.shopId, parsedActor.data.shopId),
          eq(ticketJobs.id, job.id),
          eq(ticketJobs.workStatus, 'in_progress'),
          eq(ticketJobs.updatedAt, job.updatedAt),
        ))
        .returning()
      return updated
        ? { ok: true, changed: true, work: safeWork(updated) }
        : failure('conflict', true)
    })
  } catch (error) {
    if (isLockUnavailable(error)) return failure('conflict', true)
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
        startedAt: job.workStartedAt ? job.workStartedAt.toISOString() : null,
        completedAt: job.workCompletedAt ? job.workCompletedAt.toISOString() : null,
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
  expected: { id: string; shopId: string; ticketId: string; title: string; requiredSkillTier: number },
): SafeEscalatedJob | null {
  if (job.id !== expected.id || job.shopId !== expected.shopId || job.ticketId !== expected.ticketId
    || job.title !== expected.title || job.requiredSkillTier !== expected.requiredSkillTier
    || job.claimedAt !== null || job.customerStory !== null || job.storyMeta !== null || job.workNotes !== null
    || job.approvedQuoteVersionId !== null || job.diagnosticStartState !== 'idle'
    || job.diagnosticStartAttemptKey !== null || job.diagnosticStartLeaseUntil !== null
    || job.diagnosticStartErrorCode !== null) return null
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
    requiredSkillTier: parsedBody.data.requiredSkillTier,
  }

  try {
    return await db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      const context = await lockContext(transactionDb, {
        actor: parsedActor.data,
        ticketId: parsedTicket.data,
        jobId: parsedSource.data,
      })
      if (!context) return failure('not_found')
      const [existing] = await transactionDb.select().from(ticketJobs)
        .where(eq(ticketJobs.id, jobId)).limit(1)
      if (existing) {
        const projected = exactEscalation(existing, expected)
        return projected
          ? { ok: true, changed: false, job: projected }
          : failure('conflict')
      }
      if (context.ticket.status !== 'open' || context.job.workStatus !== 'in_progress') {
        return failure('not_ready')
      }
      if (!hasPinnedApproval(context, false)) return failure('not_authorized')
      const [created] = await transactionDb.insert(ticketJobs).values({
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
      }).returning()
      const projected = safeEscalatedJob(created)
      if (!projected) throw new TypeError('created escalation shape is invalid')
      return { ok: true, changed: true, job: projected }
    })
  } catch (error) {
    if (isLockUnavailable(error)
      || (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')) {
      return failure('conflict', true)
    }
    throw error
  }
}
