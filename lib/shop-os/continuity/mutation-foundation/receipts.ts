import 'server-only'

import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AppDb } from '../../../db/queries'
import {
  ticketJobs,
  ticketMutationReceiptJobs,
  ticketMutationReceipts,
  tickets,
} from '../../../db/schema'
import type {
  CanonicalMutationEnvelopeV1,
  LockedActiveActorV1,
  MutationAttemptCapabilityV1,
  MutationFingerprintKeyringV1,
  TicketMutationKind,
} from './contracts'
import { TICKET_CREATING_MUTATION_KINDS_V1 } from './contracts'
import {
  assertLiveLockedMutationScopeV1,
  assertLiveMutationAttemptV1,
} from './attempt-capability'
import {
  canonicalJsonV1,
  createCanonicalMutationFingerprintV1,
  createCanonicalTargetBindingFingerprintV1,
  normalizeCandidateBindingsV1,
  verifyCanonicalMutationFingerprintV1,
  verifyCanonicalTargetBindingFingerprintV1,
} from './canonical'
import { ShopOsMutationConflict } from './conflicts'
import type { LockedMutationScopeV1 } from './lock-order'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TICKET_CREATING_MUTATION_KIND_SET = new Set<string>(
  TICKET_CREATING_MUTATION_KINDS_V1,
)
const RECEIPT_REQUEST_KEY_CONSTRAINT = 'ticket_mutation_receipts_shop_request_key_uq'
const MAX_ERROR_CAUSE_DEPTH = 8

export type MutationReceiptExpectationV1 = Readonly<{
  requestKey: string
  mutationKind: TicketMutationKind
  mutationSchemaVersion: 1
  targetTicketId: string | null
  envelope: CanonicalMutationEnvelopeV1
}>

type NormalizedExpectationV1 = Readonly<{
  requestKey: string
  mutationKind: TicketMutationKind
  mutationSchemaVersion: 1
  targetTicketId: string | null
  envelope: CanonicalMutationEnvelopeV1
}>

function normalizeUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError('invalid_mutation_receipt_request')
  }
  return value.toLowerCase()
}

function ownDataProperty(value: object, name: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

export function isExactReceiptRequestKeyViolation(error: unknown): boolean {
  const seen = new WeakSet<object>()
  let current = error
  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null || seen.has(current)) return false
    seen.add(current)
    if (ownDataProperty(current, 'code') === '23505') {
      const constraint = ownDataProperty(current, 'constraint')
      const constraintName = ownDataProperty(current, 'constraint_name')
      if (
        constraint !== undefined && constraintName !== undefined &&
        constraint !== constraintName
      ) return false
      return (constraint ?? constraintName) === RECEIPT_REQUEST_KEY_CONSTRAINT
    }
    current = ownDataProperty(current, 'cause')
  }
  return false
}

function receiptConflict(): never {
  throw new ShopOsMutationConflict()
}

function freezeCanonicalValue<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    for (const member of value) freezeCanonicalValue(member)
  } else {
    for (const member of Object.values(value)) freezeCanonicalValue(member)
  }
  return Object.freeze(value)
}

function ownCanonicalRecord(
  value: CanonicalMutationEnvelopeV1['target'],
): CanonicalMutationEnvelopeV1['target'] {
  const serialized = canonicalJsonV1(value)
  const parsed = JSON.parse(serialized) as CanonicalMutationEnvelopeV1['target']
  return freezeCanonicalValue(parsed)
}

function normalizeExpectation(
  scope: LockedMutationScopeV1,
  expected: MutationReceiptExpectationV1,
): NormalizedExpectationV1 {
  if (typeof expected !== 'object' || expected === null) return receiptConflict()
  const requestKey = normalizeUuid(expected.requestKey)
  if (
    scope.request.receiptRequestKey !== requestKey ||
    scope.request.shopId !== scope.actor.shopId ||
    expected.mutationSchemaVersion !== 1 ||
    expected.envelope.schemaVersion !== 1 ||
    expected.mutationKind !== expected.envelope.mutationKind
  ) return receiptConflict()

  const targetTicketId = expected.targetTicketId === null
    ? null
    : normalizeUuid(expected.targetTicketId)
  const candidates = Object.freeze(
    normalizeCandidateBindingsV1(expected.envelope.candidates)
      .map((candidate) => Object.freeze({ ...candidate })),
  )
  const lockedGraphByTicket = new Map(
    scope.tickets.map((graph) => [graph.ticket.id, graph] as const),
  )
  const requireCurrentLockedBindings = scope.receiptPeek.kind === 'none'
  if (
    requireCurrentLockedBindings &&
    targetTicketId !== null &&
    !lockedGraphByTicket.has(targetTicketId)
  ) {
    return receiptConflict()
  }
  const target = ownCanonicalRecord(expected.envelope.target)
  const payload = ownCanonicalRecord(expected.envelope.payload)
  const envelopeTargetTicketId = target.ticketId
  if (
    envelopeTargetTicketId !== undefined &&
    (typeof envelopeTargetTicketId !== 'string' ||
      normalizeUuid(envelopeTargetTicketId) !== targetTicketId)
  ) return receiptConflict()
  for (const candidate of requireCurrentLockedBindings ? candidates : []) {
    const graph = lockedGraphByTicket.get(candidate.ticketId)
    if (
      !graph ||
      String(graph.ticket.continuityRevision) !== candidate.continuityRevision
    ) return receiptConflict()
  }

  const envelope = Object.freeze({
    schemaVersion: 1 as const,
    mutationKind: expected.envelope.mutationKind,
    operationOrigin: expected.envelope.operationOrigin,
    actorProfileId: scope.actor.id,
    target,
    candidates,
    payload,
  })
  return Object.freeze({
    requestKey,
    mutationKind: expected.mutationKind,
    mutationSchemaVersion: 1 as const,
    targetTicketId,
    envelope,
  })
}

function immutableIdentity(
  ticketId: string,
  jobIds: readonly string[],
): Readonly<{ ticketId: string; jobIds: readonly string[] }> {
  return Object.freeze({
    ticketId,
    jobIds: Object.freeze([...jobIds]),
  })
}

function validatePersistedReceiptJobs(
  rows: readonly (typeof ticketMutationReceiptJobs.$inferSelect)[],
  receipt: typeof ticketMutationReceipts.$inferSelect,
  graph: LockedMutationScopeV1['tickets'][number],
): readonly string[] | null {
  if (
    !Number.isInteger(receipt.resultJobCount) ||
    receipt.resultJobCount < 0 ||
    receipt.resultJobCount > 25 ||
    rows.length !== receipt.resultJobCount
  ) return null
  const lockedJobIds = new Set(graph.jobs.map(({ id }) => id))
  const seen = new Set<string>()
  const result: string[] = []
  for (let ordinal = 0; ordinal < rows.length; ordinal += 1) {
    const row = rows[ordinal]
    if (
      !row ||
      row.shopId !== receipt.shopId ||
      row.receiptId !== receipt.id ||
      row.resultTicketId !== receipt.resultTicketId ||
      row.resultJobCount !== receipt.resultJobCount ||
      row.ordinal !== ordinal ||
      seen.has(row.jobId) ||
      !lockedJobIds.has(row.jobId)
    ) return null
    seen.add(row.jobId)
    result.push(row.jobId)
  }
  return Object.freeze(result)
}

function normalizeResultJobIds(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return receiptConflict()
  }
  if (!Number.isInteger(value.length) || value.length < 0 || value.length > 25) {
    return receiptConflict()
  }
  const result = value.map(normalizeUuid)
  if (new Set(result).size !== result.length) return receiptConflict()
  return Object.freeze(result)
}

async function validateResultIdentity(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  expectation: NormalizedExpectationV1,
  resultTicketId: string,
  resultJobIds: readonly string[],
): Promise<typeof tickets.$inferSelect> {
  const lockedGraph = scope.tickets.find(({ ticket }) => ticket.id === resultTicketId)
  const insertedTicket = scope.insertionIntents.tickets.includes(resultTicketId)
  if (!lockedGraph && !insertedTicket) return receiptConflict()
  const allowedJobIds = new Set([
    ...(lockedGraph?.jobs.map(({ id }) => id) ?? []),
    ...scope.insertionIntents.jobs
      .filter(({ ticketId }) => ticketId === resultTicketId)
      .map(({ id }) => id),
  ])
  if (resultJobIds.some((id) => !allowedJobIds.has(id))) return receiptConflict()

  const [resultTicket] = await tx.select().from(tickets).where(and(
    eq(tickets.shopId, scope.actor.shopId),
    eq(tickets.id, resultTicketId),
  )).limit(1)
  if (!resultTicket) return receiptConflict()
  if (
    TICKET_CREATING_MUTATION_KIND_SET.has(expectation.mutationKind) &&
    resultTicket.source !== expectation.envelope.operationOrigin
  ) return receiptConflict()

  const persistedJobs = resultJobIds.length === 0
    ? []
    : await tx.select({
      id: ticketJobs.id,
      ticketId: ticketJobs.ticketId,
    }).from(ticketJobs).where(and(
      eq(ticketJobs.shopId, scope.actor.shopId),
      eq(ticketJobs.ticketId, resultTicketId),
      inArray(ticketJobs.id, resultJobIds),
    )).orderBy(ticketJobs.id)
  if (
    persistedJobs.length !== resultJobIds.length ||
    persistedJobs.some(({ id, ticketId }) =>
      ticketId !== resultTicketId || !resultJobIds.includes(id))
  ) return receiptConflict()
  return resultTicket
}

export async function hintMutationReceiptPresenceV1(
  tx: AppDb,
  attempt: MutationAttemptCapabilityV1,
  input: Readonly<{ shopId: string; requestKey: string }>,
): Promise<'present' | 'absent'> {
  assertLiveMutationAttemptV1(tx, attempt)
  const shopId = normalizeUuid(input.shopId)
  const requestKey = normalizeUuid(input.requestKey)
  const row = await tx.select({ present: sql<number>`1` })
    .from(ticketMutationReceipts)
    .where(and(
      eq(ticketMutationReceipts.shopId, shopId),
      eq(ticketMutationReceipts.requestKey, requestKey),
    ))
    .limit(1)
  return row.length === 0 ? 'absent' : 'present'
}

export async function peekMutationReceiptV1(
  tx: AppDb,
  attempt: MutationAttemptCapabilityV1,
  actor: LockedActiveActorV1,
  requestKey: string,
): Promise<
  | Readonly<{ kind: 'none' }>
  | Readonly<{ kind: 'owned'; receiptId: string; resultTicketId: string }>
  | Readonly<{ kind: 'occupied' }>
> {
  assertLiveMutationAttemptV1(tx, attempt)
  const shopId = normalizeUuid(actor.shopId)
  const actorProfileId = normalizeUuid(actor.id)
  const normalizedRequestKey = normalizeUuid(requestKey)
  const [receipt] = await tx.select({
    id: ticketMutationReceipts.id,
    actorProfileId: ticketMutationReceipts.actorProfileId,
    resultTicketId: ticketMutationReceipts.resultTicketId,
  }).from(ticketMutationReceipts).where(and(
    eq(ticketMutationReceipts.shopId, shopId),
    eq(ticketMutationReceipts.requestKey, normalizedRequestKey),
  )).limit(1)

  if (!receipt) return Object.freeze({ kind: 'none' })
  if (receipt.actorProfileId !== actorProfileId) {
    return Object.freeze({ kind: 'occupied' })
  }
  return Object.freeze({
    kind: 'owned',
    receiptId: receipt.id,
    resultTicketId: receipt.resultTicketId,
  })
}

export async function lockAndClassifyMutationReceiptV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  expected: MutationReceiptExpectationV1,
  keyring: MutationFingerprintKeyringV1,
): Promise<
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'replay'; ticketId: string; jobIds: readonly string[] }>
  | Readonly<{ kind: 'conflict' }>
  | Readonly<{ kind: 'verification_unavailable' }>
> {
  assertLiveLockedMutationScopeV1(tx, scope)
  if (scope.receiptPeek.kind === 'none') return Object.freeze({ kind: 'missing' })
  if (scope.receiptPeek.kind === 'occupied') return Object.freeze({ kind: 'conflict' })
  if (!('receiptId' in scope.receiptPeek)) return Object.freeze({ kind: 'conflict' })
  const ownedPeek = scope.receiptPeek

  let expectation: NormalizedExpectationV1
  try {
    expectation = normalizeExpectation(scope, expected)
  } catch {
    return Object.freeze({ kind: 'conflict' })
  }
  const [receipt] = await tx.select().from(ticketMutationReceipts).where(and(
    eq(ticketMutationReceipts.shopId, scope.actor.shopId),
    eq(ticketMutationReceipts.requestKey, expectation.requestKey),
  )).limit(1)
  if (
    !receipt ||
    receipt.id !== ownedPeek.receiptId ||
    receipt.shopId !== scope.actor.shopId ||
    receipt.actorProfileId !== scope.actor.id ||
    receipt.requestKey !== expectation.requestKey ||
    receipt.mutationKind !== expectation.mutationKind ||
    receipt.mutationSchemaVersion !== expectation.mutationSchemaVersion ||
    receipt.targetTicketId !== expectation.targetTicketId ||
    receipt.resultTicketId !== ownedPeek.resultTicketId
  ) return Object.freeze({ kind: 'conflict' })

  let requestVerification: ReturnType<typeof verifyCanonicalMutationFingerprintV1>
  let targetBindingVerification: ReturnType<
    typeof verifyCanonicalTargetBindingFingerprintV1
  >
  try {
    requestVerification = verifyCanonicalMutationFingerprintV1(
      expectation.envelope,
      {
        keyVersion: receipt.fingerprintKeyVersion,
        digest: receipt.requestFingerprint,
      },
      keyring,
    )
    targetBindingVerification = verifyCanonicalTargetBindingFingerprintV1(
      expectation.envelope.target,
      expectation.envelope.candidates,
      {
        keyVersion: receipt.fingerprintKeyVersion,
        digest: receipt.targetBindingFingerprint,
      },
      keyring,
    )
  } catch {
    return Object.freeze({ kind: 'conflict' })
  }
  if (
    requestVerification === 'verification_unavailable' ||
    targetBindingVerification === 'verification_unavailable'
  ) {
    return Object.freeze({ kind: 'verification_unavailable' })
  }
  if (
    requestVerification !== 'match' ||
    targetBindingVerification !== 'match'
  ) return Object.freeze({ kind: 'conflict' })

  const graph = scope.tickets.find(({ ticket }) => ticket.id === receipt.resultTicketId)
  if (
    !graph ||
    (TICKET_CREATING_MUTATION_KIND_SET.has(expectation.mutationKind) &&
      graph.ticket.source !== expectation.envelope.operationOrigin)
  ) return Object.freeze({ kind: 'conflict' })
  const receiptJobs = await tx.select().from(ticketMutationReceiptJobs).where(and(
    eq(ticketMutationReceiptJobs.shopId, scope.actor.shopId),
    eq(ticketMutationReceiptJobs.receiptId, receipt.id),
  )).orderBy(ticketMutationReceiptJobs.ordinal)
  const jobIds = validatePersistedReceiptJobs(receiptJobs, receipt, graph)
  if (jobIds === null) return Object.freeze({ kind: 'conflict' })
  const identity = immutableIdentity(receipt.resultTicketId, jobIds)
  return Object.freeze({ kind: 'replay', ...identity })
}

export async function insertMutationReceiptPrimitiveV1(
  tx: AppDb,
  scope: LockedMutationScopeV1,
  input: MutationReceiptExpectationV1 & Readonly<{
    keyring: MutationFingerprintKeyringV1
    resultTicketId: string
    resultJobIds: readonly string[]
  }>,
): Promise<Readonly<{ ticketId: string; jobIds: readonly string[] }>> {
  assertLiveLockedMutationScopeV1(tx, scope)
  if (scope.receiptPeek.kind !== 'none') return receiptConflict()
  const expectation = normalizeExpectation(scope, input)
  const resultTicketId = normalizeUuid(input.resultTicketId)
  const resultJobIds = normalizeResultJobIds(input.resultJobIds)
  await validateResultIdentity(
    tx,
    scope,
    expectation,
    resultTicketId,
    resultJobIds,
  )

  let requestFingerprint: ReturnType<typeof createCanonicalMutationFingerprintV1>
  let targetBindingFingerprint: ReturnType<typeof createCanonicalTargetBindingFingerprintV1>
  try {
    requestFingerprint = createCanonicalMutationFingerprintV1(
      expectation.envelope,
      input.keyring,
    )
    targetBindingFingerprint = createCanonicalTargetBindingFingerprintV1(
      expectation.envelope.target,
      expectation.envelope.candidates,
      input.keyring,
    )
  } catch {
    return receiptConflict()
  }
  if (requestFingerprint.keyVersion !== targetBindingFingerprint.keyVersion) {
    return receiptConflict()
  }

  const [receipt] = await tx.insert(ticketMutationReceipts).values({
    shopId: scope.actor.shopId,
    requestKey: expectation.requestKey,
    mutationSchemaVersion: expectation.mutationSchemaVersion,
    fingerprintKeyVersion: requestFingerprint.keyVersion,
    mutationKind: expectation.mutationKind,
    actorProfileId: scope.actor.id,
    targetTicketId: expectation.targetTicketId,
    targetBindingFingerprint: targetBindingFingerprint.digest,
    requestFingerprint: requestFingerprint.digest,
    resultTicketId,
    resultJobCount: resultJobIds.length,
  }).returning()
  if (!receipt) return receiptConflict()
  if (resultJobIds.length > 0) {
    await tx.insert(ticketMutationReceiptJobs).values(
      resultJobIds.map((jobId, ordinal) => ({
        shopId: scope.actor.shopId,
        receiptId: receipt.id,
        resultTicketId,
        resultJobCount: resultJobIds.length,
        ordinal,
        jobId,
      })),
    )
  }
  return immutableIdentity(resultTicketId, resultJobIds)
}
