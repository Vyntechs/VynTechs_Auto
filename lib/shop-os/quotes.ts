import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { jobAttachments, jobLines, profiles, quoteVersions, shops, ticketJobs, tickets } from '@/lib/db/schema'
import { canBuildQuotes } from '@/lib/shop-os/capabilities'
import {
  formatScaledDecimal,
  buildQuoteStoryMeta,
  calculateTicketTotals,
  canonicalizeJson,
  parseScaledDecimal,
  quoteSnapshotContentIdentity,
  resolveLaborPriceCents,
  sortBySnapshotOrder,
  type QuoteCustomerStoryV1,
  type QuoteSnapshotV1,
} from '@/lib/shop-os/quote-math'

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER
const MAX_PART_QUANTITY_SCALED = 999_999_999_999n
const MAX_LABOR_HOURS_SCALED = 99_999_999n
const MAX_POSTGRES_INTEGER = 2_147_483_647
const MAX_SNAPSHOT_BYTES = 65_536
const uuidSchema = z.uuid().transform((value) => value.toLowerCase())
const moneySchema = z.number().int().min(0).max(MAX_SAFE_INTEGER)
const boundedText = (max: number) => z.string().max(max)
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

const storyEvidenceSchema = z.strictObject({
  claim: boundedText(2_000),
  sourceEventIds: z.array(boundedText(200)).max(100),
  sourceArtifactIds: z.array(boundedText(200)).max(100),
})
const customerStorySchema = z.strictObject({
  whatYouToldUs: boundedText(5_000),
  whatWeFound: boundedText(5_000),
  howWeKnow: z.array(storyEvidenceSchema).max(50),
  whatItMeansIfWaived: boundedText(5_000),
  whatWeRecommend: boundedText(5_000),
})
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
    title: boundedText(500),
    kind: z.enum(['diagnostic', 'repair', 'maintenance']),
    customerStory: customerStorySchema.nullable(),
    storyMeta: z.strictObject({
      source: z.enum(['ai', 'manual', 'template']),
      sessionId: boundedText(200).optional(),
    }).nullable(),
    lines: z.array(z.strictObject({
      id: uuidSchema,
      kind: z.enum(['part', 'labor', 'fee']),
      description: boundedText(500),
      quantity: z.string(),
      priceCents: moneySchema,
      taxable: z.boolean(),
      partNumber: boundedText(200).nullable(),
      brand: boundedText(200).nullable(),
      coreChargeCents: moneySchema.nullable(),
      fitment: boundedText(500).nullable(),
      laborHours: z.string().nullable(),
      laborRateCents: moneySchema.nullable(),
      source: z.enum(['manual', 'vendor_offer', 'diagnosis_seed', 'guide']),
      vendorContext: z.null(),
    }).superRefine((line, context) => {
      const partFieldsPresent = line.partNumber !== null || line.brand !== null
        || line.coreChargeCents !== null || line.fitment !== null
      const laborFieldsPresent = line.laborHours !== null || line.laborRateCents !== null
      if (line.kind === 'part' && laborFieldsPresent) {
        context.addIssue({ code: 'custom', message: 'part line contains labor fields' })
      }
      if (line.kind === 'labor' && (partFieldsPresent || line.laborHours === null)) {
        context.addIssue({ code: 'custom', message: 'labor line fields are corrupt' })
      }
      if (line.kind === 'fee' && (partFieldsPresent || laborFieldsPresent)) {
        context.addIssue({ code: 'custom', message: 'fee line contains typed fields' })
      }
    })).max(500),
    attachments: z.array(z.strictObject({
      id: uuidSchema,
      jobId: uuidSchema,
      kind: z.enum(['photo', 'video', 'document']),
    })).max(200),
    totals: snapshotTotalsSchema,
  })).min(1).max(200),
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

export type CreateQuoteVersionResult =
  | {
    ok: true
    changed: boolean
    version: {
      id: string
      versionNumber: number
    }
  }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'conflict'; retryable?: boolean }

export type CreateQuoteVersionDependencies = {
  beforeWrite?: () => Promise<void>
  afterTicketLock?: () => Promise<void>
}

type VersionFailure = Extract<CreateQuoteVersionResult, { ok: false }>
type VersionContext = {
  ticket: Pick<typeof tickets.$inferSelect, 'id' | 'ticketNumber' | 'customerId' | 'vehicleId'>
  shop: Pick<typeof shops.$inferSelect, 'id' | 'laborRateCents' | 'taxRateBps'>
  jobs: Array<typeof ticketJobs.$inferSelect>
  lines: Array<typeof jobLines.$inferSelect>
  attachments: Array<typeof jobAttachments.$inferSelect>
  versions: Array<typeof quoteVersions.$inferSelect>
  actorId: string
}

class AbortVersionCreation extends Error {
  constructor(readonly failure: VersionFailure) {
    super('abort_quote_version_creation')
  }
}

async function lockVersionContext(
  db: AppDb,
  input: { shopId: string; profileId: string; ticketId: string },
  dependencies: Pick<CreateQuoteVersionDependencies, 'afterTicketLock'>,
): Promise<VersionContext | null> {
  const [ticket] = await db
    .select({
      id: tickets.id,
      ticketNumber: tickets.ticketNumber,
      customerId: tickets.customerId,
      vehicleId: tickets.vehicleId,
      status: tickets.status,
    })
    .from(tickets)
    .where(and(eq(tickets.shopId, input.shopId), eq(tickets.id, input.ticketId)))
    .limit(1)
    .for('update', { noWait: true })
  if (!ticket || ticket.status !== 'open') return null
  await dependencies.afterTicketLock?.()

  const [shop] = await db
    .select({ id: shops.id, laborRateCents: shops.laborRateCents, taxRateBps: shops.taxRateBps })
    .from(shops)
    .where(eq(shops.id, input.shopId))
    .limit(1)
    .for('update', { noWait: true })
  if (!shop) return null

  const jobs = await db
    .select()
    .from(ticketJobs)
    .where(and(eq(ticketJobs.shopId, input.shopId), eq(ticketJobs.ticketId, input.ticketId)))
    .orderBy(ticketJobs.id)
    .for('update', { noWait: true })
  const jobIds = jobs.map((job) => job.id)
  const lines = jobIds.length === 0
    ? []
    : await db
      .select()
      .from(jobLines)
      .where(and(eq(jobLines.shopId, input.shopId), inArray(jobLines.jobId, jobIds)))
      .orderBy(jobLines.id)
      .for('update', { noWait: true })
  const attachments = jobIds.length === 0
    ? []
    : await db
      .select()
      .from(jobAttachments)
      .where(and(eq(jobAttachments.shopId, input.shopId), inArray(jobAttachments.jobId, jobIds)))
      .orderBy(jobAttachments.id)
      .for('update', { noWait: true })
  const versions = await db
    .select()
    .from(quoteVersions)
    .where(and(eq(quoteVersions.shopId, input.shopId), eq(quoteVersions.ticketId, input.ticketId)))
    .orderBy(quoteVersions.id)
    .for('update', { noWait: true })
  const [actor] = await db
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
  if (!actor || !canBuildQuotes(actor.role)) return null
  return { ticket, shop, jobs, lines, attachments, versions, actorId: actor.id }
}

function safeUuid(value: string): string {
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) throw new TypeError('persisted UUID is invalid')
  return parsed.data
}

function safeMoney(value: number | null, nullable = false): number | null {
  if (value === null && nullable) return null
  if (value === null || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('persisted money value is unsafe')
  }
  return value
}

function safeCustomerStory(value: unknown): QuoteCustomerStoryV1 | null {
  if (value === null) return null
  const parsed = customerStorySchema.safeParse(value)
  if (!parsed.success) throw new TypeError('persisted customer story is invalid')
  return canonicalizeJson(parsed.data) as unknown as QuoteCustomerStoryV1
}

function requireBoundedJson(value: unknown, maxBytes: number): void {
  if (value === null) return
  const canonical = canonicalizeJson(value)
  if (!canonical || typeof canonical !== 'object' || Array.isArray(canonical)) {
    throw new TypeError('persisted vendor context is invalid')
  }
  if (Buffer.byteLength(JSON.stringify(canonical), 'utf8') > maxBytes) {
    throw new RangeError('persisted vendor context is oversized')
  }
}

function canonicalStoredDecimal(value: number, scale: number): string {
  if (!Number.isFinite(value)) throw new RangeError('persisted decimal is unsafe')
  return formatScaledDecimal(parseScaledDecimal(String(value), scale), scale)
}

function buildQuoteSnapshot(context: VersionContext): QuoteSnapshotV1 {
  if (!context.ticket.customerId || !context.ticket.vehicleId) {
    throw new TypeError('ticket is unreconciled')
  }
  if (!Number.isSafeInteger(context.ticket.ticketNumber) || context.ticket.ticketNumber <= 0) {
    throw new RangeError('ticket number is unsafe')
  }
  if (context.shop.taxRateBps === null || !Number.isInteger(context.shop.taxRateBps)
    || context.shop.taxRateBps < 0 || context.shop.taxRateBps > 10_000) {
    throw new RangeError('shop tax rate is unconfigured or unsafe')
  }
  const shopRate = safeMoney(context.shop.laborRateCents, true)
  const linesByJob = new Map<string, Array<typeof jobLines.$inferSelect>>()
  for (const line of context.lines) {
    const rows = linesByJob.get(line.jobId) ?? []
    rows.push(line)
    linesByJob.set(line.jobId, rows)
  }
  const attachmentsByJob = new Map<string, Array<typeof jobAttachments.$inferSelect>>()
  for (const attachment of context.attachments) {
    const rows = attachmentsByJob.get(attachment.jobId) ?? []
    rows.push(attachment)
    attachmentsByJob.set(attachment.jobId, rows)
  }
  const jobs = sortBySnapshotOrder(context.jobs)
    .filter((job) => job.workStatus !== 'canceled' && (linesByJob.get(job.id)?.length ?? 0) > 0)
    .map((job) => {
      if (!job.title) throw new TypeError('job title is empty')
      const totalsInput: Array<{ extendedCents: number; taxable: boolean }> = []
      const lines = sortBySnapshotOrder(linesByJob.get(job.id) ?? []).map((line) => {
        if (!line.description) throw new TypeError('line description is empty')
        const priceCents = safeMoney(line.priceCents)
        if (priceCents === null) throw new TypeError('line price is missing')
        const quantity = canonicalStoredDecimal(line.quantity, 3)
        if (parseScaledDecimal(quantity, 3) === 0n) throw new RangeError('line quantity is zero')
        const laborHours = line.laborHours === null ? null : canonicalStoredDecimal(line.laborHours, 2)
        const laborRateCents = safeMoney(line.laborRateCents, true)
        const partFieldsPresent = line.partNumber !== null || line.brand !== null
          || line.unitCostCents !== null || line.coreChargeCents !== null || line.fitment !== null
        const laborFieldsPresent = line.laborHours !== null || line.laborRateCents !== null
        if (line.kind === 'part' && laborFieldsPresent) throw new TypeError('part line contains labor fields')
        if (line.kind === 'labor' && (partFieldsPresent || laborHours === null)) {
          throw new TypeError('labor line fields are corrupt')
        }
        if (line.kind === 'fee' && (partFieldsPresent || laborFieldsPresent)) {
          throw new TypeError('fee line contains typed fields')
        }
        if (line.kind !== 'part' && quantity !== '1') throw new TypeError('non-part quantity is corrupt')
        requireBoundedJson(line.vendorSnapshot, 16_384)
        totalsInput.push({ extendedCents: priceCents, taxable: line.taxable })
        return {
          id: safeUuid(line.id),
          kind: line.kind,
          description: line.description,
          quantity,
          priceCents,
          taxable: line.taxable,
          partNumber: line.partNumber,
          brand: line.brand,
          coreChargeCents: safeMoney(line.coreChargeCents, true),
          fitment: line.fitment,
          laborHours,
          laborRateCents,
          source: line.source,
          vendorContext: null,
        }
      })
      const totals = calculateTicketTotals(totalsInput, 0)
      return {
        id: safeUuid(job.id),
        title: job.title,
        kind: job.kind,
        customerStory: safeCustomerStory(job.customerStory),
        storyMeta: buildQuoteStoryMeta(job.storyMeta),
        lines,
        attachments: sortBySnapshotOrder(attachmentsByJob.get(job.id) ?? []).map((attachment) => ({
          id: safeUuid(attachment.id),
          jobId: safeUuid(attachment.jobId),
          kind: attachment.kind,
        })),
        totals: {
          subtotalCents: totals.subtotalCents,
          taxableSubtotalCents: totals.taxableSubtotalCents,
        },
      }
    })
  if (jobs.length === 0) throw new TypeError('quote is empty')
  const totals = calculateTicketTotals(
    jobs.flatMap((job) => job.lines.map((line) => ({ extendedCents: line.priceCents, taxable: line.taxable }))),
    context.shop.taxRateBps,
  )
  const snapshot: QuoteSnapshotV1 = {
    schemaVersion: 1,
    ticket: {
      id: safeUuid(context.ticket.id),
      number: context.ticket.ticketNumber,
      customerId: safeUuid(context.ticket.customerId),
      vehicleId: safeUuid(context.ticket.vehicleId),
      laborRateCents: shopRate,
      taxRateBps: context.shop.taxRateBps,
    },
    jobs,
    totals,
  }
  const parsed = quoteSnapshotSchema.safeParse(snapshot)
  if (!parsed.success) throw new TypeError('quote snapshot is invalid')
  if (Buffer.byteLength(JSON.stringify(parsed.data), 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new RangeError('quote snapshot is oversized')
  }
  return parsed.data as QuoteSnapshotV1
}

function safeVersionProjection(version: typeof quoteVersions.$inferSelect): CreateQuoteVersionResult {
  const snapshot = quoteSnapshotSchema.safeParse(version.snapshot)
  if (!snapshot.success) return conflict()
  return {
    ok: true,
    changed: false,
    version: {
      id: version.id,
      versionNumber: version.versionNumber,
    },
  }
}

function validatedActiveSnapshot(
  context: VersionContext,
  version: typeof quoteVersions.$inferSelect,
): QuoteSnapshotV1 {
  const parsed = quoteSnapshotSchema.safeParse(version.snapshot)
  if (!parsed.success) throw new AbortVersionCreation(conflict())
  const snapshot = parsed.data as QuoteSnapshotV1
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new AbortVersionCreation(conflict())
  }
  if (snapshot.ticket.id !== context.ticket.id || snapshot.jobs.length === 0) {
    throw new AbortVersionCreation(conflict())
  }
  const currentJobIds = new Set(context.jobs.map((job) => job.id))
  const snapshotJobIds = snapshot.jobs.map((job) => job.id)
  if (new Set(snapshotJobIds).size !== snapshotJobIds.length
    || snapshotJobIds.some((jobId) => !currentJobIds.has(jobId))) {
    throw new AbortVersionCreation(conflict())
  }
  return snapshot
}

export async function createQuoteVersion(
  db: AppDb,
  input: { actor: QuoteActor; ticketId: unknown },
  dependencies: CreateQuoteVersionDependencies = {},
): Promise<CreateQuoteVersionResult> {
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  if (!parsedTicket.success) return { ok: false, error: 'invalid_input' }
  const persistedActor = await loadActiveActor(db, input.actor)
  if (!persistedActor?.shopId) return notFound()
  try {
    return await db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      const context = await lockVersionContext(transactionDb, {
        shopId: persistedActor.shopId as string,
        profileId: persistedActor.id,
        ticketId: parsedTicket.data,
      }, dependencies)
      if (!context) return notFound()
      const activeVersions = context.versions.filter((version) => version.supersededAt === null)
      if (activeVersions.length > 1) throw new AbortVersionCreation(conflict())
      let snapshot: QuoteSnapshotV1
      try {
        snapshot = buildQuoteSnapshot(context)
      } catch {
        throw new AbortVersionCreation(conflict())
      }
      const active = activeVersions[0]
      const activeSnapshot = active ? validatedActiveSnapshot(context, active) : null
      if (active) {
        if (quoteSnapshotContentIdentity(activeSnapshot!) === quoteSnapshotContentIdentity(snapshot)) {
          return safeVersionProjection(active)
        }
      }
      await dependencies.beforeWrite?.()
      if (active) {
        const [superseded] = await transactionDb
          .update(quoteVersions)
          .set({ supersededAt: new Date() })
          .where(and(eq(quoteVersions.id, active.id), isNull(quoteVersions.supersededAt)))
          .returning()
        if (!superseded) throw new AbortVersionCreation(conflict(true))
        const oldJobIds = activeSnapshot!.jobs.map((job) => job.id)
        if (oldJobIds.length > 0) {
          await transactionDb.update(ticketJobs).set({
            approvalState: 'pending_quote',
            approvedQuoteVersionId: null,
            updatedAt: new Date(),
          }).where(and(
            eq(ticketJobs.shopId, context.shop.id),
            eq(ticketJobs.ticketId, context.ticket.id),
            inArray(ticketJobs.id, oldJobIds),
          ))
        }
      }
      const maxVersion = context.versions.reduce((maximum, version) => Math.max(maximum, version.versionNumber), 0)
      if (!Number.isInteger(maxVersion) || maxVersion >= MAX_POSTGRES_INTEGER) {
        throw new AbortVersionCreation(conflict())
      }
      const [created] = await transactionDb.insert(quoteVersions).values({
        shopId: context.shop.id,
        ticketId: context.ticket.id,
        versionNumber: maxVersion + 1,
        snapshot: snapshot as unknown as Record<string, unknown>,
        createdByProfileId: context.actorId,
      }).returning()
      const includedJobIds = snapshot.jobs.map((job) => job.id)
      await transactionDb.update(ticketJobs).set({
        approvalState: 'quote_ready',
        approvedQuoteVersionId: null,
        updatedAt: new Date(),
      }).where(and(
        eq(ticketJobs.shopId, context.shop.id),
        eq(ticketJobs.ticketId, context.ticket.id),
        inArray(ticketJobs.id, includedJobIds),
      ))
      return {
        ok: true,
        changed: true,
        version: { id: created.id, versionNumber: created.versionNumber },
      }
    })
  } catch (error) {
    if (error instanceof AbortVersionCreation) return error.failure
    if (isLockUnavailable(error)) return conflict(true)
    if (isUniqueViolation(error)) return conflict(true)
    throw error
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
