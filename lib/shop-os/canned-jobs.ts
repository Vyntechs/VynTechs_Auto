import { createHash } from 'node:crypto'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { cannedJobs, jobLines, profiles, quoteVersions, shops, ticketJobs, tickets } from '@/lib/db/schema'
import { canBuildQuotes } from '@/lib/shop-os/capabilities'
import { calculateTicketTotals, formatScaledDecimal, parseScaledDecimal, stableStringify } from '@/lib/shop-os/quote-math'
import { invalidateActiveQuoteVersion } from '@/lib/shop-os/quotes'
import {
  assertLiveLockedMutationScopeV1,
  assertLiveMutationAttemptV1,
} from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import type {
  MutationAttemptCapabilityV1,
  ResolvedLockedQuickTemplateV1,
  ResolvedQuickTemplateV1,
} from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import type { LockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/lock-order'

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER
const MAX_TEMPLATE_BYTES = 16 * 1024
const uuidSchema = z.string().uuid().transform((value) => value.toLowerCase())
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/)
const boundedText = (max: number) => z.string().trim().min(1).max(max)
const moneySchema = z.number().int().min(0).max(MAX_SAFE_INTEGER)
const sortSchema = z.number().int().min(0).max(1_000_000)

function decimalSchema(scale: number, maxScaled: bigint) {
  return z.string().superRefine((value, context) => {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
      context.addIssue({ code: 'custom', message: 'decimal must be plain and canonical' })
      return
    }
    try {
      const scaled = parseScaledDecimal(value, scale)
      if (scaled <= 0n || scaled > maxScaled) {
        context.addIssue({ code: 'custom', message: 'decimal is out of range' })
      }
    } catch {
      context.addIssue({ code: 'custom', message: 'decimal is out of range' })
    }
  }).transform((value) => formatScaledDecimal(parseScaledDecimal(value, scale), scale))
}

const quantitySchema = decimalSchema(3, 999_999_999_999n)
const hoursSchema = decimalSchema(2, 99_999_999n)
const commonLine = {
  description: boundedText(500),
  sort: sortSchema,
  priceCents: moneySchema,
  taxable: z.boolean(),
}
const partLineSchema = z.strictObject({
  kind: z.literal('part'),
  ...commonLine,
  quantity: quantitySchema,
  partNumber: boundedText(200).optional(),
  brand: boundedText(200).optional(),
})
const laborLineSchema = z.strictObject({
  kind: z.literal('labor'),
  ...commonLine,
  hours: hoursSchema,
  laborRateCents: moneySchema.optional(),
})
const feeLineSchema = z.strictObject({
  kind: z.literal('fee'),
  ...commonLine,
})
const cannedLineSchema = z.discriminatedUnion('kind', [partLineSchema, laborLineSchema, feeLineSchema])
const cannedJobBodySchema = z.strictObject({
  title: boundedText(200),
  kind: z.enum(['repair', 'maintenance']),
  defaultRequiredSkillTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  sort: sortSchema,
  lines: z.array(cannedLineSchema).min(1).max(25),
})

export type CannedJobActor = { profileId: string; founderOverride?: boolean }
export type SafeCannedJobLine = z.output<typeof cannedLineSchema>
export type SafeCannedJob = {
  id: string
  title: string
  kind: 'repair' | 'maintenance'
  defaultRequiredSkillTier: 1 | 2 | 3
  sort: number
  lines: SafeCannedJobLine[]
  fingerprint: string
  summary: {
    subtotalCents: number
    taxableSubtotalCents: number
    taxCents: number | null
    totalCents: number | null
  }
}

type ResolvedQuickTemplatePayload = Readonly<{
  cannedJobId: string
  title: string
  kind: 'repair' | 'maintenance'
  defaultRequiredSkillTier: 1 | 2 | 3
  sort: number
  lines: readonly SafeCannedJobLine[]
  fingerprint: string
  taxRateBps: number | null
}>

type ResolvedQuickTemplateState = Readonly<{
  tx: AppDb
  capability: MutationAttemptCapabilityV1
  payload: ResolvedQuickTemplatePayload
}>

type ResolvedLockedQuickTemplateState = Readonly<{
  tx: AppDb
  scope: LockedMutationScopeV1
  capability: MutationAttemptCapabilityV1
  payload: ResolvedQuickTemplatePayload
}>

const resolvedQuickTemplateStates = new WeakMap<
  ResolvedQuickTemplateV1,
  ResolvedQuickTemplateState
>()
const resolvedLockedQuickTemplateStates = new WeakMap<
  ResolvedLockedQuickTemplateV1,
  ResolvedLockedQuickTemplateState
>()

type Failure = {
  ok: false
  error: 'invalid_input' | 'not_found' | 'conflict'
  retryable?: boolean
}
type ListResult = { ok: true; cannedJobs: SafeCannedJob[]; taxRateBps: number | null } | Failure
type MutationResult = { ok: true; changed: boolean; cannedJob: SafeCannedJob } | Failure
export type SafeAppliedCannedJob = {
  id: string
  title: string
  kind: 'repair' | 'maintenance'
  requiredSkillTier: 1 | 2 | 3
  lineCount: number
}
type ApplyResult = { ok: true; changed: boolean; job: SafeAppliedCannedJob } | Failure
export type ApplyCannedJobDependencies = {
  afterTicketLock?: () => Promise<void>
  afterJobInsert?: () => Promise<void>
}

export function cannedJobActorFromProfile(
  profile: { id: string },
  founderOverride = false,
): CannedJobActor {
  return founderOverride ? { profileId: profile.id, founderOverride: true } : { profileId: profile.id }
}

function invalidInput(): Failure {
  return { ok: false, error: 'invalid_input' }
}

function notFound(): Failure {
  return { ok: false, error: 'not_found' }
}

function conflict(): Failure {
  return { ok: false, error: 'conflict', retryable: false }
}

function retryableConflict(): Failure {
  return { ok: false, error: 'conflict', retryable: true }
}

function parseBody(body: unknown): z.output<typeof cannedJobBodySchema> | null {
  let byteLength: number
  try {
    byteLength = Buffer.byteLength(JSON.stringify(body), 'utf8')
  } catch {
    return null
  }
  if (byteLength > MAX_TEMPLATE_BYTES) return null
  const parsed = cannedJobBodySchema.safeParse(body)
  if (!parsed.success) return null
  const subtotal = parsed.data.lines.reduce((sum, line) => sum + BigInt(line.priceCents), 0n)
  const taxableSubtotal = parsed.data.lines.reduce(
    (sum, line) => sum + (line.taxable ? BigInt(line.priceCents) : 0n),
    0n,
  )
  if (subtotal + taxableSubtotal > BigInt(MAX_SAFE_INTEGER)) return null
  return {
    ...parsed.data,
    lines: parsed.data.lines
      .map((line, index) => ({ line, index }))
      .sort((left, right) => left.line.sort - right.line.sort || left.index - right.index)
      .map(({ line }) => line),
  }
}

function persistedCannedJobId(shopId: string, clientKey: string): string {
  const bytes = createHash('sha256')
    .update('shop-os-canned-job-v1\0')
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

function storedContent(row: typeof cannedJobs.$inferSelect) {
  return {
    title: row.title,
    kind: row.kind,
    defaultRequiredSkillTier: row.defaultRequiredSkillTier,
    sort: row.sort,
    lines: row.defaultLines,
  }
}

function fingerprintFor(
  id: string,
  content: z.output<typeof cannedJobBodySchema>,
  updatedAt: Date,
): string {
  return createHash('sha256').update(stableStringify({ id, ...content, updatedAt: updatedAt.toISOString() })).digest('hex')
}

function projectRow(
  row: typeof cannedJobs.$inferSelect,
  taxRateBps: number | null,
): SafeCannedJob | null {
  const content = parseBody(storedContent(row))
  if (!content || !uuidSchema.safeParse(row.id).success) return null
  try {
    const beforeTax = calculateTicketTotals(
      content.lines.map((line) => ({ extendedCents: line.priceCents, taxable: line.taxable })),
      taxRateBps ?? 0,
    )
    return {
      id: row.id,
      title: content.title,
      kind: content.kind,
      defaultRequiredSkillTier: content.defaultRequiredSkillTier,
      sort: content.sort,
      lines: content.lines,
      fingerprint: fingerprintFor(row.id, content, row.updatedAt),
      summary: {
        subtotalCents: beforeTax.subtotalCents,
        taxableSubtotalCents: beforeTax.taxableSubtotalCents,
        taxCents: taxRateBps === null ? null : beforeTax.taxCents,
        totalCents: taxRateBps === null ? null : beforeTax.totalCents,
      },
    }
  } catch {
    return null
  }
}

export function publicCannedJob(template: SafeCannedJob): SafeCannedJob {
  return {
    id: template.id,
    title: template.title,
    kind: template.kind,
    defaultRequiredSkillTier: template.defaultRequiredSkillTier,
    sort: template.sort,
    lines: template.lines.map((line) => {
      if (line.kind === 'part') return {
        kind: 'part', description: line.description, sort: line.sort,
        quantity: line.quantity, priceCents: line.priceCents, taxable: line.taxable,
        ...(line.partNumber === undefined ? {} : { partNumber: line.partNumber }),
        ...(line.brand === undefined ? {} : { brand: line.brand }),
      }
      if (line.kind === 'labor') return {
        kind: 'labor', description: line.description, sort: line.sort,
        hours: line.hours, priceCents: line.priceCents, taxable: line.taxable,
        ...(line.laborRateCents === undefined ? {} : { laborRateCents: line.laborRateCents }),
      }
      return {
        kind: 'fee', description: line.description, sort: line.sort,
        priceCents: line.priceCents, taxable: line.taxable,
      }
    }),
    fingerprint: template.fingerprint,
    summary: {
      subtotalCents: template.summary.subtotalCents,
      taxableSubtotalCents: template.summary.taxableSubtotalCents,
      taxCents: template.summary.taxCents,
      totalCents: template.summary.totalCents,
    },
  }
}

export function publicAppliedCannedJob(job: SafeAppliedCannedJob): SafeAppliedCannedJob {
  return {
    id: job.id,
    title: job.title,
    kind: job.kind,
    requiredSkillTier: job.requiredSkillTier,
    lineCount: job.lineCount,
  }
}

function persistedAppliedJobId(
  shopId: string,
  ticketId: string,
  profileId: string,
  clientKey: string,
): string {
  const bytes = createHash('sha256')
    .update('shop-os-applied-canned-job-v1\0')
    .update(shopId).update('\0')
    .update(ticketId).update('\0')
    .update(profileId).update('\0')
    .update(clientKey)
    .digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function persistedAppliedLineId(jobId: string, index: number): string {
  const bytes = createHash('sha256')
    .update('shop-os-applied-canned-line-v1\0')
    .update(jobId).update('\0').update(String(index))
    .digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x80
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export type StrictCannedJobCopyResult =
  | { ok: true; cannedJob: SafeCannedJob }
  | Failure

/** Internal transaction seam. Callers must authorize the shop before calling it. */
export async function loadStrictCannedJobCopy(
  db: AppDb,
  input: {
    shopId: string
    cannedJobId: string
    expectedFingerprint: string
    expectedTaxRateBps: number | null
  },
): Promise<StrictCannedJobCopyResult> {
  const [shop] = await db.select({ taxRateBps: shops.taxRateBps }).from(shops)
    .where(eq(shops.id, input.shopId)).limit(1).for('update')
  if (
    !shop
    || (shop.taxRateBps !== null
      && (!Number.isInteger(shop.taxRateBps) || shop.taxRateBps < 0 || shop.taxRateBps > 10_000))
  ) return conflict()
  if (shop.taxRateBps !== input.expectedTaxRateBps) return conflict()
  const [row] = await db.select().from(cannedJobs).where(and(
    eq(cannedJobs.shopId, input.shopId),
    eq(cannedJobs.id, input.cannedJobId),
    isNull(cannedJobs.retiredAt),
  )).limit(1).for('update')
  if (!row) return notFound()
  const cannedJob = projectRow(row, shop.taxRateBps)
  if (!cannedJob || cannedJob.fingerprint !== input.expectedFingerprint) return conflict()
  return { ok: true, cannedJob }
}

function invalidResolvedQuickTemplate(): never {
  throw new Error('resolved_quick_template_invalid')
}

function copyQuickTemplateLine(line: SafeCannedJobLine): SafeCannedJobLine {
  if (line.kind === 'part') {
    return Object.freeze({
      kind: 'part' as const,
      description: line.description,
      sort: line.sort,
      quantity: line.quantity,
      priceCents: line.priceCents,
      taxable: line.taxable,
      ...(line.partNumber === undefined ? {} : { partNumber: line.partNumber }),
      ...(line.brand === undefined ? {} : { brand: line.brand }),
    })
  }
  if (line.kind === 'labor') {
    return Object.freeze({
      kind: 'labor' as const,
      description: line.description,
      sort: line.sort,
      hours: line.hours,
      priceCents: line.priceCents,
      taxable: line.taxable,
      ...(line.laborRateCents === undefined ? {} : { laborRateCents: line.laborRateCents }),
    })
  }
  return Object.freeze({
    kind: 'fee' as const,
    description: line.description,
    sort: line.sort,
    priceCents: line.priceCents,
    taxable: line.taxable,
  })
}

function quickTemplatePayload(
  cannedJob: SafeCannedJob,
  taxRateBps: number | null,
): ResolvedQuickTemplatePayload {
  return Object.freeze({
    cannedJobId: cannedJob.id,
    title: cannedJob.title,
    kind: cannedJob.kind,
    defaultRequiredSkillTier: cannedJob.defaultRequiredSkillTier,
    sort: cannedJob.sort,
    lines: Object.freeze(cannedJob.lines.map(copyQuickTemplateLine)),
    fingerprint: cannedJob.fingerprint,
    taxRateBps,
  })
}

function copyQuickTemplatePayload(
  payload: ResolvedQuickTemplatePayload,
): ResolvedQuickTemplatePayload {
  return Object.freeze({
    cannedJobId: payload.cannedJobId,
    title: payload.title,
    kind: payload.kind,
    defaultRequiredSkillTier: payload.defaultRequiredSkillTier,
    sort: payload.sort,
    lines: Object.freeze(payload.lines.map(copyQuickTemplateLine)),
    fingerprint: payload.fingerprint,
    taxRateBps: payload.taxRateBps,
  })
}

function resolvedQuickTemplateStateFor(
  template: ResolvedQuickTemplateV1,
): ResolvedQuickTemplateState {
  if ((typeof template !== 'object' || template === null) && typeof template !== 'function') {
    return invalidResolvedQuickTemplate()
  }
  return resolvedQuickTemplateStates.get(template) ?? invalidResolvedQuickTemplate()
}

function resolvedLockedQuickTemplateStateFor(
  template: ResolvedLockedQuickTemplateV1,
): ResolvedLockedQuickTemplateState {
  if ((typeof template !== 'object' || template === null) && typeof template !== 'function') {
    return invalidResolvedQuickTemplate()
  }
  return resolvedLockedQuickTemplateStates.get(template) ?? invalidResolvedQuickTemplate()
}

function normalizeStrictCannedJobInput(input: Readonly<{
  shopId: string
  cannedJobId: string
  expectedFingerprint: string
  expectedTaxRateBps: number | null
}>): Readonly<{
  shopId: string
  cannedJobId: string
  expectedFingerprint: string
  expectedTaxRateBps: number | null
}> {
  if (typeof input !== 'object' || input === null) return invalidResolvedQuickTemplate()
  const shopId = uuidSchema.safeParse(input.shopId)
  const cannedJobId = uuidSchema.safeParse(input.cannedJobId)
  const expectedFingerprint = fingerprintSchema.safeParse(input.expectedFingerprint)
  const expectedTaxRateBps = z.union([
    z.literal(null),
    z.number().int().min(0).max(10_000),
  ]).safeParse(input.expectedTaxRateBps)
  if (
    !shopId.success || !cannedJobId.success ||
    !expectedFingerprint.success || !expectedTaxRateBps.success
  ) return invalidResolvedQuickTemplate()
  return Object.freeze({
    shopId: shopId.data,
    cannedJobId: cannedJobId.data,
    expectedFingerprint: expectedFingerprint.data,
    expectedTaxRateBps: expectedTaxRateBps.data,
  })
}

export async function preflightStrictCannedJobV1(
  tx: AppDb,
  attempt: MutationAttemptCapabilityV1,
  input: Readonly<{
    shopId: string
    cannedJobId: string
    expectedFingerprint: string
    expectedTaxRateBps: number | null
  }>,
): Promise<
  | Readonly<{
      ok: true
      template: ResolvedQuickTemplateV1
      cannedJobIds: readonly [string]
    }>
  | Readonly<{ ok: false; error: 'not_found' | 'template_drift' }>
> {
  assertLiveMutationAttemptV1(tx, attempt)
  const normalized = normalizeStrictCannedJobInput(input)
  const [shop] = await tx.select({ taxRateBps: shops.taxRateBps }).from(shops)
    .where(eq(shops.id, normalized.shopId)).limit(1)
  if (!shop) return Object.freeze({ ok: false, error: 'not_found' })
  if (
    (shop.taxRateBps !== null && (
      !Number.isInteger(shop.taxRateBps) || shop.taxRateBps < 0 || shop.taxRateBps > 10_000
    )) || shop.taxRateBps !== normalized.expectedTaxRateBps
  ) return Object.freeze({ ok: false, error: 'template_drift' })

  const [row] = await tx.select().from(cannedJobs).where(and(
    eq(cannedJobs.shopId, normalized.shopId),
    eq(cannedJobs.id, normalized.cannedJobId),
    isNull(cannedJobs.retiredAt),
  )).orderBy(cannedJobs.id).limit(1)
  if (!row) return Object.freeze({ ok: false, error: 'not_found' })
  const cannedJob = projectRow(row, shop.taxRateBps)
  if (!cannedJob || cannedJob.fingerprint !== normalized.expectedFingerprint) {
    return Object.freeze({ ok: false, error: 'template_drift' })
  }

  const handle = Object.freeze(Object.create(null) as ResolvedQuickTemplateV1)
  resolvedQuickTemplateStates.set(handle, Object.freeze({
    tx,
    capability: attempt,
    payload: quickTemplatePayload(cannedJob, shop.taxRateBps),
  }))
  return Object.freeze({
    ok: true,
    template: handle,
    cannedJobIds: Object.freeze([normalized.cannedJobId]) as readonly [string],
  })
}

export function resolveStrictCannedJobInLockedScopeV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  template: ResolvedQuickTemplateV1,
): ResolvedLockedQuickTemplateV1 {
  const capability = assertLiveLockedMutationScopeV1(tx, scope)
  const state = resolvedQuickTemplateStateFor(template)
  if (state.tx !== tx || state.capability !== capability) {
    return invalidResolvedQuickTemplate()
  }
  const expected = state.payload
  if (
    scope.request.shopId !== scope.actor.shopId ||
    scope.request.shopId !== scope.shop?.id ||
    scope.request.lockShop !== true ||
    scope.request.cannedJobIds.length !== 1 ||
    scope.request.cannedJobIds[0] !== expected.cannedJobId ||
    scope.cannedJobs.length !== 1
  ) return invalidResolvedQuickTemplate()
  const row = scope.cannedJobs[0]!
  if (
    row.id !== expected.cannedJobId ||
    row.shopId !== scope.actor.shopId ||
    row.retiredAt !== null ||
    scope.shop.taxRateBps !== expected.taxRateBps
  ) return invalidResolvedQuickTemplate()
  const cannedJob = projectRow(row, scope.shop.taxRateBps)
  if (!cannedJob || cannedJob.fingerprint !== expected.fingerprint) {
    return invalidResolvedQuickTemplate()
  }
  const lockedPayload = quickTemplatePayload(cannedJob, scope.shop.taxRateBps)
  if (stableStringify(lockedPayload) !== stableStringify(expected)) {
    return invalidResolvedQuickTemplate()
  }

  const locked = Object.freeze(Object.create(null) as ResolvedLockedQuickTemplateV1)
  resolvedLockedQuickTemplateStates.set(locked, Object.freeze({
    tx,
    scope,
    capability,
    payload: lockedPayload,
  }))
  return locked
}

export function consumeResolvedLockedQuickTemplateForCreationV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  template: ResolvedLockedQuickTemplateV1,
): ResolvedQuickTemplatePayload {
  const capability = assertLiveLockedMutationScopeV1(tx, scope)
  const state = resolvedLockedQuickTemplateStateFor(template)
  if (
    state.tx !== tx || state.scope !== scope || state.capability !== capability
  ) return invalidResolvedQuickTemplate()
  return copyQuickTemplatePayload(state.payload)
}

export function cannedJobLineInsertValues(
  shopId: string,
  jobId: string,
  lines: SafeCannedJobLine[],
) {
  return lines.map((line, index) => ({
    id: persistedAppliedLineId(jobId, index),
    shopId,
    jobId,
    kind: line.kind,
    description: line.description,
    sort: line.sort,
    quantity: line.kind === 'part' ? Number(line.quantity) : 1,
    priceCents: line.priceCents,
    taxable: line.taxable,
    partNumber: line.kind === 'part' ? line.partNumber ?? null : null,
    brand: line.kind === 'part' ? line.brand ?? null : null,
    unitCostCents: null,
    coreChargeCents: null,
    fitment: null,
    vendorAccountId: null,
    externalOfferId: null,
    vendorSnapshot: null,
    partStatus: 'proposed' as const,
    orderedAt: null,
    orderedByProfileId: null,
    receivedAt: null,
    receivedByProfileId: null,
    laborHours: line.kind === 'labor' ? Number(line.hours) : null,
    laborRateCents: line.kind === 'labor' ? line.laborRateCents ?? null : null,
    source: 'manual' as const,
  }))
}

function projectAppliedJob(
  row: typeof ticketJobs.$inferSelect,
  lineCount: number,
): SafeAppliedCannedJob | null {
  if (
    !uuidSchema.safeParse(row.id).success
    || (row.kind !== 'repair' && row.kind !== 'maintenance')
    || (row.requiredSkillTier !== 1 && row.requiredSkillTier !== 2 && row.requiredSkillTier !== 3)
    || typeof row.title !== 'string'
    || row.title.length < 1
    || row.title.length > 200
    || !Number.isInteger(lineCount)
    || lineCount < 1
    || lineCount > 25
  ) return null
  return publicAppliedCannedJob({
    id: row.id,
    title: row.title,
    kind: row.kind,
    requiredSkillTier: row.requiredSkillTier,
    lineCount,
  })
}

function isBuilderVisibleAppliedLine(line: typeof jobLines.$inferSelect): boolean {
  return line.source === 'manual'
    && line.partStatus === 'proposed'
    && line.unitCostCents === null
    && line.coreChargeCents === null
    && line.fitment === null
    && line.vendorAccountId === null
    && line.externalOfferId === null
    && line.vendorSnapshot === null
    && line.orderedAt === null
    && line.orderedByProfileId === null
    && line.receivedAt === null
    && line.receivedByProfileId === null
}

function errorCode(error: unknown, codes: Set<string>): boolean {
  let current: unknown = error
  for (let depth = 0; current && depth < 5; depth += 1) {
    if (typeof current === 'object' && 'code' in current && codes.has(String(current.code))) return true
    current = typeof current === 'object' && 'cause' in current ? current.cause : null
  }
  return false
}

class AbortCannedApply extends Error {
  constructor(readonly failure: Failure) {
    super('abort_canned_apply')
  }
}

type ActorRow = { id: string; shopId: string; role: string }

async function loadActor(
  db: AppDb,
  actor: CannedJobActor,
  mode: 'list' | 'manage',
  lock: boolean | 'nowait' = false,
): Promise<ActorRow | null> {
  const profileId = uuidSchema.safeParse(actor.profileId)
  if (!profileId.success) return null
  let query = db.select({ id: profiles.id, shopId: profiles.shopId, role: profiles.role })
    .from(profiles)
    .where(and(
      eq(profiles.id, profileId.data),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
  if (lock === 'nowait') query = query.for('update', { noWait: true }) as typeof query
  else if (lock) query = query.for('update') as typeof query
  const [profile] = await query
  if (!profile?.shopId) return null
  const founder = actor.founderOverride === true
  if (mode === 'list' ? !canBuildQuotes(profile.role) && !founder : profile.role !== 'owner' && !founder) return null
  return { id: profile.id, shopId: profile.shopId, role: profile.role }
}

async function loadTaxRate(db: AppDb, shopId: string): Promise<number | null | undefined> {
  const [shop] = await db.select({ taxRateBps: shops.taxRateBps }).from(shops).where(eq(shops.id, shopId)).limit(1)
  if (!shop || (shop.taxRateBps !== null && (!Number.isInteger(shop.taxRateBps) || shop.taxRateBps < 0 || shop.taxRateBps > 10_000))) return undefined
  return shop.taxRateBps
}

export async function listCannedJobs(
  db: AppDb,
  input: { actor: CannedJobActor },
): Promise<ListResult> {
  return db.transaction(async (tx) => {
    const actor = await loadActor(tx, input.actor, 'list')
    if (!actor) return notFound()
    const taxRateBps = await loadTaxRate(tx, actor.shopId)
    if (taxRateBps === undefined) return conflict()
    const rows = await tx.select().from(cannedJobs).where(and(
      eq(cannedJobs.shopId, actor.shopId),
      isNull(cannedJobs.retiredAt),
    )).orderBy(asc(cannedJobs.sort), asc(cannedJobs.title), asc(cannedJobs.id))
    const projected = rows.map((row) => projectRow(row, taxRateBps))
    if (projected.some((row) => row === null)) return conflict()
    return { ok: true, cannedJobs: projected as SafeCannedJob[], taxRateBps }
  })
}

export async function createCannedJob(
  db: AppDb,
  input: { actor: CannedJobActor; clientKey: unknown; body: unknown },
): Promise<MutationResult> {
  const clientKey = uuidSchema.safeParse(input.clientKey)
  const body = parseBody(input.body)
  if (!clientKey.success || !body) return invalidInput()
  return db.transaction(async (tx) => {
    const actor = await loadActor(tx, input.actor, 'manage', true)
    if (!actor) return notFound()
    const taxRateBps = await loadTaxRate(tx, actor.shopId)
    if (taxRateBps === undefined) return conflict()
    const id = persistedCannedJobId(actor.shopId, clientKey.data)
    const [existing] = await tx.select().from(cannedJobs).where(and(
      eq(cannedJobs.shopId, actor.shopId), eq(cannedJobs.id, id),
    )).limit(1).for('update')
    if (existing) {
      const safe = projectRow(existing, taxRateBps)
      if (!safe) return conflict()
      return stableStringify(storedContent(existing)) === stableStringify(body)
        ? { ok: true, changed: false, cannedJob: safe }
        : conflict()
    }
    const [created] = await tx.insert(cannedJobs).values({
      id, shopId: actor.shopId, title: body.title, kind: body.kind,
      defaultRequiredSkillTier: body.defaultRequiredSkillTier,
      defaultLines: body.lines as never, sort: body.sort,
    }).onConflictDoNothing({ target: cannedJobs.id }).returning()
    if (created) {
      const safe = projectRow(created, taxRateBps)
      return safe ? { ok: true, changed: true, cannedJob: safe } : conflict()
    }
    const [persisted] = await tx.select().from(cannedJobs).where(and(
      eq(cannedJobs.shopId, actor.shopId), eq(cannedJobs.id, id),
    )).limit(1).for('update')
    if (!persisted) return conflict()
    const safe = projectRow(persisted, taxRateBps)
    if (!safe) return conflict()
    return stableStringify(storedContent(persisted)) === stableStringify(body)
      ? { ok: true, changed: false, cannedJob: safe }
      : conflict()
  })
}

export async function replaceCannedJob(
  db: AppDb,
  input: {
    actor: CannedJobActor
    cannedJobId: unknown
    expectedFingerprint: unknown
    body: unknown
  },
): Promise<MutationResult> {
  const cannedJobId = uuidSchema.safeParse(input.cannedJobId)
  const fingerprint = fingerprintSchema.safeParse(input.expectedFingerprint)
  const body = parseBody(input.body)
  if (!cannedJobId.success || !fingerprint.success || !body) return invalidInput()
  return db.transaction(async (tx) => {
    const actor = await loadActor(tx, input.actor, 'manage', true)
    if (!actor) return notFound()
    const taxRateBps = await loadTaxRate(tx, actor.shopId)
    if (taxRateBps === undefined) return conflict()
    const [existing] = await tx.select().from(cannedJobs).where(and(
      eq(cannedJobs.shopId, actor.shopId), eq(cannedJobs.id, cannedJobId.data),
    )).limit(1).for('update')
    if (!existing || existing.retiredAt) return notFound()
    const safe = projectRow(existing, taxRateBps)
    if (!safe) return conflict()
    if (safe.fingerprint !== fingerprint.data) return conflict()
    if (stableStringify(storedContent(existing)) === stableStringify(body)) {
      return { ok: true, changed: false, cannedJob: safe }
    }
    const [updated] = await tx.update(cannedJobs).set({
      title: body.title, kind: body.kind,
      defaultRequiredSkillTier: body.defaultRequiredSkillTier,
      defaultLines: body.lines as never, sort: body.sort, updatedAt: new Date(),
    }).where(and(eq(cannedJobs.shopId, actor.shopId), eq(cannedJobs.id, cannedJobId.data))).returning()
    const next = projectRow(updated, taxRateBps)
    return next ? { ok: true, changed: true, cannedJob: next } : conflict()
  })
}

export async function retireCannedJob(
  db: AppDb,
  input: { actor: CannedJobActor; cannedJobId: unknown; expectedFingerprint: unknown },
): Promise<MutationResult> {
  const cannedJobId = uuidSchema.safeParse(input.cannedJobId)
  const fingerprint = fingerprintSchema.safeParse(input.expectedFingerprint)
  if (!cannedJobId.success || !fingerprint.success) return invalidInput()
  return db.transaction(async (tx) => {
    const actor = await loadActor(tx, input.actor, 'manage', true)
    if (!actor) return notFound()
    const taxRateBps = await loadTaxRate(tx, actor.shopId)
    if (taxRateBps === undefined) return conflict()
    const [existing] = await tx.select().from(cannedJobs).where(and(
      eq(cannedJobs.shopId, actor.shopId), eq(cannedJobs.id, cannedJobId.data),
    )).limit(1).for('update')
    if (!existing) return notFound()
    const safe = projectRow(existing, taxRateBps)
    if (!safe) return conflict()
    if (existing.retiredAt) return { ok: true, changed: false, cannedJob: safe }
    if (safe.fingerprint !== fingerprint.data) return conflict()
    const now = new Date()
    const [retired] = await tx.update(cannedJobs).set({ retiredAt: now, updatedAt: now }).where(and(
      eq(cannedJobs.shopId, actor.shopId), eq(cannedJobs.id, cannedJobId.data),
    )).returning()
    const next = projectRow(retired, taxRateBps)
    return next ? { ok: true, changed: true, cannedJob: next } : conflict()
  })
}

export async function applyCannedJobToTicket(
  db: AppDb,
  input: {
    actor: CannedJobActor
    ticketId: unknown
    clientKey: unknown
    cannedJobId: unknown
    expectedFingerprint: unknown
    expectedTaxRateBps: unknown
  },
  dependencies: ApplyCannedJobDependencies = {},
): Promise<ApplyResult> {
  const ticketId = uuidSchema.safeParse(input.ticketId)
  const clientKey = uuidSchema.safeParse(input.clientKey)
  const cannedJobId = uuidSchema.safeParse(input.cannedJobId)
  const fingerprint = fingerprintSchema.safeParse(input.expectedFingerprint)
  const taxRate = z.union([z.literal(null), z.number().int().min(0).max(10_000)])
    .safeParse(input.expectedTaxRateBps)
  if (!ticketId.success || !clientKey.success || !cannedJobId.success || !fingerprint.success || !taxRate.success) {
    return invalidInput()
  }
  const persistedActor = await loadActor(db, input.actor, 'list')
  if (!persistedActor) return notFound()

  try {
    return await db.transaction(async (tx) => {
      const [ticket] = await tx.select({ id: tickets.id }).from(tickets).where(and(
        eq(tickets.shopId, persistedActor.shopId),
        eq(tickets.id, ticketId.data),
        eq(tickets.status, 'open'),
      )).limit(1).for('update', { noWait: true })
      if (!ticket) return notFound()
      await dependencies.afterTicketLock?.()

      const jobRows = await tx.select().from(ticketJobs).where(and(
        eq(ticketJobs.shopId, persistedActor.shopId),
        eq(ticketJobs.ticketId, ticketId.data),
      )).orderBy(ticketJobs.id).for('update', { noWait: true })
      const lineRows = jobRows.length === 0
        ? []
        : await tx.select().from(jobLines).where(and(
          eq(jobLines.shopId, persistedActor.shopId),
          inArray(jobLines.jobId, jobRows.map((job) => job.id)),
        )).orderBy(jobLines.id).for('update', { noWait: true })
      const activeVersions = await tx.select().from(quoteVersions).where(and(
        eq(quoteVersions.shopId, persistedActor.shopId),
        eq(quoteVersions.ticketId, ticketId.data),
        isNull(quoteVersions.supersededAt),
      )).orderBy(quoteVersions.id).for('update', { noWait: true })
      const currentActor = await loadActor(tx, input.actor, 'list', 'nowait')
      if (!currentActor || currentActor.id !== persistedActor.id || currentActor.shopId !== persistedActor.shopId) {
        return notFound()
      }
      const jobId = persistedAppliedJobId(
        currentActor.shopId,
        ticketId.data,
        currentActor.id,
        clientKey.data,
      )
      const existing = jobRows.find((job) => job.id === jobId)
      if (existing) {
        const existingLines = lineRows.filter((line) => line.jobId === existing.id)
        if (existingLines.some((line) => !isBuilderVisibleAppliedLine(line))) {
          throw new AbortCannedApply(conflict())
        }
        const safe = projectAppliedJob(
          existing,
          existingLines.length,
        )
        if (!safe) throw new AbortCannedApply(conflict())
        return { ok: true, changed: false, job: safe }
      }
      if (activeVersions.length > 1) throw new AbortCannedApply(conflict())

      const [shop] = await tx.select({ taxRateBps: shops.taxRateBps }).from(shops)
        .where(eq(shops.id, currentActor.shopId)).limit(1).for('update', { noWait: true })
      if (
        !shop
        || (shop.taxRateBps !== null && (!Number.isInteger(shop.taxRateBps) || shop.taxRateBps < 0 || shop.taxRateBps > 10_000))
      ) throw new AbortCannedApply(conflict())
      if (shop.taxRateBps !== taxRate.data) throw new AbortCannedApply(conflict())

      const [templateRow] = await tx.select().from(cannedJobs).where(and(
        eq(cannedJobs.shopId, currentActor.shopId),
        eq(cannedJobs.id, cannedJobId.data),
        isNull(cannedJobs.retiredAt),
      )).limit(1).for('update', { noWait: true })
      if (!templateRow) return notFound()
      const template = projectRow(templateRow, shop.taxRateBps)
      if (!template) throw new AbortCannedApply(conflict())
      if (template.fingerprint !== fingerprint.data) throw new AbortCannedApply(conflict())

      const [createdJob] = await tx.insert(ticketJobs).values({
        id: jobId,
        shopId: currentActor.shopId,
        ticketId: ticketId.data,
        title: template.title,
        kind: template.kind,
        requiredSkillTier: template.defaultRequiredSkillTier,
        assignedTechId: null,
        workStatus: 'open',
        approvalState: 'pending_quote',
      }).returning()
      await dependencies.afterJobInsert?.()
      await tx.insert(jobLines).values(template.lines.map((line, index) => ({
        id: persistedAppliedLineId(jobId, index),
        shopId: currentActor.shopId,
        jobId,
        kind: line.kind,
        description: line.description,
        sort: line.sort,
        quantity: line.kind === 'part' ? Number(line.quantity) : 1,
        priceCents: line.priceCents,
        taxable: line.taxable,
        partNumber: line.kind === 'part' ? line.partNumber ?? null : null,
        brand: line.kind === 'part' ? line.brand ?? null : null,
        unitCostCents: null,
        coreChargeCents: null,
        fitment: null,
        vendorAccountId: null,
        externalOfferId: null,
        vendorSnapshot: null,
        partStatus: 'proposed' as const,
        orderedAt: null,
        orderedByProfileId: null,
        receivedAt: null,
        receivedByProfileId: null,
        laborHours: line.kind === 'labor' ? Number(line.hours) : null,
        laborRateCents: line.kind === 'labor' ? line.laborRateCents ?? null : null,
        source: 'manual' as const,
      })))
      const invalidationFailure = await invalidateActiveQuoteVersion(tx, {
        shopId: currentActor.shopId,
        ticketId: ticketId.data,
        jobIds: jobRows.map((job) => job.id),
        activeVersions,
      })
      if (invalidationFailure) throw new AbortCannedApply(invalidationFailure)
      const safe = projectAppliedJob(createdJob, template.lines.length)
      if (!safe) throw new AbortCannedApply(conflict())
      return { ok: true, changed: true, job: safe }
    })
  } catch (error) {
    if (error instanceof AbortCannedApply) return error.failure
    if (errorCode(error, new Set(['55P03', '40001', '40P01']))) return retryableConflict()
    if (errorCode(error, new Set(['23505']))) return conflict()
    throw error
  }
}

export function cannedJobDomainStatus(
  result: ListResult | MutationResult | ApplyResult,
  successStatus = 200,
): number {
  if (result.ok) return successStatus
  if (result.error === 'invalid_input') return 422
  if (result.error === 'not_found') return 404
  return 409
}

export function cannedJobErrorBody(result: Failure): { error: Failure['error']; retryable?: boolean } {
  return result.retryable === true
    ? { error: result.error, retryable: true }
    : { error: result.error }
}
