import {
  calculateLaborPriceCents,
  calculateTicketTotals,
  formatScaledDecimal,
  parseScaledDecimal,
} from '@/lib/shop-os/quote-math'
import { z } from 'zod'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER)
type QuoteBuilderProjection = Extract<QuoteBuilderResult, { ok: true }>['builder']

const safeMoneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const uuidSchema = z.uuid().transform((value) => value.toLowerCase())
const nullableText = (max: number) => z.string().max(max).nullable()
const storyEvidenceSchema = z.strictObject({
  claim: z.string().max(2_000),
  sourceEventIds: z.array(z.string().max(200)).max(100),
  sourceArtifactIds: z.array(z.string().max(200)).max(100),
})
const customerStorySchema = z.strictObject({
  whatYouToldUs: z.string().max(5_000),
  whatWeFound: z.string().max(5_000),
  howWeKnow: z.array(storyEvidenceSchema).max(50),
  whatItMeansIfWaived: z.string().max(5_000),
  whatWeRecommend: z.string().max(5_000),
})
const builderLineSchema = z.strictObject({
  id: uuidSchema,
  kind: z.enum(['part', 'labor', 'fee']),
  description: z.string().min(1).max(500),
  sort: z.number().int().min(0).max(1_000_000),
  quantity: z.string().max(32).regex(/^\d+(?:\.\d{1,3})?$/),
  priceCents: safeMoneySchema,
  taxable: z.boolean(),
  partNumber: nullableText(200),
  brand: nullableText(200),
  coreChargeCents: safeMoneySchema.nullable(),
  fitment: nullableText(500),
  laborHours: z.string().max(32).regex(/^\d+(?:\.\d{1,2})?$/).nullable(),
  laborRateCents: safeMoneySchema.nullable(),
}).superRefine((line, context) => {
  try {
    const quantity = parseScaledDecimal(line.quantity, 3)
    if (formatScaledDecimal(quantity, 3) !== line.quantity
      || quantity === 0n
      || (line.kind === 'part' && quantity > 999_999_999_999n)) {
      context.addIssue({ code: 'custom', message: 'quantity is not canonical positive' })
    }
    if (line.laborHours !== null) {
      const hours = parseScaledDecimal(line.laborHours, 2)
      if (formatScaledDecimal(hours, 2) !== line.laborHours
        || hours === 0n || hours > 99_999_999n) {
        context.addIssue({ code: 'custom', message: 'hours are not canonical positive' })
      }
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'scaled decimal is invalid' })
  }
  if (line.kind === 'part' && (line.laborHours !== null || line.laborRateCents !== null)) {
    context.addIssue({ code: 'custom', message: 'part labor fields must be null' })
  }
  if (line.kind === 'labor' && (
    line.laborHours === null || line.partNumber !== null || line.brand !== null
    || line.coreChargeCents !== null || line.fitment !== null || line.quantity !== '1'
  )) context.addIssue({ code: 'custom', message: 'labor fields are invalid' })
  if (line.kind === 'fee' && (
    line.partNumber !== null || line.brand !== null || line.coreChargeCents !== null
    || line.fitment !== null || line.laborHours !== null || line.laborRateCents !== null
    || line.quantity !== '1'
  )) context.addIssue({ code: 'custom', message: 'fee fields are invalid' })
})

const quoteBuilderSchema = z.strictObject({
  ticket: z.strictObject({
    id: uuidSchema, status: z.literal('open'), reconciled: z.boolean(),
  }),
  configuration: z.strictObject({
    laborRateCents: safeMoneySchema.nullable(),
    taxRateBps: z.number().int().min(0).max(10_000).nullable(),
    laborRateConfigured: z.boolean(),
    taxRateConfigured: z.boolean(),
  }).superRefine((configuration, context) => {
    if (configuration.laborRateConfigured !== (configuration.laborRateCents !== null)) {
      context.addIssue({ code: 'custom', message: 'labor configuration is inconsistent' })
    }
    if (configuration.taxRateConfigured !== (configuration.taxRateBps !== null)) {
      context.addIssue({ code: 'custom', message: 'tax configuration is inconsistent' })
    }
  }),
  jobs: z.array(z.strictObject({
    id: uuidSchema,
    title: z.string().min(1).max(500),
    kind: z.enum(['diagnostic', 'repair', 'maintenance']),
    workStatus: z.enum(['open', 'in_progress', 'blocked']),
    story: z.strictObject({
      content: customerStorySchema.nullable(),
      source: z.enum(['ai', 'manual', 'template']).nullable(),
      reviewStatus: z.enum(['pending', 'reviewed']).nullable(),
      revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    }).superRefine((story, context) => {
      if ((story.content === null) !== (story.source === null)) {
        context.addIssue({ code: 'custom', message: 'story content and source are inconsistent' })
      }
      if (story.source === null && (story.reviewStatus !== null || story.revision !== 0)) {
        context.addIssue({ code: 'custom', message: 'empty story metadata is inconsistent' })
      }
      if (story.source === 'ai' && story.reviewStatus === null) {
        context.addIssue({ code: 'custom', message: 'AI story review state is required' })
      }
    }),
    approval: z.strictObject({
      state: z.enum(['pending_quote', 'quote_ready', 'sent', 'approved', 'declined']),
      quoteVersionId: uuidSchema.nullable(),
    }).superRefine((approval, context) => {
      if ((approval.state === 'approved') !== (approval.quoteVersionId !== null)) {
        context.addIssue({ code: 'custom', message: 'approval version is inconsistent' })
      }
    }),
    lines: z.array(builderLineSchema).max(2_000),
  })).max(500),
  capabilities: z.strictObject({ canRecordCustomerApproval: z.boolean() }),
  activeVersion: z.strictObject({
    id: uuidSchema,
    versionNumber: z.number().int().min(1).max(2_147_483_647),
    totalCents: safeMoneySchema,
    jobs: z.array(z.strictObject({
      jobId: uuidSchema,
      subtotalCents: safeMoneySchema,
    })).min(1).max(500),
  }).nullable(),
}).superRefine((builder, context) => {
  const jobIds = builder.jobs.map((job) => job.id)
  if (new Set(jobIds).size !== jobIds.length) {
    context.addIssue({ code: 'custom', message: 'duplicate job IDs' })
  }
  const lineIds = builder.jobs.flatMap((job) => job.lines.map((line) => line.id))
  if (new Set(lineIds).size !== lineIds.length) {
    context.addIssue({ code: 'custom', message: 'duplicate line IDs' })
  }
  if (builder.activeVersion) {
    const versionJobIds = builder.activeVersion.jobs.map((job) => job.jobId)
    if (new Set(versionJobIds).size !== versionJobIds.length
      || versionJobIds.some((jobId) => !jobIds.includes(jobId))) {
      context.addIssue({ code: 'custom', message: 'active version job projection is invalid' })
    }
    const subtotal = builder.activeVersion.jobs.reduce((sum, job) => sum + BigInt(job.subtotalCents), 0n)
    if (subtotal > BigInt(builder.activeVersion.totalCents)) {
      context.addIssue({ code: 'custom', message: 'active version total is invalid' })
    }
  }
})

export function parseQuoteBuilderProjection(value: unknown): QuoteBuilderProjection | null {
  const parsed = quoteBuilderSchema.safeParse(value)
  return parsed.success ? parsed.data as QuoteBuilderProjection : null
}

const preparedVersionResponseSchema = z.strictObject({
  changed: z.boolean(),
  version: z.strictObject({
    id: uuidSchema,
    versionNumber: z.number().int().min(1).max(2_147_483_647),
  }),
})

export function parsePreparedVersionResponse(
  status: number,
  value: unknown,
): { changed: boolean; version: { id: string; versionNumber: number } } | null {
  const parsed = preparedVersionResponseSchema.safeParse(value)
  if (!parsed.success) return null
  if (status === 201 && parsed.data.changed !== true) return null
  if (status === 200 && parsed.data.changed !== false) return null
  if (status !== 200 && status !== 201) return null
  return parsed.data
}

const quoteDecisionResponseSchema = z.strictObject({
  changed: z.boolean(),
  event: z.strictObject({
    id: uuidSchema,
    kind: z.enum(['approved', 'declined']),
    quoteVersionId: uuidSchema,
    jobId: uuidSchema,
    approvedVia: z.enum(['phone', 'in_person']).nullable(),
  }).superRefine((event, context) => {
    if ((event.kind === 'approved') !== (event.approvedVia !== null)) {
      context.addIssue({ code: 'custom', message: 'decision channel is inconsistent' })
    }
  }),
  projection: z.strictObject({
    approvalState: z.enum(['pending_quote', 'quote_ready', 'sent', 'approved', 'declined']),
    approvedQuoteVersionId: uuidSchema.nullable(),
  }).superRefine((projection, context) => {
    if ((projection.approvalState === 'approved') !== (projection.approvedQuoteVersionId !== null)) {
      context.addIssue({ code: 'custom', message: 'decision projection is inconsistent' })
    }
  }),
})

export function parseQuoteDecisionResponse(
  status: number,
  value: unknown,
): z.infer<typeof quoteDecisionResponseSchema> | null {
  const parsed = quoteDecisionResponseSchema.safeParse(value)
  if (!parsed.success) return null
  if (status === 201 && parsed.data.changed !== true) return null
  if (status === 200 && parsed.data.changed !== false) return null
  if (status !== 200 && status !== 201) return null
  if (parsed.data.event.kind === 'approved'
    && parsed.data.projection.approvedQuoteVersionId !== parsed.data.event.quoteVersionId) return null
  return parsed.data
}

export function parseMoneyToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value)
  if (!match) throw new RangeError('money must be a nonnegative plain decimal')

  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')
  if (cents > MAX_SAFE_CENTS) throw new RangeError('money exceeds the safe-integer range')
  return Number(cents)
}

export function formatMoneyCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError('money must be a nonnegative safe integer')
  }
  const value = BigInt(cents)
  const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = (value % 100n).toString().padStart(2, '0')
  return `$${whole}.${fraction}`
}

export type QuoteMoneySummary =
  | {
    ok: true
    subtotalCents: number
    taxableSubtotalCents: number
    taxCents: number
    totalCents: number
    taxConfigured: true
  }
  | {
    ok: true
    subtotalCents: number
    taxableSubtotalCents: number
    taxCents: null
    totalCents: null
    taxConfigured: false
  }
  | { ok: false }

export type QuotePreparationState =
  | { kind: 'prepared'; version: { id: string; versionNumber: number } }
  | { kind: 'ready'; reasons: [] }
  | { kind: 'blocked'; reasons: string[] }

export function getQuotePreparationState(input: {
  builder: QuoteBuilderProjection
  totals: QuoteMoneySummary
  editorOpen: boolean
  modalOpen: boolean
  busy: boolean
}): QuotePreparationState {
  if (input.builder.activeVersion) {
    return { kind: 'prepared', version: input.builder.activeVersion }
  }
  const reasons: string[] = []
  if (!input.builder.ticket.reconciled) reasons.push('Add customer and vehicle.')
  if (input.builder.configuration.taxRateBps === null) reasons.push('Configure a tax rate.')
  if (!input.builder.jobs.some((job) => job.lines.length > 0)) {
    reasons.push('Add at least one quote line.')
  }
  if (!input.totals.ok) reasons.push('Review stored quote amounts.')
  if (input.editorOpen) reasons.push('Finish or cancel the open line editor.')
  if (input.modalOpen) reasons.push('Finish the open confirmation.')
  if (input.busy) reasons.push('Wait for the current quote update.')
  return reasons.length === 0 ? { kind: 'ready', reasons: [] } : { kind: 'blocked', reasons }
}

export function summarizeQuoteMoney(
  lines: readonly { priceCents: number; taxable: boolean }[],
  taxRateBps: number | null,
): QuoteMoneySummary {
  try {
    const totals = calculateTicketTotals(
      lines.map((line) => ({
        extendedCents: line.priceCents,
        taxable: line.taxable,
      })),
      taxRateBps ?? 0,
    )
    const known = {
      ok: true as const,
      subtotalCents: totals.subtotalCents,
      taxableSubtotalCents: totals.taxableSubtotalCents,
    }
    return taxRateBps === null
      ? { ...known, taxCents: null, totalCents: null, taxConfigured: false }
      : {
        ...known,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        taxConfigured: true,
      }
  } catch {
    return { ok: false }
  }
}

export type ManualLineKind = 'part' | 'labor' | 'fee'
export type ManualLineFormValues = {
  description: string
  quantity: string
  hours: string
  price: string
  taxable: boolean
  partNumber: string
  brand: string
  fitment: string
}

export function buildManualLineInput(
  kind: ManualLineKind,
  values: ManualLineFormValues,
  shopLaborRateCents: number | null,
): Record<string, unknown> {
  const description = values.description.trim()
  if (!description || description.length > 500) throw new RangeError('description is required')
  const common = { kind, description, sort: 0, taxable: values.taxable }

  if (kind === 'part') {
    const scaled = parseScaledDecimal(values.quantity, 3)
    if (scaled === 0n || scaled > 999_999_999_999n) throw new RangeError('quantity is invalid')
    return {
      ...common,
      quantity: formatScaledDecimal(scaled, 3),
      priceCents: parseMoneyToCents(values.price),
      ...optionalText('partNumber', values.partNumber, 200),
      ...optionalText('brand', values.brand, 200),
      ...optionalText('fitment', values.fitment, 500),
    }
  }

  if (kind === 'labor') {
    const hours = parseScaledDecimal(values.hours, 2)
    if (hours === 0n || hours > 99_999_999n) throw new RangeError('labor hours are invalid')
    const priceCents = shopLaborRateCents === null
      ? parseMoneyToCents(values.price)
      : calculateLaborPriceCents(hours, shopLaborRateCents)
    return {
      ...common,
      laborHours: formatScaledDecimal(hours, 2),
      laborRateCents: shopLaborRateCents,
      priceCents,
    }
  }

  return { ...common, priceCents: parseMoneyToCents(values.price) }
}

function optionalText(key: string, raw: string, max: number): Record<string, string> {
  const value = raw.trim()
  if (value.length > max) throw new RangeError(`${key} is too long`)
  return value ? { [key]: value } : {}
}

export type QuoteFailureAction =
  | { kind: 'navigate'; href: string }
  | { kind: 'error'; message: string; refresh: boolean }

export function classifyQuoteFailure(
  status: number,
  body: unknown,
  quotePath: string,
): QuoteFailureAction {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  if (status === 401) {
    return { kind: 'navigate', href: `/sign-in?next=${encodeURIComponent(quotePath)}` }
  }
  if (status === 403) {
    return { kind: 'navigate', href: record.error === 'deactivated' ? '/deactivated' : '/subscribe' }
  }
  if (status === 404) {
    return { kind: 'navigate', href: quotePath.replace(/\/quote$/, '') }
  }
  if (status === 409 && record.retryable === true) {
    return { kind: 'error', message: 'Quote is busy. Refresh and retry.', refresh: true }
  }
  return {
    kind: 'error',
    message: 'Review the visible fields, then refresh and retry.',
    refresh: false,
  }
}
