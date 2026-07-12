import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  jobAttachments,
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
export const MAX_JOB_ATTACHMENT_BYTES = 4 * 1024 * 1024

type WorkProjection = {
  status: 'open' | 'in_progress' | 'done'
  workNotes: string | null
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
  attachments: Array<typeof jobAttachments.$inferSelect>
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

  const attachments = await db
    .select()
    .from(jobAttachments)
    .where(and(eq(jobAttachments.shopId, input.actor.shopId), eq(jobAttachments.jobId, job.id)))
    .orderBy(asc(jobAttachments.id))
    .for('update', { noWait: true })
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
  return { ticket, job, versions, decisions, attachments }
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
          .set({ workStatus: 'in_progress', updatedAt: nextTimestamp(job.updatedAt) })
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
      const proofPrefix = `${parsedActor.data.shopId}/jobs/${job.id}/proof/`
      const hasWorkPhoto = context.attachments.some((attachment) =>
        attachment.kind === 'photo'
        && attachment.uploadedByProfileId === parsedActor.data.profileId
        && attachment.storageKey.startsWith(proofPrefix))
      if (!job.workNotes?.trim() || !hasWorkPhoto) return failure('not_ready')
      const [updated] = await (tx as AppDb)
        .update(ticketJobs)
        .set({ workStatus: 'done', updatedAt: nextTimestamp(job.updatedAt) })
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
    const [job] = await transactionDb.select().from(ticketJobs).where(and(
      eq(ticketJobs.shopId, parsedActor.data.shopId),
      eq(ticketJobs.ticketId, parsedTicket.data),
      eq(ticketJobs.id, parsedJob.data),
    )).limit(1)
    if (!actor || !isShopRole(actor.role) || !job || job.assignedTechId !== actor.id
      || (job.kind !== 'repair' && job.kind !== 'maintenance')
      || job.workStatus === 'blocked' || job.workStatus === 'canceled') return failure('not_found')
    const attachments = await transactionDb.select({
      id: jobAttachments.id,
      kind: jobAttachments.kind,
      mimeType: jobAttachments.mimeType,
      byteSize: jobAttachments.byteSize,
      createdAt: jobAttachments.createdAt,
    }).from(jobAttachments).where(and(
      eq(jobAttachments.shopId, parsedActor.data.shopId),
      eq(jobAttachments.jobId, job.id),
    )).orderBy(asc(jobAttachments.createdAt), asc(jobAttachments.id))

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
    const context: LockedContext = {
      ticket: { id: parsedTicket.data, status: 'open' }, job, versions, decisions, attachments: [],
    }
    const authorization = hasPinnedApproval(context, job.workStatus === 'open')
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
        attachments: attachments.map((attachment) => ({
          ...attachment,
          createdAt: attachment.createdAt.toISOString(),
        })),
      },
    }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

type JobAttachmentKind = 'photo' | 'video' | 'document'
type SafeJobAttachment = {
  id: string
  kind: JobAttachmentKind
  mimeType: string
  byteSize: number
  createdAt: string
}

export type CreateJobAttachmentResult =
  | { ok: true; changed: boolean; attachment: SafeJobAttachment }
  | SimpleWorkFailure

export type JobAttachmentDependencies = {
  upload: (input: { storageKey: string; bytes: Uint8Array; mimeType: string }) => Promise<void>
  remove: (storageKey: string) => Promise<void>
  beforeFinalize?: () => Promise<void>
}

const attachmentKinds = z.enum(['photo', 'video', 'document'])
const mimeByKind: Record<JobAttachmentKind, ReadonlySet<string>> = {
  photo: new Set(['image/jpeg', 'image/png', 'image/webp']),
  video: new Set(['video/mp4', 'video/webm']),
  document: new Set(['application/pdf', 'text/plain']),
}
const extensionByMime: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
}

function canonicalMime(value: string): string {
  return value.split(';')[0].trim().toLowerCase()
}

function bytesStartWith(bytes: Uint8Array, signature: number[]): boolean {
  return signature.every((value, index) => bytes[index] === value)
}

function fileSignatureMatches(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === 'image/jpeg') return bytesStartWith(bytes, [0xff, 0xd8, 0xff])
  if (mimeType === 'image/png') return bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (mimeType === 'image/webp') {
    return bytes.length >= 12
      && new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF'
      && new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  }
  if (mimeType === 'video/mp4') {
    return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === 'ftyp'
  }
  if (mimeType === 'video/webm') return bytesStartWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])
  if (mimeType === 'application/pdf') return new TextDecoder().decode(bytes.slice(0, 5)) === '%PDF-'
  if (mimeType === 'text/plain') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      return true
    } catch {
      return false
    }
  }
  return false
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

function safeAttachment(row: typeof jobAttachments.$inferSelect): SafeJobAttachment {
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    createdAt: row.createdAt.toISOString(),
  }
}

function exactAttachmentRetry(
  row: typeof jobAttachments.$inferSelect,
  expected: {
    id: string
    jobId: string
    actorId: string
    kind: JobAttachmentKind
    mimeType: string
    byteSize: number
    storageKey: string
  },
): boolean {
  return row.id === expected.id
    && row.jobId === expected.jobId
    && row.uploadedByProfileId === expected.actorId
    && row.kind === expected.kind
    && row.mimeType === expected.mimeType
    && row.byteSize === expected.byteSize
    && row.storageKey === expected.storageKey
}

async function attachmentAuthorization(
  db: AppDb,
  input: { actor: SimpleWorkActor; ticketId: string; jobId: string; attachmentId: string },
  expected?: Parameters<typeof exactAttachmentRetry>[1],
): Promise<CreateJobAttachmentResult | null> {
  const context = await lockContext(db, input)
  if (!context) return failure('not_found')
  const existing = context.attachments.find((attachment) => attachment.id === input.attachmentId)
  if (existing) {
    return expected && exactAttachmentRetry(existing, expected)
      ? { ok: true, changed: false, attachment: safeAttachment(existing) }
      : failure('conflict')
  }
  if (context.ticket.status !== 'open' || context.job.workStatus !== 'in_progress') {
    return failure('not_ready')
  }
  if (!hasPinnedApproval(context, false)) return failure('not_authorized')
  return null
}

export async function createJobAttachment(
  db: AppDb,
  input: {
    actor: SimpleWorkActor
    ticketId: unknown
    jobId: unknown
    requestKey: unknown
    kind: unknown
    file: { bytes: Uint8Array; mimeType: string; size: number }
  },
  dependencies: JobAttachmentDependencies,
): Promise<CreateJobAttachmentResult> {
  const parsedActor = z.strictObject({ profileId: uuidSchema, shopId: uuidSchema }).safeParse(input.actor)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedJob = uuidSchema.safeParse(input.jobId)
  const parsedRequest = uuidSchema.safeParse(input.requestKey)
  const parsedKind = attachmentKinds.safeParse(input.kind)
  if (!parsedActor.success || !parsedTicket.success || !parsedJob.success
    || !parsedRequest.success || !parsedKind.success
    || !(input.file.bytes instanceof Uint8Array)
    || !Number.isSafeInteger(input.file.size)
    || input.file.size !== input.file.bytes.byteLength
    || input.file.size < 1 || input.file.size > MAX_JOB_ATTACHMENT_BYTES) {
    return failure('invalid_input')
  }
  const mimeType = canonicalMime(input.file.mimeType)
  const kind = parsedKind.data
  if (!mimeByKind[kind].has(mimeType) || !fileSignatureMatches(mimeType, input.file.bytes)) {
    return failure('invalid_input')
  }
  const attachmentId = derivedUuid('shop-os-job-attachment-v1', [
    parsedActor.data.shopId,
    parsedJob.data,
    parsedActor.data.profileId,
    parsedRequest.data,
  ])
  const digest = createHash('sha256').update(input.file.bytes).digest('hex')
  const storageKey = `${parsedActor.data.shopId}/jobs/${parsedJob.data}/proof/${attachmentId}/${digest}.${extensionByMime[mimeType]}`
  const expected = {
    id: attachmentId,
    jobId: parsedJob.data,
    actorId: parsedActor.data.profileId,
    kind,
    mimeType,
    byteSize: input.file.size,
    storageKey,
  }

  try {
    const preflight = await db.transaction((tx) => attachmentAuthorization(tx as AppDb, {
      actor: parsedActor.data,
      ticketId: parsedTicket.data,
      jobId: parsedJob.data,
      attachmentId,
    }, expected))
    if (preflight) return preflight
  } catch (error) {
    if (isLockUnavailable(error)) return failure('conflict', true)
    throw error
  }

  try {
    await dependencies.upload({ storageKey, bytes: input.file.bytes, mimeType })
  } catch {
    return failure('conflict', true)
  }

  let result: CreateJobAttachmentResult
  try {
    await dependencies.beforeFinalize?.()
    result = await db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      const finalAuthorization = await attachmentAuthorization(transactionDb, {
        actor: parsedActor.data,
        ticketId: parsedTicket.data,
        jobId: parsedJob.data,
        attachmentId,
      }, expected)
      if (finalAuthorization) return finalAuthorization
      const [created] = await transactionDb.insert(jobAttachments).values({
        id: attachmentId,
        shopId: parsedActor.data.shopId,
        jobId: parsedJob.data,
        storageKey,
        kind,
        mimeType,
        byteSize: input.file.size,
        uploadedByProfileId: parsedActor.data.profileId,
      }).returning()
      return { ok: true as const, changed: true, attachment: safeAttachment(created) }
    })
  } catch (error) {
    const retryable = isLockUnavailable(error)
      || (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')
    try {
      await dependencies.remove(storageKey)
    } catch {
      console.warn('job attachment cleanup failed after finalize error')
    }
    if (!retryable) throw error
    return failure('conflict', true)
  }

  if (!result.ok) {
    try {
      await dependencies.remove(storageKey)
    } catch {
      console.warn('job attachment cleanup failed after finalize rejection')
    }
  }
  return result
}

export async function getJobAttachmentProof(
  db: AppDb,
  input: { actor: SimpleWorkActor; ticketId: unknown; jobId: unknown; attachmentId: unknown },
  dependencies: { download: (storageKey: string) => Promise<Uint8Array> },
): Promise<{ ok: true; file: { bytes: Uint8Array; mimeType: string } } | SimpleWorkFailure> {
  const parsedActor = z.strictObject({ profileId: uuidSchema, shopId: uuidSchema }).safeParse(input.actor)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedJob = uuidSchema.safeParse(input.jobId)
  const parsedAttachment = uuidSchema.safeParse(input.attachmentId)
  if (!parsedActor.success || !parsedTicket.success || !parsedJob.success || !parsedAttachment.success) {
    return failure('invalid_input')
  }
  const [actor] = await db.select({ id: profiles.id, role: profiles.role }).from(profiles).where(and(
    eq(profiles.id, parsedActor.data.profileId),
    eq(profiles.shopId, parsedActor.data.shopId),
    eq(profiles.membershipStatus, 'active'),
    isNull(profiles.deactivatedAt),
  )).limit(1)
  const [ticket] = await db.select({ id: tickets.id }).from(tickets).where(and(
    eq(tickets.shopId, parsedActor.data.shopId), eq(tickets.id, parsedTicket.data),
  )).limit(1)
  const [job] = await db.select({ id: ticketJobs.id }).from(ticketJobs).where(and(
    eq(ticketJobs.shopId, parsedActor.data.shopId),
    eq(ticketJobs.ticketId, parsedTicket.data),
    eq(ticketJobs.id, parsedJob.data),
  )).limit(1)
  const [attachment] = await db.select().from(jobAttachments).where(and(
    eq(jobAttachments.shopId, parsedActor.data.shopId),
    eq(jobAttachments.jobId, parsedJob.data),
    eq(jobAttachments.id, parsedAttachment.data),
  )).limit(1)
  if (!actor || !isShopRole(actor.role) || !ticket || !job || !attachment
    || attachment.byteSize < 1 || attachment.byteSize > MAX_JOB_ATTACHMENT_BYTES
    || !mimeByKind[attachment.kind].has(canonicalMime(attachment.mimeType))) return failure('not_found')
  try {
    const bytes = await dependencies.download(attachment.storageKey)
    if (bytes.byteLength !== attachment.byteSize
      || bytes.byteLength > MAX_JOB_ATTACHMENT_BYTES
      || !fileSignatureMatches(attachment.mimeType, bytes)) return failure('not_found')
    return { ok: true, file: { bytes, mimeType: attachment.mimeType } }
  } catch {
    return failure('conflict', true)
  }
}
