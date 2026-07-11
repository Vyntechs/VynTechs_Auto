import { createHash } from 'node:crypto'
import { and, asc, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { cannedJobs, profiles, shops } from '@/lib/db/schema'
import { canBuildQuotes } from '@/lib/shop-os/capabilities'
import { calculateTicketTotals, formatScaledDecimal, parseScaledDecimal, stableStringify } from '@/lib/shop-os/quote-math'

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

type Failure = {
  ok: false
  error: 'invalid_input' | 'not_found' | 'conflict'
  retryable?: boolean
}
type ListResult = { ok: true; cannedJobs: SafeCannedJob[]; taxRateBps: number | null } | Failure
type MutationResult = { ok: true; changed: boolean; cannedJob: SafeCannedJob } | Failure

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

type ActorRow = { id: string; shopId: string; role: string }

async function loadActor(
  db: AppDb,
  actor: CannedJobActor,
  mode: 'list' | 'manage',
  lock = false,
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
  if (lock) query = query.for('update') as typeof query
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

export function cannedJobDomainStatus(
  result: ListResult | MutationResult,
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
