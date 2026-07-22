import { z } from 'zod'
import { formatMoneyCents, parseMoneyToCents } from '@/lib/shop-os/quote-builder-ui'

export { formatMoneyCents }

const uuid = z.string().uuid()
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const sort = z.number().int().min(0).max(1_000_000)
const canonicalText = (maximum: number) => z.string().min(1).max(maximum).refine(
  (value) => value === value.trim(),
  { message: 'text must be trimmed' },
)
const decimal = (scale: number, maximum: string) => z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d*[1-9])?$/).superRefine((value, context) => {
  const [whole, fraction = ''] = value.split('.')
  if (fraction.length > scale || BigInt(whole + fraction.padEnd(scale, '0')) <= 0n || BigInt(whole + fraction.padEnd(scale, '0')) > BigInt(maximum)) {
    context.addIssue({ code: 'custom', message: 'decimal is out of range' })
  }
})
const common = { description: canonicalText(500), sort, priceCents: money, taxable: z.boolean() }
const line = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('part'), ...common, quantity: decimal(3, '999999999999'), partNumber: canonicalText(200).optional(), brand: canonicalText(200).optional() }),
  z.strictObject({ kind: z.literal('labor'), ...common, hours: decimal(2, '99999999'), laborRateCents: money.optional() }),
  z.strictObject({ kind: z.literal('fee'), ...common }),
])
export const cannedJobProjectionSchema = z.strictObject({
  id: uuid,
  title: canonicalText(200),
  kind: z.enum(['diagnostic', 'repair', 'maintenance']),
  defaultRequiredSkillTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  sort,
  lines: z.array(line).min(1).max(25),
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  summary: z.strictObject({ subtotalCents: money, taxableSubtotalCents: money, taxCents: money.nullable(), totalCents: money.nullable() }),
})

export type CannedJobProjection = z.infer<typeof cannedJob>
export type CannedJobLineProjection = z.infer<typeof line>
export type CannedJobDraftLine = {
  key: string
  kind: 'part' | 'labor' | 'fee'
  description: string
  sort: string
  price: string
  taxable: boolean
  quantity: string
  partNumber: string
  brand: string
  hours: string
  laborRate: string
}
export type CannedJobDraft = {
  title: string
  kind: 'diagnostic' | 'repair' | 'maintenance'
  tier: string
  sort: string
  lines: CannedJobDraftLine[]
}

const cannedJob = cannedJobProjectionSchema
const listEnvelope = z.strictObject({ cannedJobs: z.array(cannedJob).max(1_000), taxRateBps: z.number().int().min(0).max(10_000).nullable() })
const mutationEnvelope = z.strictObject({ changed: z.boolean(), cannedJob })
const appliedEnvelope = z.strictObject({
  changed: z.boolean(),
  job: z.strictObject({
    id: uuid, title: canonicalText(200), kind: z.enum(['diagnostic', 'repair', 'maintenance']),
    requiredSkillTier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    lineCount: z.number().int().min(1).max(25),
  }),
})
const jobLimitFailureEnvelope = z.strictObject({ error: z.literal('job_limit_reached') })

export type SafeCannedJobListResponse = z.infer<typeof listEnvelope>
export type SafeCannedJobTemplate = z.infer<typeof cannedJobProjectionSchema>
export type SafeAppliedCannedJobResponse = z.infer<typeof appliedEnvelope>

export function parseCannedJobListResponse(value: unknown) {
  const parsed = listEnvelope.safeParse(value)
  if (
    !parsed.success
    || new Set(parsed.data.cannedJobs.map((job) => job.id)).size !== parsed.data.cannedJobs.length
    || parsed.data.cannedJobs.some((job) => !validJobTruth(job, parsed.data.taxRateBps))
  ) return null
  return parsed.data
}

export function parseManagementCannedJobMutationResponse(value: unknown) {
  const parsed = mutationEnvelope.safeParse(value)
  return parsed.success && validJobTruth(parsed.data.cannedJob) ? parsed.data : null
}

export function parseCannedJobMutationResponse(status: number, value: unknown) {
  const parsed = mutationEnvelope.safeParse(value)
  if (!parsed.success || !validJobTruth(parsed.data.cannedJob) || (status === 201 ? !parsed.data.changed : status === 200 ? parsed.data.changed : true)) return null
  return parsed.data
}

export function parseAppliedCannedJobResponse(status: number, value: unknown) {
  const parsed = appliedEnvelope.safeParse(value)
  if (!parsed.success || (status === 201 ? !parsed.data.changed : status === 200 ? parsed.data.changed : true)) return null
  return parsed.data
}

/** A terminal ticket capacity response is not stale quote state. */
export function isJobLimitReachedFailure(status: number, value: unknown): boolean {
  return status === 409 && jobLimitFailureEnvelope.safeParse(value).success
}

/** @deprecated Prefer parseCannedJobListResponse. */
export const parseCannedJobList = parseCannedJobListResponse
/** @deprecated Management PUT/DELETE currently return status 200 for either changed value. */
export const parseCannedJobMutation = parseManagementCannedJobMutationResponse

function validJobTruth(job: CannedJobProjection, taxRateBps?: number | null) {
  if (job.kind === 'diagnostic'
    && (!job.lines.some((item) => item.kind === 'labor')
      || job.lines.some((item) => item.kind === 'part'))) return false
  let subtotal = 0n
  let taxable = 0n
  let previousSort = -1
  for (const item of job.lines) {
    if (item.sort < previousSort) return false
    previousSort = item.sort
    subtotal += BigInt(item.priceCents)
    if (item.taxable) taxable += BigInt(item.priceCents)
  }
  if (
    subtotal > BigInt(Number.MAX_SAFE_INTEGER)
    || taxable > BigInt(Number.MAX_SAFE_INTEGER)
    || subtotal + taxable > BigInt(Number.MAX_SAFE_INTEGER)
    || job.summary.subtotalCents !== Number(subtotal)
    || job.summary.taxableSubtotalCents !== Number(taxable)
  ) return false

  const { taxCents, totalCents } = job.summary
  if (taxRateBps === null) return taxCents === null && totalCents === null
  if (taxCents === null || totalCents === null || subtotal + BigInt(taxCents) > BigInt(Number.MAX_SAFE_INTEGER)) return false
  if (totalCents !== Number(subtotal) + taxCents) return false
  if (taxRateBps === undefined) return true
  const expectedTax = Number((taxable * BigInt(taxRateBps) + 5_000n) / 10_000n)
  return taxCents === expectedTax
}

export function newCannedLine(kind: CannedJobDraftLine['kind'] = 'part'): CannedJobDraftLine {
  return { key: crypto.randomUUID(), kind, description: '', sort: '0', price: '', taxable: true, quantity: '1', partNumber: '', brand: '', hours: '1', laborRate: '' }
}

export function newCannedJobDraft(): CannedJobDraft {
  return { title: '', kind: 'repair', tier: '1', sort: '0', lines: [newCannedLine()] }
}

export function cannedJobToDraft(job: CannedJobProjection): CannedJobDraft {
  return {
    title: job.title, kind: job.kind, tier: String(job.defaultRequiredSkillTier), sort: String(job.sort),
    lines: job.lines.map((item) => ({
      key: crypto.randomUUID(), kind: item.kind, description: item.description, sort: String(item.sort),
      price: formatMoneyCents(item.priceCents).slice(1).replace(/,/g, ''), taxable: item.taxable,
      quantity: item.kind === 'part' ? item.quantity : '1',
      partNumber: item.kind === 'part' ? item.partNumber ?? '' : '', brand: item.kind === 'part' ? item.brand ?? '' : '',
      hours: item.kind === 'labor' ? item.hours : '1',
      laborRate: item.kind === 'labor' && item.laborRateCents !== undefined ? formatMoneyCents(item.laborRateCents).slice(1).replace(/,/g, '') : '',
    })),
  }
}

export function normalizeCannedJobDraft(draft: CannedJobDraft) {
  const tier = Number(draft.tier)
  const templateSort = Number(draft.sort)
  if (!Number.isInteger(tier) || tier < 1 || tier > 3 || !Number.isInteger(templateSort) || templateSort < 0 || templateSort > 1_000_000) throw new RangeError('Check the tier and library order.')
  if (draft.lines.length < 1 || draft.lines.length > 25) throw new RangeError('Use 1–25 lines.')
  const lines = draft.lines.map((item) => {
    const base = { kind: item.kind, description: item.description.trim(), sort: Number(item.sort), priceCents: parseMoneyToCents(item.price), taxable: item.taxable }
    if (!base.description || base.description.length > 500 || !Number.isInteger(base.sort) || base.sort < 0 || base.sort > 1_000_000) throw new RangeError('Check each line description and order.')
    if (item.kind === 'part') return { ...base, kind: 'part' as const, quantity: canonicalDecimal(item.quantity, 3, 999_999_999_999n), ...(item.partNumber.trim() ? { partNumber: bounded(item.partNumber, 200) } : {}), ...(item.brand.trim() ? { brand: bounded(item.brand, 200) } : {}) }
    if (item.kind === 'labor') return { ...base, kind: 'labor' as const, hours: canonicalDecimal(item.hours, 2, 99_999_999n), ...(item.laborRate.trim() ? { laborRateCents: parseMoneyToCents(item.laborRate) } : {}) }
    return { ...base, kind: 'fee' as const }
  })
  if (draft.kind === 'diagnostic'
    && (!lines.some((item) => item.kind === 'labor')
      || lines.some((item) => item.kind === 'part'))) {
    throw new RangeError('Diagnostic templates require labor and cannot include parts.')
  }
  return { title: bounded(draft.title, 200), kind: draft.kind, defaultRequiredSkillTier: tier as 1 | 2 | 3, sort: templateSort, lines }
}

function bounded(value: string, maximum: number) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > maximum) throw new RangeError('Check the text fields.')
  return trimmed
}

function canonicalDecimal(value: string, scale: number, maximum: bigint) {
  const match = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(value)
  if (!match || (match[1]?.length ?? 0) > scale) throw new RangeError('Check quantity and hours.')
  const [whole, fraction = ''] = value.split('.')
  const scaled = BigInt(whole) * (10n ** BigInt(scale)) + BigInt(fraction.padEnd(scale, '0') || '0')
  if (scaled <= 0n || scaled > maximum) throw new RangeError('Check quantity and hours.')
  const normalizedFraction = fraction.replace(/0+$/, '')
  return normalizedFraction ? `${BigInt(whole)}.${normalizedFraction}` : BigInt(whole).toString()
}

export function normalizedCannedJobSignature(draft: CannedJobDraft) {
  return JSON.stringify(normalizeCannedJobDraft(draft))
}

export function classifyCannedJobFailure(status: number) {
  if (status === 401) return 'Sign in again, then retry.'
  if (status === 402) return 'An active subscription is required.'
  if (status === 403 || status === 404) return 'This canned job is no longer available.'
  if (status === 409) return 'The library changed. Refresh before trying again.'
  if (status === 422) return 'Check every field and try again.'
  return 'Could not update the library. Try again.'
}
