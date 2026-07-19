import { z } from 'zod'
import {
  formatMoneyCents,
  parseMoneyToCents,
} from '@/lib/shop-os/quote-builder-ui'
import { formatScaledDecimal, parseScaledDecimal } from '@/lib/shop-os/quote-math'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'

const MAX_PART_QUANTITY_SCALED = 999_999_999_999n
const moneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const canonicalUuidSchema = z.uuid().refine((value) => value === value.toLowerCase())
const canonicalTimestampSchema = z.iso.datetime({ offset: true }).refine((value) => {
  try {
    return new Date(value).toISOString() === value
  } catch {
    return false
  }
})
const canonicalText = (maximum: number) => z.string()
  .min(1)
  .max(maximum)
  .refine((value) => value.trim() === value)
const nullableCanonicalText = (maximum: number) => canonicalText(maximum).nullable()

const manualVendorAccountSchema = z.strictObject({
  id: canonicalUuidSchema,
  displayName: canonicalText(120),
  mode: z.literal('manual'),
  enabled: z.literal(true),
  updatedAt: canonicalTimestampSchema,
})

export type SafeManualVendorAccount = z.infer<typeof manualVendorAccountSchema>

const enabledVendorAccountsResponseSchema = z.strictObject({
  vendorAccounts: z.array(manualVendorAccountSchema),
})

const createdVendorAccountResponseSchema = z.strictObject({
  changed: z.boolean(),
  vendorAccount: manualVendorAccountSchema,
})

const sourcedLineSchema = z.strictObject({
  id: canonicalUuidSchema,
  jobId: canonicalUuidSchema,
  kind: z.literal('part'),
  description: canonicalText(500),
  quantity: z.string().max(32),
  priceCents: moneySchema,
  taxable: z.boolean(),
  partNumber: nullableCanonicalText(200),
  brand: nullableCanonicalText(200),
  fitment: nullableCanonicalText(500),
  source: z.literal('vendor_offer'),
  mutable: z.literal(false),
}).superRefine((line, context) => {
  try {
    const quantity = parseScaledDecimal(line.quantity, 3)
    if (quantity === 0n
      || quantity > MAX_PART_QUANTITY_SCALED
      || formatScaledDecimal(quantity, 3) !== line.quantity) {
      context.addIssue({ code: 'custom', message: 'quantity is not canonical positive' })
    }
  } catch {
    context.addIssue({ code: 'custom', message: 'quantity is invalid' })
  }
})

export type SafeSourcedQuoteLine = z.infer<typeof sourcedLineSchema>

const sourcingSchema = z.strictObject({
  vendorAccountId: canonicalUuidSchema,
  displayName: canonicalText(200),
  externalOfferId: nullableCanonicalText(500),
  unitCostCents: moneySchema,
  coreChargeCents: moneySchema,
  availability: z.enum(['in_stock', 'special_order', 'unknown']),
  fulfillment: z.strictObject({
    method: z.enum(['pickup', 'delivery', 'ship', 'unknown']),
    locationLabel: nullableCanonicalText(500),
  }),
  fetchedAt: canonicalTimestampSchema,
})

const manualOfferLineResponseSchema = z.strictObject({
  changed: z.boolean(),
  line: sourcedLineSchema,
  sourcing: sourcingSchema,
})
const manualOfferUnavailableResponseSchema = z.strictObject({
  changed: z.literal(false),
  unavailable: z.literal(true),
})
const manualOfferRemovalResponseSchema = z.strictObject({ changed: z.boolean() })

export type ManualPartDraft = {
  vendorAccountId: string
  description: string
  quantity: string
  unitCost: string
  customerPrice: string
  taxable: boolean
  partNumber: string
  brand: string
  fitment: string
  externalOfferId: string
  coreCharge: string
  availability: 'in_stock' | 'special_order' | 'unknown'
  fulfillmentMethod: 'pickup' | 'delivery' | 'ship' | 'unknown'
  locationLabel: string
}

export type ManualOfferPayload = {
  clientKey: string
  vendorAccountId: string
  description: string
  partNumber: string | null
  brand: string | null
  quantity: string
  priceCents: number
  unitCostCents: number
  coreChargeCents: number
  taxable: boolean
  availability: 'in_stock' | 'special_order' | 'unknown'
  fitment: string | null
  fulfillment: {
    method: 'pickup' | 'delivery' | 'ship' | 'unknown'
    locationLabel: string | null
  }
  externalOfferId: string | null
}

const manualOfferPayloadSchema = z.strictObject({
  clientKey: z.uuid().transform((value) => value.toLowerCase()),
  vendorAccountId: z.uuid().transform((value) => value.toLowerCase()),
  description: canonicalText(500),
  partNumber: nullableCanonicalText(200),
  brand: nullableCanonicalText(200),
  quantity: z.string().max(32),
  priceCents: moneySchema,
  unitCostCents: moneySchema,
  coreChargeCents: moneySchema,
  taxable: z.boolean(),
  availability: z.enum(['in_stock', 'special_order', 'unknown']),
  fitment: nullableCanonicalText(500),
  fulfillment: z.strictObject({
    method: z.enum(['pickup', 'delivery', 'ship', 'unknown']),
    locationLabel: nullableCanonicalText(500),
  }),
  externalOfferId: nullableCanonicalText(500),
})

// Derives the complete customer line price from a supplier unit cost, the line
// quantity, and the shop's default markup (basis points; 4000 = 40%). The
// quote money summary treats a part line's priceCents as the extended line
// total (not per-unit), so the markup is applied to unit cost × quantity.
// Returns a plain dollar string (e.g. "280.00") that canonicalMoney round-trips,
// or null when the inputs are not yet a valid cost/quantity/markup — the caller
// then leaves the price blank and the normal cost/quantity validation fires.
export function deriveMarkupLinePrice(
  unitCost: string,
  quantity: string,
  markupBps: number,
): string | null {
  if (!Number.isInteger(markupBps) || markupBps < 0) return null
  let unitCostCents: number
  let scaledQuantity: bigint
  try {
    unitCostCents = parseMoneyToCents(unitCost.trim())
    scaledQuantity = parseScaledDecimal(quantity.trim(), 3)
  } catch {
    return null
  }
  if (scaledQuantity <= 0n) return null
  // quantity is scaled by 1000 (3 dp); markup is out of 10000. Round half-up in
  // integer space so the customer cent is exact — no floating point.
  const numerator = BigInt(unitCostCents) * scaledQuantity * BigInt(10_000 + markupBps)
  const denominator = 10_000_000n
  const derivedCents = Number((numerator + denominator / 2n) / denominator)
  if (!Number.isSafeInteger(derivedCents)) return null
  return formatMoneyCents(derivedCents).replace(/[$,]/g, '')
}

export function parseEnabledVendorAccountsResponse(value: unknown): SafeManualVendorAccount[] | null {
  const parsed = enabledVendorAccountsResponseSchema.safeParse(value)
  return parsed.success ? parsed.data.vendorAccounts : null
}

export function parseCreatedVendorAccountResponse(
  status: number,
  value: unknown,
): z.infer<typeof createdVendorAccountResponseSchema> | null {
  const parsed = createdVendorAccountResponseSchema.safeParse(value)
  if (!parsed.success) return null
  if (status === 201 && parsed.data.changed === true) return parsed.data
  if (status === 200 && parsed.data.changed === false) return parsed.data
  return null
}

export function parseManualOfferResponse(
  status: number,
  value: unknown,
): z.infer<typeof manualOfferLineResponseSchema>
  | z.infer<typeof manualOfferUnavailableResponseSchema>
  | null {
  const lineResult = manualOfferLineResponseSchema.safeParse(value)
  if (lineResult.success) {
    if (status === 201 && lineResult.data.changed === true) return lineResult.data
    if (status === 200 && lineResult.data.changed === false) return lineResult.data
    return null
  }
  const unavailableResult = manualOfferUnavailableResponseSchema.safeParse(value)
  return status === 200 && unavailableResult.success ? unavailableResult.data : null
}

export function parseManualOfferRemovalResponse(
  status: number,
  value: unknown,
): z.infer<typeof manualOfferRemovalResponseSchema> | null {
  if (status !== 200) return null
  const parsed = manualOfferRemovalResponseSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function canonicalQuantity(value: string): string {
  const quantity = parseScaledDecimal(value.trim(), 3)
  if (quantity === 0n || quantity > MAX_PART_QUANTITY_SCALED) {
    throw new RangeError('quantity must be positive and within the supported range')
  }
  return formatScaledDecimal(quantity, 3)
}

function canonicalMoney(value: string): number {
  return parseMoneyToCents(value.trim())
}

function optionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizedUuidOrRaw(value: string): string {
  const trimmed = value.trim()
  const parsed = z.uuid().safeParse(trimmed)
  return parsed.success ? parsed.data.toLowerCase() : trimmed
}

function normalizedQuantityOrRaw(value: string): string {
  const trimmed = value.trim()
  try {
    return canonicalQuantity(trimmed)
  } catch {
    return trimmed
  }
}

function normalizedMoneyOrRaw(value: string): string {
  const trimmed = value.trim()
  try {
    return canonicalMoney(trimmed).toString()
  } catch {
    return trimmed
  }
}

export function normalizedManualPartSignature(draft: ManualPartDraft): string {
  return JSON.stringify({
    vendorAccountId: normalizedUuidOrRaw(draft.vendorAccountId),
    description: draft.description.trim(),
    quantity: normalizedQuantityOrRaw(draft.quantity),
    unitCost: normalizedMoneyOrRaw(draft.unitCost),
    customerPrice: normalizedMoneyOrRaw(draft.customerPrice),
    taxable: draft.taxable,
    partNumber: draft.partNumber.trim(),
    brand: draft.brand.trim(),
    fitment: draft.fitment.trim(),
    externalOfferId: draft.externalOfferId.trim(),
    coreCharge: normalizedMoneyOrRaw(draft.coreCharge),
    availability: draft.availability,
    fulfillmentMethod: draft.fulfillmentMethod,
    locationLabel: draft.fulfillmentMethod === 'unknown' ? '' : draft.locationLabel.trim(),
  })
}

export function buildManualOfferPayload(
  draft: ManualPartDraft,
  clientKey: string,
): ManualOfferPayload {
  const method = draft.fulfillmentMethod
  const payload = {
    clientKey: clientKey.trim(),
    vendorAccountId: draft.vendorAccountId.trim(),
    description: draft.description.trim(),
    partNumber: optionalText(draft.partNumber),
    brand: optionalText(draft.brand),
    quantity: canonicalQuantity(draft.quantity),
    priceCents: canonicalMoney(draft.customerPrice),
    unitCostCents: canonicalMoney(draft.unitCost),
    coreChargeCents: canonicalMoney(draft.coreCharge),
    taxable: draft.taxable,
    availability: draft.availability,
    fitment: optionalText(draft.fitment),
    fulfillment: {
      method,
      locationLabel: method === 'unknown' ? null : optionalText(draft.locationLabel),
    },
    externalOfferId: optionalText(draft.externalOfferId),
  }
  const parsed = manualOfferPayloadSchema.safeParse(payload)
  if (!parsed.success) throw new TypeError('manual offer payload is invalid')
  return parsed.data
}

export function manualPartCommitLabel(draft: ManualPartDraft): string {
  const description = draft.description.trim()
  if (description.length === 0 || description.length > 500) return 'Add sourced part'
  try {
    const quantity = canonicalQuantity(draft.quantity)
    const priceCents = canonicalMoney(draft.customerPrice)
    return `Add ${quantity} ${description} · Customer price ${formatMoneyCents(priceCents)}`
  } catch {
    return 'Add sourced part'
  }
}

type QuoteBuilderJob = Extract<QuoteBuilderResult, { ok: true }>['builder']['jobs'][number]

export function selectLockedDiagnosisSeed(
  jobs: QuoteBuilderJob[],
): { description: string } | null {
  const eligible = jobs.filter((job) => (
    job.kind === 'diagnostic'
    && job.storyMode === 'ordinary_locked_tree'
    && job.story.reviewStatus === 'reviewed'
    && job.story.content !== null
    && job.story.content.whatWeRecommend.trim().length > 0
  ))
  if (eligible.length !== 1) return null
  return { description: eligible[0].story.content!.whatWeRecommend }
}
