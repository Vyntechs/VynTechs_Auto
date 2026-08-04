export const TICKET_CORRECTION_DRAFT_VERSION = 1
export const TICKET_CORRECTION_DRAFT_MAX_BYTES = 8 * 1024
export const TICKET_CORRECTION_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1000

const FUTURE_CLOCK_SKEW_MS = 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type TicketCorrectionTarget =
  | { kind: 'identity' }
  | { kind: 'concern' }
  | { kind: 'job'; jobId: string }

export type TicketCorrectionFields =
  | {
      kind: 'identity'
      mode: 'search' | 'existing' | 'new'
      vehicleId: string | null
      name: string
      phone: string
      email: string
      year: string
      make: string
      model: string
      engine: string
      vin: string
      mileage: string
      plate: string
    }
  | { kind: 'concern'; concern: string }
  | {
      kind: 'job'
      title: string
      jobKind: 'diagnostic' | 'repair' | 'maintenance'
      customerSuppliedPartsNote: string
      remove: boolean
    }

export type PendingTicketCorrectionRequest = {
  body: string
  signature: string
  requestKey: string
}

export type TicketCorrectionDraft = {
  version: 1
  actorId: string
  ticketId: string
  target: TicketCorrectionTarget
  fields: TicketCorrectionFields
  pending: PendingTicketCorrectionRequest | null
  savedAt: number
}

const DRAFT_KEYS = [
  'version', 'actorId', 'ticketId', 'target', 'fields', 'pending', 'savedAt',
] as const
const PENDING_KEYS = ['body', 'signature', 'requestKey'] as const
const IDENTITY_KEYS = [
  'kind', 'mode', 'vehicleId', 'name', 'phone', 'email', 'year', 'make', 'model',
  'engine', 'vin', 'mileage', 'plate',
] as const
const CONCERN_KEYS = ['kind', 'concern'] as const
const JOB_KEYS = ['kind', 'title', 'jobKind', 'customerSuppliedPartsNote', 'remove'] as const

export function ticketCorrectionDraftKey(
  actorId: string,
  ticketId: string,
  target: TicketCorrectionTarget,
): string {
  const actor = normalizedUuid(actorId)
  const ticket = normalizedUuid(ticketId)
  const normalizedTarget = normalizeTarget(target)
  if (!actor || !ticket || !normalizedTarget) throw new TypeError('ticket correction draft scope is invalid')
  const suffix = normalizedTarget.kind === 'job'
    ? `job:${normalizedTarget.jobId}`
    : normalizedTarget.kind
  return `vyntechs:ticket-correction-draft:v1:${actor}:${ticket}:${suffix}`
}

export function encodeTicketCorrectionDraft(
  draft: TicketCorrectionDraft,
  now = Date.now(),
): string {
  const normalized = normalizeDraft({ ...draft, savedAt: now })
  if (!normalized) throw new TypeError('ticket correction draft is invalid')
  const encoded = JSON.stringify(normalized)
  if (byteLength(encoded) > TICKET_CORRECTION_DRAFT_MAX_BYTES) {
    throw new RangeError('ticket correction draft is too large')
  }
  return encoded
}

export function parseTicketCorrectionDraft(
  raw: string,
  scope: {
    actorId: string
    ticketId: string
    target: TicketCorrectionTarget
    now?: number
  },
): TicketCorrectionDraft | null {
  if (byteLength(raw) > TICKET_CORRECTION_DRAFT_MAX_BYTES) return null
  const actorId = normalizedUuid(scope.actorId)
  const ticketId = normalizedUuid(scope.ticketId)
  const target = normalizeTarget(scope.target)
  if (!actorId || !ticketId || !target) return null
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return null
  }
  const draft = normalizeDraft(value)
  if (!draft
    || draft.actorId !== actorId
    || draft.ticketId !== ticketId
    || targetToken(draft.target) !== targetToken(target)) return null
  const now = scope.now ?? Date.now()
  if (!Number.isFinite(now)
    || draft.savedAt > now + FUTURE_CLOCK_SKEW_MS
    || now - draft.savedAt > TICKET_CORRECTION_DRAFT_MAX_AGE_MS) return null
  return draft
}

export function prepareTicketCorrectionRequest(
  intent: Record<string, unknown>,
  pending: PendingTicketCorrectionRequest | null,
  createKey: () => string = () => crypto.randomUUID(),
): PendingTicketCorrectionRequest {
  if ('requestKey' in intent) throw new TypeError('ticket correction intent already has a request key')
  const normalizedIntent = stableJson(intent)
  const signature = signatureFor(normalizedIntent)
  if (pending && pending.signature === signature && validPending(pending)) return pending
  const requestKey = normalizedUuid(createKey())
  if (!requestKey) throw new TypeError('ticket correction request key is invalid')
  return {
    body: stableJson({ ...intent, requestKey }),
    signature,
    requestKey,
  }
}

function normalizeDraft(value: unknown): TicketCorrectionDraft | null {
  if (!isExactRecord(value, DRAFT_KEYS)) return null
  const actorId = normalizedUuid(value.actorId)
  const ticketId = normalizedUuid(value.ticketId)
  const target = normalizeTarget(value.target)
  const fields = normalizeFields(value.fields)
  const pending = value.pending === null ? null : normalizePending(value.pending)
  if (value.version !== TICKET_CORRECTION_DRAFT_VERSION
    || !actorId || !ticketId || !target || !fields
    || (value.pending !== null && !pending)
    || fields.kind !== target.kind
    || typeof value.savedAt !== 'number'
    || !Number.isSafeInteger(value.savedAt)) return null
  return {
    version: 1,
    actorId,
    ticketId,
    target,
    fields,
    pending,
    savedAt: value.savedAt,
  }
}

function normalizeTarget(value: unknown): TicketCorrectionTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.kind === 'identity' || record.kind === 'concern') {
    return Object.keys(record).length === 1 ? { kind: record.kind } : null
  }
  if (record.kind !== 'job' || Object.keys(record).length !== 2) return null
  const jobId = normalizedUuid(record.jobId)
  return jobId ? { kind: 'job', jobId } : null
}

function normalizeFields(value: unknown): TicketCorrectionFields | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.kind === 'identity') {
    if (!isExactRecord(record, IDENTITY_KEYS)
      || !['search', 'existing', 'new'].includes(String(record.mode))
      || !boundedString(record.name, 200)
      || !boundedString(record.phone, 100)
      || !boundedString(record.email, 320)
      || !boundedString(record.year, 4)
      || !boundedString(record.make, 100)
      || !boundedString(record.model, 100)
      || !boundedString(record.engine, 200)
      || !boundedString(record.vin, 17)
      || !boundedString(record.mileage, 16)
      || !boundedString(record.plate, 32)) return null
    const vehicleId = record.vehicleId === null ? null : normalizedUuid(record.vehicleId)
    if ((record.vehicleId !== null && !vehicleId)
      || (record.mode === 'existing') !== (vehicleId !== null)) return null
    return {
      kind: 'identity',
      mode: record.mode as 'search' | 'existing' | 'new',
      vehicleId,
      name: record.name,
      phone: record.phone,
      email: record.email,
      year: record.year,
      make: record.make,
      model: record.model,
      engine: record.engine,
      vin: record.vin,
      mileage: record.mileage,
      plate: record.plate,
    }
  }
  if (record.kind === 'concern') {
    return isExactRecord(record, CONCERN_KEYS) && boundedString(record.concern, 5_000)
      ? { kind: 'concern', concern: record.concern }
      : null
  }
  if (record.kind !== 'job'
    || !isExactRecord(record, JOB_KEYS)
    || !boundedString(record.title, 200)
    || !['diagnostic', 'repair', 'maintenance'].includes(String(record.jobKind))
    || !boundedString(record.customerSuppliedPartsNote, 500)
    || typeof record.remove !== 'boolean') return null
  return {
    kind: 'job',
    title: record.title,
    jobKind: record.jobKind as 'diagnostic' | 'repair' | 'maintenance',
    customerSuppliedPartsNote: record.customerSuppliedPartsNote,
    remove: record.remove,
  }
}

function normalizePending(value: unknown): PendingTicketCorrectionRequest | null {
  if (!isExactRecord(value, PENDING_KEYS)
    || typeof value.body !== 'string'
    || typeof value.signature !== 'string'
    || typeof value.requestKey !== 'string') return null
  const pending = {
    body: value.body,
    signature: value.signature,
    requestKey: value.requestKey,
  }
  return validPending(pending) ? pending : null
}

function validPending(pending: PendingTicketCorrectionRequest): boolean {
  const requestKey = normalizedUuid(pending.requestKey)
  if (!requestKey || !/^v1:[0-9a-f]{16}$/.test(pending.signature)) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(pending.body)
  } catch {
    return false
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false
  const record = parsed as Record<string, unknown>
  if (normalizedUuid(record.requestKey) !== requestKey || stableJson(record) !== pending.body) return false
  const { requestKey: _requestKey, ...intent } = record
  return signatureFor(stableJson(intent)) === pending.signature
}

function stableJson(value: unknown): string {
  return JSON.stringify(normalizeJson(value))
}

function normalizeJson(value: unknown): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(normalizeJson)
  if (!value || typeof value !== 'object') throw new TypeError('ticket correction intent is not JSON')
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, normalizeJson(entry)]))
}

function signatureFor(value: string): string {
  let hash = 0xcbf29ce484222325n
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `v1:${hash.toString(16).padStart(16, '0')}`
}

function targetToken(target: TicketCorrectionTarget): string {
  return target.kind === 'job' ? `${target.kind}:${target.jobId}` : target.kind
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
