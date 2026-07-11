import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import {
  profiles,
  quoteEvents,
  quoteVersions,
  sessions,
  ticketJobs,
  tickets,
} from '@/lib/db/schema'
import { quoteSnapshotContainsJob } from '@/lib/shop-os/quotes'

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

export async function lockDiagnosticRepairAccess(
  db: AppDb,
  input: { shopId: string; sessionId: string; actorProfileId: string },
): Promise<LockedDiagnosticRepairAccess> {
  const discovered = await db
    .select({ ticketId: ticketJobs.ticketId })
    .from(ticketJobs)
    .where(eq(ticketJobs.sessionId, input.sessionId))
    .limit(2)
  if (discovered.length === 0) return { state: 'legacy' }
  if (discovered.length !== 1) return { state: 'unavailable' }

  const [ticket] = await db
    .select({ id: tickets.id, status: tickets.status })
    .from(tickets)
    .where(and(eq(tickets.shopId, input.shopId), eq(tickets.id, discovered[0].ticketId)))
    .limit(1)
    .for('update', { noWait: true })
  if (!ticket) return { state: 'unavailable' }

  const jobs = await db
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
    .where(and(eq(ticketJobs.shopId, input.shopId), eq(ticketJobs.ticketId, ticket.id)))
    .orderBy(asc(ticketJobs.id))
    .for('update', { noWait: true })
  const job = jobs.find((candidate) => candidate.sessionId === input.sessionId)
  if (!job) return { state: 'unavailable' }

  const versions = await db
    .select({
      id: quoteVersions.id,
      ticketId: quoteVersions.ticketId,
      snapshot: quoteVersions.snapshot,
      supersededAt: quoteVersions.supersededAt,
    })
    .from(quoteVersions)
    .where(and(eq(quoteVersions.shopId, input.shopId), eq(quoteVersions.ticketId, ticket.id)))
    .orderBy(asc(quoteVersions.id))
    .for('update', { noWait: true })

  const [session] = await db
    .select({
      id: sessions.id,
      status: sessions.status,
      techId: sessions.techId,
      treeState: sessions.treeState,
      createdAt: sessions.createdAt,
    })
    .from(sessions)
    .where(and(eq(sessions.shopId, input.shopId), eq(sessions.id, input.sessionId)))
    .limit(1)
    .for('update', { noWait: true })
  const [actor] = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(and(
      eq(profiles.id, input.actorProfileId),
      eq(profiles.shopId, input.shopId),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
    .for('update', { noWait: true })
  if (
    !session
    || session.status !== 'open'
    || session.treeState.phase !== 'repairing'
    || session.techId !== input.actorProfileId
    || !actor
    || job.assignedTechId !== actor.id
  ) {
    return { state: 'unavailable' }
  }

  const decisions = await loadDecisionTruth(db, {
    shopId: input.shopId,
    ticketId: ticket.id,
    jobId: job.id,
  })
  const access = classifyAccess({
    expectedShopId: input.shopId,
    ticketOpen: ticket.status === 'open',
    sessionActionable: true,
    job,
    versions,
    decisions,
  })
  return access.state === 'declined'
    ? {
        ...access,
        lockedDiagnosis: {
          rootCauseSummary: session.treeState.rootCauseSummary,
          createdAt: session.createdAt,
        },
      }
    : access
}
