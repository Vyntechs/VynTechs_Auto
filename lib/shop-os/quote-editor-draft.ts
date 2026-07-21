import type {
  ManualLineFormValues,
  ManualLineKind,
} from '@/lib/shop-os/quote-builder-ui'

export const QUOTE_EDITOR_DRAFT_VERSION = 1
export const QUOTE_EDITOR_DRAFT_MAX_BYTES = 8192
export const QUOTE_EDITOR_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000

const FUTURE_CLOCK_SKEW_MS = 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type QuoteEditorDraft = {
  version: 1
  actorId: string
  ticketId: string
  jobId: string
  mode: 'create' | 'edit'
  kind: ManualLineKind
  lineId: string | null
  values: ManualLineFormValues
  hoursChanged: boolean
  clientKey: string | null
  savedAt: number
}

const DRAFT_KEYS = [
  'version',
  'actorId',
  'ticketId',
  'jobId',
  'mode',
  'kind',
  'lineId',
  'values',
  'hoursChanged',
  'clientKey',
  'savedAt',
] as const

const VALUE_KEYS = [
  'description',
  'quantity',
  'hours',
  'price',
  'taxable',
  'partNumber',
  'brand',
  'fitment',
] as const

export function quoteEditorDraftKey(actorId: string, ticketId: string): string {
  const actor = normalizedUuid(actorId)
  const ticket = normalizedUuid(ticketId)
  if (!actor || !ticket) throw new TypeError('quote draft scope is invalid')
  return `vyntechs:quote-editor-draft:v1:${actor}:${ticket}`
}

export function encodeQuoteEditorDraft(
  draft: QuoteEditorDraft,
  now = Date.now(),
): string {
  const candidate = normalizeDraft({ ...draft, savedAt: now })
  if (!candidate) throw new TypeError('quote editor draft is invalid')
  const encoded = JSON.stringify(candidate)
  if (byteLength(encoded) > QUOTE_EDITOR_DRAFT_MAX_BYTES) {
    throw new RangeError('quote editor draft is too large')
  }
  return encoded
}

export function parseQuoteEditorDraft(
  raw: string,
  scope: { actorId: string; ticketId: string; now?: number },
): QuoteEditorDraft | null {
  if (byteLength(raw) > QUOTE_EDITOR_DRAFT_MAX_BYTES) return null
  const actorId = normalizedUuid(scope.actorId)
  const ticketId = normalizedUuid(scope.ticketId)
  if (!actorId || !ticketId) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  const draft = normalizeDraft(parsed)
  if (!draft || draft.actorId !== actorId || draft.ticketId !== ticketId) return null
  const now = scope.now ?? Date.now()
  if (!Number.isFinite(now)
    || draft.savedAt > now + FUTURE_CLOCK_SKEW_MS
    || now - draft.savedAt > QUOTE_EDITOR_DRAFT_MAX_AGE_MS) {
    return null
  }
  return draft
}

function normalizeDraft(value: unknown): QuoteEditorDraft | null {
  if (!isExactRecord(value, DRAFT_KEYS)) return null
  const actorId = normalizedUuid(value.actorId)
  const ticketId = normalizedUuid(value.ticketId)
  const jobId = normalizedUuid(value.jobId)
  const lineId = value.lineId === null ? null : normalizedUuid(value.lineId)
  const clientKey = value.clientKey === null ? null : normalizedUuid(value.clientKey)
  if (
    value.version !== QUOTE_EDITOR_DRAFT_VERSION
    || !actorId
    || !ticketId
    || !jobId
    || (value.lineId !== null && !lineId)
    || (value.clientKey !== null && !clientKey)
    || (value.mode !== 'create' && value.mode !== 'edit')
    || (value.kind !== 'part' && value.kind !== 'labor' && value.kind !== 'fee')
    || typeof value.hoursChanged !== 'boolean'
    || typeof value.savedAt !== 'number'
    || !Number.isFinite(value.savedAt)
    || !Number.isSafeInteger(value.savedAt)
  ) return null
  if (value.mode === 'create' && (lineId !== null || clientKey === null)) return null
  if (value.mode === 'edit' && (lineId === null || clientKey !== null)) return null
  const values = normalizeValues(value.values)
  if (!values) return null
  return {
    version: QUOTE_EDITOR_DRAFT_VERSION,
    actorId,
    ticketId,
    jobId,
    mode: value.mode,
    kind: value.kind,
    lineId,
    values,
    hoursChanged: value.hoursChanged,
    clientKey,
    savedAt: value.savedAt,
  }
}

function normalizeValues(value: unknown): ManualLineFormValues | null {
  if (!isExactRecord(value, VALUE_KEYS)) return null
  if (
    !boundedString(value.description, 500)
    || !boundedString(value.quantity, 64)
    || !boundedString(value.hours, 64)
    || !boundedString(value.price, 64)
    || typeof value.taxable !== 'boolean'
    || !boundedString(value.partNumber, 200)
    || !boundedString(value.brand, 200)
    || !boundedString(value.fitment, 500)
  ) return null
  return {
    description: value.description,
    quantity: value.quantity,
    hours: value.hours,
    price: value.price,
    taxable: value.taxable,
    partNumber: value.partNumber,
    brand: value.brand,
    fitment: value.fitment,
  }
}

function normalizedUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length <= maximum
}

function isExactRecord<const T extends readonly string[]>(
  value: unknown,
  keys: T,
): value is Record<T[number], unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => actual.includes(key))
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
