import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { jobLines, profiles, quoteVersions, ticketJobs, tickets } from '@/lib/db/schema'
import { canPlacePartsOrders, isShopRole } from '@/lib/shop-os/capabilities'
import { isLockUnavailable, validatedQuoteSnapshot } from '@/lib/shop-os/quotes'

export type PartsArrivalAction = 'mark_ordered' | 'mark_received'
export type PartsArrivalState = 'needs_order' | 'ordered' | 'received'
export type PartsArrivalError = 'invalid_input' | 'not_found' | 'conflict'
export type PartsArrivalFailure = {
  ok: false
  error: PartsArrivalError
  retryable?: true
}

export type PartsArrivalReceipt = {
  actorName: string | null
  at: string
}

export type PartsArrivalLine = {
  id: string
  description: string
  quantity: string
  partNumber: string | null
  brand: string | null
  state: PartsArrivalState
  nextAction: PartsArrivalAction | null
  ordered: PartsArrivalReceipt | null
  received: PartsArrivalReceipt | null
}

export type PartsArrivalJob = {
  jobId: string
  approvedQuoteVersionId: string
  title: string
  readOnly: boolean
  receivedCount: number
  totalCount: number
  allHere: boolean
  lines: PartsArrivalLine[]
}

type PartsArrivalResult =
  | { ok: true; jobs: PartsArrivalJob[] }
  | PartsArrivalFailure

type AdvanceResult =
  | { ok: true; changed: boolean; job: PartsArrivalJob }
  | PartsArrivalFailure

type Actor = {
  id: string
  shopId: string
  role: string
}

type JobRow = Pick<typeof ticketJobs.$inferSelect,
  'id' | 'title' | 'assignedTechId' | 'approvalState' | 'approvedQuoteVersionId' | 'workStatus'>
type LineRow = typeof jobLines.$inferSelect
type VersionRow = typeof quoteVersions.$inferSelect
type TicketIdentity = Pick<typeof tickets.$inferSelect,
  'id' | 'ticketNumber' | 'customerId' | 'vehicleId'>

const uuidSchema = z.uuid().transform((value) => value.toLowerCase())
const actorSchema = z.strictObject({ profileId: uuidSchema })
const actionSchema = z.strictObject({ action: z.enum(['mark_ordered', 'mark_received']) })

function failure(error: PartsArrivalError, retryable = false): PartsArrivalFailure {
  return retryable ? { ok: false, error, retryable: true } : { ok: false, error }
}

async function loadActiveActor(db: AppDb, profileId: string, lock = false): Promise<Actor | null> {
  let query = db
    .select({ id: profiles.id, shopId: profiles.shopId, role: profiles.role })
    .from(profiles)
    .where(and(
      eq(profiles.id, profileId),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
  if (lock) query = query.for('update', { noWait: true }) as typeof query
  const [actor] = await query
  return actor?.shopId && isShopRole(actor.role) ? actor as Actor : null
}

function canonicalQuantity(value: number | string): string {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric <= 0) throw new TypeError('invalid part quantity')
  return numeric.toFixed(3).replace(/\.0+$|(?<=\.[0-9]*?)0+$/g, '').replace(/\.$/, '')
}

function sameApprovedPart(
  line: LineRow,
  approved: {
    id: string
    kind: string
    description: string
    quantity: string
    priceCents: number
    taxable: boolean
    partNumber: string | null
    brand: string | null
    coreChargeCents: number | null
    fitment: string | null
    source: string
  },
): boolean {
  return line.id === approved.id
    && line.kind === 'part'
    && approved.kind === 'part'
    && line.description === approved.description
    && canonicalQuantity(line.quantity) === approved.quantity
    && line.priceCents === approved.priceCents
    && line.taxable === approved.taxable
    && line.partNumber === approved.partNumber
    && line.brand === approved.brand
    && line.coreChargeCents === approved.coreChargeCents
    && line.fitment === approved.fitment
    && line.source === approved.source
}

function displayState(status: LineRow['partStatus']): PartsArrivalState | null {
  if (status === 'proposed' || status === 'needs_order') return 'needs_order'
  if (status === 'ordered') return 'ordered'
  if (status === 'received' || status === 'installed') return 'received'
  return null
}

function receipt(
  at: Date | null,
  profileId: string | null,
  names: ReadonlyMap<string, string | null>,
): PartsArrivalReceipt | null {
  return at ? { actorName: profileId ? (names.get(profileId) ?? null) : null, at: at.toISOString() } : null
}

function projectJob(input: {
  job: JobRow
  lines: LineRow[]
  version: VersionRow
  ticket: TicketIdentity
  actor: Actor
  names: ReadonlyMap<string, string | null>
}): PartsArrivalJob | null {
  const { job, lines, version, ticket, actor, names } = input
  if (job.approvalState !== 'approved' || !job.approvedQuoteVersionId
    || job.approvedQuoteVersionId !== version.id || version.supersededAt) return null
  let snapshot: ReturnType<typeof validatedQuoteSnapshot>
  try {
    snapshot = validatedQuoteSnapshot(version.snapshot, ticket)
  } catch {
    return null
  }
  const approvedJob = snapshot.jobs.find((candidate) => candidate.id === job.id)
  if (!approvedJob) return null
  const approvedParts = approvedJob.lines.filter((line) => line.kind === 'part')
  if (approvedParts.length === 0) return null
  const liveById = new Map(lines.filter((line) => line.jobId === job.id).map((line) => [line.id, line]))
  const readOnly = actor.role === 'tech'
  const projected: PartsArrivalLine[] = []
  for (const approved of approvedParts) {
    const live = liveById.get(approved.id)
    if (!live || !sameApprovedPart(live, approved)) return null
    const state = displayState(live.partStatus)
    if (!state) return null
    if ((state === 'needs_order' && (live.orderedAt || live.orderedByProfileId || live.receivedAt || live.receivedByProfileId))
      || (state === 'ordered' && (!live.orderedAt || !live.orderedByProfileId || live.receivedAt || live.receivedByProfileId))
      || (live.receivedAt && !live.receivedByProfileId)
      || (live.receivedByProfileId && !live.receivedAt)) return null
    projected.push({
      id: approved.id,
      description: approved.description,
      quantity: approved.quantity,
      partNumber: approved.partNumber,
      brand: approved.brand,
      state,
      nextAction: readOnly || state === 'received'
        ? null
        : state === 'needs_order' ? 'mark_ordered' : 'mark_received',
      ordered: receipt(live.orderedAt, live.orderedByProfileId, names),
      received: receipt(live.receivedAt, live.receivedByProfileId, names),
    })
  }
  const receivedCount = projected.filter((line) => line.state === 'received').length
  return {
    jobId: job.id,
    approvedQuoteVersionId: version.id,
    title: approvedJob.title,
    readOnly,
    receivedCount,
    totalCount: projected.length,
    allHere: receivedCount === projected.length,
    lines: projected,
  }
}

async function actorNames(db: AppDb, shopId: string, lines: LineRow[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(lines.flatMap((line) => [line.orderedByProfileId, line.receivedByProfileId]).filter(Boolean))] as string[]
  if (ids.length === 0) return new Map()
  const rows = await db.select({ id: profiles.id, fullName: profiles.fullName }).from(profiles).where(and(
    eq(profiles.shopId, shopId),
    inArray(profiles.id, ids),
  ))
  return new Map(rows.map((row) => [row.id, row.fullName]))
}

export async function getPartsArrivalForTicket(
  db: AppDb,
  input: { actor: { profileId: unknown }; ticketId: unknown },
): Promise<PartsArrivalResult> {
  const parsedActor = actorSchema.safeParse(input.actor)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  if (!parsedActor.success || !parsedTicket.success) return failure('invalid_input')
  const actor = await loadActiveActor(db, parsedActor.data.profileId)
  if (!actor) return failure('not_found')

  return db.transaction(async (tx) => {
    const transactionDb = tx as AppDb
    const [ticket] = await transactionDb.select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      customerId: tickets.customerId,
      vehicleId: tickets.vehicleId,
      status: tickets.status,
    }).from(tickets).where(and(
      eq(tickets.id, parsedTicket.data), eq(tickets.shopId, actor.shopId),
    )).limit(1)
    if (!ticket || ticket.status !== 'open') return failure('not_found')
    const allJobs = await transactionDb.select({
      id: ticketJobs.id,
      title: ticketJobs.title,
      assignedTechId: ticketJobs.assignedTechId,
      approvalState: ticketJobs.approvalState,
      approvedQuoteVersionId: ticketJobs.approvedQuoteVersionId,
      workStatus: ticketJobs.workStatus,
    }).from(ticketJobs).where(and(
      eq(ticketJobs.shopId, actor.shopId), eq(ticketJobs.ticketId, parsedTicket.data),
    )).orderBy(ticketJobs.id)
    const jobs = allJobs.filter((job) => actor.role !== 'tech' || job.assignedTechId === actor.id)
    if (jobs.length === 0) return { ok: true as const, jobs: [] }
    const lines = await transactionDb.select().from(jobLines).where(and(
      eq(jobLines.shopId, actor.shopId), inArray(jobLines.jobId, jobs.map((job) => job.id)),
    )).orderBy(jobLines.id)
    const versionIds = [...new Set(jobs.map((job) => job.approvedQuoteVersionId).filter(Boolean))] as string[]
    const versions = versionIds.length === 0 ? [] : await transactionDb.select().from(quoteVersions).where(and(
      eq(quoteVersions.shopId, actor.shopId),
      eq(quoteVersions.ticketId, parsedTicket.data),
      inArray(quoteVersions.id, versionIds),
      isNull(quoteVersions.supersededAt),
    ))
    const names = await actorNames(transactionDb, actor.shopId, lines)
    const versionById = new Map(versions.map((version) => [version.id, version]))
    const projected: PartsArrivalJob[] = []
    for (const job of jobs) {
      if (job.workStatus === 'done' || job.workStatus === 'canceled' || !job.approvedQuoteVersionId) continue
      const version = versionById.get(job.approvedQuoteVersionId)
      if (!version) continue
      const safe = projectJob({ job, lines, version, ticket, actor, names })
      if (safe) projected.push(safe)
    }
    return { ok: true as const, jobs: projected }
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' })
}

export async function advancePartArrival(
  db: AppDb,
  input: {
    actor: { profileId: unknown }
    ticketId: unknown
    jobId: unknown
    lineId: unknown
    body: unknown
  },
): Promise<AdvanceResult> {
  const parsedActor = actorSchema.safeParse(input.actor)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedJob = uuidSchema.safeParse(input.jobId)
  const parsedLine = uuidSchema.safeParse(input.lineId)
  const parsedBody = actionSchema.safeParse(input.body)
  if (!parsedActor.success || !parsedTicket.success || !parsedJob.success || !parsedLine.success || !parsedBody.success) {
    return failure('invalid_input')
  }
  const actor = await loadActiveActor(db, parsedActor.data.profileId)
  if (!actor || !canPlacePartsOrders(actor.role)) return failure('not_found')

  try {
    return await db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      const [ticket] = await transactionDb.select().from(tickets).where(and(
        eq(tickets.id, parsedTicket.data), eq(tickets.shopId, actor.shopId),
      )).limit(1).for('update', { noWait: true })
      if (!ticket || ticket.status !== 'open') return failure('not_found')

      const jobs = await transactionDb.select().from(ticketJobs).where(and(
        eq(ticketJobs.shopId, actor.shopId), eq(ticketJobs.ticketId, parsedTicket.data),
      )).orderBy(ticketJobs.id).for('update', { noWait: true })
      const job = jobs.find((candidate) => candidate.id === parsedJob.data)
      if (!job || job.approvalState !== 'approved' || !job.approvedQuoteVersionId
        || job.workStatus === 'done' || job.workStatus === 'canceled') return failure('not_found')

      const lines = jobs.length === 0 ? [] : await transactionDb.select().from(jobLines).where(and(
        eq(jobLines.shopId, actor.shopId), inArray(jobLines.jobId, jobs.map((candidate) => candidate.id)),
      )).orderBy(jobLines.id).for('update', { noWait: true })
      const line = lines.find((candidate) => candidate.id === parsedLine.data && candidate.jobId === job.id)
      if (!line || line.kind !== 'part') return failure('not_found')
      const versions = await transactionDb.select().from(quoteVersions).where(and(
        eq(quoteVersions.shopId, actor.shopId), eq(quoteVersions.ticketId, parsedTicket.data),
      )).orderBy(quoteVersions.id).for('update', { noWait: true })
      const version = versions.find((candidate) => candidate.id === job.approvedQuoteVersionId && !candidate.supersededAt)
      if (!version) return failure('conflict')

      const currentActor = await loadActiveActor(transactionDb, parsedActor.data.profileId, true)
      if (!currentActor || currentActor.id !== actor.id || currentActor.shopId !== actor.shopId
        || !canPlacePartsOrders(currentActor.role)) return failure('not_found')

      let snapshot: ReturnType<typeof validatedQuoteSnapshot>
      try {
        snapshot = validatedQuoteSnapshot(version.snapshot, ticket)
      } catch {
        return failure('conflict')
      }
      const approvedJob = snapshot.jobs.find((candidate) => candidate.id === job.id)
      const approvedLine = approvedJob?.lines.find((candidate) => candidate.id === line.id && candidate.kind === 'part')
      if (!approvedLine || !sameApprovedPart(line, approvedLine)) return failure('conflict')
      if (line.partStatus === 'returned') return failure('conflict')

      const action = parsedBody.data.action
      let changed = false
      let updatedLine = line
      if (action === 'mark_ordered') {
        if (line.partStatus === 'proposed' || line.partStatus === 'needs_order') {
          const [updated] = await transactionDb.update(jobLines).set({
            partStatus: 'ordered',
            orderedAt: sql`now()`,
            orderedByProfileId: currentActor.id,
            updatedAt: sql`now()`,
          }).where(and(
            eq(jobLines.shopId, actor.shopId),
            eq(jobLines.id, line.id),
            inArray(jobLines.partStatus, ['proposed', 'needs_order']),
          )).returning()
          if (!updated) return failure('conflict', true)
          changed = true
          updatedLine = updated
        }
      } else if (line.partStatus === 'ordered') {
        const [updated] = await transactionDb.update(jobLines).set({
          partStatus: 'received',
          receivedAt: sql`now()`,
          receivedByProfileId: currentActor.id,
          updatedAt: sql`now()`,
        }).where(and(
          eq(jobLines.shopId, actor.shopId),
          eq(jobLines.id, line.id),
          eq(jobLines.partStatus, 'ordered'),
        )).returning()
        if (!updated) return failure('conflict', true)
        changed = true
        updatedLine = updated
      } else if (line.partStatus !== 'received' && line.partStatus !== 'installed') {
        return failure('conflict')
      }

      const currentLines = lines.map((candidate) => candidate.id === updatedLine.id ? updatedLine : candidate)
      const names = await actorNames(transactionDb, actor.shopId, currentLines)
      const projected = projectJob({ job, lines: currentLines, version, ticket, actor: currentActor, names })
      if (!projected) return failure('conflict')
      return { ok: true as const, changed, job: projected }
    })
  } catch (error) {
    if (isLockUnavailable(error)) return failure('conflict', true)
    throw error
  }
}

export function partsArrivalErrorBody(result: PartsArrivalFailure): {
  error: PartsArrivalError
  retryable?: true
} {
  return result.retryable ? { error: result.error, retryable: true } : { error: result.error }
}
