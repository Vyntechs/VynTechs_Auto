import {
  TICKET_CREATING_MUTATION_KINDS_V1,
  TICKET_MUTATION_KINDS,
} from './contracts'
import type {
  CandidateBindingV1,
  CanonicalMutationEnvelopeV1,
  CanonicalValue,
  MutationFingerprintKeyringV1,
  RevisionDecimal,
  TicketMutationKind,
  TicketOperationOriginV1,
} from './contracts'
import {
  signCanonicalMutationPayloadV1,
  verifyCanonicalMutationPayloadV1,
} from './keyring'

const SIGNED_BIGINT_MAX = 9_223_372_036_854_775_807n
const REVISION_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)$/
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const TICKET_MUTATION_KIND_SET = new Set<string>(TICKET_MUTATION_KINDS)
const TICKET_CREATING_MUTATION_KIND_SET = new Set<string>(TICKET_CREATING_MUTATION_KINDS_V1)
const OPERATION_ORIGIN_SET = new Set<string>(['counter', 'quick_quote', 'tech_quick'])

function invalidRevisionDecimal(): never {
  throw new Error('invalid_revision_decimal')
}

function invalidCanonicalValue(): never {
  throw new Error('invalid_canonical_value')
}

function invalidCandidateBindings(): never {
  throw new Error('invalid_candidate_bindings')
}

export function parseRevisionDecimal(value: unknown): bigint {
  if (typeof value !== 'string' || !REVISION_DECIMAL_PATTERN.test(value)) {
    return invalidRevisionDecimal()
  }

  try {
    const parsed = BigInt(value)
    if (parsed > SIGNED_BIGINT_MAX) return invalidRevisionDecimal()
    return parsed
  } catch {
    return invalidRevisionDecimal()
  }
}

export function serializeRevisionDecimal(value: bigint): RevisionDecimal {
  if (typeof value !== 'bigint' || value < 0n || value > SIGNED_BIGINT_MAX) {
    return invalidRevisionDecimal()
  }
  return value.toString() as RevisionDecimal
}

function serializeCanonicalValue(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) return invalidCanonicalValue()
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') return invalidCanonicalValue()
  if (ancestors.has(value)) return invalidCanonicalValue()

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return invalidCanonicalValue()
      const keys = Reflect.ownKeys(value)
      if (keys.some((key) => typeof key === 'symbol')) return invalidCanonicalValue()
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
      if (
        !lengthDescriptor ||
        lengthDescriptor.enumerable ||
        !('value' in lengthDescriptor) ||
        !Number.isSafeInteger(lengthDescriptor.value) ||
        lengthDescriptor.value < 0
      ) {
        return invalidCanonicalValue()
      }
      const length = lengthDescriptor.value as number
      if (keys.length !== length + 1 || !keys.includes('length')) {
        return invalidCanonicalValue()
      }

      const values: string[] = []
      for (let index = 0; index < length; index += 1) {
        const key = String(index)
        if (!keys.includes(key)) return invalidCanonicalValue()
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          return invalidCanonicalValue()
        }
        values.push(serializeCanonicalValue(descriptor.value, ancestors))
      }

      return `[${values.join(',')}]`
    }

    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return invalidCanonicalValue()
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.some((key) => typeof key === 'symbol')) return invalidCanonicalValue()
    const keys = ownKeys as string[]

    const entries: string[] = []
    for (const key of [...keys].sort()) {
      if (FORBIDDEN_OBJECT_KEYS.has(key)) return invalidCanonicalValue()
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        return invalidCanonicalValue()
      }
      entries.push(`${JSON.stringify(key)}:${serializeCanonicalValue(descriptor.value, ancestors)}`)
    }
    return `{${entries.join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

export function canonicalJsonV1(value: CanonicalValue): string {
  try {
    return serializeCanonicalValue(value, new WeakSet())
  } catch {
    return invalidCanonicalValue()
  }
}

function readDenseArrayValues(value: unknown): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return invalidCandidateBindings()
  }
  const keys = Reflect.ownKeys(value)
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    keys.some((key) => typeof key === 'symbol') ||
    !lengthDescriptor ||
    lengthDescriptor.enumerable ||
    !('value' in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    keys.length !== lengthDescriptor.value + 1 ||
    !keys.includes('length')
  ) {
    return invalidCandidateBindings()
  }
  const length = lengthDescriptor.value as number

  const result: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    const key = String(index)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      return invalidCandidateBindings()
    }
    result.push(descriptor.value)
  }
  return result
}

function readCandidateBinding(value: unknown): CandidateBindingV1 {
  if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) {
    return invalidCandidateBindings()
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== 2 ||
    keys.some((key) => typeof key !== 'string') ||
    !keys.includes('ticketId') ||
    !keys.includes('continuityRevision')
  ) {
    return invalidCandidateBindings()
  }

  const ticketIdDescriptor = Object.getOwnPropertyDescriptor(value, 'ticketId')
  const revisionDescriptor = Object.getOwnPropertyDescriptor(value, 'continuityRevision')
  if (
    !ticketIdDescriptor?.enumerable ||
    !('value' in ticketIdDescriptor) ||
    typeof ticketIdDescriptor.value !== 'string' ||
    !UUID_PATTERN.test(ticketIdDescriptor.value) ||
    !revisionDescriptor?.enumerable ||
    !('value' in revisionDescriptor)
  ) {
    return invalidCandidateBindings()
  }

  return {
    ticketId: ticketIdDescriptor.value.toLowerCase(),
    continuityRevision: serializeRevisionDecimal(parseRevisionDecimal(revisionDescriptor.value)),
  }
}

export function normalizeCandidateBindingsV1(
  value: readonly CandidateBindingV1[],
): readonly CandidateBindingV1[] {
  try {
    const normalized = readDenseArrayValues(value).map(readCandidateBinding)
    normalized.sort((left, right) =>
      left.ticketId < right.ticketId ? -1 : left.ticketId > right.ticketId ? 1 : 0,
    )
    for (let index = 1; index < normalized.length; index += 1) {
      if (normalized[index - 1]?.ticketId === normalized[index]?.ticketId) {
        return invalidCandidateBindings()
      }
    }
    return normalized
  } catch {
    return invalidCandidateBindings()
  }
}

function invalidCanonicalMutationEnvelope(): never {
  throw new Error('invalid_canonical_mutation_envelope')
}

function readExactDataRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return invalidCanonicalMutationEnvelope()
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidCanonicalMutationEnvelope()
  }
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some((key) => typeof key !== 'string') ||
    expectedKeys.some((key) => !ownKeys.includes(key))
  ) {
    return invalidCanonicalMutationEnvelope()
  }

  const result: Record<string, unknown> = Object.create(null)
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      return invalidCanonicalMutationEnvelope()
    }
    result[key] = descriptor.value
  }
  return result
}

function canonicalMutationPayloadV1(envelope: CanonicalMutationEnvelopeV1): string {
  try {
    const value = readExactDataRecord(envelope, [
      'schemaVersion',
      'mutationKind',
      'operationOrigin',
      'actorProfileId',
      'target',
      'candidates',
      'payload',
    ])
    if (value.schemaVersion !== 1) return invalidCanonicalMutationEnvelope()
    if (typeof value.mutationKind !== 'string' || !TICKET_MUTATION_KIND_SET.has(value.mutationKind)) {
      return invalidCanonicalMutationEnvelope()
    }
    if (
      value.operationOrigin !== null &&
      (typeof value.operationOrigin !== 'string' || !OPERATION_ORIGIN_SET.has(value.operationOrigin))
    ) {
      return invalidCanonicalMutationEnvelope()
    }
    const creating = TICKET_CREATING_MUTATION_KIND_SET.has(value.mutationKind)
    if ((creating && value.operationOrigin === null) || (!creating && value.operationOrigin !== null)) {
      return invalidCanonicalMutationEnvelope()
    }
    if (typeof value.actorProfileId !== 'string' || value.actorProfileId.length === 0) {
      return invalidCanonicalMutationEnvelope()
    }
    if (
      typeof value.target !== 'object' ||
      value.target === null ||
      Array.isArray(value.target) ||
      typeof value.payload !== 'object' ||
      value.payload === null ||
      Array.isArray(value.payload)
    ) {
      return invalidCanonicalMutationEnvelope()
    }

    const normalized: CanonicalMutationEnvelopeV1 = {
      schemaVersion: 1,
      mutationKind: value.mutationKind as TicketMutationKind,
      operationOrigin: value.operationOrigin as TicketOperationOriginV1 | null,
      actorProfileId: value.actorProfileId,
      target: value.target as Readonly<Record<string, CanonicalValue>>,
      candidates: normalizeCandidateBindingsV1(
        value.candidates as readonly CandidateBindingV1[],
      ),
      payload: value.payload as Readonly<Record<string, CanonicalValue>>,
    }
    return canonicalJsonV1(normalized)
  } catch {
    return invalidCanonicalMutationEnvelope()
  }
}

export function createCanonicalMutationFingerprintV1(
  envelope: CanonicalMutationEnvelopeV1,
  keyring: MutationFingerprintKeyringV1,
): Readonly<{ keyVersion: number; digest: string }> {
  const canonicalPayload = canonicalMutationPayloadV1(envelope)
  return signCanonicalMutationPayloadV1(keyring, canonicalPayload)
}

export function verifyCanonicalMutationFingerprintV1(
  envelope: CanonicalMutationEnvelopeV1,
  persisted: Readonly<{ keyVersion: number; digest: string }>,
  keyring: MutationFingerprintKeyringV1,
): 'match' | 'mismatch' | 'verification_unavailable' {
  const canonicalPayload = canonicalMutationPayloadV1(envelope)
  let persistedValue: Record<string, unknown>
  try {
    persistedValue = readExactDataRecord(persisted, ['keyVersion', 'digest'])
  } catch {
    return 'mismatch'
  }
  if (typeof persistedValue.keyVersion !== 'number' || typeof persistedValue.digest !== 'string') {
    return 'mismatch'
  }
  return verifyCanonicalMutationPayloadV1(
    keyring,
    persistedValue.keyVersion,
    canonicalPayload,
    persistedValue.digest,
  )
}

export function createCanonicalTargetBindingFingerprintV1(
  target: CanonicalMutationEnvelopeV1['target'],
  candidates: CanonicalMutationEnvelopeV1['candidates'],
  keyring: MutationFingerprintKeyringV1,
): Readonly<{ keyVersion: number; digest: string }> {
  return signCanonicalMutationPayloadV1(
    keyring,
    canonicalTargetBindingPayloadV1(target, candidates),
  )
}

function canonicalTargetBindingPayloadV1(
  target: CanonicalMutationEnvelopeV1['target'],
  candidates: CanonicalMutationEnvelopeV1['candidates'],
): string {
  let canonicalPayload: string
  try {
    if (typeof target !== 'object' || target === null || Array.isArray(target)) {
      return invalidCanonicalMutationEnvelope()
    }
    canonicalPayload = canonicalJsonV1({
      schemaVersion: 1,
      target,
      candidates: normalizeCandidateBindingsV1(candidates),
    })
  } catch {
    return invalidCanonicalMutationEnvelope()
  }
  return canonicalPayload
}

export function verifyCanonicalTargetBindingFingerprintV1(
  target: CanonicalMutationEnvelopeV1['target'],
  candidates: CanonicalMutationEnvelopeV1['candidates'],
  persisted: Readonly<{ keyVersion: number; digest: string }>,
  keyring: MutationFingerprintKeyringV1,
): 'match' | 'mismatch' | 'verification_unavailable' {
  const canonicalPayload = canonicalTargetBindingPayloadV1(target, candidates)
  let persistedValue: Record<string, unknown>
  try {
    persistedValue = readExactDataRecord(persisted, ['keyVersion', 'digest'])
  } catch {
    return 'mismatch'
  }
  if (typeof persistedValue.keyVersion !== 'number' || typeof persistedValue.digest !== 'string') {
    return 'mismatch'
  }
  return verifyCanonicalMutationPayloadV1(
    keyring,
    persistedValue.keyVersion,
    canonicalPayload,
    persistedValue.digest,
  )
}
