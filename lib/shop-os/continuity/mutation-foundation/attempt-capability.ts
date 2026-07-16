import 'server-only'

import type { AppDb } from '../../../db/queries'
import type {
  MutationAttemptCapabilityV1,
  MutationAttemptContextV1,
} from './contracts'
import type { LockedMutationScopeV1 } from './lock-order'

type AttemptState = {
  tx: AppDb
  ordinal: 1 | 2
  purpose: 'primary' | 'unique_collision_recovery'
  live: boolean
  scope?: LockedMutationScopeV1
}

const attemptStates = new WeakMap<MutationAttemptCapabilityV1, AttemptState>()
const scopeOwners = new WeakMap<LockedMutationScopeV1, MutationAttemptCapabilityV1>()

function invalidAttempt(): never {
  throw new Error('mutation_attempt_capability_invalid')
}

function stateFor(capability: MutationAttemptCapabilityV1): AttemptState {
  if ((typeof capability !== 'object' || capability === null) && typeof capability !== 'function') {
    return invalidAttempt()
  }
  return attemptStates.get(capability) ?? invalidAttempt()
}

export function createMutationAttemptCapabilityV1(
  _tx: AppDb,
  _input: Readonly<{
    ordinal: 1 | 2
    purpose: 'primary' | 'unique_collision_recovery'
  }>,
): MutationAttemptContextV1 {
  const capability = Object.freeze(
    Object.create(null) as MutationAttemptCapabilityV1,
  )
  attemptStates.set(capability, {
    tx: _tx,
    ordinal: _input.ordinal,
    purpose: _input.purpose,
    live: true,
  })
  return Object.freeze({
    capability,
    ordinal: _input.ordinal,
    purpose: _input.purpose,
  })
}

export function bindLockedMutationScopeToAttemptV1(
  _tx: AppDb,
  _capability: MutationAttemptCapabilityV1,
  _scope: LockedMutationScopeV1,
): void {
  assertLiveMutationAttemptV1(_tx, _capability)
  if (typeof _scope !== 'object' || _scope === null) {
    throw new Error('mutation_scope_invalid')
  }
  const state = stateFor(_capability)
  if (state.scope !== undefined) throw new Error('mutation_scope_already_bound')
  if (scopeOwners.has(_scope)) throw new Error('mutation_scope_already_owned')
  state.scope = _scope
  scopeOwners.set(_scope, _capability)
}

export function assertLiveMutationAttemptV1(
  _tx: AppDb,
  _capability: MutationAttemptCapabilityV1,
): void {
  const state = stateFor(_capability)
  if (!state.live) throw new Error('mutation_attempt_capability_closed')
  if (state.tx !== _tx) throw new Error('mutation_attempt_transaction_mismatch')
}

export function assertLiveLockedMutationScopeV1(
  _tx: AppDb,
  _scope: LockedMutationScopeV1,
): MutationAttemptCapabilityV1 {
  if (typeof _scope !== 'object' || _scope === null) {
    throw new Error('mutation_scope_invalid')
  }
  const capability = scopeOwners.get(_scope)
  if (!capability) throw new Error('mutation_scope_unbound')
  assertLiveMutationAttemptV1(_tx, capability)
  const state = stateFor(capability)
  if (state.scope !== _scope) throw new Error('mutation_scope_attempt_mismatch')
  return capability
}

export function closeMutationAttemptCapabilityV1(
  _capability: MutationAttemptCapabilityV1,
): void {
  const state = stateFor(_capability)
  if (!state.live) throw new Error('mutation_attempt_capability_closed')
  state.live = false
}
