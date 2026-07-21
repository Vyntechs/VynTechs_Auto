import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { profiles, ticketActivity, ticketJobs, ticketPayments, tickets } from '@/lib/db/schema'
import { canAssignWork, isShopRole } from '@/lib/shop-os/capabilities'
import { isLockUnavailable } from '@/lib/shop-os/quotes'
import { nextSimpleWorkTimestamp } from '@/lib/shop-os/simple-work'
import { appendTicketActivity } from '@/lib/shop-os/ticket-activity'

export type InterruptionActor = {
  profileId: string
  shopId: string
  role: string
  membershipStatus: string
  deactivatedAt: Date | null
}

export type InterruptionError =
  | 'invalid_input'
  | 'not_found'
  | 'inactive_profile'
  | 'forbidden'
  | 'not_ready'
  | 'conflict'

export type InterruptionJobProjection = {
  id: string
  assignedTechId: string | null
  workStatus: 'open' | 'in_progress' | 'blocked' | 'done' | 'canceled'
  holdKind: 'parts' | 'customer' | 'schedule' | 'shop' | null
  holdNote: string | null
  holdResumeStatus: 'open' | 'in_progress' | null
  heldAt: string | null
  heldByProfileId: string | null
  clockedOnSince: string | null
  activeSeconds: number
  updatedAt: string
}

export type InterruptionResult =
  | { ok: true; changed: boolean; job: InterruptionJobProjection }
  | { ok: false; error: InterruptionError; retryable?: true }

export type TicketLifecycleProjection = {
  id: string
  status: 'open' | 'closed' | 'canceled'
  jobs: Array<{ id: string; workStatus: 'open' | 'in_progress' | 'blocked' | 'done' | 'canceled' }>
}

export type TicketLifecycleResult =
  | { ok: true; changed: boolean; ticket: TicketLifecycleProjection }
  | { ok: false; error: InterruptionError; retryable?: true }

const uuid = z.uuid().transform((value) => value.toLowerCase())
const blockBody = z.strictObject({
  action: z.literal('block'),
  requestKey: uuid,
  holdKind: z.enum(['parts', 'customer', 'schedule', 'shop']),
  holdNote: z.string().trim().min(1).max(500),
})
const resolveHoldBody = z.strictObject({
  action: z.literal('resolve_hold'),
  requestKey: uuid,
})

const handoffBody = z.strictObject({
  action: z.literal('handoff'),
  requestKey: uuid,
  assignedTechId: uuid,
})
const cancelBody = z.strictObject({
  action: z.literal('cancel'),
  requestKey: uuid,
  reason: z.string().trim().min(1).max(500),
})
const reopenBody = z.strictObject({
  action: z.literal('reopen'),
  requestKey: uuid,
})
const lifecycleBody = z.discriminatedUnion('action', [cancelBody, reopenBody])
const cancellationSnapshotJob = z.strictObject({
  id: uuid,
  workStatus: z.enum(['open', 'in_progress', 'blocked']),
  assignedTechId: uuid.nullable(),
  claimedAt: z.string().datetime({ offset: true }).nullable(),
  workStartedAt: z.string().datetime({ offset: true }).nullable(),
  activeSeconds: z.number().int().min(0),
  holdKind: z.enum(['parts', 'customer', 'schedule', 'shop']).nullable(),
  holdNote: z.string().min(1).max(500).nullable(),
  holdResumeStatus: z.enum(['open', 'in_progress']).nullable(),
  heldAt: z.string().datetime({ offset: true }).nullable(),
  heldByProfileId: uuid.nullable(),
})
const cancellationSnapshot = z.strictObject({
  reason: z.string().min(1).max(500),
  interruptedJobs: z.array(cancellationSnapshotJob).max(25),
})

const mutationBody = z.discriminatedUnion('action', [blockBody, resolveHoldBody, handoffBody])

const JOB_ACTIVITY_KIND = {
  block: 'job_blocked',
  resolve_hold: 'job_hold_resolved',
  handoff: 'job_handed_off',
} as const

const LIFECYCLE_ACTIVITY_KIND = {
  cancel: 'ticket_canceled',
  reopen: 'ticket_reopened',
} as const

function failure(error: InterruptionError, retryable = false): InterruptionResult {
  return retryable ? { ok: false, error, retryable: true } : { ok: false, error }
}

function projection(job: Pick<typeof ticketJobs.$inferSelect,
  | 'id'
  | 'assignedTechId'
  | 'workStatus'
  | 'holdKind'
  | 'holdNote'
  | 'holdResumeStatus'
  | 'heldAt'
  | 'heldByProfileId'
  | 'clockedOnSince'
  | 'activeSeconds'
  | 'updatedAt'
>): InterruptionJobProjection {
  return {
    id: job.id,
    assignedTechId: job.assignedTechId,
    workStatus: job.workStatus,
    holdKind: job.holdKind,
    holdNote: job.holdNote,
    holdResumeStatus: job.holdResumeStatus,
    heldAt: job.heldAt ? job.heldAt.toISOString() : null,
    heldByProfileId: job.heldByProfileId,
    clockedOnSince: job.clockedOnSince ? job.clockedOnSince.toISOString() : null,
    activeSeconds: job.activeSeconds,
    updatedAt: job.updatedAt.toISOString(),
  }
}

function bankClock() {
  return sql`${ticketJobs.activeSeconds} + case when ${ticketJobs.clockedOnSince} is not null
    then round(extract(epoch from (clock_timestamp() - ${ticketJobs.clockedOnSince})))::int else 0 end`
}

function lifecycleFailure(error: InterruptionError, retryable = false): TicketLifecycleResult {
  return retryable ? { ok: false, error, retryable: true } : { ok: false, error }
}

async function lifecycleProjection(
  db: AppDb,
  shopId: string,
  ticket: { id: string; status: string },
): Promise<TicketLifecycleProjection> {
  if (ticket.status !== 'open' && ticket.status !== 'closed' && ticket.status !== 'canceled') {
    throw new Error('invalid_ticket_lifecycle_status')
  }
  const jobs = await db.select({ id: ticketJobs.id, workStatus: ticketJobs.workStatus })
    .from(ticketJobs)
    .where(and(eq(ticketJobs.shopId, shopId), eq(ticketJobs.ticketId, ticket.id)))
    .orderBy(ticketJobs.createdAt, ticketJobs.id)
  return {
    id: ticket.id,
    status: ticket.status,
    jobs: jobs.map((job) => ({ id: job.id, workStatus: job.workStatus })),
  }
}

export async function mutateJobInterruption(
  db: AppDb,
  input: { actor: InterruptionActor; ticketId: unknown; jobId: unknown; body: unknown },
): Promise<InterruptionResult> {
  const actor = z.strictObject({
    profileId: uuid,
    shopId: uuid,
    role: z.string(),
    membershipStatus: z.string(),
    deactivatedAt: z.date().nullable(),
  }).safeParse(input.actor)
  const ticketId = uuid.safeParse(input.ticketId)
  const jobId = uuid.safeParse(input.jobId)
  const body = mutationBody.safeParse(input.body)
  if (!actor.success || !ticketId.success || !jobId.success || !body.success) {
    return failure('invalid_input')
  }

  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as AppDb
      const [profile] = await tx
        .select({
          id: profiles.id,
          role: profiles.role,
          membershipStatus: profiles.membershipStatus,
          deactivatedAt: profiles.deactivatedAt,
        })
        .from(profiles)
        .where(and(
          eq(profiles.shopId, actor.data.shopId),
          eq(profiles.id, actor.data.profileId),
        ))
        .limit(1)
        .for('update', { noWait: true })
      if (!profile) return failure('not_found')
      if (profile.membershipStatus !== 'active' || profile.deactivatedAt) {
        return failure('inactive_profile')
      }
      if (!isShopRole(profile.role)) return failure('forbidden')

      const [ticket] = await tx
        .select({ id: tickets.id, status: tickets.status })
        .from(tickets)
        .where(and(
          eq(tickets.shopId, actor.data.shopId),
          eq(tickets.id, ticketId.data),
        ))
        .limit(1)
        .for('update', { noWait: true })
      if (!ticket) return failure('not_found')
      if (ticket.status !== 'open') return failure('not_ready')

      const [job] = await tx
        .select()
        .from(ticketJobs)
        .where(and(
          eq(ticketJobs.shopId, actor.data.shopId),
          eq(ticketJobs.ticketId, ticket.id),
          eq(ticketJobs.id, jobId.data),
        ))
        .limit(1)
        .for('update', { noWait: true })
      if (!job) return failure('not_found')
      if (!canAssignWork(profile.role) && (profile.role !== 'tech' || job.assignedTechId !== profile.id)) {
        return failure('forbidden')
      }

      const [receipt] = await tx
        .select({
          ticketId: ticketActivity.ticketId,
          jobId: ticketActivity.jobId,
          actorProfileId: ticketActivity.actorProfileId,
          kind: ticketActivity.kind,
        })
        .from(ticketActivity)
        .where(and(
          eq(ticketActivity.shopId, actor.data.shopId),
          eq(ticketActivity.requestKey, body.data.requestKey),
        ))
        .limit(1)
      if (receipt) {
        if (receipt.ticketId !== ticket.id
          || receipt.jobId !== job.id
          || receipt.actorProfileId !== profile.id
          || receipt.kind !== JOB_ACTIVITY_KIND[body.data.action]) {
          return failure('conflict')
        }
        return { ok: true, changed: false, job: projection(job) }
      }

      if (body.data.action === 'handoff') {
        if (!canAssignWork(profile.role)) return failure('forbidden')
        if (!['open', 'in_progress', 'blocked'].includes(job.workStatus)) {
          return failure('not_ready')
        }
        const [assignee] = await tx
          .select({
            id: profiles.id,
            role: profiles.role,
            skillTier: profiles.skillTier,
            membershipStatus: profiles.membershipStatus,
            deactivatedAt: profiles.deactivatedAt,
          })
          .from(profiles)
          .where(and(
            eq(profiles.shopId, actor.data.shopId),
            eq(profiles.id, body.data.assignedTechId),
          ))
          .limit(1)
          .for('update', { noWait: true })
        if (!assignee || !isShopRole(assignee.role)
          || assignee.membershipStatus !== 'active'
          || assignee.deactivatedAt
          || assignee.skillTier === null
          || assignee.skillTier < job.requiredSkillTier) {
          return failure('forbidden')
        }
        if (job.assignedTechId === assignee.id) {
          return { ok: true, changed: false, job: projection(job) }
        }
        const [updated] = await tx
          .update(ticketJobs)
          .set({
            assignedTechId: assignee.id,
            claimedAt: null,
            activeSeconds: bankClock(),
            clockedOnSince: null,
            updatedAt: nextSimpleWorkTimestamp(),
          })
          .where(and(
            eq(ticketJobs.shopId, actor.data.shopId),
            eq(ticketJobs.id, job.id),
            inArray(ticketJobs.workStatus, ['open', 'in_progress', 'blocked']),
          ))
          .returning()
        if (!updated) return failure('conflict', true)
        const activity = await appendTicketActivity(tx, {
          shopId: actor.data.shopId,
          ticketId: ticket.id,
          jobId: job.id,
          actorProfileId: profile.id,
          kind: 'job_handed_off',
          requestKey: body.data.requestKey,
          payload: {
            fromAssignedTechId: job.assignedTechId,
            toAssignedTechId: assignee.id,
            workStatus: job.workStatus,
          },
        })
        if (!activity.ok) throw new Error('ticket_activity_conflict')
        return { ok: true, changed: true, job: projection(updated) }
      }

      if (body.data.action === 'block') {
        if (job.workStatus !== 'open' && job.workStatus !== 'in_progress') {
          return failure('not_ready')
        }
        const [updated] = await tx
          .update(ticketJobs)
          .set({
            workStatus: 'blocked',
            activeSeconds: bankClock(),
            clockedOnSince: null,
            holdKind: body.data.holdKind,
            holdNote: body.data.holdNote,
            holdResumeStatus: job.workStatus,
            heldAt: sql`clock_timestamp()`,
            heldByProfileId: profile.id,
            updatedAt: nextSimpleWorkTimestamp(),
          })
          .where(and(
            eq(ticketJobs.shopId, actor.data.shopId),
            eq(ticketJobs.id, job.id),
            inArray(ticketJobs.workStatus, ['open', 'in_progress']),
          ))
          .returning()
        if (!updated) return failure('conflict', true)
        const activity = await appendTicketActivity(tx, {
          shopId: actor.data.shopId,
          ticketId: ticket.id,
          jobId: job.id,
          actorProfileId: profile.id,
          kind: 'job_blocked',
          requestKey: body.data.requestKey,
          payload: {
            from: job.workStatus,
            to: 'blocked',
            holdKind: body.data.holdKind,
            holdNote: body.data.holdNote,
            resumeStatus: job.workStatus,
          },
        })
        if (!activity.ok) throw new Error('ticket_activity_conflict')
        return { ok: true, changed: true, job: projection(updated) }
      }

      if (job.workStatus !== 'blocked') return failure('not_ready')
      const resumeStatus = job.holdResumeStatus
        ?? (job.workStartedAt ? 'in_progress' : 'open')
      const holdKind = job.holdKind ?? 'shop'
      const [updated] = await tx
        .update(ticketJobs)
        .set({
          workStatus: resumeStatus,
          holdKind: null,
          holdNote: null,
          holdResumeStatus: null,
          heldAt: null,
          heldByProfileId: null,
          updatedAt: nextSimpleWorkTimestamp(),
        })
        .where(and(
          eq(ticketJobs.shopId, actor.data.shopId),
          eq(ticketJobs.id, job.id),
          eq(ticketJobs.workStatus, 'blocked'),
        ))
        .returning()
      if (!updated) return failure('conflict', true)
      const activity = await appendTicketActivity(tx, {
        shopId: actor.data.shopId,
        ticketId: ticket.id,
        jobId: job.id,
        actorProfileId: profile.id,
        kind: 'job_hold_resolved',
        requestKey: body.data.requestKey,
        payload: { from: 'blocked', to: resumeStatus, holdKind },
      })
      if (!activity.ok) throw new Error('ticket_activity_conflict')
      return { ok: true, changed: true, job: projection(updated) }
    })
  } catch (error) {
    if (isLockUnavailable(error) || error instanceof Error && error.message === 'ticket_activity_conflict') {
      return failure('conflict', true)
    }
    throw error
  }
}

export async function mutateTicketLifecycle(
  db: AppDb,
  input: { actor: InterruptionActor; ticketId: unknown; body: unknown },
): Promise<TicketLifecycleResult> {
  const actor = z.strictObject({
    profileId: uuid,
    shopId: uuid,
    role: z.string(),
    membershipStatus: z.string(),
    deactivatedAt: z.date().nullable(),
  }).safeParse(input.actor)
  const ticketId = uuid.safeParse(input.ticketId)
  const body = lifecycleBody.safeParse(input.body)
  if (!actor.success || !ticketId.success || !body.success) return lifecycleFailure('invalid_input')

  try {
    return await db.transaction(async (txRaw) => {
      const tx = txRaw as AppDb
      const [profile] = await tx.select({
        id: profiles.id,
        role: profiles.role,
        membershipStatus: profiles.membershipStatus,
        deactivatedAt: profiles.deactivatedAt,
      }).from(profiles).where(and(
        eq(profiles.shopId, actor.data.shopId),
        eq(profiles.id, actor.data.profileId),
      )).limit(1).for('update', { noWait: true })
      if (!profile) return lifecycleFailure('not_found')
      if (profile.membershipStatus !== 'active' || profile.deactivatedAt) {
        return lifecycleFailure('inactive_profile')
      }
      if (!canAssignWork(profile.role)) return lifecycleFailure('forbidden')

      const [ticket] = await tx.select({ id: tickets.id, status: tickets.status })
        .from(tickets).where(and(
          eq(tickets.shopId, actor.data.shopId),
          eq(tickets.id, ticketId.data),
        )).limit(1).for('update', { noWait: true })
      if (!ticket) return lifecycleFailure('not_found')
      const [receipt] = await tx
        .select({
          ticketId: ticketActivity.ticketId,
          jobId: ticketActivity.jobId,
          actorProfileId: ticketActivity.actorProfileId,
          kind: ticketActivity.kind,
        })
        .from(ticketActivity)
        .where(and(
          eq(ticketActivity.shopId, actor.data.shopId),
          eq(ticketActivity.requestKey, body.data.requestKey),
        ))
        .limit(1)
      if (receipt) {
        if (receipt.ticketId !== ticket.id
          || receipt.jobId !== null
          || receipt.actorProfileId !== profile.id
          || receipt.kind !== LIFECYCLE_ACTIVITY_KIND[body.data.action]) {
          return lifecycleFailure('conflict')
        }
        const projected = await lifecycleProjection(tx, actor.data.shopId, ticket)
        return { ok: true, changed: false, ticket: projected }
      }
      if (body.data.action === 'reopen') {
        if (ticket.status !== 'canceled') return lifecycleFailure('not_ready')
        const [cancellation] = await tx.select({ payload: ticketActivity.payload })
          .from(ticketActivity).where(and(
            eq(ticketActivity.shopId, actor.data.shopId),
            eq(ticketActivity.ticketId, ticket.id),
            eq(ticketActivity.kind, 'ticket_canceled'),
          )).orderBy(desc(ticketActivity.createdAt), desc(ticketActivity.id)).limit(1)
          .for('update', { noWait: true })
        const snapshot = cancellationSnapshot.safeParse(cancellation?.payload)
        if (!snapshot.success) return lifecycleFailure('conflict', true)
        const jobs = await tx.select().from(ticketJobs).where(and(
          eq(ticketJobs.shopId, actor.data.shopId),
          eq(ticketJobs.ticketId, ticket.id),
        )).for('update', { noWait: true })
        const jobsById = new Map(jobs.map((job) => [job.id, job]))
        for (const saved of snapshot.data.interruptedJobs) {
          const current = jobsById.get(saved.id)
          if (!current || current.workStatus !== 'canceled') return lifecycleFailure('conflict', true)
          const [restored] = await tx.update(ticketJobs).set({
            workStatus: saved.workStatus,
            assignedTechId: saved.assignedTechId,
            claimedAt: saved.claimedAt ? new Date(saved.claimedAt) : null,
            workStartedAt: saved.workStartedAt ? new Date(saved.workStartedAt) : null,
            activeSeconds: saved.activeSeconds,
            clockedOnSince: null,
            holdKind: saved.holdKind,
            holdNote: saved.holdNote,
            holdResumeStatus: saved.holdResumeStatus,
            heldAt: saved.heldAt ? new Date(saved.heldAt) : null,
            heldByProfileId: saved.heldByProfileId,
            updatedAt: nextSimpleWorkTimestamp(),
          }).where(and(
            eq(ticketJobs.shopId, actor.data.shopId),
            eq(ticketJobs.id, saved.id),
            eq(ticketJobs.workStatus, 'canceled'),
          )).returning()
          if (!restored) return lifecycleFailure('conflict', true)
        }
        const [reopened] = await tx.update(tickets).set({
          status: 'open',
          canceledAt: null,
          canceledByProfileId: null,
          canceledReason: null,
          updatedAt: sql`clock_timestamp()`,
        }).where(and(
          eq(tickets.shopId, actor.data.shopId),
          eq(tickets.id, ticket.id),
          eq(tickets.status, 'canceled'),
        )).returning()
        if (!reopened) return lifecycleFailure('conflict', true)
        const activity = await appendTicketActivity(tx, {
          shopId: actor.data.shopId,
          ticketId: ticket.id,
          actorProfileId: profile.id,
          kind: 'ticket_reopened',
          requestKey: body.data.requestKey,
          payload: { restoredJobIds: snapshot.data.interruptedJobs.map((job) => job.id) },
        })
        if (!activity.ok) throw new Error('ticket_activity_conflict')
        return { ok: true, changed: true, ticket: await lifecycleProjection(tx, actor.data.shopId, reopened) }
      }

      if (ticket.status !== 'open') return lifecycleFailure('not_ready')

      const [payment] = await tx.select({ id: ticketPayments.id }).from(ticketPayments)
        .where(and(
          eq(ticketPayments.shopId, actor.data.shopId),
          eq(ticketPayments.ticketId, ticket.id),
        )).limit(1).for('update', { noWait: true })
      if (payment) return lifecycleFailure('not_ready')

      const jobs = await tx.select().from(ticketJobs).where(and(
        eq(ticketJobs.shopId, actor.data.shopId),
        eq(ticketJobs.ticketId, ticket.id),
      )).for('update', { noWait: true })
      const interrupted = jobs.filter((job) => (
        job.workStatus === 'open' || job.workStatus === 'in_progress' || job.workStatus === 'blocked'
      ))
      const canceled = interrupted.length
        ? await tx.update(ticketJobs).set({
            workStatus: 'canceled',
            activeSeconds: bankClock(),
            clockedOnSince: null,
            updatedAt: nextSimpleWorkTimestamp(),
          }).where(and(
            eq(ticketJobs.shopId, actor.data.shopId),
            eq(ticketJobs.ticketId, ticket.id),
            inArray(ticketJobs.id, interrupted.map((job) => job.id)),
          )).returning()
        : []
      const activeSecondsById = new Map(canceled.map((job) => [job.id, job.activeSeconds]))
      const interruptedJobs = interrupted.map((job) => ({
        id: job.id,
        workStatus: job.workStatus,
        assignedTechId: job.assignedTechId,
        claimedAt: job.claimedAt ? job.claimedAt.toISOString() : null,
        workStartedAt: job.workStartedAt ? job.workStartedAt.toISOString() : null,
        activeSeconds: activeSecondsById.get(job.id) ?? job.activeSeconds,
        holdKind: job.holdKind,
        holdNote: job.holdNote,
        holdResumeStatus: job.holdResumeStatus,
        heldAt: job.heldAt ? job.heldAt.toISOString() : null,
        heldByProfileId: job.heldByProfileId,
      }))

      const [updated] = await tx.update(tickets).set({
        status: 'canceled',
        canceledAt: sql`clock_timestamp()`,
        canceledByProfileId: profile.id,
        canceledReason: body.data.reason,
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(tickets.shopId, actor.data.shopId),
        eq(tickets.id, ticket.id),
        eq(tickets.status, 'open'),
      )).returning()
      if (!updated) return lifecycleFailure('conflict', true)
      const activity = await appendTicketActivity(tx, {
        shopId: actor.data.shopId,
        ticketId: ticket.id,
        actorProfileId: profile.id,
        kind: 'ticket_canceled',
        requestKey: body.data.requestKey,
        payload: { reason: body.data.reason, interruptedJobs },
      })
      if (!activity.ok) throw new Error('ticket_activity_conflict')
      return { ok: true, changed: true, ticket: await lifecycleProjection(tx, actor.data.shopId, updated) }
    })
  } catch (error) {
    if (isLockUnavailable(error) || error instanceof Error && error.message === 'ticket_activity_conflict') {
      return lifecycleFailure('conflict', true)
    }
    throw error
  }
}
