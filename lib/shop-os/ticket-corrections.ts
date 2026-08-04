import { createHash } from 'node:crypto'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  jobLines,
  profiles,
  quoteVersions,
  ticketActivity,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { upsertCustomer } from '@/lib/intake/customers'
import { upsertVehicle } from '@/lib/intake/vehicles'
import { isTicketCorrectionEnabled } from '@/lib/release-policy'
import { canAssignWork } from '@/lib/shop-os/capabilities'
import {
  parsePersistedCustomerStory,
  parsePersistedCustomerStoryMeta,
} from '@/lib/shop-os/customer-story-contracts'
import {
  buildQuoteStoryMeta,
  formatScaledDecimal,
  parseScaledDecimal,
  sortBySnapshotOrder,
  stableStringify,
  type QuoteSnapshotJobV1,
  type QuoteSnapshotLineV1,
} from '@/lib/shop-os/quote-math'
import {
  invalidateActiveQuoteVersion,
  isLockUnavailable,
  isPinnedSimpleWork,
  validatedQuoteSnapshot,
} from '@/lib/shop-os/quotes'
import {
  appendTicketActivity,
  isTicketCorrectionReceiptV1,
  type TicketCorrectionChangedField,
  type TicketCorrectionReceiptV1,
} from '@/lib/shop-os/ticket-activity'
import {
  getTicketDetail,
  ticketActorFromProfile,
  type TicketActor,
  type TicketDetail,
} from '@/lib/tickets'

export type TicketCorrectionScope = 'identity' | 'concern' | 'job' | 'job_removed'

export type TicketCorrectionResult =
  | {
      ok: true
      outcome: 'changed' | 'replayed' | 'unchanged'
      changed: boolean
      scope: TicketCorrectionScope
      invalidatedVersionNumber: number | null
      ticket: TicketDetail
    }
  | {
      ok: false
      error: 'unavailable' | 'invalid_input' | 'not_found' | 'forbidden'
        | 'conflict' | 'ticket_not_open' | 'job_not_open' | 'last_job'
      retryable?: boolean
    }

export type TicketCorrectionDependencies = {
  afterVersionLock?: (db: AppDb) => Promise<void>
  afterActorLock?: (db: AppDb) => Promise<void>
  afterLinkLock?: () => Promise<void>
  beforeFactWrite?: () => Promise<void>
}

type CorrectionFailure = Extract<TicketCorrectionResult, { ok: false }>
type CorrectionSuccess = Extract<TicketCorrectionResult, { ok: true }>

const uuidSchema = z.uuid().transform((value) => value.toLowerCase())
const timestampSchema = z.string().datetime({ offset: true })
  .transform((value) => new Date(value).toISOString())
const nullableTrimmedText = (max: number) => z.string().trim().max(max).nullable()
  .transform((value) => value === '' ? null : value)
const commonShape = {
  requestKey: uuidSchema,
  expectedTicketUpdatedAt: timestampSchema,
  expectedActiveVersionId: uuidSchema.nullable(),
}
const identitySelectionSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('existing'), vehicleId: uuidSchema }),
  z.strictObject({
    mode: z.literal('new'),
    customer: z.strictObject({
      name: z.string().trim().min(1).max(200),
      phone: z.string().trim().min(1).max(100),
      email: z.string().trim().email().max(320).nullable(),
    }),
    vehicle: z.strictObject({
      year: z.number().int().min(1886).max(new Date().getFullYear() + 1),
      make: z.string().trim().min(1).max(100),
      model: z.string().trim().min(1).max(100),
      engine: nullableTrimmedText(200),
      vin: z.string().trim().length(17).nullable(),
      mileage: z.number().int().nonnegative().max(2_147_483_647).nullable(),
      plate: nullableTrimmedText(32),
    }),
  }),
])
const identityCorrectionSchema = z.strictObject({
  action: z.literal('identity'),
  ...commonShape,
  selection: identitySelectionSchema,
})
const concernCorrectionSchema = z.strictObject({
  action: z.literal('concern'),
  ...commonShape,
  concern: z.string().trim().min(1).max(5_000),
})
const jobCorrectionSchema = z.strictObject({
  action: z.literal('job'),
  ...commonShape,
  jobId: uuidSchema,
  expectedJobUpdatedAt: timestampSchema,
  title: z.string().trim().min(1).max(200),
  kind: z.enum(['diagnostic', 'repair', 'maintenance']),
  customerSuppliedPartsNote: z.string().trim().min(1).max(500).nullable(),
}).superRefine((job, context) => {
  if (job.kind === 'diagnostic' && job.customerSuppliedPartsNote !== null) {
    context.addIssue({
      code: 'custom',
      message: 'diagnostic jobs cannot carry supplied-part truth',
    })
  }
})
const removeJobCorrectionSchema = z.strictObject({
  action: z.literal('remove_job'),
  ...commonShape,
  jobId: uuidSchema,
  expectedJobUpdatedAt: timestampSchema,
})
const correctionBodySchema = z.discriminatedUnion('action', [
  identityCorrectionSchema,
  concernCorrectionSchema,
  jobCorrectionSchema,
  removeJobCorrectionSchema,
])

type CorrectionBody = z.infer<typeof correctionBodySchema>
type LockedTicket = Pick<
  typeof tickets.$inferSelect,
  'id' | 'ticketNumber' | 'status' | 'customerId' | 'vehicleId' | 'concern' | 'updatedAt'
>
type LockedJob = typeof ticketJobs.$inferSelect
type LockedLine = typeof jobLines.$inferSelect
type ActiveVersion = typeof quoteVersions.$inferSelect

class AbortCorrection extends Error {
  constructor(readonly result: CorrectionFailure) {
    super('ticket_correction_rollback')
  }
}

function failure(error: CorrectionFailure['error']): CorrectionFailure {
  return { ok: false, error }
}

function conflict(retryable = false): CorrectionFailure {
  return { ok: false, error: 'conflict', retryable }
}

function scopeFor(body: CorrectionBody): TicketCorrectionScope {
  if (body.action === 'remove_job') return 'job_removed'
  return body.action
}

function targetJobId(body: CorrectionBody): string | null {
  return body.action === 'job' || body.action === 'remove_job' ? body.jobId : null
}

function intentHash(body: CorrectionBody): string {
  return createHash('sha256').update(stableStringify(body)).digest('hex')
}

function nextTicketTimestamp() {
  return sql`greatest(
    date_trunc('milliseconds', clock_timestamp()),
    date_trunc('milliseconds', ${tickets.updatedAt}) + interval '1 millisecond'
  )`
}

function nextJobTimestamp() {
  return sql`greatest(
    date_trunc('milliseconds', clock_timestamp()),
    date_trunc('milliseconds', ${ticketJobs.updatedAt}) + interval '1 millisecond'
  )`
}

function jobCanBeCorrected(job: LockedJob): boolean {
  return job.workStatus === 'open'
    && job.sessionId === null
    && !(job.kind === 'diagnostic'
      && (job.diagnosticStartState === 'initializing' || job.diagnosticStartState === 'ambiguous'))
    && !isPinnedSimpleWork(job)
}

function lineMatchesLockedTruth(
  snapshotLine: QuoteSnapshotLineV1,
  line: LockedLine,
): boolean {
  const quantity = formatScaledDecimal(parseScaledDecimal(String(line.quantity), 3), 3)
  const laborHours = line.laborHours === null
    ? null
    : formatScaledDecimal(parseScaledDecimal(String(line.laborHours), 2), 2)
  return snapshotLine.id === line.id
    && snapshotLine.kind === line.kind
    && snapshotLine.description === line.description
    && snapshotLine.quantity === quantity
    && snapshotLine.priceCents === line.priceCents
    && snapshotLine.taxable === line.taxable
    && snapshotLine.partNumber === line.partNumber
    && snapshotLine.brand === line.brand
    && snapshotLine.coreChargeCents === (
      line.source === 'vendor_offer' ? null : line.coreChargeCents
    )
    && snapshotLine.fitment === line.fitment
    && snapshotLine.laborHours === laborHours
    && snapshotLine.laborRateCents === line.laborRateCents
    && snapshotLine.source === line.source
    && snapshotLine.vendorContext === null
}

function jobMatchesLockedTruth(snapshotJob: QuoteSnapshotJobV1, job: LockedJob): boolean {
  const customerStory = job.customerStory === null
    ? null
    : parsePersistedCustomerStory(job.customerStory)
  const persistedStoryMeta = job.storyMeta === null
    ? null
    : parsePersistedCustomerStoryMeta(job.storyMeta)
  if ((job.customerStory !== null && customerStory === null)
    || (job.storyMeta !== null && persistedStoryMeta === null)) return false
  const storyMeta = persistedStoryMeta === null ? null : buildQuoteStoryMeta(persistedStoryMeta)
  const authorizationPurpose = job.kind === 'diagnostic'
    && job.sessionId === null
    && job.customerStory === null
    && job.storyMeta === null
    ? 'diagnosis'
    : null
  return job.title === snapshotJob.title
    && job.kind === snapshotJob.kind
    && (job.customerSuppliedPartsNote ?? undefined)
      === (snapshotJob.customerSuppliedPartsNote ?? undefined)
    && stableStringify(customerStory) === stableStringify(snapshotJob.customerStory)
    && stableStringify(storyMeta) === stableStringify(snapshotJob.storyMeta)
    && authorizationPurpose === (snapshotJob.authorizationPurpose ?? null)
}

function snapshotMatchesLockedTruth(
  version: ActiveVersion,
  ticket: LockedTicket,
  jobs: LockedJob[],
  lines: LockedLine[],
): boolean {
  try {
    const snapshot = validatedQuoteSnapshot(version.snapshot, ticket)
    const lineJobIds = new Set(lines.map((line) => line.jobId))
    const canonicalJobIds = sortBySnapshotOrder(jobs)
      .filter((job) => job.workStatus !== 'canceled'
        && !isPinnedSimpleWork(job)
        && lineJobIds.has(job.id))
      .map((job) => job.id)
    const snapshotJobIds = snapshot.jobs.map((job) => job.id)
    if (canonicalJobIds.length !== snapshotJobIds.length
      || canonicalJobIds.some((id, index) => id !== snapshotJobIds[index])) return false
    const currentJobs = new Map(jobs.map((job) => [job.id, job]))
    const currentLines = new Map(lines.map((line) => [line.id, line]))
    for (const snapshotJob of snapshot.jobs) {
      const job = currentJobs.get(snapshotJob.id)
      if (!job || !jobMatchesLockedTruth(snapshotJob, job)) return false
      const currentLineIds = sortBySnapshotOrder(
        lines.filter((line) => line.jobId === job.id),
      ).map((line) => line.id)
      const snapshotLineIds = snapshotJob.lines.map((line) => line.id)
      if (currentLineIds.length !== snapshotLineIds.length
        || currentLineIds.some((id, index) => id !== snapshotLineIds[index])) return false
      if (snapshotJob.lines.some((snapshotLine) => {
        const currentLine = currentLines.get(snapshotLine.id)
        return !currentLine || !lineMatchesLockedTruth(snapshotLine, currentLine)
      })) return false
    }
    return true
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return false
    throw error
  }
}

async function loadSafeTicket(
  db: AppDb,
  actor: ReturnType<typeof ticketActorFromProfile>,
  ticketId: string,
): Promise<TicketDetail> {
  const detail = await getTicketDetail(db, { actor, ticketId })
  if (!detail.ok) throw new Error('corrected_ticket_not_found')
  return detail.ticket
}

function replayMatches(
  row: typeof ticketActivity.$inferSelect,
  body: CorrectionBody,
  ticketId: string,
  actorProfileId: string,
  hash: string,
): row is typeof row & { payload: TicketCorrectionReceiptV1 } {
  const jobId = targetJobId(body)
  return row.ticketId === ticketId
    && row.actorProfileId === actorProfileId
    && row.kind === 'ticket_corrected'
    && row.jobId === jobId
    && isTicketCorrectionReceiptV1(row.payload, row.jobId)
    && row.payload.scope === scopeFor(body)
    && row.payload.intentHash === hash
}

type ResolvedIdentity = { customerId: string; vehicleId: string }
type IdentityPlan =
  | { ok: true; identity: ResolvedIdentity | null }
  | { ok: false }

async function planIdentity(
  db: AppDb,
  shopId: string,
  ticket: LockedTicket,
  selection: z.infer<typeof identitySelectionSchema>,
): Promise<IdentityPlan> {
  if (selection.mode === 'existing') {
    const [pair] = await db
      .select({ customerId: customers.id, vehicleId: vehicles.id })
      .from(customers)
      .innerJoin(
        vehicles,
        and(eq(vehicles.id, selection.vehicleId), eq(vehicles.customerId, customers.id)),
      )
      .where(eq(customers.shopId, shopId))
      .limit(1)
    return pair ? { ok: true, identity: pair } : { ok: false }
  }

  const [current] = ticket.customerId && ticket.vehicleId ? await db
    .select({
      customerId: customers.id,
      customerName: customers.name,
      customerPhone: customers.phone,
      customerEmail: customers.email,
      vehicleId: vehicles.id,
      year: vehicles.year,
      make: vehicles.make,
      model: vehicles.model,
      engine: vehicles.engine,
      vin: vehicles.vin,
      mileage: vehicles.mileage,
      plate: vehicles.plate,
    })
    .from(customers)
    .innerJoin(vehicles, and(
      eq(vehicles.id, ticket.vehicleId),
      eq(vehicles.customerId, customers.id),
    ))
    .where(and(eq(customers.shopId, shopId), eq(customers.id, ticket.customerId)))
    .limit(1) : []
  if (current
    && current.customerName === selection.customer.name
    && current.customerPhone === selection.customer.phone
    && current.customerEmail === selection.customer.email
    && current.year === selection.vehicle.year
    && current.make === selection.vehicle.make
    && current.model === selection.vehicle.model
    && current.engine === selection.vehicle.engine
    && current.vin === selection.vehicle.vin
    && current.mileage === selection.vehicle.mileage
    && current.plate === selection.vehicle.plate) {
    return {
      ok: true,
      identity: { customerId: current.customerId, vehicleId: current.vehicleId },
    }
  }

  const [customer] = await db
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.shopId, shopId), eq(customers.phone, selection.customer.phone)))
    .limit(1)
  if (!customer) return { ok: true, identity: null }

  const [vehicle] = selection.vehicle.vin ? await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(
      eq(vehicles.customerId, customer.id),
      eq(vehicles.vin, selection.vehicle.vin),
    ))
    .limit(1) : selection.vehicle.plate ? await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(
      eq(vehicles.customerId, customer.id),
      eq(vehicles.year, selection.vehicle.year),
      eq(vehicles.make, selection.vehicle.make),
      eq(vehicles.model, selection.vehicle.model),
      eq(vehicles.plate, selection.vehicle.plate),
    ))
    .orderBy(desc(vehicles.createdAt))
    .limit(1) : []
  return vehicle
    ? { ok: true, identity: { customerId: customer.id, vehicleId: vehicle.id } }
    : { ok: true, identity: null }
}

async function materializeNewIdentity(
  db: AppDb,
  shopId: string,
  selection: Extract<z.infer<typeof identitySelectionSchema>, { mode: 'new' }>,
): Promise<ResolvedIdentity> {
  const customer = await upsertCustomer(db, {
    shopId,
    name: selection.customer.name,
    phone: selection.customer.phone,
    email: selection.customer.email,
  })
  const vehicle = await upsertVehicle(db, {
    customerId: customer.id,
    year: selection.vehicle.year,
    make: selection.vehicle.make,
    model: selection.vehicle.model,
    engine: selection.vehicle.engine,
    vin: selection.vehicle.vin,
    mileage: selection.vehicle.mileage,
    plate: selection.vehicle.plate,
  })
  return { customerId: customer.id, vehicleId: vehicle.id }
}

function receiptFor(
  body: CorrectionBody,
  hash: string,
  ticket: LockedTicket,
  targetJob: LockedJob | null,
  identity: { customerId: string; vehicleId: string } | null,
  activeVersion: ActiveVersion | null,
): TicketCorrectionReceiptV1 {
  const version = {
    invalidatedVersionId: activeVersion?.id ?? null,
    invalidatedVersionNumber: activeVersion?.versionNumber ?? null,
  }
  if (body.action === 'identity') {
    if (!identity) throw new Error('correction_identity_missing')
    const changedFields: TicketCorrectionChangedField[] = [
      ...(ticket.customerId !== identity.customerId ? ['customer_id' as const] : []),
      ...(ticket.vehicleId !== identity.vehicleId ? ['vehicle_id' as const] : []),
    ]
    return {
      v: 1,
      scope: 'identity',
      intentHash: hash,
      changedFields,
      ...version,
      ...(changedFields.includes('customer_id') ? {
        fromCustomerId: ticket.customerId,
        toCustomerId: identity.customerId,
      } : {}),
      ...(changedFields.includes('vehicle_id') ? {
        fromVehicleId: ticket.vehicleId,
        toVehicleId: identity.vehicleId,
      } : {}),
    }
  }
  if (body.action === 'concern') {
    return {
      v: 1,
      scope: 'concern',
      intentHash: hash,
      changedFields: ['concern'],
      ...version,
    }
  }
  if (body.action === 'remove_job') {
    return {
      v: 1,
      scope: 'job_removed',
      intentHash: hash,
      changedFields: ['work_status'],
      ...version,
    }
  }
  if (body.action !== 'job') throw new Error('correction_scope_invalid')
  if (!targetJob) throw new Error('correction_target_missing')
  const changedFields: TicketCorrectionChangedField[] = [
    ...(targetJob.title !== body.title ? ['title' as const] : []),
    ...(targetJob.kind !== body.kind ? ['kind' as const] : []),
    ...((targetJob.customerSuppliedPartsNote ?? null) !== body.customerSuppliedPartsNote
      ? ['customer_supplied_parts_note' as const]
      : []),
  ]
  return {
    v: 1,
    scope: 'job',
    intentHash: hash,
    changedFields,
    ...version,
    ...(changedFields.includes('kind') ? {
      fromKind: targetJob.kind,
      toKind: body.kind,
    } : {}),
  }
}

export async function correctTicket(
  db: AppDb,
  input: { actor: TicketActor; ticketId: unknown; body: unknown },
  dependencies: TicketCorrectionDependencies = {},
): Promise<TicketCorrectionResult> {
  if (!isTicketCorrectionEnabled()) return failure('unavailable')
  const parsedActorId = uuidSchema.safeParse(input.actor.profileId)
  const parsedTicketId = uuidSchema.safeParse(input.ticketId)
  const parsedBody = correctionBodySchema.safeParse(input.body)
  if (!parsedActorId.success || !parsedTicketId.success || !parsedBody.success) {
    return failure('invalid_input')
  }
  const body = parsedBody.data
  const hash = intentHash(body)

  try {
    return await db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      await transactionDb.execute(sql`set local lock_timeout = '5s'`)

      const [resolvedActor] = await transactionDb
        .select({ id: profiles.id, shopId: profiles.shopId })
        .from(profiles)
        .where(eq(profiles.id, parsedActorId.data))
        .limit(1)
      if (!resolvedActor?.shopId) return failure('not_found')
      const shopId = resolvedActor.shopId

      const [ticket] = await transactionDb
        .select({
          id: tickets.id,
          ticketNumber: tickets.ticketNumber,
          status: tickets.status,
          customerId: tickets.customerId,
          vehicleId: tickets.vehicleId,
          concern: tickets.concern,
          updatedAt: tickets.updatedAt,
        })
        .from(tickets)
        .where(and(eq(tickets.shopId, shopId), eq(tickets.id, parsedTicketId.data)))
        .limit(1)
        .for('update', { noWait: true })
      if (!ticket) return failure('not_found')

      const jobs = await transactionDb
        .select()
        .from(ticketJobs)
        .where(and(eq(ticketJobs.shopId, shopId), eq(ticketJobs.ticketId, ticket.id)))
        .orderBy(ticketJobs.id)
        .for('update', { noWait: true })
      const lines = await transactionDb
        .select()
        .from(jobLines)
        .where(and(
          eq(jobLines.shopId, shopId),
          inArray(jobLines.jobId, jobs.map((job) => job.id)),
        ))
        .orderBy(jobLines.id)
        .for('update', { noWait: true })
      const activeVersions = await transactionDb
        .select()
        .from(quoteVersions)
        .where(and(
          eq(quoteVersions.shopId, shopId),
          eq(quoteVersions.ticketId, ticket.id),
          isNull(quoteVersions.supersededAt),
        ))
        .orderBy(quoteVersions.id)
        .for('update', { noWait: true })
      await dependencies.afterVersionLock?.(transactionDb)

      const [lockedActor] = await transactionDb
        .select({
          id: profiles.id,
          shopId: profiles.shopId,
          role: profiles.role,
          skillTier: profiles.skillTier,
          membershipStatus: profiles.membershipStatus,
          deactivatedAt: profiles.deactivatedAt,
        })
        .from(profiles)
        .where(and(
          eq(profiles.id, resolvedActor.id),
          eq(profiles.shopId, shopId),
          eq(profiles.membershipStatus, 'active'),
          isNull(profiles.deactivatedAt),
        ))
        .limit(1)
        .for('update', { noWait: true })
      if (!lockedActor) return failure('not_found')
      await dependencies.afterActorLock?.(transactionDb)
      if (lockedActor.membershipStatus !== 'active'
        || lockedActor.deactivatedAt !== null
        || !canAssignWork(lockedActor.role)) return failure('forbidden')
      const responseActor = ticketActorFromProfile(lockedActor)

      const [existingReceipt] = await transactionDb
        .select()
        .from(ticketActivity)
        .where(and(
          eq(ticketActivity.shopId, shopId),
          eq(ticketActivity.requestKey, body.requestKey),
        ))
        .limit(1)
        .for('update', { noWait: true })
      if (existingReceipt) {
        if (!replayMatches(
          existingReceipt,
          body,
          ticket.id,
          lockedActor.id,
          hash,
        )) return conflict()
        const detail = await loadSafeTicket(transactionDb, responseActor, ticket.id)
        return {
          ok: true,
          outcome: 'replayed',
          changed: false,
          scope: existingReceipt.payload.scope,
          invalidatedVersionNumber: existingReceipt.payload.invalidatedVersionNumber ?? null,
          ticket: detail,
        }
      }

      if (ticket.status !== 'open') return failure('ticket_not_open')
      if (ticket.updatedAt.getTime() !== new Date(body.expectedTicketUpdatedAt).getTime()) {
        return conflict()
      }
      if (activeVersions.length > 1) return conflict()
      const activeVersion = activeVersions[0] ?? null
      if ((activeVersion?.id ?? null) !== body.expectedActiveVersionId) return conflict()
      if (activeVersion && !snapshotMatchesLockedTruth(activeVersion, ticket, jobs, lines)) {
        return conflict()
      }

      const scope = scopeFor(body)
      const target = targetJobId(body)
        ? jobs.find((job) => job.id === targetJobId(body)) ?? null
        : null
      if (body.action === 'identity' || body.action === 'concern') {
        if (jobs.some((job) => job.workStatus !== 'canceled' && !jobCanBeCorrected(job))) {
          return failure('job_not_open')
        }
      } else {
        if (!target) return failure('not_found')
        if (!jobCanBeCorrected(target)) return failure('job_not_open')
        if (target.updatedAt.getTime() !== new Date(body.expectedJobUpdatedAt).getTime()) {
          return conflict()
        }
        if (body.action === 'remove_job'
          && jobs.filter((job) => job.workStatus !== 'canceled').length <= 1) {
          return failure('last_job')
        }
      }

      let identityPlan: IdentityPlan | null = null
      if (body.action === 'identity') {
        identityPlan = await planIdentity(transactionDb, shopId, ticket, body.selection)
        if (!identityPlan.ok) return failure('not_found')
      }

      const noChange = body.action === 'identity' ? (
        ticket.customerId === identityPlan?.identity?.customerId
        && ticket.vehicleId === identityPlan.identity.vehicleId
      ) : body.action === 'concern' ? ticket.concern === body.concern : body.action === 'job' ? (
        target?.title === body.title
        && target.kind === body.kind
        && (target.customerSuppliedPartsNote ?? null) === body.customerSuppliedPartsNote
      ) : false
      if (noChange) {
        const detail = await loadSafeTicket(transactionDb, responseActor, ticket.id)
        return {
          ok: true,
          outcome: 'unchanged',
          changed: false,
          scope,
          invalidatedVersionNumber: null,
          ticket: detail,
        }
      }

      const invalidationFailure = await invalidateActiveQuoteVersion(transactionDb, {
        shopId,
        ticketId: ticket.id,
        jobIds: jobs.map((job) => job.id),
        activeVersions,
      }, { afterLinkLock: dependencies.afterLinkLock })
      if (invalidationFailure) {
        throw new AbortCorrection(conflict(invalidationFailure.retryable === true))
      }
      await dependencies.beforeFactWrite?.()

      let identity = identityPlan?.ok ? identityPlan.identity : null
      if (body.action === 'identity' && identity === null) {
        if (body.selection.mode !== 'new') throw new Error('correction_identity_plan_invalid')
        identity = await materializeNewIdentity(
          transactionDb,
          shopId,
          body.selection,
        )
      }
      const receipt = receiptFor(body, hash, ticket, target, identity, activeVersion)

      if (body.action === 'identity' && identity) {
        await transactionDb.update(tickets).set({
          customerId: identity.customerId,
          vehicleId: identity.vehicleId,
          updatedAt: nextTicketTimestamp(),
        }).where(and(eq(tickets.shopId, shopId), eq(tickets.id, ticket.id)))
      } else if (body.action === 'concern') {
        await transactionDb.update(tickets).set({
          concern: body.concern,
          updatedAt: nextTicketTimestamp(),
        }).where(and(eq(tickets.shopId, shopId), eq(tickets.id, ticket.id)))
      } else if (body.action === 'job' && target) {
        await transactionDb.update(ticketJobs).set({
          title: body.title,
          kind: body.kind,
          customerSuppliedPartsNote: body.customerSuppliedPartsNote,
          updatedAt: nextJobTimestamp(),
        }).where(and(
          eq(ticketJobs.shopId, shopId),
          eq(ticketJobs.ticketId, ticket.id),
          eq(ticketJobs.id, target.id),
        ))
        await transactionDb.update(tickets).set({ updatedAt: nextTicketTimestamp() })
          .where(and(eq(tickets.shopId, shopId), eq(tickets.id, ticket.id)))
      } else if (body.action === 'remove_job' && target) {
        await transactionDb.update(ticketJobs).set({
          workStatus: 'canceled',
          updatedAt: nextJobTimestamp(),
        }).where(and(
          eq(ticketJobs.shopId, shopId),
          eq(ticketJobs.ticketId, ticket.id),
          eq(ticketJobs.id, target.id),
        ))
        await transactionDb.update(tickets).set({ updatedAt: nextTicketTimestamp() })
          .where(and(eq(tickets.shopId, shopId), eq(tickets.id, ticket.id)))
      }

      const activity = await appendTicketActivity(transactionDb, {
        shopId,
        ticketId: ticket.id,
        jobId: target?.id ?? null,
        actorProfileId: lockedActor.id,
        kind: 'ticket_corrected',
        requestKey: body.requestKey,
        payload: receipt as unknown as Record<string, unknown>,
      })
      if (!activity.ok) throw new AbortCorrection(conflict())
      const detail = await loadSafeTicket(transactionDb, responseActor, ticket.id)
      return {
        ok: true,
        outcome: 'changed',
        changed: true,
        scope,
        invalidatedVersionNumber: activeVersion?.versionNumber ?? null,
        ticket: detail,
      } satisfies CorrectionSuccess
    })
  } catch (error) {
    if (error instanceof AbortCorrection) return error.result
    if (isLockUnavailable(error)) return conflict(true)
    throw error
  }
}
