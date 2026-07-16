import { PART_STATUSES } from './contracts'
import type {
  BuildContinuitySignatureInputV1,
  CancelReasonCode,
  CanonicalValue,
  CloseDisposition,
  ContinuitySignatureV1,
  PartStatus,
  SeparateReason,
} from './contracts'
import { canonicalJsonV1 } from './canonical'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TICKET_STATUS_SET = new Set(['open', 'closed', 'canceled'])
const CLOSE_DISPOSITION_SET = new Set([
  'delivered',
  'customer_declined',
  'no_repair',
  'remote_quote_not_proceeding',
])
const CANCEL_REASON_CODE_SET = new Set([
  'duplicate_created',
  'customer_canceled_before_authorization',
  'administrative_error',
  'other',
])
const SEPARATE_REASON_SET = new Set([
  'warranty',
  'comeback',
  'different_payer',
  'internal_work',
  'future_or_scheduled_work',
  'fleet_split',
  'other',
])
const JOB_KIND_SET = new Set(['diagnostic', 'repair', 'maintenance'])
const STATEMENT_REVIEW_STATE_SET = new Set(['confirmed', 'review_required'])
const WORK_STATUS_SET = new Set(['open', 'in_progress', 'blocked', 'done', 'canceled'])
const APPROVAL_STATE_SET = new Set([
  'pending_quote',
  'quote_ready',
  'sent',
  'approved',
  'declined',
])
const LINE_KIND_SET = new Set(['part', 'labor', 'fee'])
const PART_STATUS_SET = new Set<string>(PART_STATUSES)

function invalidContinuitySignature(): never {
  throw new Error('invalid_continuity_signature')
}

function normalizeUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    return invalidContinuitySignature()
  }
  return value.toLowerCase()
}

function normalizeNullableUuid(value: unknown): string | null {
  return value === null ? null : normalizeUuid(value)
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string') return invalidContinuitySignature()
  return value
}

function normalizeTimestamp(value: unknown): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    return invalidContinuitySignature()
  }
  return new Date(value.getTime()).toISOString()
}

function normalizeNullableTimestamp(value: unknown): string | null {
  return value === null ? null : normalizeTimestamp(value)
}

function enumValue<T extends string>(value: unknown, allowed: ReadonlySet<string>): T {
  if (typeof value !== 'string' || !allowed.has(value)) return invalidContinuitySignature()
  return value as T
}

function nullableEnumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<string>,
): T | null {
  return value === null ? null : enumValue<T>(value, allowed)
}

type NormalizedJobForSignature = Readonly<{
  row: BuildContinuitySignatureInputV1['graph']['jobs'][number]
  id: string
  sequenceNumber: number | null
  createdAtMs: number
}>

type NormalizedPartLine = Readonly<{
  id: string
  jobId: string
  sort: number
  partStatus: PartStatus
}>

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function compareJobs(left: NormalizedJobForSignature, right: NormalizedJobForSignature): number {
  if (left.sequenceNumber !== null && right.sequenceNumber !== null) {
    return left.sequenceNumber - right.sequenceNumber || compareIds(left.id, right.id)
  }
  if (left.sequenceNumber !== null) return -1
  if (right.sequenceNumber !== null) return 1
  return left.createdAtMs - right.createdAtMs || compareIds(left.id, right.id)
}

function normalizeJobs(
  input: BuildContinuitySignatureInputV1,
): readonly NormalizedJobForSignature[] {
  if (!Array.isArray(input.graph.jobs)) return invalidContinuitySignature()
  const seenIds = new Set<string>()
  const jobs = input.graph.jobs.map((row) => {
    const id = normalizeUuid(row.id)
    if (seenIds.has(id)) return invalidContinuitySignature()
    seenIds.add(id)
    const sequenceNumber = row.sequenceNumber
    if (
      sequenceNumber !== null &&
      (!Number.isSafeInteger(sequenceNumber) || sequenceNumber < 1)
    ) {
      return invalidContinuitySignature()
    }
    const createdAt = normalizeTimestamp(row.createdAt)
    return {
      row,
      id,
      sequenceNumber,
      createdAtMs: Date.parse(createdAt),
    }
  })
  return jobs.sort(compareJobs)
}

function normalizePartLines(
  input: BuildContinuitySignatureInputV1,
  jobIds: ReadonlySet<string>,
): ReadonlyMap<string, readonly NormalizedPartLine[]> {
  if (!Array.isArray(input.graph.lines)) return invalidContinuitySignature()
  const byJob = new Map<string, NormalizedPartLine[]>()
  const seenLineIds = new Set<string>()

  for (const row of input.graph.lines) {
    enumValue(row.kind, LINE_KIND_SET)
    if (row.kind !== 'part') continue
    const id = normalizeUuid(row.id)
    if (seenLineIds.has(id)) return invalidContinuitySignature()
    seenLineIds.add(id)
    const jobId = normalizeUuid(row.jobId)
    if (!jobIds.has(jobId)) return invalidContinuitySignature()
    if (!Number.isSafeInteger(row.sort)) return invalidContinuitySignature()
    const partStatus = enumValue<PartStatus>(row.partStatus, PART_STATUS_SET)
    const normalized = { id, jobId, sort: row.sort, partStatus }
    const current = byJob.get(jobId)
    if (current) current.push(normalized)
    else byJob.set(jobId, [normalized])
  }

  for (const lines of byJob.values()) {
    lines.sort((left, right) => left.sort - right.sort || compareIds(left.id, right.id))
  }
  return byJob
}

function reconciliationState(
  source: unknown,
  customerId: string | null,
  vehicleId: string | null,
  customerBelongsToShop: boolean,
  vehicleBelongsToCustomer: boolean,
): ContinuitySignatureV1['ticket']['reconciliationState'] {
  if (source === 'tech_quick' && customerId === null && vehicleId === null) {
    return 'provisional'
  }
  if (
    customerId !== null &&
    vehicleId !== null &&
    customerBelongsToShop &&
    vehicleBelongsToCustomer
  ) {
    return 'reconciled'
  }
  return 'inconsistent'
}

export function buildContinuitySignatureV1(
  input: BuildContinuitySignatureInputV1,
): ContinuitySignatureV1 {
  try {
    if (
      typeof input !== 'object' ||
      input === null ||
      typeof input.graph !== 'object' ||
      input.graph === null ||
      typeof input.customerBelongsToShop !== 'boolean' ||
      typeof input.vehicleBelongsToCustomer !== 'boolean'
    ) {
      return invalidContinuitySignature()
    }
    const ticket = input.graph.ticket
    if (typeof ticket !== 'object' || ticket === null || typeof ticket.source !== 'string') {
      return invalidContinuitySignature()
    }
    if (!Array.isArray(input.graph.versions) || !Array.isArray(input.graph.events)) {
      return invalidContinuitySignature()
    }

    const customerId = normalizeNullableUuid(ticket.customerId)
    const vehicleId = normalizeNullableUuid(ticket.vehicleId)
    const jobs = normalizeJobs(input)
    const jobIds = new Set(jobs.map((job) => job.id))
    const partLines = normalizePartLines(input, jobIds)

    return {
      schemaVersion: 1,
      ticket: {
        id: normalizeUuid(ticket.id),
        customerId,
        vehicleId,
        reconciliationState: reconciliationState(
          ticket.source,
          customerId,
          vehicleId,
          input.customerBelongsToShop,
          input.vehicleBelongsToCustomer,
        ),
        status: enumValue(ticket.status, TICKET_STATUS_SET),
        deliveredAt: normalizeNullableTimestamp(ticket.deliveredAt),
        deliveredByProfileId: normalizeNullableUuid(ticket.deliveredByProfileId),
        closedAt: normalizeNullableTimestamp(ticket.closedAt),
        closedByProfileId: normalizeNullableUuid(ticket.closedByProfileId),
        closeDisposition: nullableEnumValue<CloseDisposition>(
          ticket.closeDisposition,
          CLOSE_DISPOSITION_SET,
        ),
        closeNote: normalizeNullableString(ticket.closeNote),
        canceledAt: normalizeNullableTimestamp(ticket.canceledAt),
        canceledByProfileId: normalizeNullableUuid(ticket.canceledByProfileId),
        cancelReasonCode: nullableEnumValue<CancelReasonCode>(
          ticket.cancelReasonCode,
          CANCEL_REASON_CODE_SET,
        ),
        canceledReason: normalizeNullableString(ticket.canceledReason),
        separateFromTicketId: normalizeNullableUuid(ticket.separateFromTicketId),
        separateReason: nullableEnumValue<SeparateReason>(
          ticket.separateReason,
          SEPARATE_REASON_SET,
        ),
        separateReasonNote: normalizeNullableString(ticket.separateReasonNote),
      },
      jobs: jobs.map(({ row, id }) => {
        if (
          row.approvedAuthorizationFingerprint !== null &&
          typeof row.approvedAuthorizationFingerprint !== 'string'
        ) {
          return invalidContinuitySignature()
        }
        return {
          id,
          kind: enumValue(row.kind, JOB_KIND_SET),
          workStatement: normalizeNullableString(row.workStatement),
          statementReviewState: nullableEnumValue(
            row.statementReviewState,
            STATEMENT_REVIEW_STATE_SET,
          ),
          workStatus: enumValue(row.workStatus, WORK_STATUS_SET),
          approvalState: enumValue(row.approvalState, APPROVAL_STATE_SET),
          approvedAuthorizationFingerprintPresent:
            row.approvedAuthorizationFingerprint !== null,
          partStatuses: (partLines.get(id) ?? []).map((line) => line.partStatus),
        }
      }),
    }
  } catch {
    return invalidContinuitySignature()
  }
}

export function serializeContinuitySignatureV1(value: ContinuitySignatureV1): string {
  return canonicalJsonV1(value as unknown as CanonicalValue)
}

export function equalContinuitySignatureV1(
  left: ContinuitySignatureV1,
  right: ContinuitySignatureV1,
): boolean {
  return serializeContinuitySignatureV1(left) === serializeContinuitySignatureV1(right)
}
