import { z } from 'zod'
import { formatScaledDecimal, parseScaledDecimal } from '@/lib/shop-os/quote-math'

const MAX_PART_QUANTITY_SCALED = 999_999_999_999n
const moneySchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional()
const requiredNullableText = (max: number) => z.string().trim().min(1).max(max).nullable()

const searchInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(500),
  quantity: z.string().max(32),
})

const manualOfferInputSchema = z.strictObject({
  description: z.string().trim().min(1).max(500),
  partNumber: optionalText(200),
  brand: optionalText(200),
  quantity: z.string().max(32),
  unitCostCents: moneySchema,
  coreChargeCents: moneySchema,
  availability: z.enum(['in_stock', 'special_order', 'unavailable', 'unknown']),
  fitment: optionalText(500),
  fulfillment: z.strictObject({
    method: z.enum(['pickup', 'delivery', 'ship', 'unknown']),
    locationLabel: optionalText(500),
  }),
  externalOfferId: optionalText(500),
  verifyingProfileId: z.uuid().transform((value) => value.toLowerCase()),
})

const manualOfferSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal('manual_offer'),
  vendorAccountId: z.uuid().transform((value) => value.toLowerCase()),
  vendorDisplayName: z.string().trim().min(1).max(200),
  externalOfferId: requiredNullableText(500),
  currency: z.literal('USD'),
  quantity: z.string().max(32),
  unitCostCents: moneySchema,
  coreChargeCents: moneySchema,
  availability: z.enum(['in_stock', 'special_order', 'unknown']),
  fitment: requiredNullableText(500),
  fulfillment: z.strictObject({
    method: z.enum(['pickup', 'delivery', 'ship', 'unknown']),
    locationLabel: requiredNullableText(500),
  }),
  fetchedAt: z.iso.datetime({ offset: true }),
  verifiedByProfileId: z.uuid().transform((value) => value.toLowerCase()),
  requestFingerprint: z.string().regex(/^[0-9a-f]{64}$/),
})

export type PartsSearchInput = z.input<typeof searchInputSchema>
export type ManualOfferInput = z.input<typeof manualOfferInputSchema>
export type ManualOfferSnapshotV1 = z.output<typeof manualOfferSnapshotSchema>

export type NormalizedPartOffer = {
  description: string
  partNumber: string | null
  brand: string | null
  quantity: string
  unitCostCents: number
  coreChargeCents: number
  availability: 'in_stock' | 'special_order' | 'unknown'
  fitment: string | null
  fulfillment: {
    method: 'pickup' | 'delivery' | 'ship' | 'unknown'
    locationLabel: string | null
  }
  externalOfferId: string | null
  currency: 'USD'
  fetchedAt: string
  verifiedByProfileId: string
}

export type PartsSearchResult =
  | { kind: 'offers'; offers: NormalizedPartOffer[] }
  | { kind: 'manual_entry_required' }

export type RefreshOfferResult =
  | { kind: 'available'; offer: NormalizedPartOffer }
  | { kind: 'unavailable' }

export interface PartsAdapter {
  searchParts(input: PartsSearchInput): Promise<PartsSearchResult>
  refreshOffer(input: ManualOfferInput): Promise<RefreshOfferResult>
}

export function parseManualOfferSnapshot(value: unknown): ManualOfferSnapshotV1 | null {
  let encoded: string
  try {
    encoded = JSON.stringify(value)
  } catch {
    return null
  }
  if (Buffer.byteLength(encoded, 'utf8') > 4_096) return null
  const parsed = manualOfferSnapshotSchema.safeParse(value)
  if (!parsed.success) return null
  try {
    const quantity = normalizedQuantity(parsed.data.quantity, 'invalid_manual_offer')
    if (quantity !== parsed.data.quantity) return null
  } catch {
    return null
  }
  return parsed.data
}

export function validateStoredManualOfferLine(line: {
  kind: unknown
  source: unknown
  partStatus: unknown
  vendorAccountId: unknown
  externalOfferId: unknown
  vendorSnapshot: unknown
  quantity: unknown
  unitCostCents: unknown
  coreChargeCents: unknown
  fitment: unknown
  laborHours: unknown
  laborRateCents: unknown
  orderedAt: unknown
  orderedByProfileId: unknown
  receivedAt: unknown
  receivedByProfileId: unknown
}): ManualOfferSnapshotV1 | null {
  const snapshot = parseManualOfferSnapshot(line.vendorSnapshot)
  let quantity: string
  try {
    quantity = normalizedQuantity(String(line.quantity), 'invalid_manual_offer')
  } catch {
    return null
  }
  if (
    line.kind !== 'part'
    || line.source !== 'vendor_offer'
    || line.partStatus !== 'proposed'
    || typeof line.vendorAccountId !== 'string'
    || !snapshot
    || snapshot.vendorAccountId !== line.vendorAccountId
    || snapshot.externalOfferId !== line.externalOfferId
    || snapshot.quantity !== quantity
    || snapshot.unitCostCents !== line.unitCostCents
    || snapshot.coreChargeCents !== line.coreChargeCents
    || snapshot.fitment !== line.fitment
    || line.laborHours !== null
    || line.laborRateCents !== null
    || line.orderedAt !== null
    || line.orderedByProfileId !== null
    || line.receivedAt !== null
    || line.receivedByProfileId !== null
  ) return null
  return snapshot
}

function normalizedQuantity(value: string, error: string): string {
  try {
    const scaled = parseScaledDecimal(value, 3)
    if (scaled <= 0n || scaled > MAX_PART_QUANTITY_SCALED) throw new RangeError(error)
    return formatScaledDecimal(scaled, 3)
  } catch {
    throw new TypeError(error)
  }
}

export class ManualPartsAdapter implements PartsAdapter {
  constructor(private readonly dependencies: { now: () => Date } = { now: () => new Date() }) {}

  async searchParts(input: PartsSearchInput): Promise<PartsSearchResult> {
    const parsed = searchInputSchema.safeParse(input)
    if (!parsed.success) throw new TypeError('invalid_parts_search')
    normalizedQuantity(parsed.data.quantity, 'invalid_parts_search')
    return { kind: 'manual_entry_required' }
  }

  async refreshOffer(input: ManualOfferInput): Promise<RefreshOfferResult> {
    const parsed = manualOfferInputSchema.safeParse(input)
    if (!parsed.success) throw new TypeError('invalid_manual_offer')
    const quantity = normalizedQuantity(parsed.data.quantity, 'invalid_manual_offer')
    if (parsed.data.availability === 'unavailable') return { kind: 'unavailable' }

    const fetchedAt = this.dependencies.now()
    if (!Number.isFinite(fetchedAt.getTime())) throw new TypeError('invalid_manual_offer')
    return {
      kind: 'available',
      offer: {
        description: parsed.data.description,
        partNumber: parsed.data.partNumber ?? null,
        brand: parsed.data.brand ?? null,
        quantity,
        unitCostCents: parsed.data.unitCostCents,
        coreChargeCents: parsed.data.coreChargeCents,
        availability: parsed.data.availability,
        fitment: parsed.data.fitment ?? null,
        fulfillment: {
          method: parsed.data.fulfillment.method,
          locationLabel: parsed.data.fulfillment.locationLabel ?? null,
        },
        externalOfferId: parsed.data.externalOfferId ?? null,
        currency: 'USD',
        fetchedAt: fetchedAt.toISOString(),
        verifiedByProfileId: parsed.data.verifyingProfileId,
      },
    }
  }
}
