import { createHash } from 'node:crypto'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  customers, jobLines, profiles, quoteEvents, quoteVersions, sessionEvents, sessions, shops,
  ticketJobs, tickets, vehicles, vendorAccounts,
} from '@/lib/db/schema'
import { resolveShopEntitlements } from '@/lib/entitlements'
import { canBuildQuotes, canRecordCustomerApproval } from '@/lib/shop-os/capabilities'
import {
  parsePersistedCustomerStory,
  parsePersistedCustomerStoryMeta,
  parseQuoteStorySnapshotMeta,
} from '@/lib/shop-os/customer-story-contracts'
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
import { validateStoredManualOfferLine } from '@/lib/shop-os/parts-adapters'
import { assertLiveLockedMutationScopeV1 } from '@/lib/shop-os/continuity/mutation-foundation/attempt-capability'
import { ShopOsMutationNotFound } from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { ShopOsMutationConflict } from '@/lib/shop-os/continuity/mutation-foundation/conflicts'
import type {
  LockedMutationScopeV1,
  MutationLockRequestV1,
} from '@/lib/shop-os/continuity/mutation-foundation/lock-order'
import { finalizeMutationRevisionsV1 } from '@/lib/shop-os/continuity/mutation-foundation/revisions'
import { runBoundedShopOsMutationV1 } from '@/lib/shop-os/continuity/mutation-foundation/transaction-runner'

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

const quoteApprovalDecisionSchema = z.strictObject({
  requestKey: uuidSchema,
  jobId: uuidSchema,
  quoteVersionId: uuidSchema,
  decision: z.literal('approved'),
  approvedVia: z.enum(['phone', 'in_person']),
})
const quoteDeclineDecisionSchema = z.strictObject({
  requestKey: uuidSchema,
  jobId: uuidSchema,
  quoteVersionId: uuidSchema,
  decision: z.literal('declined'),
})
const quoteDecisionSchema = z.discriminatedUnion('decision', [
  quoteApprovalDecisionSchema,
  quoteDeclineDecisionSchema,
])

export type QuoteActor = { profileId: string }
export function quoteActorFromProfile(profile: { id: string }): QuoteActor {
  return { profileId: profile.id }
}

export function quoteDomainStatus(
  result: { ok: boolean; error?: 'invalid_input' | 'not_found' | 'conflict' },
  successStatus = 200,
): number {
  if (result.ok) return successStatus
  if (result.error === 'invalid_input') return 422
  if (result.error === 'not_found') return 404
  return 409
}

export function quoteErrorBody(result: {
  error: 'invalid_input' | 'not_found' | 'conflict'
  retryable?: boolean
}): { error: typeof result.error; retryable?: true } {
  return result.retryable
    ? { error: result.error, retryable: true }
    : { error: result.error }
}
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
  afterDiscovery?: () => Promise<void>
  afterWrite?: () => Promise<void>
  afterFinalization?: () => Promise<void>
}

export type QuoteBuilderResult =
  | {
    ok: true
    builder: {
      ticket: { id: string; status: 'open'; reconciled: boolean }
      configuration: {
        laborRateCents: number | null
        taxRateBps: number | null
        laborRateConfigured: boolean
        taxRateConfigured: boolean
      }
      jobs: Array<{
        id: string
        title: string
        kind: 'diagnostic' | 'repair' | 'maintenance'
        workStatus: 'open' | 'in_progress' | 'blocked'
        story: {
          content: QuoteCustomerStoryV1 | null
          source: 'ai' | 'manual' | 'template' | null
          reviewStatus: 'pending' | 'reviewed' | null
          revision: number
        }
        storyMode: 'ordinary_locked_tree' | 'topology_manual' | 'manual_findings' | 'published_wizard_unsupported' | 'unavailable' | null
        decisionEligible: boolean
        approval: {
          state: 'pending_quote' | 'quote_ready' | 'sent' | 'approved' | 'declined'
          quoteVersionId: string | null
        }
        lines: Array<
          Omit<SafeManualDraftLine, 'quantity' | 'laborHours'>
          & {
            quantity: string
            laborHours: string | null
            source: 'manual' | 'vendor_offer'
            mutable: boolean
          }
        >
      }>
      capabilities: { canRecordCustomerApproval: boolean }
      activeVersion: {
        id: string
        versionNumber: number
        totalCents: number
        jobs: Array<{ jobId: string; subtotalCents: number }>
      } | null
    }
  }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'conflict'; retryable?: boolean }

export type QuoteBuilderDependencies = {
  afterTicketLock?: () => Promise<void>
}

export type QuoteDecisionResult =
  | {
    ok: true
    changed: boolean
    event: {
      id: string
      kind: 'approved' | 'declined'
      quoteVersionId: string
      jobId: string
      approvedVia: 'phone' | 'in_person' | null
    }
    projection: {
      approvalState: 'pending_quote' | 'quote_ready' | 'sent' | 'approved' | 'declined'
      approvedQuoteVersionId: string | null
    }
  }
  | { ok: false; error: 'invalid_input' | 'not_found' | 'conflict'; retryable?: boolean }

export type QuoteDecisionDependencies = {
  afterTicketLock?: () => Promise<void>
  afterEventInsert?: () => Promise<void>
  afterDiscovery?: () => Promise<void>
  afterWrite?: () => Promise<void>
  afterFinalization?: () => Promise<void>
}

type Failure = Extract<QuoteDraftResult, { ok: false }>
type DraftContext = {
  scope: LockedMutationScopeV1
  shopId: string
  ticketId: string
  jobId: string
  shopRateCents: number | null
  jobIds: readonly string[]
  lineRows: readonly (typeof jobLines.$inferSelect)[]
  activeVersions: readonly (typeof quoteVersions.$inferSelect)[]
}

class AbortDraftMutation extends Error {
  constructor(readonly failure: Failure) {
    super('abort_quote_draft_mutation')
  }
}

const customerStorySchema = z.unknown().transform((value, context) => {
  const parsed = parsePersistedCustomerStory(value)
  if (!parsed) {
    context.addIssue({ code: 'custom', message: 'customer story is invalid' })
    return z.NEVER
  }
  return parsed
})
const quoteStoryMetaSchema = z.unknown().transform((value, context) => {
  const parsed = parseQuoteStorySnapshotMeta(value)
  if (!parsed) {
    context.addIssue({ code: 'custom', message: 'customer story metadata is invalid' })
    return z.NEVER
  }
  return parsed
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
    storyMeta: quoteStoryMetaSchema.nullable(),
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
      if (line.source === 'vendor_offer' && (line.kind !== 'part' || line.coreChargeCents !== null)) {
        context.addIssue({ code: 'custom', message: 'sourced quote line is not customer-safe' })
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

export function quoteSnapshotContainsJob(
  snapshot: unknown,
  input: { ticketId: string; jobId: string },
): boolean {
  const parsed = quoteSnapshotSchema.safeParse(snapshot)
  return parsed.success
    && parsed.data.ticket.id === input.ticketId
    && parsed.data.jobs.some((job) => job.id === input.jobId)
}

export function quoteSnapshotContainsExactJob(
  snapshot: unknown,
  input: { ticketId: string; jobId: string; kind: 'diagnostic' | 'repair' | 'maintenance' },
): boolean {
  const parsed = quoteSnapshotSchema.safeParse(snapshot)
  return parsed.success
    && parsed.data.ticket.id === input.ticketId
    && parsed.data.jobs.some((job) => job.id === input.jobId && job.kind === input.kind)
}

function isPinnedSimpleWork(
  job: Pick<typeof ticketJobs.$inferSelect, 'kind' | 'workStatus'>,
): boolean {
  return (job.kind === 'repair' || job.kind === 'maintenance')
    && (job.workStatus === 'in_progress' || job.workStatus === 'done')
}

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
    coreChargeCents: line.coreChargeCents,
    fitment: line.fitment,
    laborHours: line.laborHours,
    laborRateCents: line.laborRateCents,
  }
}

export function publicManualDraftLine(line: SafeManualDraftLine): SafeManualDraftLine {
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
    coreChargeCents: line.coreChargeCents,
    fitment: line.fitment,
    laborHours: line.laborHours,
    laborRateCents: line.laborRateCents,
  }
}

function safeBuilderLine(
  line: typeof jobLines.$inferSelect,
): Omit<SafeManualDraftLine, 'quantity' | 'laborHours'>
  & {
    quantity: string
    laborHours: string | null
    source: 'manual' | 'vendor_offer'
    mutable: boolean
  } {
  const safe = safeManualDraftLine(line)
  const quantity = canonicalStoredDecimal(line.quantity, 3)
  if (line.source === 'vendor_offer') {
    if (!validateStoredManualOfferLine(line)) throw new TypeError('persisted manual offer is invalid')
    return {
      ...safe,
      coreChargeCents: null,
      quantity,
      laborHours: null,
      source: 'vendor_offer',
      mutable: false,
    }
  }
  if (!isMutableManualLine(line)) throw new TypeError('persisted manual line is invalid')
  return {
    ...safe,
    quantity,
    laborHours: line.laborHours === null ? null : canonicalStoredDecimal(line.laborHours, 2),
    source: 'manual',
    mutable: true,
  }
}

function isBuilderVisibleLine(line: typeof jobLines.$inferSelect): boolean {
  return isMutableManualLine(line) || line.source === 'vendor_offer'
}

class BuilderDataError extends Error {
  constructor() {
    super('invalid_quote_builder_data')
  }
}

export async function getQuoteBuilder(
  db: AppDb,
  input: { actor: QuoteActor; ticketId: unknown },
  dependencies: QuoteBuilderDependencies = {},
): Promise<QuoteBuilderResult> {
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  if (!parsedTicket.success) return { ok: false, error: 'invalid_input' }

  try {
    return await db.transaction(async (tx) => {
      const transactionDb = tx as AppDb
      const actor = await loadActiveActor(transactionDb, input.actor)
      if (!actor?.shopId) return { ok: false as const, error: 'not_found' as const }
      // Per-shop diagnostics entitlement decides which sessionless story
      // path a diagnostic job offers (plan §3 one-slot rule): entitled
      // shops keep today's behavior unchanged; unentitled shops get the
      // manual Record-findings editor in the same slot.
      const entitlements = await resolveShopEntitlements(transactionDb, {
        shopId: actor.shopId as string,
        isComp: actor.isComp,
      })
      const [ticket] = await transactionDb.select({
        id: tickets.id,
        ticketNumber: tickets.ticketNumber,
        status: tickets.status,
        customerId: tickets.customerId,
        vehicleId: tickets.vehicleId,
        concern: tickets.concern,
      }).from(tickets).where(and(
        eq(tickets.shopId, actor.shopId as string),
        eq(tickets.id, parsedTicket.data),
      )).limit(1).for('update', { noWait: true })
      if (!ticket || ticket.status !== 'open') return { ok: false as const, error: 'not_found' as const }
      await dependencies.afterTicketLock?.()

      const [shop] = await transactionDb.select({
        laborRateCents: shops.laborRateCents,
        taxRateBps: shops.taxRateBps,
      }).from(shops).where(eq(shops.id, actor.shopId as string)).limit(1)
      if (!shop) return { ok: false as const, error: 'not_found' as const }

      const allJobs = await transactionDb.select().from(ticketJobs).where(and(
        eq(ticketJobs.shopId, actor.shopId as string),
        eq(ticketJobs.ticketId, ticket.id),
      )).orderBy(ticketJobs.createdAt, ticketJobs.id)
      const eligibleJobs = allJobs.filter((job) =>
        job.workStatus === 'open' || job.workStatus === 'in_progress' || job.workStatus === 'blocked')
      if (eligibleJobs.length > 500) {
        return { ok: false as const, error: 'conflict' as const, retryable: false }
      }
      const eligibleJobIds = eligibleJobs.map((job) => job.id)
      const lines = eligibleJobIds.length === 0 ? [] : await transactionDb
        .select()
        .from(jobLines)
        .where(and(
          eq(jobLines.shopId, actor.shopId as string),
          inArray(jobLines.jobId, eligibleJobIds),
        ))
        .orderBy(jobLines.sort, jobLines.createdAt, jobLines.id)
      const diagnosticSessionIds = [...new Set(eligibleJobs
        .filter((job) => job.kind === 'diagnostic' && job.sessionId !== null)
        .map((job) => job.sessionId as string))]
      const linkedSessions = diagnosticSessionIds.length === 0 ? [] : await transactionDb
        .select({ id: sessions.id, status: sessions.status, treeState: sessions.treeState })
        .from(sessions)
        .where(and(
          eq(sessions.shopId, actor.shopId as string),
          inArray(sessions.id, diagnosticSessionIds),
        ))
        .orderBy(sessions.id)
      const wizardEvents = diagnosticSessionIds.length === 0 ? [] : await transactionDb
        .select({ sessionId: sessionEvents.sessionId })
        .from(sessionEvents)
        .where(and(
          inArray(sessionEvents.sessionId, diagnosticSessionIds),
          eq(sessionEvents.eventType, 'wizard_lock_in'),
        ))
        .orderBy(sessionEvents.sessionId, sessionEvents.id)
      let databaseNow: Date | null = null
      if (diagnosticSessionIds.length > 0) {
        const clockResult = await transactionDb.execute<{ now: string | Date }>(
          sql`select statement_timestamp() as "now"`,
        )
        const clockRows = ('rows' in clockResult ? clockResult.rows : clockResult) as Array<{ now: string | Date }>
        databaseNow = new Date(clockRows[0].now)
      }
      const versions = await transactionDb.select({
        id: quoteVersions.id,
        versionNumber: quoteVersions.versionNumber,
        snapshot: quoteVersions.snapshot,
        supersededAt: quoteVersions.supersededAt,
      }).from(quoteVersions).where(and(
        eq(quoteVersions.shopId, actor.shopId as string),
        eq(quoteVersions.ticketId, ticket.id),
      )).orderBy(quoteVersions.id)
      const activeVersions = versions.filter((version) => version.supersededAt === null)
      if (activeVersions.length > 1) {
        return { ok: false as const, error: 'conflict' as const, retryable: false }
      }
      const approvalEvents = await transactionDb.select({
        id: quoteEvents.id,
        kind: quoteEvents.kind,
        jobId: quoteEvents.jobId,
        quoteVersionId: quoteEvents.quoteVersionId,
        createdAt: quoteEvents.createdAt,
      }).from(quoteEvents).where(and(
        eq(quoteEvents.shopId, actor.shopId as string),
        eq(quoteEvents.ticketId, ticket.id),
        inArray(quoteEvents.kind, ['approved', 'declined']),
      )).orderBy(quoteEvents.createdAt, quoteEvents.id)

      try {
        const sessionById = new Map(linkedSessions.map((session) => [session.id, session]))
        if (diagnosticSessionIds.some((sessionId) => !sessionById.has(sessionId))) {
          throw new TypeError('diagnostic session binding is invalid')
        }
        const wizardSessionIds = new Set(wizardEvents.map((event) => event.sessionId))
        const storyMode = (job: typeof eligibleJobs[number]) => {
          if (job.kind !== 'diagnostic') return null
          if (!job.sessionId) {
            return entitlements.diagnostics
              ? 'unavailable' as const
              : 'manual_findings' as const
          }
          if (job.sessionId && wizardSessionIds.has(job.sessionId)) return 'published_wizard_unsupported' as const
          const linkedSession = sessionById.get(job.sessionId)
          const treeState = linkedSession?.treeState
          if (!linkedSession || linkedSession.status !== 'open'
            || !treeState || typeof treeState !== 'object') return 'unavailable' as const
          const tree = treeState as Record<string, unknown>
          if (tree.done === true && tree.currentNodeId === '_topology') {
            return 'topology_manual' as const
          }
          const lockAt = typeof tree.diagnosisLockedAt === 'string'
            ? new Date(tree.diagnosisLockedAt) : new Date(Number.NaN)
          const action = tree.proposedAction && typeof tree.proposedAction === 'object'
            ? tree.proposedAction as Record<string, unknown> : null
          const boundedText = (value: unknown) => typeof value === 'string'
            && value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= 5_000
          if (
            tree.done === true && tree.phase === 'repairing' && tree.currentNodeId !== '_topology'
            && !Number.isNaN(lockAt.getTime()) && lockAt.toISOString() === tree.diagnosisLockedAt
            && databaseNow && lockAt.getTime() <= databaseNow.getTime() + 5 * 60 * 1000
            && boundedText(ticket.concern) && boundedText(tree.rootCauseSummary)
            && boundedText(action?.description) && typeof action?.confidence === 'number'
            && Number.isFinite(action.confidence) && action.confidence >= 0 && action.confidence <= 1
          ) return 'ordinary_locked_tree' as const
          return 'unavailable' as const
        }
        const activeVersion = activeVersions[0]
        let activeVersionProjection: Extract<QuoteBuilderResult, { ok: true }>['builder']['activeVersion'] = null
        let activeSnapshot: QuoteSnapshotV1 | null = null
        let activeSnapshotJobIds = new Set<string>()
        if (activeVersion) {
          const snapshot = validatedQuoteSnapshot(activeVersion.snapshot, ticket)
          const visibleJobIds = new Set(eligibleJobs.map((job) => job.id))
          if (snapshot.jobs.some((job) => !visibleJobIds.has(job.id))) {
            throw new TypeError('active quote snapshot contains a hidden job')
          }
          if (!Number.isInteger(activeVersion.versionNumber) || activeVersion.versionNumber < 1
            || activeVersion.versionNumber > MAX_POSTGRES_INTEGER) {
            throw new RangeError('active quote version number is unsafe')
          }
          activeVersionProjection = {
            id: safeUuid(activeVersion.id),
            versionNumber: activeVersion.versionNumber,
            totalCents: snapshot.totals.totalCents,
            jobs: snapshot.jobs.map((job) => ({
              jobId: job.id,
              subtotalCents: job.totals.subtotalCents,
            })),
          }
          activeSnapshotJobIds = new Set(snapshot.jobs.map((job) => job.id))
          activeSnapshot = snapshot
        }
        return {
          ok: true as const,
          builder: {
            ticket: {
              id: safeUuid(ticket.id),
              status: 'open' as const,
              reconciled: ticket.customerId !== null && ticket.vehicleId !== null,
            },
            configuration: {
              laborRateCents: safeMoney(shop.laborRateCents, true),
              taxRateBps: shop.taxRateBps,
              laborRateConfigured: shop.laborRateCents !== null,
              taxRateConfigured: shop.taxRateBps !== null,
            },
            jobs: eligibleJobs.map((job) => ({
              id: safeUuid(job.id),
              title: job.title,
              kind: job.kind,
              workStatus: job.workStatus as 'open' | 'in_progress' | 'blocked',
              story: safeBuilderStory(job.customerStory, job.storyMeta),
              storyMode: storyMode(job),
              decisionEligible: activeSnapshot ? decisionJobEligible(activeSnapshot, job) : false,
              approval: safeBuilderApproval(
                job.approvalState,
                job.approvedQuoteVersionId,
                job,
                activeVersionProjection,
                activeSnapshotJobIds,
                pinnedBuilderApprovalIsValid(job, ticket.id, versions, approvalEvents),
              ),
              lines: lines
                .filter((line) => line.jobId === job.id && isBuilderVisibleLine(line))
                .map(safeBuilderLine),
            })),
            capabilities: { canRecordCustomerApproval: canRecordCustomerApproval(actor.role) },
            activeVersion: activeVersionProjection,
          },
        }
      } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) {
          throw new BuilderDataError()
        }
        throw error
      }
    })
  } catch (error) {
    if (error instanceof BuilderDataError) {
      return { ok: false, error: 'conflict', retryable: false }
    }
    if (isLockUnavailable(error)) return { ok: false, error: 'conflict', retryable: true }
    throw error
  }
}

export function isLockUnavailable(error: unknown): boolean {
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
    .select({
      id: profiles.id,
      shopId: profiles.shopId,
      role: profiles.role,
      isComp: profiles.isComp,
    })
    .from(profiles)
    .where(and(
      eq(profiles.id, parsed.data),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
  return profile?.shopId && canBuildQuotes(profile.role) ? profile : null
}

function emptyQuoteInsertionIntents(): MutationLockRequestV1['insertionIntents'] {
  return Object.freeze({
    sessions: Object.freeze([]),
    customers: Object.freeze([]),
    vehicles: Object.freeze([]),
    tickets: Object.freeze([]),
    jobs: Object.freeze([]),
  })
}

function quoteUuidList(values: readonly (string | null | undefined)[]): readonly string[] {
  return Object.freeze([...new Set(values.filter(
    (value): value is string => typeof value === 'string',
  ))].sort())
}

function persistedQuoteFingerprint(value: unknown): string {
  const normalize = (member: unknown): unknown => {
    if (member instanceof Date) return { $date: member.toISOString() }
    if (typeof member === 'bigint') return { $bigint: member.toString() }
    if (
      member === null || member === undefined || typeof member === 'string' ||
      typeof member === 'number' || typeof member === 'boolean'
    ) return member ?? null
    if (Array.isArray(member)) return member.map(normalize)
    if (typeof member !== 'object') throw new TypeError('invalid_quote_discovery_value')
    const result: Record<string, unknown> = Object.create(null)
    for (const key of Object.keys(member).sort()) {
      result[key] = normalize((member as Record<string, unknown>)[key])
    }
    return result
  }
  return JSON.stringify(normalize(value))
}

function rowsById<T extends { id: string }>(rows: readonly T[]): readonly T[] {
  return [...rows].sort((left, right) => left.id.localeCompare(right.id))
}

type CompleteQuoteDiscovery = Readonly<{
  kind: 'ready' | 'not_found'
  separateChainIds: readonly string[]
  closureFingerprint: string | null
}>

async function discoverQuoteVersionMutation(
  tx: AppDb,
  input: { shopId: string; profileId: string; ticketId: string },
) {
  return discoverCompleteQuoteMutation(tx, {
    shopId: input.shopId,
    actorProfileId: input.profileId,
    ticketId: input.ticketId,
    exactJobId: null,
    lockShop: true,
    includeAllQuoteVersionsForTickets: true,
    includeAllQuoteEventsForTickets: true,
  })
}

async function discoverCompleteQuoteMutation(
  tx: AppDb,
  input: Readonly<{
    shopId: string
    actorProfileId: string
    ticketId: string
    exactJobId: string | null
    lockShop: boolean
    includeAllQuoteVersionsForTickets: true
    includeAllQuoteEventsForTickets: true
  }>,
): Promise<Readonly<{
  lockRequest: MutationLockRequestV1
  payload: CompleteQuoteDiscovery
}>> {
  const actorOnly = (): Readonly<{
    lockRequest: MutationLockRequestV1
    payload: CompleteQuoteDiscovery
  }> => Object.freeze({
    lockRequest: Object.freeze({
      shopId: input.shopId,
      actorProfileId: input.actorProfileId,
      profileIds: Object.freeze([input.actorProfileId]),
      lockShop: false,
      customerIds: Object.freeze([]),
      vehicleIds: Object.freeze([]),
      ticketIds: Object.freeze([]),
      jobIds: Object.freeze([]),
      includeAllJobsForTickets: false,
      includeAllLinesForJobs: false,
      includeAllQuoteVersionsForTickets: false,
      includeAllQuoteEventsForTickets: false,
      sessionIds: Object.freeze([]),
      sessionEventIds: Object.freeze([]),
      vendorAccountIds: Object.freeze([]),
      cannedJobIds: Object.freeze([]),
      receiptRequestKey: null,
      receiptConditionalInsert: null,
      insertionIntents: emptyQuoteInsertionIntents(),
    }),
    payload: Object.freeze({
      kind: 'not_found', separateChainIds: Object.freeze([]), closureFingerprint: null,
    }),
  })

  const [target] = await tx.select().from(tickets).where(and(
    eq(tickets.shopId, input.shopId),
    eq(tickets.id, input.ticketId),
  )).limit(1)
  if (!target) return actorOnly()
  if (input.exactJobId !== null) {
    const [pair] = await tx.select({ id: ticketJobs.id }).from(ticketJobs).where(and(
      eq(ticketJobs.shopId, input.shopId),
      eq(ticketJobs.ticketId, input.ticketId),
      eq(ticketJobs.id, input.exactJobId),
    )).limit(1)
    if (!pair) return actorOnly()
  }

  const ticketRows = [target]
  const seenTicketIds = new Set([target.id])
  let parentId = target.separateFromTicketId
  while (parentId !== null) {
    if (ticketRows.length >= 64 || seenTicketIds.has(parentId)) {
      throw new ShopOsMutationConflict()
    }
    const [parent] = await tx.select().from(tickets).where(and(
      eq(tickets.shopId, input.shopId),
      eq(tickets.id, parentId),
    )).limit(1)
    if (!parent) throw new ShopOsMutationConflict()
    ticketRows.push(parent)
    seenTicketIds.add(parent.id)
    parentId = parent.separateFromTicketId
  }

  const ticketIds = quoteUuidList(ticketRows.map(({ id }) => id))
  const jobs = await tx.select().from(ticketJobs).where(and(
    eq(ticketJobs.shopId, input.shopId),
    inArray(ticketJobs.ticketId, ticketIds),
  )).orderBy(ticketJobs.id)
  const jobIds = quoteUuidList(jobs.map(({ id }) => id))
  const lines = jobIds.length === 0 ? [] : await tx.select().from(jobLines).where(and(
    eq(jobLines.shopId, input.shopId),
    inArray(jobLines.jobId, jobIds),
  )).orderBy(jobLines.id)
  const versions = await tx.select().from(quoteVersions).where(and(
    eq(quoteVersions.shopId, input.shopId),
    inArray(quoteVersions.ticketId, ticketIds),
  )).orderBy(quoteVersions.id)
  const events = await tx.select().from(quoteEvents).where(and(
    eq(quoteEvents.shopId, input.shopId),
    inArray(quoteEvents.ticketId, ticketIds),
  )).orderBy(quoteEvents.id)

  const sessionIds = quoteUuidList(jobs.map(({ sessionId }) => sessionId))
  const sessionRows = sessionIds.length === 0 ? [] : await tx.select().from(sessions).where(and(
    eq(sessions.shopId, input.shopId),
    inArray(sessions.id, sessionIds),
  )).orderBy(sessions.id)
  const vehicleIds = quoteUuidList([
    ...ticketRows.map(({ vehicleId }) => vehicleId),
    ...sessionRows.map(({ vehicleId }) => vehicleId),
  ])
  const vehicleRows = vehicleIds.length === 0 ? [] : (await tx.select({ row: vehicles })
    .from(vehicles)
    .innerJoin(customers, eq(customers.id, vehicles.customerId))
    .where(and(
      eq(customers.shopId, input.shopId),
      inArray(vehicles.id, vehicleIds),
    )).orderBy(vehicles.id)).map(({ row }) => row)
  const customerIds = quoteUuidList([
    ...ticketRows.map(({ customerId }) => customerId),
    ...vehicleRows.map(({ customerId }) => customerId),
  ])
  const customerRows = customerIds.length === 0 ? [] : await tx.select().from(customers).where(and(
    eq(customers.shopId, input.shopId),
    inArray(customers.id, customerIds),
  )).orderBy(customers.id)
  const vendorAccountIds = quoteUuidList(lines.map(({ vendorAccountId }) => vendorAccountId))
  const vendorRows = vendorAccountIds.length === 0 ? [] : await tx.select().from(vendorAccounts)
    .where(and(
      eq(vendorAccounts.shopId, input.shopId),
      inArray(vendorAccounts.id, vendorAccountIds),
    )).orderBy(vendorAccounts.id)
  const profileIds = quoteUuidList([
    input.actorProfileId,
    ...ticketRows.flatMap((ticket) => [
      ticket.createdByProfileId,
      ticket.canceledByProfileId,
      ticket.deliveredByProfileId,
      ticket.closedByProfileId,
    ]),
    ...jobs.flatMap((job) => [
      job.assignedTechId,
      job.createdByProfileId,
      job.statementConfirmedByProfileId,
    ]),
    ...lines.flatMap((line) => [line.orderedByProfileId, line.receivedByProfileId]),
    ...sessionRows.map(({ techId }) => techId),
    ...versions.map(({ createdByProfileId }) => createdByProfileId),
    ...events.map(({ actorProfileId }) => actorProfileId),
  ])
  const profileRows = await tx.select().from(profiles).where(and(
    eq(profiles.shopId, input.shopId),
    inArray(profiles.id, profileIds),
  )).orderBy(profiles.id)
  const [shop] = await tx.select().from(shops).where(eq(shops.id, input.shopId)).limit(1)

  const closureFingerprint = persistedQuoteFingerprint({
    profiles: rowsById(profileRows),
    shop: shop ?? null,
    customers: rowsById(customerRows),
    vehicles: rowsById(vehicleRows),
    tickets: rowsById(ticketRows),
    jobs: rowsById(jobs),
    lines: rowsById(lines),
    versions: rowsById(versions),
    events: rowsById(events),
    sessions: rowsById(sessionRows),
    vendors: rowsById(vendorRows),
  })

  return Object.freeze({
    lockRequest: Object.freeze({
      shopId: input.shopId,
      actorProfileId: input.actorProfileId,
      profileIds,
      lockShop: input.lockShop,
      customerIds,
      vehicleIds,
      ticketIds,
      jobIds,
      includeAllJobsForTickets: true,
      includeAllLinesForJobs: true,
      includeAllQuoteVersionsForTickets: input.includeAllQuoteVersionsForTickets,
      includeAllQuoteEventsForTickets: input.includeAllQuoteEventsForTickets,
      sessionIds,
      sessionEventIds: Object.freeze([]),
      vendorAccountIds,
      cannedJobIds: Object.freeze([]),
      receiptRequestKey: null,
      receiptConditionalInsert: null,
      insertionIntents: emptyQuoteInsertionIntents(),
    }),
    payload: Object.freeze({
      kind: 'ready',
      separateChainIds: Object.freeze(ticketRows.map(({ id }) => id)),
      closureFingerprint,
    }),
  })
}

function resolveCompleteQuoteScope(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  discovery: CompleteQuoteDiscovery,
  ticketId: string,
  capability: 'build' | 'decision',
): LockedMutationScopeV1['tickets'][number] {
  assertLiveLockedMutationScopeV1(tx, scope)
  if (discovery.kind === 'not_found') throw new ShopOsMutationNotFound()
  if (
    scope.profiles.length !== scope.request.profileIds.length ||
    scope.profiles.some(({ id }) => !scope.request.profileIds.includes(id)) ||
    (capability === 'build'
      ? !canBuildQuotes(scope.actor.role)
      : !canRecordCustomerApproval(scope.actor.role)) ||
    scope.profiles.some((profile) =>
      profile.shopId !== scope.actor.shopId ||
      profile.membershipStatus !== 'active' || profile.deactivatedAt !== null ||
      (profile.skillTier !== null && ![1, 2, 3].includes(profile.skillTier)))
  ) throw new ShopOsMutationNotFound()

  const graphById = new Map(scope.tickets.map((graph) => [graph.ticket.id, graph] as const))
  if (
    discovery.separateChainIds.length < 1 || discovery.separateChainIds[0] !== ticketId ||
    discovery.separateChainIds.length !== scope.tickets.length ||
    new Set(discovery.separateChainIds).size !== discovery.separateChainIds.length
  ) throw new ShopOsMutationConflict()
  for (let index = 0; index < discovery.separateChainIds.length; index += 1) {
    const graph = graphById.get(discovery.separateChainIds[index]!)
    if (!graph || graph.ticket.separateFromTicketId !==
      (discovery.separateChainIds[index + 1] ?? null)) throw new ShopOsMutationConflict()
  }

  const lockedFingerprint = persistedQuoteFingerprint({
    profiles: rowsById(scope.profiles),
    shop: scope.shop,
    customers: rowsById(scope.customers),
    vehicles: rowsById(scope.vehicles),
    tickets: rowsById(scope.tickets.map(({ ticket }) => ticket)),
    jobs: rowsById(scope.tickets.flatMap(({ jobs }) => jobs)),
    lines: rowsById(scope.tickets.flatMap(({ lines }) => lines)),
    versions: rowsById(scope.tickets.flatMap(({ versions }) => versions)),
    events: rowsById(scope.tickets.flatMap(({ events }) => events)),
    sessions: rowsById(scope.sessions),
    vendors: rowsById(scope.vendorAccounts),
  })
  if (lockedFingerprint !== discovery.closureFingerprint) {
    throw new ShopOsMutationConflict()
  }
  const target = graphById.get(ticketId)
  if (!target) throw new ShopOsMutationNotFound()
  for (const graph of scope.tickets) {
    for (const job of graph.jobs) {
      if (job.approvedApprovalEventId === null) continue
      const event = graph.events.find(({ id }) => id === job.approvedApprovalEventId)
      if (!event || event.ticketId !== graph.ticket.id || event.jobId !== job.id) {
        throw new ShopOsMutationConflict()
      }
    }
  }
  for (const graph of scope.tickets) {
    if ((graph.ticket.customerId === null) !== (graph.ticket.vehicleId === null)) {
      throw new ShopOsMutationNotFound()
    }
    if (graph.ticket.customerId !== null) {
      const customer = scope.customers.find(({ id }) => id === graph.ticket.customerId)
      const vehicle = scope.vehicles.find(({ id }) => id === graph.ticket.vehicleId)
      if (!customer || !vehicle || customer.shopId !== scope.actor.shopId ||
        vehicle.customerId !== customer.id) throw new ShopOsMutationNotFound()
    }
  }
  return target
}

export type QuoteInvalidationDeltaV1 = Readonly<{
  changedJobIds: readonly string[]
  supersededVersionIds: readonly string[]
}>

export async function invalidateActiveQuoteVersionDeltaV1(
  db: AppDb,
  input: {
    shopId: string
    ticketId: string
    jobIds: readonly string[]
    activeVersions: readonly (typeof quoteVersions.$inferSelect)[]
    scope?: LockedMutationScopeV1
  },
): Promise<Failure | QuoteInvalidationDeltaV1> {
  if (input.scope) assertLiveLockedMutationScopeV1(db, input.scope)
  if (input.activeVersions.length > 1) return conflict()
  const active = input.activeVersions[0]
  if (!active) return Object.freeze({
    changedJobIds: Object.freeze([]), supersededVersionIds: Object.freeze([]),
  })
  const snapshot = quoteSnapshotSchema.safeParse(active.snapshot)
  if (!snapshot.success) return conflict()
  if (snapshot.data.ticket.id !== input.ticketId) return conflict()
  const includedJobIds = snapshot.data.jobs.map((job) => job.id)
  if (new Set(includedJobIds).size !== includedJobIds.length) {
    return conflict()
  }
  const lockedJobIds = new Set(input.jobIds)
  if (includedJobIds.some((jobId) => !lockedJobIds.has(jobId))) {
    return conflict()
  }

  const [superseded] = await db
    .update(quoteVersions)
    .set({ supersededAt: new Date() })
    .where(and(eq(quoteVersions.id, active.id), isNull(quoteVersions.supersededAt)))
    .returning()
  if (!superseded) return conflict(true)
  const changedJobIds: string[] = []
  if (includedJobIds.length > 0) {
    const resetJobIds = (await db
      .select({
        id: ticketJobs.id,
        kind: ticketJobs.kind,
        workStatus: ticketJobs.workStatus,
        approvalState: ticketJobs.approvalState,
        approvedQuoteVersionId: ticketJobs.approvedQuoteVersionId,
      })
      .from(ticketJobs)
      .where(and(
        eq(ticketJobs.shopId, input.shopId),
        eq(ticketJobs.ticketId, input.ticketId),
        inArray(ticketJobs.id, includedJobIds),
      )))
      .filter((job) => !isPinnedSimpleWork(job)
        && (job.approvalState !== 'pending_quote' || job.approvedQuoteVersionId !== null))
      .map((job) => job.id)
    if (resetJobIds.length > 0) await db
      .update(ticketJobs)
      .set({ approvalState: 'pending_quote', approvedQuoteVersionId: null, updatedAt: new Date() })
      .where(and(
        eq(ticketJobs.shopId, input.shopId),
        eq(ticketJobs.ticketId, input.ticketId),
        inArray(ticketJobs.id, resetJobIds),
      ))
    changedJobIds.push(...resetJobIds)
  }
  return Object.freeze({
    changedJobIds: Object.freeze([...new Set(changedJobIds)].sort()),
    supersededVersionIds: Object.freeze([active.id]),
  })
}

export async function invalidateActiveQuoteVersion(
  db: AppDb,
  input: {
    shopId: string
    ticketId: string
    jobIds: string[]
    activeVersions: DraftContext['activeVersions']
  },
): Promise<Failure | null> {
  const result = await invalidateActiveQuoteVersionDeltaV1(db, input)
  return 'ok' in result ? result : null
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
  afterDiscovery?: () => Promise<void>
  afterWrite?: () => Promise<void>
  afterFinalization?: () => Promise<void>
}

type VersionFailure = Extract<CreateQuoteVersionResult, { ok: false }>
type VersionContext = {
  ticket: Pick<typeof tickets.$inferSelect, 'id' | 'ticketNumber' | 'customerId' | 'vehicleId'>
  shop: Pick<typeof shops.$inferSelect, 'id' | 'laborRateCents' | 'taxRateBps'>
  jobs: readonly (typeof ticketJobs.$inferSelect)[]
  lines: readonly (typeof jobLines.$inferSelect)[]
  versions: readonly (typeof quoteVersions.$inferSelect)[]
  actorId: string
}

class AbortVersionCreation extends Error {
  constructor(readonly failure: VersionFailure) {
    super('abort_quote_version_creation')
  }
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
  const parsed = parsePersistedCustomerStory(value)
  if (!parsed) throw new TypeError('persisted customer story is invalid')
  return canonicalizeJson(parsed) as unknown as QuoteCustomerStoryV1
}

function safeBuilderStory(
  storyValue: unknown,
  metaValue: unknown,
): NonNullable<Extract<QuoteBuilderResult, { ok: true }>['builder']['jobs'][number]['story']> {
  if (storyValue === null && metaValue === null) {
    return { content: null, source: null, reviewStatus: null, revision: 0 }
  }
  if (storyValue === null) {
    throw new TypeError('customer story and metadata must be paired')
  }
  const content = parsePersistedCustomerStory(storyValue)
  const meta = parsePersistedCustomerStoryMeta(metaValue)
  if (!content || !meta) throw new TypeError('customer story persistence is invalid')
  return {
    content,
    source: meta.source,
    reviewStatus: meta.reviewStatus ?? null,
    revision: meta.storyRevision ?? 0,
  }
}

function safeBuilderApproval(
  state: unknown,
  quoteVersionId: unknown,
  job: Pick<typeof ticketJobs.$inferSelect, 'id' | 'kind' | 'workStatus'>,
  activeVersion: Extract<QuoteBuilderResult, { ok: true }>['builder']['activeVersion'],
  activeSnapshotJobIds: ReadonlySet<string>,
  pinnedApprovalValid: boolean,
): NonNullable<Extract<QuoteBuilderResult, { ok: true }>['builder']['jobs'][number]['approval']> {
  if (state !== 'pending_quote' && state !== 'quote_ready' && state !== 'sent'
    && state !== 'approved' && state !== 'declined') {
    throw new TypeError('quote approval state is invalid')
  }
  const safeVersionId = quoteVersionId === null ? null
    : typeof quoteVersionId === 'string' ? safeUuid(quoteVersionId) : null
  if (quoteVersionId !== null && safeVersionId === null) {
    throw new TypeError('approved quote version ID is invalid')
  }
  if ((state === 'approved') !== (safeVersionId !== null)) {
    throw new TypeError('quote approval projection is inconsistent')
  }
  if (state === 'approved') {
    if (isPinnedSimpleWork(job)) {
      if (!pinnedApprovalValid) throw new TypeError('pinned quote approval projection is stale')
    } else if (!activeVersion
      || safeVersionId !== activeVersion.id
      || !activeSnapshotJobIds.has(job.id)) {
      throw new TypeError('approved quote projection is stale')
    }
  }
  return { state, quoteVersionId: safeVersionId }
}

function pinnedBuilderApprovalIsValid(
  job: Pick<typeof ticketJobs.$inferSelect, 'id' | 'kind' | 'workStatus' | 'approvedQuoteVersionId'>,
  ticketId: string,
  versions: ReadonlyArray<Pick<typeof quoteVersions.$inferSelect, 'id' | 'snapshot'>>,
  events: ReadonlyArray<Pick<typeof quoteEvents.$inferSelect, 'id' | 'kind' | 'jobId' | 'quoteVersionId' | 'createdAt'>>,
): boolean {
  if (!isPinnedSimpleWork(job) || !job.approvedQuoteVersionId) return false
  const version = versions.find((candidate) => candidate.id === job.approvedQuoteVersionId)
  if (!version || !quoteSnapshotContainsExactJob(version.snapshot, {
    ticketId,
    jobId: job.id,
    kind: job.kind,
  })) return false
  const latest = events.filter((event) => event.jobId === job.id).sort((left, right) => {
    const time = left.createdAt.getTime() - right.createdAt.getTime()
    return time === 0 ? left.id.localeCompare(right.id) : time
  }).at(-1)
  return latest?.kind === 'approved' && latest.quoteVersionId === version.id
}

function requireVersionableStory(
  kind: 'diagnostic' | 'repair' | 'maintenance',
  story: unknown,
  meta: unknown,
): void {
  if (story === null) {
    if (meta !== null || kind === 'diagnostic') {
      throw new TypeError('diagnostic customer story is required')
    }
    return
  }
  const safeStory = safeBuilderStory(story, meta)
  if (safeStory.content?.howWeKnow.some((claim) => claim.sourceArtifactIds.length > 0)) {
    throw new TypeError('new quote versions cannot acquire media provenance')
  }
  if (safeStory.source === 'ai' && safeStory.reviewStatus !== 'reviewed') {
    throw new TypeError('AI customer story requires human review')
  }
  if (kind === 'diagnostic' && safeStory.source === 'template') {
    throw new TypeError('diagnostic template stories are unsupported')
  }
  if (kind === 'diagnostic' && safeStory.source === 'manual' && safeStory.reviewStatus !== 'reviewed') {
    throw new TypeError('manual diagnostic story requires human review')
  }
  if (kind === 'diagnostic' && safeStory.source === 'manual'
    && safeStory.content && safeStory.content.howWeKnow.length !== 0) {
    throw new TypeError('manual diagnostic story cannot claim sourced proof')
  }
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

function requireManualOfferLine(
  line: typeof jobLines.$inferSelect,
  _quantity: string,
): void {
  if (!validateStoredManualOfferLine(line)) throw new TypeError('persisted manual offer is invalid')
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
  const jobs = sortBySnapshotOrder(context.jobs)
    .filter((job) => job.workStatus !== 'canceled'
      && !isPinnedSimpleWork(job)
      && (linesByJob.get(job.id)?.length ?? 0) > 0)
    .map((job) => {
      if (!job.title) throw new TypeError('job title is empty')
      requireVersionableStory(job.kind, job.customerStory, job.storyMeta)
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
        if (line.source === 'vendor_offer') requireManualOfferLine(line, quantity)
        else requireBoundedJson(line.vendorSnapshot, 16_384)
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
          coreChargeCents: line.source === 'vendor_offer'
            ? null
            : safeMoney(line.coreChargeCents, true),
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
        attachments: [],
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

function validatedQuoteSnapshot(
  snapshotValue: unknown,
  expectedTicket?: Pick<
    typeof tickets.$inferSelect,
    'id' | 'ticketNumber' | 'customerId' | 'vehicleId'
  >,
): QuoteSnapshotV1 {
  const parsed = quoteSnapshotSchema.safeParse(snapshotValue)
  if (!parsed.success) throw new TypeError('quote snapshot is invalid')
  const snapshot = parsed.data as QuoteSnapshotV1
  if (snapshot.jobs.length === 0) throw new TypeError('quote snapshot is empty')
  if (Buffer.byteLength(JSON.stringify(snapshot), 'utf8') > MAX_SNAPSHOT_BYTES) {
    throw new RangeError('quote snapshot is oversized')
  }
  if (expectedTicket && (
    snapshot.ticket.id !== expectedTicket.id
    || snapshot.ticket.number !== expectedTicket.ticketNumber
    || snapshot.ticket.customerId !== expectedTicket.customerId
    || snapshot.ticket.vehicleId !== expectedTicket.vehicleId
  )) {
    throw new TypeError('quote snapshot ticket does not match')
  }

  const jobIds = new Set<string>()
  const lineIds = new Set<string>()
  const attachmentIds = new Set<string>()
  const ticketLines: Array<{ extendedCents: number; taxable: boolean }> = []
  for (const job of snapshot.jobs) {
    if (jobIds.has(job.id) || job.lines.length === 0) {
      throw new TypeError('quote snapshot job structure is invalid')
    }
    jobIds.add(job.id)
    if ((job.customerStory === null) !== (job.storyMeta === null)) {
      throw new TypeError('quote snapshot story metadata is inconsistent')
    }
    if (job.kind === 'diagnostic' && (
      job.customerStory === null
      || job.storyMeta === null
      || (job.storyMeta.source !== 'ai' && job.storyMeta.source !== 'manual')
      || (job.storyMeta.source === 'manual' && job.customerStory.howWeKnow.length !== 0)
    )) {
      throw new TypeError('quote snapshot diagnostic story is invalid')
    }
    const jobLinesForTotals: Array<{ extendedCents: number; taxable: boolean }> = []
    for (const line of job.lines) {
      if (lineIds.has(line.id)) throw new TypeError('quote snapshot line ID is duplicated')
      lineIds.add(line.id)
      const quantity = formatScaledDecimal(parseScaledDecimal(line.quantity, 3), 3)
      if (quantity !== line.quantity || parseScaledDecimal(quantity, 3) === 0n) {
        throw new TypeError('quote snapshot quantity is invalid')
      }
      if (line.kind !== 'part' && quantity !== '1') {
        throw new TypeError('quote snapshot non-part quantity is invalid')
      }
      if (line.laborHours !== null) {
        const hours = formatScaledDecimal(parseScaledDecimal(line.laborHours, 2), 2)
        if (hours !== line.laborHours) throw new TypeError('quote snapshot labor hours are invalid')
      }
      const totalsLine = { extendedCents: line.priceCents, taxable: line.taxable }
      jobLinesForTotals.push(totalsLine)
      ticketLines.push(totalsLine)
    }
    for (const attachment of job.attachments) {
      if (attachmentIds.has(attachment.id) || attachment.jobId !== job.id) {
        throw new TypeError('quote snapshot attachment structure is invalid')
      }
      attachmentIds.add(attachment.id)
    }
    const jobTotals = calculateTicketTotals(jobLinesForTotals, 0)
    if (job.totals.subtotalCents !== jobTotals.subtotalCents
      || job.totals.taxableSubtotalCents !== jobTotals.taxableSubtotalCents) {
      throw new TypeError('quote snapshot job totals are invalid')
    }
  }
  const ticketTotals = calculateTicketTotals(ticketLines, snapshot.ticket.taxRateBps)
  if (snapshot.totals.subtotalCents !== ticketTotals.subtotalCents
    || snapshot.totals.taxableSubtotalCents !== ticketTotals.taxableSubtotalCents
    || snapshot.totals.taxCents !== ticketTotals.taxCents
    || snapshot.totals.totalCents !== ticketTotals.totalCents) {
    throw new TypeError('quote snapshot ticket totals are invalid')
  }
  return snapshot
}

function validatedActiveSnapshot(
  context: VersionContext,
  version: typeof quoteVersions.$inferSelect,
): QuoteSnapshotV1 {
  let snapshot: QuoteSnapshotV1
  try {
    snapshot = validatedQuoteSnapshot(version.snapshot, context.ticket)
  } catch {
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
  const parsedActor = uuidSchema.safeParse(input.actor.profileId)
  if (!parsedTicket.success || !parsedActor.success) {
    return { ok: false, error: 'invalid_input' }
  }
  const persistedActor = await loadActiveActor(db, input.actor)
  if (!persistedActor?.shopId) return notFound()
  const seams = Object.freeze({
    beforeWrite: dependencies.beforeWrite,
    afterTicketLock: dependencies.afterTicketLock,
    afterDiscovery: dependencies.afterDiscovery,
    afterWrite: dependencies.afterWrite,
    afterFinalization: dependencies.afterFinalization,
  })
  try {
    return await runBoundedShopOsMutationV1<
      CreateQuoteVersionResult,
      CompleteQuoteDiscovery
    >(db, {
      discover: async (tx) => discoverQuoteVersionMutation(tx, {
        shopId: persistedActor.shopId as string,
        profileId: parsedActor.data,
        ticketId: parsedTicket.data,
      }),
      executeLocked: async (tx, scope, discovery) => {
      assertLiveLockedMutationScopeV1(tx, scope)
      const graph = resolveCompleteQuoteScope(
        tx, scope, discovery, parsedTicket.data, 'build',
      )
      if (graph.ticket.status !== 'open' || !scope.shop) {
        throw new ShopOsMutationNotFound()
      }
      if (!graph.ticket.customerId || !graph.ticket.vehicleId) {
        throw new AbortVersionCreation(conflict())
      }
      const context: VersionContext = {
        ticket: graph.ticket,
        shop: scope.shop,
        jobs: graph.jobs,
        lines: graph.lines,
        versions: graph.versions,
        actorId: scope.actor.id,
      }
      await seams.afterTicketLock?.()
      await seams.afterDiscovery?.()
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
      await seams.beforeWrite?.()
      if (active) {
        const [superseded] = await tx
          .update(quoteVersions)
          .set({ supersededAt: new Date() })
          .where(and(eq(quoteVersions.id, active.id), isNull(quoteVersions.supersededAt)))
          .returning()
        if (!superseded) throw new AbortVersionCreation(conflict(true))
        const oldJobIds = activeSnapshot!.jobs.map((job) => job.id)
        const resetOldJobIds = context.jobs
          .filter((job) => oldJobIds.includes(job.id) && !isPinnedSimpleWork(job))
          .map((job) => job.id)
        if (resetOldJobIds.length > 0) {
          await tx.update(ticketJobs).set({
            approvalState: 'pending_quote',
            approvedQuoteVersionId: null,
            updatedAt: new Date(),
          }).where(and(
            eq(ticketJobs.shopId, context.shop.id),
            eq(ticketJobs.ticketId, context.ticket.id),
            inArray(ticketJobs.id, resetOldJobIds),
          ))
        }
      }
      const maxVersion = context.versions.reduce((maximum, version) => Math.max(maximum, version.versionNumber), 0)
      if (!Number.isInteger(maxVersion) || maxVersion >= MAX_POSTGRES_INTEGER) {
        throw new AbortVersionCreation(conflict())
      }
      const [created] = await tx.insert(quoteVersions).values({
        shopId: context.shop.id,
        ticketId: context.ticket.id,
        versionNumber: maxVersion + 1,
        snapshot: snapshot as unknown as Record<string, unknown>,
        createdByProfileId: context.actorId,
      }).returning()
      const includedJobIds = snapshot.jobs.map((job) => job.id)
      const readyJobIds = context.jobs
        .filter((job) => includedJobIds.includes(job.id) && !isPinnedSimpleWork(job))
        .map((job) => job.id)
      if (readyJobIds.length > 0) await tx.update(ticketJobs).set({
        approvalState: 'quote_ready',
        approvedQuoteVersionId: null,
        updatedAt: new Date(),
      }).where(and(
        eq(ticketJobs.shopId, context.shop.id),
        eq(ticketJobs.ticketId, context.ticket.id),
        inArray(ticketJobs.id, readyJobIds),
      ))
      await seams.afterWrite?.()
      const changedJobIds = [...new Set([
        ...(activeSnapshot?.jobs.map(({ id }) => id) ?? []),
        ...snapshot.jobs.map(({ id }) => id),
      ])].filter((id) => {
        const job = context.jobs.find((candidate) => candidate.id === id)
        return job !== undefined && !isPinnedSimpleWork(job)
      }).sort()
      await finalizeMutationRevisionsV1(
        tx,
        scope,
        { sessionIds: [], customerIds: [], vehicleIds: [] },
        [{
          ticketId: graph.ticket.id,
          createdTicket: false,
          createdJobIds: [],
          existingChangedJobIds: changedJobIds,
          actorVisibleTicketFieldsChanged: false,
        }],
      )
      await seams.afterFinalization?.()
      return {
        ok: true,
        changed: true,
        version: { id: created.id, versionNumber: created.versionNumber },
      }
      },
    })
  } catch (error) {
    if (error instanceof AbortVersionCreation) return error.failure
    if (error instanceof ShopOsMutationNotFound) return notFound()
    if (error instanceof ShopOsMutationConflict) return conflict(true)
    if (isUniqueViolation(error)) return conflict(true)
    throw error
  }
}

type DecisionFailure = Extract<QuoteDecisionResult, { ok: false }>

class AbortQuoteDecision extends Error {
  constructor(readonly failure: DecisionFailure) {
    super('abort_quote_decision')
  }
}

function decisionNotFound(): DecisionFailure {
  return { ok: false, error: 'not_found' }
}

async function discoverQuoteDecisionMutation(
  tx: AppDb,
  input: { shopId: string; profileId: string; ticketId: string; jobId: string },
) {
  return discoverCompleteQuoteMutation(tx, {
    shopId: input.shopId,
    actorProfileId: input.profileId,
    ticketId: input.ticketId,
    exactJobId: input.jobId,
    lockShop: true,
    includeAllQuoteVersionsForTickets: true,
    includeAllQuoteEventsForTickets: true,
  })
}

function decisionConflict(retryable = false): DecisionFailure {
  return { ok: false, error: 'conflict', retryable }
}

function safeDecisionResult(
  event: typeof quoteEvents.$inferSelect,
  job: Pick<typeof ticketJobs.$inferSelect, 'approvalState' | 'approvedQuoteVersionId'>,
  changed: boolean,
): QuoteDecisionResult {
  if (event.kind !== 'approved' && event.kind !== 'declined') throw new TypeError('invalid decision event')
  return {
    ok: true,
    changed,
    event: {
      id: event.id,
      kind: event.kind,
      quoteVersionId: event.quoteVersionId,
      jobId: event.jobId as string,
      approvedVia: event.approvedVia === 'phone' || event.approvedVia === 'in_person'
        ? event.approvedVia
        : null,
    },
    projection: {
      approvalState: job.approvalState,
      approvedQuoteVersionId: job.approvedQuoteVersionId,
    },
  }
}

function isMatchingDecisionEvent(
  event: typeof quoteEvents.$inferSelect,
  input: z.infer<typeof quoteDecisionSchema>,
  actorId: string,
): boolean {
  return event.actorProfileId === actorId
    && event.jobId === input.jobId
    && event.quoteVersionId === input.quoteVersionId
    && event.kind === input.decision
    && event.approvedVia === (input.decision === 'approved' ? input.approvedVia : null)
}

function snapshotContainsDecisionJob(
  snapshotValue: unknown,
  ticket: Pick<typeof tickets.$inferSelect, 'id' | 'ticketNumber' | 'customerId' | 'vehicleId'>,
  currentJobs: ReadonlyArray<Pick<typeof ticketJobs.$inferSelect, 'id'>>,
  job: Pick<typeof ticketJobs.$inferSelect, 'id' | 'kind' | 'workStatus'>,
): boolean {
  let snapshot: QuoteSnapshotV1
  try {
    snapshot = validatedQuoteSnapshot(snapshotValue, ticket)
  } catch {
    return false
  }
  const currentJobIds = new Set(currentJobs.map((candidate) => candidate.id))
  if (snapshot.jobs.some((candidate) => !currentJobIds.has(candidate.id))) return false
  return decisionJobEligible(snapshot, job)
}

function decisionJobEligible(
  snapshot: QuoteSnapshotV1,
  job: Pick<typeof ticketJobs.$inferSelect, 'id' | 'kind' | 'workStatus'>,
): boolean {
  const snapshotJob = snapshot.jobs.find((candidate) => candidate.id === job.id)
  return Boolean(
    snapshotJob
    && (job.kind === 'diagnostic' || job.kind === 'repair' || job.kind === 'maintenance')
    && snapshotJob.kind === job.kind
    && job.workStatus === 'open',
  )
}

export async function recordQuoteDecision(
  db: AppDb,
  input: { actor: QuoteActor; ticketId: unknown; body: unknown },
  dependencies: QuoteDecisionDependencies = {},
): Promise<QuoteDecisionResult> {
  const parsedTicket = uuidSchema.safeParse(input.ticketId)
  const parsedDecision = quoteDecisionSchema.safeParse(input.body)
  const parsedActor = uuidSchema.safeParse(input.actor.profileId)
  if (!parsedTicket.success || !parsedDecision.success || !parsedActor.success) {
    return { ok: false, error: 'invalid_input' }
  }

  const [persistedActor] = await db
    .select({ id: profiles.id, shopId: profiles.shopId, role: profiles.role })
    .from(profiles)
    .where(and(
      eq(profiles.id, parsedActor.data),
      eq(profiles.membershipStatus, 'active'),
      isNull(profiles.deactivatedAt),
    ))
    .limit(1)
  if (!persistedActor?.shopId || !canRecordCustomerApproval(persistedActor.role)) {
    return decisionNotFound()
  }

  try {
    const seams = Object.freeze({
      afterTicketLock: dependencies.afterTicketLock,
      afterEventInsert: dependencies.afterEventInsert,
      afterDiscovery: dependencies.afterDiscovery,
      afterWrite: dependencies.afterWrite,
      afterFinalization: dependencies.afterFinalization,
    })
    return await runBoundedShopOsMutationV1<QuoteDecisionResult, CompleteQuoteDiscovery>(db, {
      discover: async (tx) => discoverQuoteDecisionMutation(tx, {
        shopId: persistedActor.shopId as string,
        profileId: parsedActor.data,
        ticketId: parsedTicket.data,
        jobId: parsedDecision.data.jobId,
      }),
      executeLocked: async (tx, scope, discovery) => {
      assertLiveLockedMutationScopeV1(tx, scope)
      const graph = resolveCompleteQuoteScope(
        tx, scope, discovery, parsedTicket.data, 'decision',
      )
      const targetJob = graph.jobs.find(({ id }) => id === parsedDecision.data.jobId)
      if (!targetJob) throw new ShopOsMutationNotFound()
      await seams.afterTicketLock?.()
      await seams.afterDiscovery?.()

      const [existingEvent] = await tx.select().from(quoteEvents).where(and(
        eq(quoteEvents.shopId, scope.actor.shopId),
        eq(quoteEvents.requestKey, parsedDecision.data.requestKey),
      )).limit(1)
      if (existingEvent) {
        if (!isMatchingDecisionEvent(existingEvent, parsedDecision.data, scope.actor.id)) {
          throw new AbortQuoteDecision(decisionConflict())
        }
        return safeDecisionResult(existingEvent, targetJob, false)
      }

      if (graph.ticket.status !== 'open' || !graph.ticket.customerId ||
        !graph.ticket.vehicleId) {
        throw new ShopOsMutationNotFound()
      }
      const activeVersions = graph.versions.filter((candidate) => candidate.supersededAt === null)
      const version = graph.versions.find((candidate) =>
        candidate.id === parsedDecision.data.quoteVersionId)
      if (!targetJob || !version || activeVersions.length !== 1 || activeVersions[0]?.id !== version.id) {
        throw new ShopOsMutationNotFound()
      }
      if (!snapshotContainsDecisionJob(version.snapshot, graph.ticket, graph.jobs, targetJob)) {
        throw new ShopOsMutationNotFound()
      }

      const approvedVia = parsedDecision.data.decision === 'approved'
        ? parsedDecision.data.approvedVia
        : null
      const [event] = await tx.insert(quoteEvents).values({
        shopId: scope.actor.shopId,
        ticketId: graph.ticket.id,
        jobId: targetJob.id,
        quoteVersionId: version.id,
        kind: parsedDecision.data.decision,
        actorProfileId: scope.actor.id,
        approvedVia,
        requestKey: parsedDecision.data.requestKey,
      }).returning()

      await seams.afterEventInsert?.()
      const [updatedJob] = await tx
        .update(ticketJobs)
        .set({
          approvalState: parsedDecision.data.decision,
          approvedQuoteVersionId: parsedDecision.data.decision === 'approved' ? version.id : null,
          updatedAt: new Date(),
        })
        .where(and(
          eq(ticketJobs.shopId, scope.actor.shopId),
          eq(ticketJobs.ticketId, graph.ticket.id),
          eq(ticketJobs.id, targetJob.id),
          eq(ticketJobs.revision, targetJob.revision),
        ))
        .returning()
      if (!updatedJob) throw new ShopOsMutationConflict()
      await seams.afterWrite?.()
      await finalizeMutationRevisionsV1(
        tx,
        scope,
        { sessionIds: [], customerIds: [], vehicleIds: [] },
        [{
          ticketId: graph.ticket.id,
          createdTicket: false,
          createdJobIds: [],
          existingChangedJobIds: [targetJob.id],
          actorVisibleTicketFieldsChanged: false,
        }],
      )
      await seams.afterFinalization?.()
      return safeDecisionResult(event, updatedJob, true)
      },
    })
  } catch (error) {
    if (error instanceof AbortQuoteDecision) return error.failure
    if (error instanceof ShopOsMutationNotFound) return decisionNotFound()
    if (error instanceof ShopOsMutationConflict) return decisionConflict(true)
    if (isUniqueViolation(error)) return decisionConflict(true)
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
  mutate: (tx: AppDb, context: DraftContext) => Promise<Readonly<{
    result: QuoteDraftResult
    changedJobIds: readonly string[]
  }>>,
): Promise<QuoteDraftResult> {
  const parsedTicket = uuidSchema.safeParse(ticketId)
  const parsedJob = uuidSchema.safeParse(jobId)
  const parsedActor = uuidSchema.safeParse(actor.profileId)
  if (!parsedTicket.success || !parsedJob.success || !parsedActor.success) {
    return { ok: false, error: 'invalid_input' }
  }
  const persistedActor = await loadActiveActor(db, actor)
  if (!persistedActor?.shopId) return notFound()
  const seams = Object.freeze({
    beforeMutation: dependencies.beforeMutation,
    afterDiscovery: dependencies.afterDiscovery,
    afterWrite: dependencies.afterWrite,
    afterFinalization: dependencies.afterFinalization,
  })
  try {
    return await runBoundedShopOsMutationV1<QuoteDraftResult, CompleteQuoteDiscovery>(db, {
      discover: async (tx) => discoverCompleteQuoteMutation(tx, {
        shopId: persistedActor.shopId as string,
        actorProfileId: parsedActor.data,
        ticketId: parsedTicket.data,
        exactJobId: parsedJob.data,
        lockShop: true,
        includeAllQuoteVersionsForTickets: true,
        includeAllQuoteEventsForTickets: true,
      }),
      executeLocked: async (tx, scope, discovery) => {
        assertLiveLockedMutationScopeV1(tx, scope)
        const graph = resolveCompleteQuoteScope(
          tx, scope, discovery, parsedTicket.data, 'build',
        )
        const targetJob = graph.jobs.find(({ id }) => id === parsedJob.data)
        if (!targetJob || graph.ticket.status !== 'open' ||
          targetJob.workStatus === 'done' || targetJob.workStatus === 'canceled' ||
          isPinnedSimpleWork(targetJob)) throw new ShopOsMutationNotFound()
        if (!scope.shop) throw new ShopOsMutationNotFound()
        const activeVersions = graph.versions.filter(({ supersededAt }) => supersededAt === null)
        if (activeVersions.length > 1) throw new AbortDraftMutation(conflict())
        const context: DraftContext = {
          scope,
          shopId: scope.actor.shopId,
          ticketId: graph.ticket.id,
          jobId: targetJob.id,
          shopRateCents: scope.shop.laborRateCents,
          jobIds: graph.jobs.map(({ id }) => id),
          lineRows: graph.lines,
          activeVersions,
        }
        await seams.afterDiscovery?.()
        await seams.beforeMutation?.()
        const outcome = await mutate(tx, context)
        if (!outcome.result.ok || !outcome.result.changed) return outcome.result
        await seams.afterWrite?.()
        await finalizeMutationRevisionsV1(
          tx,
          scope,
          { sessionIds: [], customerIds: [], vehicleIds: [] },
          [{
            ticketId: graph.ticket.id,
            createdTicket: false,
            createdJobIds: [],
            existingChangedJobIds: [...new Set(outcome.changedJobIds)].sort(),
            actorVisibleTicketFieldsChanged: false,
          }],
        )
        await seams.afterFinalization?.()
        return outcome.result
      },
    })
  } catch (error) {
    if (error instanceof AbortDraftMutation) return error.failure
    if (error instanceof ShopOsMutationNotFound) return notFound()
    if (error instanceof ShopOsMutationConflict) return conflict(true)
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
    if (!desired) return {
      result: { ok: false, error: 'invalid_input' }, changedJobIds: [],
    }
    if (sameShopCollision) {
      if (
        sameShopCollision.jobId === context.jobId
        && isMutableManualLine(sameShopCollision)
        && sameLine(sameShopCollision, desired)
      ) {
        return {
          result: { ok: true, changed: false, line: safeManualDraftLine(sameShopCollision) },
          changedJobIds: [],
        }
      }
      return { result: conflict(), changedJobIds: [] }
    }
    const [line] = await tx.insert(jobLines).values({
      id: lineId,
      shopId: context.shopId,
      jobId: context.jobId,
      ...desired,
    }).returning()
    const invalidation = await invalidateActiveQuoteVersionDeltaV1(tx, {
      shopId: context.shopId,
      ticketId: context.ticketId,
      jobIds: context.jobIds,
      activeVersions: context.activeVersions,
      scope: context.scope,
    })
    if ('ok' in invalidation) throw new AbortDraftMutation(invalidation)
    return {
      result: { ok: true, changed: true, line: safeManualDraftLine(line) },
      changedJobIds: [context.jobId, ...invalidation.changedJobIds],
    }
  })
}

export async function replaceDraftLine(
  db: AppDb,
  input: { actor: QuoteActor; ticketId: unknown; jobId: unknown; lineId: unknown; body: unknown },
  dependencies: QuoteDraftDependencies = {},
): Promise<QuoteDraftResult> {
  const parsedLineId = uuidSchema.safeParse(input.lineId)
  if (!parsedLineId.success || !manualLineSchema.safeParse(input.body).success) {
    return { ok: false, error: 'invalid_input' }
  }
  return runMutation(db, input.actor, input.ticketId, input.jobId, dependencies, async (tx, context) => {
    const existing = context.lineRows.find((line) =>
      line.id === parsedLineId.data
      && line.jobId === context.jobId
      && isMutableManualLine(line),
    )
    if (!existing) return { result: notFound(), changedJobIds: [] }
    const desired = normalizedLine(input.body, context.shopRateCents, existing)
    if (!desired) return {
      result: { ok: false, error: 'invalid_input' }, changedJobIds: [],
    }
    if (sameLine(existing, desired)) {
      return {
        result: { ok: true, changed: false, line: safeManualDraftLine(existing) },
        changedJobIds: [],
      }
    }
    const [line] = await tx.update(jobLines).set({ ...desired, updatedAt: new Date() }).where(and(
      eq(jobLines.shopId, context.shopId),
      eq(jobLines.jobId, context.jobId),
      eq(jobLines.id, parsedLineId.data),
    )).returning()
    if (!line) throw new AbortDraftMutation(conflict(true))
    const invalidation = await invalidateActiveQuoteVersionDeltaV1(tx, {
      shopId: context.shopId,
      ticketId: context.ticketId,
      jobIds: context.jobIds,
      activeVersions: context.activeVersions,
      scope: context.scope,
    })
    if ('ok' in invalidation) throw new AbortDraftMutation(invalidation)
    return {
      result: { ok: true, changed: true, line: safeManualDraftLine(line) },
      changedJobIds: [context.jobId, ...invalidation.changedJobIds],
    }
  })
}

export async function deleteDraftLine(
  db: AppDb,
  input: { actor: QuoteActor; ticketId: unknown; jobId: unknown; lineId: unknown },
  dependencies: QuoteDraftDependencies = {},
): Promise<QuoteDraftResult> {
  const parsedLineId = uuidSchema.safeParse(input.lineId)
  if (!parsedLineId.success) return { ok: false, error: 'invalid_input' }
  return runMutation(db, input.actor, input.ticketId, input.jobId, dependencies, async (tx, context) => {
    const namedLine = context.lineRows.find((line) =>
      line.id === parsedLineId.data && line.jobId === context.jobId,
    )
    if (namedLine && !isMutableManualLine(namedLine)) {
      return { result: notFound(), changedJobIds: [] }
    }
    const existing = namedLine
    if (!existing) return {
      result: { ok: true, changed: false }, changedJobIds: [],
    }
    const [deleted] = await tx.delete(jobLines).where(and(
      eq(jobLines.shopId, context.shopId),
      eq(jobLines.jobId, context.jobId),
      eq(jobLines.id, parsedLineId.data),
    )).returning()
    if (!deleted) throw new AbortDraftMutation(conflict(true))
    const invalidation = await invalidateActiveQuoteVersionDeltaV1(tx, {
      shopId: context.shopId,
      ticketId: context.ticketId,
      jobIds: context.jobIds,
      activeVersions: context.activeVersions,
      scope: context.scope,
    })
    if ('ok' in invalidation) throw new AbortDraftMutation(invalidation)
    return {
      result: { ok: true, changed: true },
      changedJobIds: [context.jobId, ...invalidation.changedJobIds],
    }
  })
}
