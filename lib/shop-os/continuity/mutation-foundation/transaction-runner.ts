import 'server-only'

import { sql } from 'drizzle-orm'
import type { AppDb } from '../../../db/queries'
import type { MutationAttemptContextV1 } from './contracts'
import type {
  LockedMutationScopeV1,
  MutationLockRequestV1,
} from './lock-order'
import { lockMutationScopeV1 } from './lock-order'
import {
  closeMutationAttemptCapabilityV1,
  createMutationAttemptCapabilityV1,
} from './attempt-capability'
import { ShopOsMutationConflict, isRetryableMutationConflict } from './conflicts'

export const MUTATION_LOCK_TIMEOUT_MS_V1 = 250
export const MUTATION_STATEMENT_TIMEOUT_MS_V1 = 5_000
export const MAX_MUTATION_ATTEMPTS_V1 = 2
export const RECOVERABLE_UNIQUE_CONSTRAINTS_V1 = [
  'ticket_mutation_receipts_shop_request_key_uq',
  'sessions_pkey',
] as const

export type RecoverableUniqueConstraintV1 =
  (typeof RECOVERABLE_UNIQUE_CONSTRAINTS_V1)[number]

export type BoundedMutationDiscoveryV1<TDiscovery> = Readonly<{
  lockRequest: MutationLockRequestV1
  payload: TDiscovery
}>

export type BoundedMutationOperationV1<T, TDiscovery = undefined> = Readonly<{
  discover: (
    tx: AppDb,
    attempt: MutationAttemptContextV1,
  ) => Promise<BoundedMutationDiscoveryV1<TDiscovery>>
  executeLocked: (
    tx: AppDb,
    scope: LockedMutationScopeV1,
    discovery: TDiscovery,
    attempt: MutationAttemptContextV1,
  ) => Promise<T>
  uniqueCollisionRecovery?: Readonly<{
    allowedConstraints: readonly RecoverableUniqueConstraintV1[]
    executeLocked: (
      tx: AppDb,
      scope: LockedMutationScopeV1,
      discovery: TDiscovery,
      attempt: MutationAttemptContextV1,
      constraint: RecoverableUniqueConstraintV1,
    ) => Promise<
      | Readonly<{ kind: 'recovered'; value: T }>
      | Readonly<{ kind: 'unresolved' }>
    >
  }>
}>

const RECOVERABLE_UNIQUE_CONSTRAINT_SET = new Set<string>(
  RECOVERABLE_UNIQUE_CONSTRAINTS_V1,
)
const MAX_ERROR_CAUSE_DEPTH = 8

function ownDataProperty(value: object, name: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

function recoverableUniqueConstraint(
  error: unknown,
): RecoverableUniqueConstraintV1 | null {
  const seen = new WeakSet<object>()
  let current = error
  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if ((typeof current !== 'object' || current === null) && typeof current !== 'function') {
      return null
    }
    if (seen.has(current)) return null
    seen.add(current)
    const code = ownDataProperty(current, 'code')
    if (code === '23505') {
      const constraint = ownDataProperty(current, 'constraint')
      const constraintName = ownDataProperty(current, 'constraint_name')
      if (
        constraint !== undefined && constraintName !== undefined &&
        constraint !== constraintName
      ) return null
      const candidate = constraint ?? constraintName
      return typeof candidate === 'string' && RECOVERABLE_UNIQUE_CONSTRAINT_SET.has(candidate)
        ? candidate as RecoverableUniqueConstraintV1
        : null
    }
    current = ownDataProperty(current, 'cause')
  }
  return null
}

async function runPrimaryAttempt<T, TDiscovery>(
  db: AppDb,
  operation: BoundedMutationOperationV1<T, TDiscovery>,
  ordinal: 1 | 2,
): Promise<T> {
  return db.transaction(async (rawTx) => {
    const tx = rawTx as AppDb
    await tx.execute(sql`set local lock_timeout = '250ms'`)
    await tx.execute(sql`set local statement_timeout = '5000ms'`)
    const attempt = createMutationAttemptCapabilityV1(tx, {
      ordinal,
      purpose: 'primary',
    })
    try {
      const discovery = await operation.discover(tx, attempt)
      const scope = await lockMutationScopeV1(
        tx,
        attempt.capability,
        discovery.lockRequest,
      )
      return await operation.executeLocked(
        tx,
        scope,
        discovery.payload,
        attempt,
      )
    } finally {
      closeMutationAttemptCapabilityV1(attempt.capability)
    }
  })
}

async function runRecoveryAttempt<T, TDiscovery>(
  db: AppDb,
  operation: BoundedMutationOperationV1<T, TDiscovery>,
  constraint: RecoverableUniqueConstraintV1,
): Promise<Readonly<{ kind: 'recovered'; value: T }> | Readonly<{ kind: 'unresolved' }>> {
  const recovery = operation.uniqueCollisionRecovery
  if (!recovery) return { kind: 'unresolved' }
  return db.transaction(async (rawTx) => {
    const tx = rawTx as AppDb
    await tx.execute(sql`set local lock_timeout = '250ms'`)
    await tx.execute(sql`set local statement_timeout = '5000ms'`)
    const attempt = createMutationAttemptCapabilityV1(tx, {
      ordinal: 2,
      purpose: 'unique_collision_recovery',
    })
    try {
      const discovery = await operation.discover(tx, attempt)
      const scope = await lockMutationScopeV1(
        tx,
        attempt.capability,
        discovery.lockRequest,
      )
      return await recovery.executeLocked(
        tx,
        scope,
        discovery.payload,
        attempt,
        constraint,
      )
    } finally {
      closeMutationAttemptCapabilityV1(attempt.capability)
    }
  })
}

export async function runBoundedShopOsMutationV1<T, TDiscovery = undefined>(
  db: AppDb,
  operation: BoundedMutationOperationV1<T, TDiscovery>,
): Promise<T> {
  for (const ordinal of [1, 2] as const) {
    try {
      return await runPrimaryAttempt(db, operation, ordinal)
    } catch (error) {
      const constraint = recoverableUniqueConstraint(error)
      if (
        ordinal === 1 && constraint !== null &&
        operation.uniqueCollisionRecovery?.allowedConstraints.includes(constraint)
      ) {
        const result = await runRecoveryAttempt(db, operation, constraint)
        if (result.kind === 'recovered') return result.value
        throw error
      }
      if (!isRetryableMutationConflict(error)) throw error
      if (ordinal === MAX_MUTATION_ATTEMPTS_V1) throw new ShopOsMutationConflict()
    }
  }
  throw new ShopOsMutationConflict()
}
