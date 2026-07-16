import 'server-only'

import type { AppDb } from '../../../db/queries'
import type {
  TicketOperationOriginV1,
  TrustedTicketOriginV1,
} from './contracts'
import type { LockedMutationScopeV1 } from './lock-order'
import { assertLiveLockedMutationScopeV1 } from './attempt-capability'

type TrustedTicketOriginState =
  | Readonly<{ kind: 'counter' }>
  | Readonly<{ kind: 'tech_quick'; sessionId: string }>
  | Readonly<{ kind: 'quick_quote'; requestKey: string }>

const trustedTicketOriginStates = new WeakMap<
  TrustedTicketOriginV1,
  TrustedTicketOriginState
>()
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function invalidOrigin(): never {
  throw new Error('trusted_ticket_origin_invalid')
}

function normalizeUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) return invalidOrigin()
  return value.toLowerCase()
}

function createOrigin(state: TrustedTicketOriginState): TrustedTicketOriginV1 {
  const origin = Object.freeze(Object.create(null) as TrustedTicketOriginV1)
  trustedTicketOriginStates.set(origin, Object.freeze(state))
  return origin
}

function stateFor(origin: TrustedTicketOriginV1): TrustedTicketOriginState {
  if ((typeof origin !== 'object' || origin === null) && typeof origin !== 'function') {
    return invalidOrigin()
  }
  return trustedTicketOriginStates.get(origin) ?? invalidOrigin()
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

export function createCounterTicketOriginV1(): TrustedTicketOriginV1 {
  return createOrigin({ kind: 'counter' })
}

export function createTechQuickTicketOriginV1(
  _sessionId: string,
): TrustedTicketOriginV1 {
  return createOrigin({
    kind: 'tech_quick',
    sessionId: normalizeUuid(_sessionId),
  })
}

export function createQuickTicketOriginV1(
  _requestKey: string,
): TrustedTicketOriginV1 {
  return createOrigin({
    kind: 'quick_quote',
    requestKey: normalizeUuid(_requestKey),
  })
}

export function resolveTrustedTicketOriginInLockedScopeV1(
  _tx: AppDb,
  _scope: LockedMutationScopeV1,
  _origin: TrustedTicketOriginV1,
  _context: Readonly<{
    mode: 'insert' | 'intake_insert' | 'quick_insert' | 'replay' | 'tech_quick_replay'
    canonicalRequestKey: string | null
    ticketId: string
    jobs: readonly Readonly<{
      id: string
      ticketId: string
      sessionId: string | null
    }>[]
  }>,
): TicketOperationOriginV1 {
  assertLiveLockedMutationScopeV1(_tx, _scope)
  const state = stateFor(_origin)
  let ticketId: string
  let jobs: readonly Readonly<{
    id: string
    ticketId: string
    sessionId: string | null
  }>[]
  try {
    ticketId = normalizeUuid(_context.ticketId)
    if (!Array.isArray(_context.jobs)) return invalidOrigin()
    jobs = _context.jobs.map((job) => Object.freeze({
      id: normalizeUuid(job.id),
      ticketId: normalizeUuid(job.ticketId),
      sessionId: job.sessionId === null ? null : normalizeUuid(job.sessionId),
    }))
  } catch {
    return invalidOrigin()
  }
  if (
    _scope.actor.shopId !== _scope.request.shopId ||
    jobs.some((job) => job.ticketId !== ticketId)
  ) return invalidOrigin()

  if (state.kind === 'counter') {
    if (
      (_context.mode !== 'insert' && _context.mode !== 'intake_insert') ||
      _context.canonicalRequestKey !== null ||
      _scope.request.receiptRequestKey !== null ||
      _scope.insertionIntents.sessions.length !== 0 ||
      jobs.some((job) => job.sessionId !== null)
    ) return invalidOrigin()
    return 'counter'
  }

  if (state.kind === 'quick_quote') {
    let canonicalRequestKey: string
    try {
      canonicalRequestKey = normalizeUuid(_context.canonicalRequestKey)
    } catch {
      return invalidOrigin()
    }
    if (
      (_context.mode !== 'quick_insert' && _context.mode !== 'replay') ||
      state.requestKey !== canonicalRequestKey ||
      _scope.request.receiptRequestKey !== canonicalRequestKey
    ) return invalidOrigin()
    if (
      _context.mode === 'quick_insert' && (
        _scope.insertionIntents.sessions.length !== 0 ||
        jobs.some((job) => job.sessionId !== null)
      )
    ) return invalidOrigin()
    return 'quick_quote'
  }

  if (_context.mode === 'tech_quick_replay') {
    let canonicalRequestKey: string
    try {
      canonicalRequestKey = normalizeUuid(_context.canonicalRequestKey)
    } catch {
      return invalidOrigin()
    }
    const session = _scope.sessions.filter(({ id }) => id === state.sessionId)
    const graph = _scope.tickets.find(({ ticket }) => ticket.id === ticketId)
    const linkedJobs = graph?.jobs.filter(({ sessionId }) => sessionId === state.sessionId) ?? []
    if (
      state.sessionId !== canonicalRequestKey ||
      _scope.request.receiptRequestKey !== null ||
      _scope.request.lockShop !== true || _scope.shop?.id !== _scope.actor.shopId ||
      _scope.insertionIntents.sessions.length !== 0 ||
      _scope.insertionIntents.customers.length !== 0 ||
      _scope.insertionIntents.vehicles.length !== 0 ||
      _scope.insertionIntents.tickets.length !== 0 ||
      _scope.insertionIntents.jobs.length !== 0 ||
      session.length !== 1 || session[0]?.techId !== _scope.actor.id ||
      session[0]?.shopId !== _scope.actor.shopId ||
      _scope.tickets.length !== 1 || !graph || linkedJobs.length !== 1 ||
      jobs.length !== 1 || jobs[0]?.id !== linkedJobs[0]?.id ||
      jobs[0]?.ticketId !== graph.ticket.id || jobs[0]?.sessionId !== state.sessionId ||
      !_scope.request.sessionIds.includes(state.sessionId) ||
      !sameIds(_scope.request.ticketIds, [graph.ticket.id]) ||
      !sameIds(_scope.request.jobIds, [linkedJobs[0]!.id])
    ) return invalidOrigin()
    return 'tech_quick'
  }

  const sessionIntents = _scope.insertionIntents.sessions
  const jobIntents = _scope.insertionIntents.jobs
  if (
    _context.mode !== 'insert' ||
    _context.canonicalRequestKey !== null ||
    _scope.request.receiptRequestKey !== null ||
    sessionIntents.length !== 1 ||
    sessionIntents[0]?.id !== state.sessionId ||
    sessionIntents[0]?.shopId !== _scope.actor.shopId ||
    sessionIntents[0]?.techId !== _scope.actor.id ||
    jobs.length !== 1 ||
    jobs[0]?.sessionId !== state.sessionId ||
    _scope.insertionIntents.tickets.length !== 1 ||
    _scope.insertionIntents.tickets[0] !== ticketId ||
    jobIntents.length !== 1 ||
    jobIntents[0]?.id !== jobs[0]?.id ||
    jobIntents[0]?.ticketId !== ticketId ||
    !sameIds(_scope.request.profileIds, [_scope.actor.id])
  ) return invalidOrigin()
  return 'tech_quick'
}
