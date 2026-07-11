import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { jobLines, profiles, quoteVersions, shops, ticketJobs, tickets } from '@/lib/db/schema'
import { canBuildQuotes } from '@/lib/shop-os/capabilities'
import {
  formatScaledDecimal,
  parseScaledDecimal,
  resolveLaborPriceCents,
} from '@/lib/shop-os/quote-math'

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER
const MAX_PART_QUANTITY_SCALED = 999_999_999_999n
const MAX_LABOR_HOURS_SCALED = 99_999_999n
const uuidSchema = z.uuid().transform((value) => value.toLowerCase())
const moneySchema = z.number().int().min(0).max(MAX_SAFE_INTEGER)
const commonShape = {
  description: z.string().trim().min(1).max(500),
  sort: z.number().int().min(0).max(1_000_000).default(0),
  taxable: z.boolean(),
}

const partLineSchema = z.strictObject({
  kind: z.literal('part'),
  ...commonShape,
  quantity: z.string().max(32),
  priceCents: moneySchema,
  partNumber: z.string().trim().min(1).max(200).nullable().optional(),
  brand: z.string().trim().min(1).max(200).nullable().optional(),
  unitCostCents: moneySchema.nullable().optional(),
  coreChargeCents: moneySchema.nullable().optional(),
  fitment: z.string().trim().min(1).max(500).nullable().optional(),
})

const laborLineSchema = z.strictObject({
  kind: z.literal('labor'),
  ...commonShape,
  laborHours: z.string().max(32),
  laborRateCents: moneySchema.nullable().optional(),
  priceCents: moneySchema.nullable().optional(),
})

const feeLineSchema = z.strictObject({
  kind: z.literal('fee'),
  ...commonShape,
  priceCents: moneySchema,
})

const manualLineSchema = z.discriminatedUnion('kind', [
  partLineSchema,
  laborLineSchema,
  feeLineSchema,
])

export type QuoteActor = { profileId: string }
export type SafeManualDraftLine = Pick<
  typeof jobLines.$inferSelect,
  | 'id'
  | 'kind'
  | 'description'
  | 'sort'
  | 'quantity'
  | 'priceCents'
  | 'taxable'
  | 'partNumber'
  | 'brand'
  | 'unitCostCents'
  | 'coreChargeCents'
  | 'fitment'
  | 'laborHours'
  | 'laborRateCents'
>
export type QuoteDraftError = 'invalid_input' | 'not_found' | 'conflict'
export type QuoteDraftResult =
  | { ok: true; changed: boolean; line?: SafeManualDraftLine }
  | { ok: false; error: QuoteDraftError; retryable?: boolean }

export type QuoteDraftDependencies = {
  beforeMutation?: () => Promise<void>
}

type Failure = Extract<QuoteDraftResult, { ok: false }>
type DraftContext = {
  shopId: string
  ticketId: string
  jobId: string
  shopRateCents: number | null
  jobIds: string[]
  lineRows: Array<typeof jobLines.$inferSelect>
  activeVersions: Array<typeof quoteVersions.$inferSelect>
}

class AbortDraftMutation extends Error {
  constructor(readonly failure: Failure) {
    super('abort_quote_draft_mutation')
  }
}

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(),
  z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema),
]))
const jsonObjectSchema = z.record(z.string(), jsonValueSchema)
const snapshotTotalsSchema = z.strictObject({
  subtotalCents: moneySchema,
  taxableSubtotalCents: moneySchema,
})
const quoteSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  ticket: z.strictObject({
    id: uuidSchema,
    number: z.number().int().positive().max(MAX_SAFE_INTEGER),
    customerId: uuidSchema,
    vehicleId: uuidSchema,
    laborRateCents: moneySchema.nullable(),
    taxRateBps: z.number().int().min(0).max(10_000),
  }),
  jobs: z.array(z.strictObject({
    id: uuidSchema,
    title: z.string(),
    kind: z.enum(['diagnostic', 'repair', 'maintenance']),
    customerStory: jsonObjectSchema.nullable(),
    storyMeta: z.strictObject({
      source: z.enum(['ai', 'manual', 'template']),
      sessionId: z.string().optional(),
    }).nullable(),
    lines: z.array(z.strictObject({
      id: uuidSchema,
      kind: z.enum(['part', 'labor', 'fee']),
      description: z.string(),
      quantity: z.string(),
      priceCents: moneySchema,
      taxable: z.boolean(),
      partNumber: z.string().nullable(),
      brand: z.string().nullable(),
      unitCostCents: moneySchema.nullable(),
      coreChargeCents: moneySchema.nullable(),
      fitment: z.string().nullable(),
      laborHours: z.string().nullable(),
      laborRateCents: moneySchema.nullable(),
      source: z.enum(['manual', 'vendor_offer', 'diagnosis_seed', 'guide']),
      vendorContext: jsonObjectSchema.nullable(),
    })),
    attachments: z.array(z.strictObject({
      id: uuidSchema,
      jobId: uuidSchema,
      kind: z.enum(['photo', 'video', 'document']),
    })),
    totals: snapshotTotalsSchema,
  })).min(1),
  totals: snapshotTotalsSchema.extend({
    taxCents: moneySchema,
    totalCents: moneySchema,
  }),
})

function notFound(): Failure {
  return { ok: false, error: 'not_found' }
}

function conflict(retryable = false): Failure {
  return { ok: false, error: 'conflict', retryable }
}

function persistedDraftLineId(shopId: string, clientKey: string): string {
  const bytes = createHash('sha256')
    .update('shop-os-manual-draft-line-v1\0')
    .update(shopId)
    .update('\0')
    .update(clientKey)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function safeManualDraftLine(line: typeof jobLines.$inferSelect): SafeManualDraftLine {
  return {
    id: line.id,
    kind: line.kind,
    description: line.description,
    sort: line.sort,
    quantity: line.quantity,
    priceCents: line.priceCents,
    taxable: line.taxable,
    partNumber: line.partNumber,
    brand: line.brand,
    unitCostCents: line.unitCostCents,
    coreChargeCents: line.coreChargeCents,
    fitment: line.fitment,
    laborHours: line.laborHours,
    laborRateCents: line.laborRateCents,
  }
}

function isLockUnavailable(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'code' in current && current.code === '55P03') return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'code' in current && current.code === '23505') return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

async function loadActiveActor(db: AppDb, actor: QuoteActor) {
  const parsed = uuidSchema.safeParse(actor.profileId)
  if (!parsed.success) return null
  const [profile] = await db
    .select({ id: profiles.id, shopId: profiles.shopId, role: profiles.role })
    .from(profiles)
    .where(and(
      eq(profiles.id, parsed.data),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
  return profile?.shopId && canBuildQuotes(profile.role) ? profile : null
}

async function lockDraftContext(
  db: AppDb,
  input: { shopId: string; profileId: string; ticketId: string; jobId: string },
): Promise<DraftContext | null> {
  const [ticket] = await db
    .select({ id: tickets.id, status: tickets.status })
    .from(tickets)
    .where(and(eq(tickets.shopId, input.shopId), eq(tickets.id, input.ticketId)))
    .limit(1)
    .for('update', { noWait: true })
  if (!ticket || ticket.status !== 'open') return null

  const jobRows = await db
    .select({ id: ticketJobs.id, workStatus: ticketJobs.workStatus })
    .from(ticketJobs)
    .where(and(eq(ticketJobs.shopId, input.shopId), eq(ticketJobs.ticketId, input.ticketId)))
    .orderBy(ticketJobs.id)
    .for('update', { noWait: true })
  const targetJob = jobRows.find((job) => job.id === input.jobId)
  if (!targetJob || targetJob.workStatus === 'done' || targetJob.workStatus === 'canceled') return null

  const lineRows = await db
    .select()
    .from(jobLines)
    .where(and(eq(jobLines.shopId, input.shopId), inArray(jobLines.jobId, jobRows.map((job) => job.id))))
    .orderBy(jobLines.id)
    .for('update', { noWait: true })
  const activeVersions = await db
    .select()
    .from(quoteVersions)
    .where(and(
      eq(quoteVersions.shopId, input.shopId),
      eq(quoteVersions.ticketId, input.ticketId),
      isNull(quoteVersions.supersededAt),
    ))
    .orderBy(quoteVersions.id)
    .for('update', { noWait: true })

  const [freshActor] = await db
    .select({ id: profiles.id, role: profiles.role })
    .from(profiles)
    .where(and(
      eq(profiles.id, input.profileId),
      eq(profiles.shopId, input.shopId),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
    .for('update', { noWait: true })
  if (!freshActor || !canBuildQuotes(freshActor.role)) return null

  const [shop] = await db
    .select({ laborRateCents: shops.laborRateCents })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1)
  if (!shop) return null
  return {
    shopId: input.shopId,
    ticketId: input.ticketId,
    jobId: input.jobId,
    shopRateCents: shop.laborRateCents,
    jobIds: jobRows.map((job) => job.id),
    lineRows,
    activeVersions,
  }
}

async function invalidateActiveVersion(
  db: AppDb,
  input: {
    shopId: string
    ticketId: string
    jobIds: string[]
    activeVersions: DraftContext['activeVersions']
  },
): Promise<void> {
  if (input.activeVersions.length > 1) throw new AbortDraftMutation(conflict())
  const active = input.activeVersions[0]
  if (!active) return
  const snapshot = quoteSnapshotSchema.safeParse(active.snapshot)
  if (!snapshot.success) throw new AbortDraftMutation(conflict())
  if (snapshot.data.ticket.id !== input.ticketId) throw new AbortDraftMutation(conflict())
  const includedJobIds = snapshot.data.jobs.map((job) => job.id)
  if (new Set(includedJobIds).size !== includedJobIds.length) {
    throw new AbortDraftMutation(conflict())
  }
  const lockedJobIds = new Set(input.jobIds)
  if (includedJobIds.some((jobId) => !lockedJobIds.has(jobId))) {
    throw new AbortDraftMutation(conflict())
  }

  const [superseded] = await db
    .update(quoteVersions)
    .set({ supersededAt: new Date() })
    .where(and(eq(quoteVersions.id, active.id), isNull(quoteVersions.supersededAt)))
    .returning()
  if (!superseded) throw new AbortDraftMutation(conflict(true))
  if (includedJobIds.length > 0) {
    await db
      .update(ticketJobs)
      .set({ approvalState: 'pending_quote', approvedQuoteVersionId: null, updatedAt: new Date() })
      .where(and(
        eq(ticketJobs.shopId, input.shopId),
        eq(ticketJobs.ticketId, input.ticketId),
        inArray(ticketJobs.id, includedJobIds),
      ))
  }
}

type NormalizedLine = Omit<typeof jobLines.$inferInsert, 'id' | 'shopId' | 'jobId' | 'createdAt' | 'updatedAt'>

function normalizedLine(
  body: unknown,
  shopRateCents: number | null,
  existing?: typeof jobLines.$inferSelect,
): NormalizedLine | null {
  const parsed = manualLineSchema.safeParse(body)
  if (!parsed.success) return null
  try {
    const partQuantity = parsed.data.kind === 'part'
      ? parseScaledDecimal(parsed.data.quantity, 3)
      : 1_000n
    if (partQuantity > MAX_PART_QUANTITY_SCALED) return null
    const quantity = parsed.data.kind === 'part'
      ? formatScaledDecimal(partQuantity, 3)
      : '1'
    if (quantity === '0') return null
    const common = {
      kind: parsed.data.kind,
      description: parsed.data.description,
      sort: parsed.data.sort,
      quantity: Number(quantity),
      taxable: parsed.data.taxable,
      source: 'manual' as const,
      partStatus: 'proposed' as const,
    }
    if (parsed.data.kind === 'part') {
      return {
        ...common,
        priceCents: parsed.data.priceCents,
        partNumber: parsed.data.partNumber ?? null,
        brand: parsed.data.brand ?? null,
        unitCostCents: parsed.data.unitCostCents ?? null,
        coreChargeCents: parsed.data.coreChargeCents ?? null,
        fitment: parsed.data.fitment ?? null,
        laborHours: null,
        laborRateCents: null,
      }
    }
    if (parsed.data.kind === 'labor') {
      const hoursHundredths = parseScaledDecimal(parsed.data.laborHours, 2)
      if (hoursHundredths > MAX_LABOR_HOURS_SCALED) return null
      const hours = formatScaledDecimal(hoursHundredths, 2)
      const omittedRate = !Object.prototype.hasOwnProperty.call(parsed.data, 'laborRateCents')
      const pinnedRate = existing?.kind === 'labor' && omittedRate
        ? existing.laborRateCents
        : parsed.data.laborRateCents
      const resolved = resolveLaborPriceCents({
        hoursHundredths,
        shopRateCents,
        ...(pinnedRate !== undefined ? { pinnedRateCents: pinnedRate } : {}),
        explicitPriceCents: parsed.data.priceCents,
      })
      return {
        ...common,
        priceCents: resolved.priceCents,
        laborHours: Number(hours),
        laborRateCents: resolved.laborRateCents,
        partNumber: null,
        brand: null,
        unitCostCents: null,
        coreChargeCents: null,
        fitment: null,
      }
    }
    return {
      ...common,
      priceCents: parsed.data.priceCents,
      partNumber: null,
      brand: null,
      unitCostCents: null,
      coreChargeCents: null,
      fitment: null,
      laborHours: null,
      laborRateCents: null,
    }
  } catch {
    return null
  }
}

const comparableKeys = [
  'kind', 'description', 'sort', 'quantity', 'priceCents', 'taxable', 'partNumber', 'brand',
  'unitCostCents', 'coreChargeCents', 'fitment', 'laborHours', 'laborRateCents', 'source', 'partStatus',
] as const

function sameLine(existing: typeof jobLines.$inferSelect, desired: NormalizedLine): boolean {
  return comparableKeys.every((key) => existing[key] === desired[key])
}

function isMutableManualLine(line: typeof jobLines.$inferSelect): boolean {
  return line.source === 'manual'
    && line.partStatus === 'proposed'
    && line.vendorAccountId === null
    && line.externalOfferId === null
    && line.vendorSnapshot === null
    && line.orderedAt === null
    && line.orderedByProfileId === null
    && line.receivedAt === null
    && line.receivedByProfileId === null
}

async function runMutation(
  db: AppDb,
  actor: QuoteActor,
  ticketId: unknown,
  jobId: unknown,
  dependencies: QuoteDraftDependencies,
  mutate: (tx: AppDb, context: DraftContext) => Promise<QuoteDraftResult>,
): Promise<QuoteDraftResult> {
  const parsedTicket = uuidSchema.safeParse(ticketId)
  const parsedJob = uuidSchema.safeParse(jobId)
  if (!parsedTicket.success || !parsedJob.success) return { ok: false, error: 'invalid_input' }
  const persistedActor = await loadActiveActor(db, actor)
  if (!persistedActor?.shopId) return notFound()
  try {
    return await db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      const context = await lockDraftContext(transactionDb, {
        shopId: persistedActor.shopId as string,
        profileId: persistedActor.id,
        ticketId: parsedTicket.data,
        jobId: parsedJob.data,
      })
      if (!context) return notFound()
      if (context.activeVersions.length > 1) throw new AbortDraftMutation(conflict())
      await dependencies.beforeMutation?.()
      return mutate(transactionDb, context)
    })
  } catch (error) {
    if (error instanceof AbortDraftMutation) return error.failure
    if (isLockUnavailable(error)) return conflict(true)
    if (isUniqueViolation(error)) return conflict()
    throw error
  }
}

export async function createDraftLine(
  db: AppDb,
  input: { actor: QuoteActor; ticketId: unknown; jobId: unknown; clientKey: unknown; body: unknown },
  dependencies: QuoteDraftDependencies = {},
): Promise<QuoteDraftResult> {
  const parsedClientKey = uuidSchema.safeParse(input.clientKey)
  if (!parsedClientKey.success || !manualLineSchema.safeParse(input.body).success) {
    return { ok: false, error: 'invalid_input' }
  }
  return runMutation(db, input.actor, input.ticketId, input.jobId, dependencies, async (tx, context) => {
    const lineId = persistedDraftLineId(context.shopId, parsedClientKey.data)
    const sameShopCollision = context.lineRows.find((line) => line.id === lineId)
      ?? (await tx.select().from(jobLines).where(and(
        eq(jobLines.shopId, context.shopId),
        eq(jobLines.id, lineId),
      )).limit(1))[0]
    const desired = normalizedLine(input.body, context.shopRateCents, sameShopCollision)
    if (!desired) return { ok: false, error: 'invalid_input' }
    if (sameShopCollision) {
      if (
        sameShopCollision.jobId === context.jobId
        && isMutableManualLine(sameShopCollision)
        && sameLine(sameShopCollision, desired)
      ) {
        return { ok: true, changed: false, line: safeManualDraftLine(sameShopCollision) }
      }
      return conflict()
    }
    const [line] = await tx.insert(jobLines).values({
      id: lineId,
      shopId: context.shopId,
      jobId: context.jobId,
      ...desired,
    }).returning()
    await invalidateActiveVersion(tx, {
      shopId: context.shopId,
      ticketId: context.ticketId,
      jobIds: context.jobIds,
      activeVersions: context.activeVersions,
    })
    return { ok: true, changed: true, line: safeManualDraftLine(line) }
  })
}

export async function replaceDraftLine(
  db: AppDb,
  input: { actor: QuoteActor; ticketId: unknown; jobId: unknown; lineId: unknown; body: unknown },
): Promise<QuoteDraftResult> {
  const parsedLineId = uuidSchema.safeParse(input.lineId)
  if (!parsedLineId.success || !manualLineSchema.safeParse(input.body).success) {
    return { ok: false, error: 'invalid_input' }
  }
  return runMutation(db, input.actor, input.ticketId, input.jobId, {}, async (tx, context) => {
    const existing = context.lineRows.find((line) =>
      line.id === parsedLineId.data
      && line.jobId === context.jobId
      && isMutableManualLine(line),
    )
    if (!existing) return notFound()
    const desired = normalizedLine(input.body, context.shopRateCents, existing)
    if (!desired) return { ok: false, error: 'invalid_input' }
    if (sameLine(existing, desired)) {
      return { ok: true, changed: false, line: safeManualDraftLine(existing) }
    }
    const [line] = await tx.update(jobLines).set({ ...desired, updatedAt: new Date() }).where(and(
      eq(jobLines.shopId, context.shopId),
      eq(jobLines.jobId, context.jobId),
      eq(jobLines.id, parsedLineId.data),
    )).returning()
    if (!line) throw new AbortDraftMutation(conflict(true))
    await invalidateActiveVersion(tx, {
      shopId: context.shopId,
      ticketId: context.ticketId,
      jobIds: context.jobIds,
      activeVersions: context.activeVersions,
    })
    return { ok: true, changed: true, line: safeManualDraftLine(line) }
  })
}

export async function deleteDraftLine(
  db: AppDb,
  input: { actor: QuoteActor; ticketId: unknown; jobId: unknown; lineId: unknown },
): Promise<QuoteDraftResult> {
  const parsedLineId = uuidSchema.safeParse(input.lineId)
  if (!parsedLineId.success) return { ok: false, error: 'invalid_input' }
  return runMutation(db, input.actor, input.ticketId, input.jobId, {}, async (tx, context) => {
    const namedLine = context.lineRows.find((line) =>
      line.id === parsedLineId.data && line.jobId === context.jobId,
    )
    if (namedLine && !isMutableManualLine(namedLine)) return notFound()
    const existing = namedLine
    if (!existing) return { ok: true, changed: false }
    const [deleted] = await tx.delete(jobLines).where(and(
      eq(jobLines.shopId, context.shopId),
      eq(jobLines.jobId, context.jobId),
      eq(jobLines.id, parsedLineId.data),
    )).returning()
    if (!deleted) throw new AbortDraftMutation(conflict(true))
    await invalidateActiveVersion(tx, {
      shopId: context.shopId,
      ticketId: context.ticketId,
      jobIds: context.jobIds,
      activeVersions: context.activeVersions,
    })
    return { ok: true, changed: true }
  })
}
