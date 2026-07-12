import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  jobLines,
  profiles,
  quoteVersions,
  ticketJobs,
  tickets,
  vendorAccounts,
} from '@/lib/db/schema'
import { canBuildQuotes } from '@/lib/shop-os/capabilities'
import {
  ManualPartsAdapter,
  parseManualOfferSnapshot,
  validateStoredManualOfferLine,
  type ManualOfferSnapshotV1,
  type PartsAdapter,
} from '@/lib/shop-os/parts-adapters'
import { formatScaledDecimal, parseScaledDecimal, stableStringify } from '@/lib/shop-os/quote-math'
import { invalidateActiveQuoteVersion, isLockUnavailable } from '@/lib/shop-os/quotes'

const MAX_INTEGER = 2_147_483_647
const MAX_QUANTITY_SCALED = 999_999_999_999n
const uuidSchema = z.uuid().transform((value) => value.toLowerCase())
const moneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const optionalText = (maximum: number) => z.string().trim().min(1).max(maximum).nullable().optional()

const captureSchema = z.strictObject({
  clientKey: uuidSchema,
  vendorAccountId: uuidSchema,
  description: z.string().trim().min(1).max(500),
  partNumber: optionalText(200),
  brand: optionalText(200),
  quantity: z.string().max(32),
  priceCents: moneySchema,
  unitCostCents: moneySchema,
  coreChargeCents: moneySchema,
  taxable: z.boolean(),
  availability: z.enum(['in_stock', 'special_order', 'unavailable', 'unknown']),
  fitment: optionalText(500),
  fulfillment: z.strictObject({
    method: z.enum(['pickup', 'delivery', 'ship', 'unknown']),
    locationLabel: optionalText(500),
  }),
  externalOfferId: optionalText(500),
})

export type ManualOfferActor = { profileId: string }

type CaptureBody = z.output<typeof captureSchema>
type StoredLine = typeof jobLines.$inferSelect
type StoredVersion = typeof quoteVersions.$inferSelect

export type SafeManualOfferLine = {
  id: string
  jobId: string
  kind: 'part'
  description: string
  quantity: string
  priceCents: number
  taxable: boolean
  partNumber: string | null
  brand: string | null
  fitment: string | null
  source: 'vendor_offer'
  mutable: false
}

export type SafeManualOfferSourcing = {
  vendorAccountId: string
  displayName: string
  externalOfferId: string | null
  unitCostCents: number
  coreChargeCents: number
  availability: 'in_stock' | 'special_order' | 'unknown'
  fulfillment: {
    method: 'pickup' | 'delivery' | 'ship' | 'unknown'
    locationLabel: string | null
  }
  fetchedAt: string
}

export type ManualOfferResult =
  | { ok: true; changed: boolean; unavailable?: never; line: SafeManualOfferLine; sourcing: SafeManualOfferSourcing }
  | { ok: true; changed: false; unavailable: true }
  | { ok: true; changed: boolean; unavailable?: never; line?: never; sourcing?: never }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'conflict'; retryable?: boolean }

export type ManualOfferDependencies = {
  adapter?: PartsAdapter
  beforeMutation?: () => Promise<void>
}

type LockedContext = {
  shopId: string
  actorId: string
  ticketId: string
  jobId: string
  jobIds: string[]
  lines: StoredLine[]
  activeVersions: StoredVersion[]
  account: typeof vendorAccounts.$inferSelect | null
}

type Failure = Extract<ManualOfferResult, { ok: false }>

class AbortManualOffer extends Error {
  constructor(readonly failure: Failure) {
    super('abort_manual_offer')
  }
}

function notFound(): Failure {
  return { ok: false, error: 'not_found' }
}

function conflict(retryable = false): Failure {
  return { ok: false, error: 'conflict', retryable }
}

export function manualOfferActorFromProfile(profile: { id: string }): ManualOfferActor {
  return { profileId: profile.id }
}

export function manualOfferDomainStatus(
  result: { ok: boolean; error?: 'invalid_input' | 'not_found' | 'conflict' },
  successStatus = 200,
): number {
  if (result.ok) return successStatus
  if (result.error === 'invalid_input') return 422
  if (result.error === 'not_found') return 404
  return 409
}

export function manualOfferErrorBody(result: Failure): { error: Failure['error']; retryable?: true } {
  return result.retryable
    ? { error: result.error, retryable: true }
    : { error: result.error }
}

function canonicalQuantity(value: string): string | null {
  try {
    const scaled = parseScaledDecimal(value, 3)
    if (scaled <= 0n || scaled > MAX_QUANTITY_SCALED) return null
    return formatScaledDecimal(scaled, 3)
  } catch {
    return null
  }
}

function requestFingerprint(
  body: CaptureBody,
  context: { shopId: string; ticketId: string; jobId: string },
): string {
  return createHash('sha256').update(stableStringify({
    schemaVersion: 1,
    shopId: context.shopId,
    ticketId: context.ticketId,
    jobId: context.jobId,
    vendorAccountId: body.vendorAccountId,
    description: body.description,
    partNumber: body.partNumber ?? null,
    brand: body.brand ?? null,
    quantity: body.quantity,
    priceCents: body.priceCents,
    unitCostCents: body.unitCostCents,
    coreChargeCents: body.coreChargeCents,
    taxable: body.taxable,
    availability: body.availability,
    fitment: body.fitment ?? null,
    fulfillment: {
      method: body.fulfillment.method,
      locationLabel: body.fulfillment.locationLabel ?? null,
    },
    externalOfferId: body.externalOfferId ?? null,
  })).digest('hex')
}

function isCleanManualAccount(account: typeof vendorAccounts.$inferSelect): boolean {
  return account.vendor === 'manual'
    && account.mode === 'manual'
    && account.enabled
    && account.secretRef === null
    && account.nonSecretConfig !== null
    && typeof account.nonSecretConfig === 'object'
    && !Array.isArray(account.nonSecretConfig)
    && Object.keys(account.nonSecretConfig).length === 0
}

function isEligibleJob(job: Pick<typeof ticketJobs.$inferSelect, 'kind' | 'workStatus'>): boolean {
  return (job.kind === 'repair' || job.kind === 'maintenance')
    && (job.workStatus === 'open' || job.workStatus === 'blocked')
}

function isOfferLine(line: StoredLine): boolean {
  return validateStoredManualOfferLine(line) !== null
}

function safeResult(
  line: StoredLine,
  snapshot: ManualOfferSnapshotV1,
  changed: boolean,
): Extract<ManualOfferResult, { ok: true; line: SafeManualOfferLine }> {
  return {
    ok: true,
    changed,
    line: {
      id: line.id,
      jobId: line.jobId,
      kind: 'part',
      description: line.description,
      quantity: snapshot.quantity,
      priceCents: line.priceCents,
      taxable: line.taxable,
      partNumber: line.partNumber,
      brand: line.brand,
      fitment: line.fitment,
      source: 'vendor_offer',
      mutable: false,
    },
    sourcing: {
      vendorAccountId: snapshot.vendorAccountId,
      displayName: snapshot.vendorDisplayName,
      externalOfferId: snapshot.externalOfferId ?? null,
      unitCostCents: snapshot.unitCostCents,
      coreChargeCents: snapshot.coreChargeCents,
      availability: snapshot.availability,
      fulfillment: {
        method: snapshot.fulfillment.method,
        locationLabel: snapshot.fulfillment.locationLabel ?? null,
      },
      fetchedAt: snapshot.fetchedAt,
    },
  }
}

function exactReplay(
  line: StoredLine,
  body: CaptureBody,
  fingerprint: string,
  context: Pick<LockedContext, 'jobId'>,
): Extract<ManualOfferResult, { ok: true; line: SafeManualOfferLine }> | null {
  if (line.jobId !== context.jobId || !isOfferLine(line)) return null
  const snapshot = validateStoredManualOfferLine(line)
  if (!snapshot
    || snapshot.requestFingerprint !== fingerprint
    || snapshot.vendorAccountId !== body.vendorAccountId
    || snapshot.quantity !== body.quantity
    || snapshot.unitCostCents !== body.unitCostCents
    || snapshot.coreChargeCents !== body.coreChargeCents
    || snapshot.availability !== body.availability
    || snapshot.fitment !== (body.fitment ?? null)
    || snapshot.fulfillment.method !== body.fulfillment.method
    || (snapshot.fulfillment.locationLabel ?? null) !== (body.fulfillment.locationLabel ?? null)
    || (snapshot.externalOfferId ?? null) !== (body.externalOfferId ?? null)
    || line.vendorAccountId !== body.vendorAccountId
    || line.externalOfferId !== (body.externalOfferId ?? null)
    || line.description !== body.description
    || line.quantity !== Number(body.quantity)
    || line.priceCents !== body.priceCents
    || line.taxable !== body.taxable
    || line.partNumber !== (body.partNumber ?? null)
    || line.brand !== (body.brand ?? null)
    || line.unitCostCents !== body.unitCostCents
    || line.coreChargeCents !== body.coreChargeCents
    || line.fitment !== (body.fitment ?? null)) return null
  return safeResult(line, snapshot, false)
}

async function loadActiveActor(db: AppDb, actor: ManualOfferActor) {
  const parsed = uuidSchema.safeParse(actor.profileId)
  if (!parsed.success) return null
  const [profile] = await db.select({ id: profiles.id, shopId: profiles.shopId, role: profiles.role })
    .from(profiles)
    .where(and(
      eq(profiles.id, parsed.data),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
  return profile?.shopId && canBuildQuotes(profile.role) ? profile : null
}

async function lockContext(
  db: AppDb,
  input: {
    shopId: string
    actorId: string
    ticketId: string
    jobId: string
    accountId?: string
    selectedLineId?: string
  },
): Promise<LockedContext | null> {
  const [ticket] = await db.select({
    id: tickets.id,
    status: tickets.status,
    customerId: tickets.customerId,
    vehicleId: tickets.vehicleId,
  }).from(tickets)
    .where(and(eq(tickets.shopId, input.shopId), eq(tickets.id, input.ticketId)))
    .limit(1)
    .for('update', { noWait: true })
  if (!ticket || ticket.status !== 'open' || !ticket.customerId || !ticket.vehicleId) return null

  const jobs = await db.select({ id: ticketJobs.id, kind: ticketJobs.kind, workStatus: ticketJobs.workStatus })
    .from(ticketJobs)
    .where(and(eq(ticketJobs.shopId, input.shopId), eq(ticketJobs.ticketId, ticket.id)))
    .orderBy(ticketJobs.id)
    .for('update', { noWait: true })
  const target = jobs.find((job) => job.id === input.jobId)

  const lines = jobs.length === 0 ? [] : await db.select().from(jobLines)
    .where(and(eq(jobLines.shopId, input.shopId), inArray(jobLines.jobId, jobs.map((job) => job.id))))
    .orderBy(jobLines.id)
    .for('update', { noWait: true })

  const activeVersions = await db.select().from(quoteVersions)
    .where(and(
      eq(quoteVersions.shopId, input.shopId),
      eq(quoteVersions.ticketId, ticket.id),
      isNull(quoteVersions.supersededAt),
    ))
    .orderBy(quoteVersions.id)
    .for('update', { noWait: true })

  const [freshActor] = await db.select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(and(
      eq(profiles.id, input.actorId),
      eq(profiles.shopId, input.shopId),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
    .for('update', { noWait: true })

  const selectedAccountId = input.accountId
    ?? lines.find((line) => line.id === input.selectedLineId)?.vendorAccountId
  const [account] = selectedAccountId ? await db.select().from(vendorAccounts)
    .where(and(eq(vendorAccounts.shopId, input.shopId), eq(vendorAccounts.id, selectedAccountId)))
    .limit(1)
    .for('update', { noWait: true }) : []

  if (!target || !isEligibleJob(target) || !freshActor || !canBuildQuotes(freshActor.role)) {
    return null
  }
  return {
    shopId: input.shopId,
    actorId: freshActor.id,
    ticketId: ticket.id,
    jobId: target.id,
    jobIds: jobs.map((job) => job.id),
    lines,
    activeVersions,
    account,
  }
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'code' in current && current.code === '23505') return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

export async function captureManualOffer(
  db: AppDb,
  input: { actor: ManualOfferActor; ticketId: unknown; jobId: unknown; body: unknown },
  dependencies: ManualOfferDependencies = {},
): Promise<ManualOfferResult> {
  const parsedActor = uuidSchema.safeParse(input.actor.profileId)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedJob = uuidSchema.safeParse(input.jobId)
  const parsedBody = captureSchema.safeParse(input.body)
  if (!parsedActor.success || !parsedTicket.success || !parsedJob.success || !parsedBody.success) {
    return { ok: false, error: 'invalid_input' }
  }
  const quantity = canonicalQuantity(parsedBody.data.quantity)
  if (!quantity) return { ok: false, error: 'invalid_input' }
  const body: CaptureBody = { ...parsedBody.data, quantity }
  const persistedActor = await loadActiveActor(db, { profileId: parsedActor.data })
  if (!persistedActor?.shopId) return notFound()
  const adapter = dependencies.adapter ?? new ManualPartsAdapter()

  try {
    return await db.transaction(async (transaction) => {
      const tx = transaction as AppDb
      const context = await lockContext(tx, {
        shopId: persistedActor.shopId as string,
        actorId: persistedActor.id,
        ticketId: parsedTicket.data,
        jobId: parsedJob.data,
        accountId: body.vendorAccountId,
      })
      if (!context || !context.account) return notFound()
      if (context.activeVersions.length > 1) throw new AbortManualOffer(conflict())

      const fingerprint = requestFingerprint(body, context)
      const collision = context.lines.find((line) => line.id === body.clientKey)
      if (collision) {
        const replay = exactReplay(collision, body, fingerprint, context)
        if (replay) return replay
        throw new AbortManualOffer(conflict())
      }

      if (!isCleanManualAccount(context.account)) return notFound()
      let refreshed: Awaited<ReturnType<PartsAdapter['refreshOffer']>>
      try {
        refreshed = await adapter.refreshOffer({
          description: body.description,
          partNumber: body.partNumber ?? null,
          brand: body.brand ?? null,
          quantity: body.quantity,
          unitCostCents: body.unitCostCents,
          coreChargeCents: body.coreChargeCents,
          availability: body.availability,
          fitment: body.fitment ?? null,
          fulfillment: {
            method: body.fulfillment.method,
            locationLabel: body.fulfillment.locationLabel ?? null,
          },
          externalOfferId: body.externalOfferId ?? null,
          verifyingProfileId: context.actorId,
        })
      } catch {
        return { ok: false, error: 'invalid_input' }
      }
      if (refreshed.kind === 'unavailable') {
        return { ok: true, changed: false, unavailable: true }
      }
      const offer = refreshed.offer
      if (offer.description !== body.description
        || offer.partNumber !== (body.partNumber ?? null)
        || offer.brand !== (body.brand ?? null)
        || offer.quantity !== body.quantity
        || offer.unitCostCents !== body.unitCostCents
        || offer.coreChargeCents !== body.coreChargeCents
        || offer.availability !== body.availability
        || offer.fitment !== (body.fitment ?? null)
        || offer.fulfillment.method !== body.fulfillment.method
        || offer.fulfillment.locationLabel !== (body.fulfillment.locationLabel ?? null)
        || offer.externalOfferId !== (body.externalOfferId ?? null)
        || offer.currency !== 'USD'
        || offer.verifiedByProfileId !== context.actorId) {
        return { ok: false, error: 'invalid_input' }
      }
      const snapshot: ManualOfferSnapshotV1 = {
        schemaVersion: 1,
        kind: 'manual_offer',
        vendorAccountId: context.account.id,
        vendorDisplayName: context.account.displayName,
        externalOfferId: offer.externalOfferId,
        currency: 'USD',
        quantity: offer.quantity,
        unitCostCents: offer.unitCostCents,
        coreChargeCents: offer.coreChargeCents,
        availability: offer.availability,
        fitment: offer.fitment,
        fulfillment: offer.fulfillment,
        fetchedAt: offer.fetchedAt,
        verifiedByProfileId: offer.verifiedByProfileId,
        requestFingerprint: fingerprint,
      }
      const strictSnapshot = parseManualOfferSnapshot(snapshot)
      if (!strictSnapshot) return { ok: false, error: 'invalid_input' }
      const maximumSort = context.lines
        .filter((line) => line.jobId === context.jobId)
        .reduce((maximum, line) => Math.max(maximum, line.sort), -1)
      if (!Number.isSafeInteger(maximumSort) || maximumSort >= MAX_INTEGER) {
        throw new AbortManualOffer(conflict())
      }
      await dependencies.beforeMutation?.()
      const [line] = await tx.insert(jobLines).values({
        id: body.clientKey,
        shopId: context.shopId,
        jobId: context.jobId,
        kind: 'part',
        description: offer.description,
        sort: maximumSort + 1,
        quantity: Number(offer.quantity),
        priceCents: body.priceCents,
        taxable: body.taxable,
        partNumber: offer.partNumber,
        brand: offer.brand,
        unitCostCents: offer.unitCostCents,
        coreChargeCents: offer.coreChargeCents,
        fitment: offer.fitment,
        vendorAccountId: context.account.id,
        externalOfferId: offer.externalOfferId,
        vendorSnapshot: strictSnapshot,
        partStatus: 'proposed',
        source: 'vendor_offer',
      }).returning()
      const invalidation = await invalidateActiveQuoteVersion(tx, {
        shopId: context.shopId,
        ticketId: context.ticketId,
        jobIds: context.jobIds,
        activeVersions: context.activeVersions,
      })
      if (invalidation) throw new AbortManualOffer(invalidation)
      return safeResult(line, strictSnapshot, true)
    })
  } catch (error) {
    if (error instanceof AbortManualOffer) return error.failure
    if (isLockUnavailable(error)) return conflict(true)
    if (isUniqueViolation(error)) return conflict()
    throw error
  }
}

export async function removeManualOffer(
  db: AppDb,
  input: { actor: ManualOfferActor; ticketId: unknown; jobId: unknown; lineId: unknown },
): Promise<ManualOfferResult> {
  const parsedActor = uuidSchema.safeParse(input.actor.profileId)
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedJob = uuidSchema.safeParse(input.jobId)
  const parsedLine = uuidSchema.safeParse(input.lineId)
  if (!parsedActor.success || !parsedTicket.success || !parsedJob.success || !parsedLine.success) {
    return { ok: false, error: 'invalid_input' }
  }
  const persistedActor = await loadActiveActor(db, { profileId: parsedActor.data })
  if (!persistedActor?.shopId) return notFound()

  try {
    return await db.transaction(async (transaction) => {
      const tx = transaction as AppDb
      const context = await lockContext(tx, {
        shopId: persistedActor.shopId as string,
        actorId: persistedActor.id,
        ticketId: parsedTicket.data,
        jobId: parsedJob.data,
        selectedLineId: parsedLine.data,
      })
      if (!context) return notFound()
      if (context.activeVersions.length > 1) throw new AbortManualOffer(conflict())
      const line = context.lines.find((candidate) => candidate.id === parsedLine.data && candidate.jobId === context.jobId)
      if (!line) return { ok: true, changed: false }
      if (!context.account || !validateStoredManualOfferLine(line)
        || line.vendorAccountId !== context.account.id) return notFound()
      const [deleted] = await tx.delete(jobLines).where(and(
        eq(jobLines.shopId, context.shopId),
        eq(jobLines.jobId, context.jobId),
        eq(jobLines.id, parsedLine.data),
      )).returning()
      if (!deleted) throw new AbortManualOffer(conflict(true))
      const invalidation = await invalidateActiveQuoteVersion(tx, {
        shopId: context.shopId,
        ticketId: context.ticketId,
        jobIds: context.jobIds,
        activeVersions: context.activeVersions,
      })
      if (invalidation) throw new AbortManualOffer(invalidation)
      return { ok: true, changed: true }
    })
  } catch (error) {
    if (error instanceof AbortManualOffer) return error.failure
    if (isLockUnavailable(error)) return conflict(true)
    throw error
  }
}

export function publicManualOfferResult(result: Extract<ManualOfferResult, { ok: true }>): object {
  if ('unavailable' in result && result.unavailable) {
    return { changed: false, unavailable: true }
  }
  if (!('line' in result) || !result.line || !('sourcing' in result) || !result.sourcing) {
    return { changed: result.changed }
  }
  return {
    changed: result.changed,
    line: {
      id: result.line.id,
      jobId: result.line.jobId,
      kind: 'part',
      description: result.line.description,
      quantity: result.line.quantity,
      priceCents: result.line.priceCents,
      taxable: result.line.taxable,
      partNumber: result.line.partNumber,
      brand: result.line.brand,
      fitment: result.line.fitment,
      source: 'vendor_offer',
      mutable: false,
    },
    sourcing: {
      vendorAccountId: result.sourcing.vendorAccountId,
      displayName: result.sourcing.displayName,
      externalOfferId: result.sourcing.externalOfferId,
      unitCostCents: result.sourcing.unitCostCents,
      coreChargeCents: result.sourcing.coreChargeCents,
      availability: result.sourcing.availability,
      fulfillment: {
        method: result.sourcing.fulfillment.method,
        locationLabel: result.sourcing.fulfillment.locationLabel,
      },
      fetchedAt: result.sourcing.fetchedAt,
    },
  }
}
