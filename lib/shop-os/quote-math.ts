const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER)

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export type QuoteLineKind = 'part' | 'labor' | 'fee'
export type QuoteLineSource = 'manual' | 'vendor_offer' | 'diagnosis_seed' | 'guide'

export interface QuoteStoryMetaV1 {
  source: 'ai' | 'manual' | 'template'
  sessionId?: string
}

export interface QuoteSnapshotLineV1 {
  id: string
  kind: QuoteLineKind
  description: string
  quantity: string
  priceCents: number
  taxable: boolean
  partNumber: string | null
  brand: string | null
  coreChargeCents: number | null
  fitment: string | null
  laborHours: string | null
  laborRateCents: number | null
  source: QuoteLineSource
  vendorContext: null
}

export interface QuoteSnapshotAttachmentRefV1 {
  id: string
  jobId: string
  kind: 'photo' | 'video' | 'document'
}

export interface QuoteSnapshotJobV1 {
  id: string
  title: string
  kind: 'diagnostic' | 'repair' | 'maintenance'
  customerStory: QuoteCustomerStoryV1 | null
  storyMeta: QuoteStoryMetaV1 | null
  lines: QuoteSnapshotLineV1[]
  attachments: QuoteSnapshotAttachmentRefV1[]
  totals: {
    subtotalCents: number
    taxableSubtotalCents: number
  }
}

export interface QuoteCustomerStoryEvidenceV1 {
  claim: string
  sourceEventIds: string[]
  sourceArtifactIds: string[]
}

export interface QuoteCustomerStoryV1 {
  whatYouToldUs: string
  whatWeFound: string
  howWeKnow: QuoteCustomerStoryEvidenceV1[]
  whatItMeansIfWaived: string
  whatWeRecommend: string
}

export interface QuoteSnapshotV1 {
  schemaVersion: 1
  ticket: {
    id: string
    number: number
    customerId: string
    vehicleId: string
    laborRateCents: number | null
    taxRateBps: number
  }
  jobs: QuoteSnapshotJobV1[]
  totals: QuoteTotals
}

export interface QuoteTotals {
  subtotalCents: number
  taxableSubtotalCents: number
  taxCents: number
  totalCents: number
}

function requireScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 0 || scale > 20) {
    throw new RangeError('scale must be an integer between 0 and 20')
  }
}

function toSafeNonnegativeInteger(value: number, name: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`)
  }
  return BigInt(value)
}

function fromSafeNonnegativeBigInt(value: bigint, name: string): number {
  if (value < 0n || value > MAX_SAFE_BIGINT) {
    throw new RangeError(`${name} exceeds the nonnegative safe-integer range`)
  }
  return Number(value)
}

function requireSafeNonnegativeBigInt(value: bigint, name: string): void {
  if (value < 0n || value > MAX_SAFE_BIGINT) {
    throw new RangeError(`${name} exceeds the nonnegative safe-integer range`)
  }
}

export function parseScaledDecimal(value: string, scale: number): bigint {
  requireScale(scale)
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) throw new RangeError('value must be a nonnegative plain decimal')

  const fraction = match[2] ?? ''
  if (fraction.length > scale) throw new RangeError('value has too many decimal places')

  const scaled = BigInt(match[1]) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0')
  if (scaled > MAX_SAFE_BIGINT) throw new RangeError('scaled value exceeds the safe-integer range')
  return scaled
}

export function formatScaledDecimal(value: bigint, scale: number): string {
  requireScale(scale)
  if (value < 0n || value > MAX_SAFE_BIGINT) {
    throw new RangeError('scaled value exceeds the nonnegative safe-integer range')
  }
  if (scale === 0) return value.toString()

  const divisor = 10n ** BigInt(scale)
  const whole = value / divisor
  const fraction = (value % divisor).toString().padStart(scale, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole.toString()
}

export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n) throw new RangeError('numerator must be nonnegative')
  if (denominator <= 0n) throw new RangeError('denominator must be positive')
  return (numerator + denominator / 2n) / denominator
}

export function calculateLaborPriceCents(hoursHundredths: bigint, rateCents: number): number {
  if (hoursHundredths < 0n || hoursHundredths > MAX_SAFE_BIGINT) {
    throw new RangeError('labor hours exceed the nonnegative safe-integer range')
  }
  const rate = toSafeNonnegativeInteger(rateCents, 'labor rate')
  return fromSafeNonnegativeBigInt(
    divideHalfUp(hoursHundredths * rate, 100n),
    'labor price',
  )
}

export function resolveLaborPriceCents(input: {
  hoursHundredths: bigint
  shopRateCents: number | null
  pinnedRateCents?: number | null
  explicitPriceCents?: number | null
}): { priceCents: number; laborRateCents: number | null } {
  requireSafeNonnegativeBigInt(input.hoursHundredths, 'labor hours')
  const selectedRate = Object.prototype.hasOwnProperty.call(input, 'pinnedRateCents')
    ? input.pinnedRateCents ?? null
    : input.shopRateCents
  if (input.explicitPriceCents !== undefined && input.explicitPriceCents !== null) {
    toSafeNonnegativeInteger(input.explicitPriceCents, 'explicit labor price')
    if (selectedRate !== null) toSafeNonnegativeInteger(selectedRate, 'labor rate')
    return { priceCents: input.explicitPriceCents, laborRateCents: selectedRate }
  }
  if (selectedRate === null) throw new RangeError('labor rate is required to calculate price')
  return {
    priceCents: calculateLaborPriceCents(input.hoursHundredths, selectedRate),
    laborRateCents: selectedRate,
  }
}

export function calculateTicketTotals(
  lines: readonly { extendedCents: number; taxable: boolean }[],
  taxRateBps: number,
): QuoteTotals {
  const bps = toSafeNonnegativeInteger(taxRateBps, 'tax rate')
  if (bps > 10_000n) throw new RangeError('tax rate must not exceed 10,000 basis points')
  let subtotal = 0n
  let taxableSubtotal = 0n

  for (const line of lines) {
    const extended = toSafeNonnegativeInteger(line.extendedCents, 'extended price')
    subtotal += extended
    if (line.taxable) taxableSubtotal += extended
  }

  const tax = divideHalfUp(taxableSubtotal * bps, 10_000n)
  const total = subtotal + tax
  return {
    subtotalCents: fromSafeNonnegativeBigInt(subtotal, 'subtotal'),
    taxableSubtotalCents: fromSafeNonnegativeBigInt(taxableSubtotal, 'taxable subtotal'),
    taxCents: fromSafeNonnegativeBigInt(tax, 'tax'),
    totalCents: fromSafeNonnegativeBigInt(total, 'total'),
  }
}

export function buildQuoteStoryMeta(value: unknown): QuoteStoryMetaV1 | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('story metadata must be an object or null')
  }
  const record = value as Record<string, unknown>
  if (record.source !== 'ai' && record.source !== 'manual' && record.source !== 'template') {
    throw new TypeError('story metadata source is invalid')
  }
  if (record.sessionId !== undefined && typeof record.sessionId !== 'string') {
    throw new TypeError('story metadata session ID is invalid')
  }
  return record.sessionId === undefined
    ? { source: record.source }
    : { source: record.source, sessionId: record.sessionId }
}

export function canonicalizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('JSON numbers must be finite')
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) return value.map(canonicalizeJson)
  if (typeof value !== 'object') throw new TypeError('value is not JSON-compatible')

  const record = value as Record<string, unknown>
  const canonical = Object.create(null) as JsonObject
  for (const key of Object.keys(record).sort()) canonical[key] = canonicalizeJson(record[key])
  return canonical
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value))
}

export function quoteSnapshotContentIdentity(snapshot: QuoteSnapshotV1): string {
  return stableStringify({
    ...snapshot,
    jobs: snapshot.jobs.map((job) => ({
      ...job,
      storyMeta: job.storyMeta === null ? null : buildQuoteStoryMeta(job.storyMeta),
    })),
  })
}

export interface SnapshotOrderRecord {
  id: string
  sort?: number
  createdAt: Date | string
}

export function sortBySnapshotOrder<T extends SnapshotOrderRecord>(records: readonly T[]): T[] {
  return [...records].sort((left, right) => {
    const sortDifference = (left.sort ?? 0) - (right.sort ?? 0)
    if (sortDifference !== 0) return sortDifference
    const createdDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    return createdDifference || left.id.localeCompare(right.id)
  })
}
