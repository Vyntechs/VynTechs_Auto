import { and, eq } from 'drizzle-orm'
import type { AppDb } from '@/lib/db/queries'
import {
  ticketActivity,
  type TICKET_ACTIVITY_KINDS,
} from '@/lib/db/schema'

export type TicketActivityKind = (typeof TICKET_ACTIVITY_KINDS)[number]

export type TicketCorrectionChangedField =
  | 'customer_id'
  | 'vehicle_id'
  | 'concern'
  | 'title'
  | 'kind'
  | 'customer_supplied_parts_note'
  | 'work_status'

export type TicketCorrectionReceiptV1 = {
  v: 1
  scope: 'identity' | 'concern' | 'job' | 'job_removed'
  intentHash: string
  changedFields: TicketCorrectionChangedField[]
  fromCustomerId?: string | null
  toCustomerId?: string | null
  fromVehicleId?: string | null
  toVehicleId?: string | null
  fromKind?: 'diagnostic' | 'repair' | 'maintenance'
  toKind?: 'diagnostic' | 'repair' | 'maintenance'
  invalidatedVersionId?: string | null
  invalidatedVersionNumber?: number | null
}

export type TicketActivityWrite = {
  shopId: string
  ticketId: string
  jobId?: string | null
  actorProfileId: string
  kind: TicketActivityKind
  requestKey: string
  payload: Record<string, unknown>
}

export type TicketActivityWriteResult =
  | { ok: true; created: boolean }
  | { ok: false; error: 'conflict' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SHA256 = /^[0-9a-f]{64}$/
const JOB_KINDS = ['diagnostic', 'repair', 'maintenance'] as const
const RECEIPT_COMMON_KEYS = [
  'v',
  'scope',
  'intentHash',
  'changedFields',
  'invalidatedVersionId',
  'invalidatedVersionNumber',
] as const

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key)
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = new Set(allowed)
  return Object.keys(record).every((key) => keys.has(key))
}

function isUuidOrNull(value: unknown): boolean {
  return value === null || (typeof value === 'string' && UUID.test(value))
}

function hasCanonicalChangedFields(
  value: unknown,
  order: readonly TicketCorrectionChangedField[],
): value is TicketCorrectionChangedField[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > order.length) return false
  if (!value.every((field): field is TicketCorrectionChangedField => (
    typeof field === 'string' && order.includes(field as TicketCorrectionChangedField)
  ))) return false
  return value.every((field, index) => field === order.filter((candidate) => value.includes(candidate))[index])
}

function validVersionEnvelope(record: Record<string, unknown>): boolean {
  const hasId = hasOwn(record, 'invalidatedVersionId')
  const hasNumber = hasOwn(record, 'invalidatedVersionNumber')
  if (!hasId && !hasNumber) return true
  if (!hasId || !hasNumber) return false
  if (record.invalidatedVersionId === null || record.invalidatedVersionNumber === null) {
    return record.invalidatedVersionId === null && record.invalidatedVersionNumber === null
  }
  return typeof record.invalidatedVersionId === 'string'
    && UUID.test(record.invalidatedVersionId)
    && Number.isSafeInteger(record.invalidatedVersionNumber)
    && Number(record.invalidatedVersionNumber) > 0
}

function validIdentityIdChange(
  record: Record<string, unknown>,
  changedFields: TicketCorrectionChangedField[],
  field: 'customer_id' | 'vehicle_id',
  fromKey: 'fromCustomerId' | 'fromVehicleId',
  toKey: 'toCustomerId' | 'toVehicleId',
): boolean {
  const changed = changedFields.includes(field)
  const hasFrom = hasOwn(record, fromKey)
  const hasTo = hasOwn(record, toKey)
  if (!changed) return !hasFrom && !hasTo
  return hasFrom
    && hasTo
    && isUuidOrNull(record[fromKey])
    && isUuidOrNull(record[toKey])
    && record[fromKey] !== record[toKey]
}

export function isTicketCorrectionReceiptV1(
  value: unknown,
  jobId: string | null,
): value is TicketCorrectionReceiptV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.v !== 1
    || typeof record.scope !== 'string'
    || typeof record.intentHash !== 'string'
    || !SHA256.test(record.intentHash)
    || !validVersionEnvelope(record)) return false

  switch (record.scope) {
    case 'identity': {
      if (jobId !== null
        || !hasOnlyKeys(record, [
          ...RECEIPT_COMMON_KEYS,
          'fromCustomerId', 'toCustomerId', 'fromVehicleId', 'toVehicleId',
        ])
        || !hasCanonicalChangedFields(record.changedFields, ['customer_id', 'vehicle_id'])) return false
      return validIdentityIdChange(
        record, record.changedFields, 'customer_id', 'fromCustomerId', 'toCustomerId',
      ) && validIdentityIdChange(
        record, record.changedFields, 'vehicle_id', 'fromVehicleId', 'toVehicleId',
      )
    }
    case 'concern':
      return jobId === null
        && hasOnlyKeys(record, RECEIPT_COMMON_KEYS)
        && hasCanonicalChangedFields(record.changedFields, ['concern'])
    case 'job': {
      if (jobId === null
        || !UUID.test(jobId)
        || !hasOnlyKeys(record, [...RECEIPT_COMMON_KEYS, 'fromKind', 'toKind'])
        || !hasCanonicalChangedFields(
          record.changedFields,
          ['title', 'kind', 'customer_supplied_parts_note'],
        )) return false
      const kindChanged = record.changedFields.includes('kind')
      const hasFrom = hasOwn(record, 'fromKind')
      const hasTo = hasOwn(record, 'toKind')
      if (!kindChanged) return !hasFrom && !hasTo
      return hasFrom
        && hasTo
        && JOB_KINDS.includes(record.fromKind as typeof JOB_KINDS[number])
        && JOB_KINDS.includes(record.toKind as typeof JOB_KINDS[number])
        && record.fromKind !== record.toKind
    }
    case 'job_removed':
      return jobId !== null
        && UUID.test(jobId)
        && hasOnlyKeys(record, RECEIPT_COMMON_KEYS)
        && hasCanonicalChangedFields(record.changedFields, ['work_status'])
    default:
      return false
  }
}

function samePayload(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('ticket activity payload must be JSON')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    )).join(',')}}`
  }
  throw new TypeError('ticket activity payload must be JSON')
}

function matches(existing: typeof ticketActivity.$inferSelect, input: TicketActivityWrite): boolean {
  return existing.ticketId === input.ticketId
    && existing.jobId === (input.jobId ?? null)
    && existing.actorProfileId === input.actorProfileId
    && existing.kind === input.kind
    && samePayload(existing.payload, input.payload)
}

export async function appendTicketActivity(
  db: AppDb,
  input: TicketActivityWrite,
): Promise<TicketActivityWriteResult> {
  if (input.kind === 'ticket_corrected'
    && !isTicketCorrectionReceiptV1(input.payload, input.jobId ?? null)) {
    return { ok: false, error: 'conflict' }
  }
  const [existing] = await db
    .select()
    .from(ticketActivity)
    .where(and(
      eq(ticketActivity.shopId, input.shopId),
      eq(ticketActivity.requestKey, input.requestKey),
    ))
    .limit(1)
  if (existing) return matches(existing, input)
    ? { ok: true, created: false }
    : { ok: false, error: 'conflict' }

  const [created] = await db.insert(ticketActivity).values({
    shopId: input.shopId,
    ticketId: input.ticketId,
    jobId: input.jobId ?? null,
    actorProfileId: input.actorProfileId,
    kind: input.kind,
    requestKey: input.requestKey,
    payload: input.payload,
  })
    .onConflictDoNothing({
      target: [ticketActivity.shopId, ticketActivity.requestKey],
    })
    .returning()
  if (created) return { ok: true, created: true }

  const [winner] = await db
    .select()
    .from(ticketActivity)
    .where(and(
      eq(ticketActivity.shopId, input.shopId),
      eq(ticketActivity.requestKey, input.requestKey),
    ))
    .limit(1)
  return winner && matches(winner, input)
    ? { ok: true, created: false }
    : { ok: false, error: 'conflict' }
}
