import { and, eq, inArray } from 'drizzle-orm'
import type { AppDb } from '../../../db/queries'
import {
  cannedJobs,
  customers,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  sessions,
  sessionEvents,
  shops,
  ticketJobs,
  ticketMutationReceipts,
  tickets,
  vehicles,
  vendorAccounts,
} from '../../../db/schema'
import {
  ShopOsMutationNotFound,
} from './contracts'
import type {
  ContinuitySignatureV1,
  LockedActiveActorV1,
  LockedTicketGraphV1,
  MutationAttemptCapabilityV1,
  MutationInsertionIntentsV1,
  MutationLockExtensionV1,
  NormalizedMutationLockRequestV1,
} from './contracts'
import {
  assertLiveMutationAttemptV1,
  bindLockedMutationScopeToAttemptV1,
} from './attempt-capability'
import { ShopOsMutationConflict } from './conflicts'
import { buildContinuitySignatureV1 } from './continuity-signature'
import { peekMutationReceiptV1 } from './receipts'

export const REPOSITORY_LOCK_CLASSES_V1 = [
  'profiles',
  'shop',
  'customers',
  'vehicles',
  'tickets',
  'ticket_jobs',
  'job_lines',
  'quote_versions',
  'quote_events',
  'quote_sends_and_orders',
  'sessions',
  'session_events',
  'vendor_accounts',
  'canned_jobs',
  'mutation_receipts',
] as const

export type RepositoryLockClassV1 = (typeof REPOSITORY_LOCK_CLASSES_V1)[number]

export type MutationLockRequestV1 = Readonly<{
  shopId: string
  actorProfileId: string
  profileIds: readonly string[]
  lockShop: boolean
  customerIds: readonly string[]
  vehicleIds: readonly string[]
  ticketIds: readonly string[]
  jobIds: readonly string[]
  includeAllJobsForTickets: boolean
  includeAllLinesForJobs: boolean
  includeAllQuoteVersionsForTickets: boolean
  includeAllQuoteEventsForTickets: boolean
  sessionIds: readonly string[]
  sessionEventIds: readonly string[]
  vendorAccountIds: readonly string[]
  cannedJobIds: readonly string[]
  receiptRequestKey: string | null
  receiptConditionalInsert:
    | null
    | Readonly<{ kind: 'prepared'; extension: MutationLockExtensionV1 }>
    | Readonly<{ kind: 'unavailable' }>
  insertionIntents: MutationInsertionIntentsV1
}>

export type LockedMutationScopeV1 = Readonly<{
  actor: LockedActiveActorV1
  request: NormalizedMutationLockRequestV1
  profiles: readonly (typeof profiles.$inferSelect)[]
  shop: typeof shops.$inferSelect | null
  customers: readonly (typeof customers.$inferSelect)[]
  vehicles: readonly (typeof vehicles.$inferSelect)[]
  tickets: readonly LockedTicketGraphV1[]
  sessions: readonly (typeof sessions.$inferSelect)[]
  sessionEvents: readonly (typeof sessionEvents.$inferSelect)[]
  vendorAccounts: readonly (typeof vendorAccounts.$inferSelect)[]
  cannedJobs: readonly (typeof cannedJobs.$inferSelect)[]
  beforeSignatures: ReadonlyMap<string, ContinuitySignatureV1>
  insertionIntents: NormalizedMutationLockRequestV1['insertionIntents']
  receiptPeek:
    | Readonly<{ kind: 'none' | 'occupied' }>
    | Readonly<{ kind: 'owned'; receiptId: string; resultTicketId: string }>
  receiptConditionalInsertState:
    | 'not_applicable'
    | 'activated'
    | 'suppressed_by_owned_receipt'
    | 'suppressed_by_occupied_receipt'
    | 'unavailable'
}>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTOR_ROLES = new Set(['tech', 'advisor', 'parts', 'owner'])

function invalidLockRequest(): never {
  throw new TypeError('invalid_mutation_lock_request')
}

function normalizeUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) return invalidLockRequest()
  return value.toLowerCase()
}

function normalizeCanonicalUuid(value: unknown): string {
  const normalized = normalizeUuid(value)
  if (value !== normalized) return invalidLockRequest()
  return normalized
}

function normalizeUuidList(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return invalidLockRequest()
  return Object.freeze([...new Set(value.map(normalizeUuid))].sort())
}

function normalizeInsertionIntents(
  value: MutationInsertionIntentsV1,
): MutationInsertionIntentsV1 {
  if (
    typeof value !== 'object' || value === null ||
    !Array.isArray(value.sessions) || !Array.isArray(value.customers) ||
    !Array.isArray(value.vehicles) || !Array.isArray(value.tickets) ||
    !Array.isArray(value.jobs)
  ) return invalidLockRequest()
  const normalized = Object.freeze({
    sessions: Object.freeze(value.sessions.map((intent) => Object.freeze({
      id: normalizeCanonicalUuid(intent.id),
      shopId: normalizeUuid(intent.shopId),
      techId: normalizeUuid(intent.techId),
    }))),
    customers: Object.freeze(value.customers.map((intent) => Object.freeze({
      id: normalizeCanonicalUuid(intent.id),
      shopId: normalizeUuid(intent.shopId),
    }))),
    vehicles: Object.freeze(value.vehicles.map((intent) => Object.freeze({
      id: normalizeCanonicalUuid(intent.id),
      customerId: normalizeUuid(intent.customerId),
    }))),
    tickets: Object.freeze(value.tickets.map(normalizeCanonicalUuid).sort()),
    jobs: Object.freeze(value.jobs.map((intent) => Object.freeze({
      id: normalizeCanonicalUuid(intent.id),
      ticketId: normalizeUuid(intent.ticketId),
    }))),
  })
  const ids = [
    ...normalized.sessions.map(({ id }) => id),
    ...normalized.customers.map(({ id }) => id),
    ...normalized.vehicles.map(({ id }) => id),
    ...normalized.tickets,
    ...normalized.jobs.map(({ id }) => id),
  ]
  if (new Set(ids).size !== ids.length) return invalidLockRequest()
  return normalized
}

function hasInsertionIntents(value: MutationInsertionIntentsV1): boolean {
  return value.sessions.length > 0 || value.customers.length > 0 ||
    value.vehicles.length > 0 || value.tickets.length > 0 || value.jobs.length > 0
}

function normalizeExtension(extension: MutationLockExtensionV1): MutationLockExtensionV1 {
  if (typeof extension !== 'object' || extension === null) return invalidLockRequest()
  for (const flag of [
    extension.lockShop,
    extension.includeAllJobsForTickets,
    extension.includeAllLinesForJobs,
    extension.includeAllQuoteVersionsForTickets,
    extension.includeAllQuoteEventsForTickets,
  ]) if (typeof flag !== 'boolean') return invalidLockRequest()
  return Object.freeze({
    lockShop: extension.lockShop,
    customerIds: normalizeUuidList(extension.customerIds),
    vehicleIds: normalizeUuidList(extension.vehicleIds),
    ticketIds: normalizeUuidList(extension.ticketIds),
    jobIds: normalizeUuidList(extension.jobIds),
    includeAllJobsForTickets: extension.includeAllJobsForTickets,
    includeAllLinesForJobs: extension.includeAllLinesForJobs,
    includeAllQuoteVersionsForTickets: extension.includeAllQuoteVersionsForTickets,
    includeAllQuoteEventsForTickets: extension.includeAllQuoteEventsForTickets,
    sessionIds: normalizeUuidList(extension.sessionIds),
    sessionEventIds: normalizeUuidList(extension.sessionEventIds),
    vendorAccountIds: normalizeUuidList(extension.vendorAccountIds),
    cannedJobIds: normalizeUuidList(extension.cannedJobIds),
    insertionIntents: normalizeInsertionIntents(extension.insertionIntents),
  })
}

function normalizeBaseRequest(request: MutationLockRequestV1): NormalizedMutationLockRequestV1 {
  if (typeof request !== 'object' || request === null) return invalidLockRequest()
  const shopId = normalizeUuid(request.shopId)
  const actorProfileId = normalizeUuid(request.actorProfileId)
  const profileIds = normalizeUuidList(request.profileIds)
  if (!profileIds.includes(actorProfileId)) return invalidLockRequest()
  for (const flag of [
    request.lockShop,
    request.includeAllJobsForTickets,
    request.includeAllLinesForJobs,
    request.includeAllQuoteVersionsForTickets,
    request.includeAllQuoteEventsForTickets,
  ]) if (typeof flag !== 'boolean') return invalidLockRequest()
  const insertionIntents = normalizeInsertionIntents(request.insertionIntents)
  const receiptRequestKey = request.receiptRequestKey === null
    ? null
    : normalizeUuid(request.receiptRequestKey)
  let receiptConditionalInsert: NormalizedMutationLockRequestV1['receiptConditionalInsert'] = null
  if (request.receiptConditionalInsert !== null) {
    if (receiptRequestKey === null) return invalidLockRequest()
    if (request.receiptConditionalInsert.kind === 'prepared') {
      receiptConditionalInsert = Object.freeze({
        kind: 'prepared',
        extension: normalizeExtension(request.receiptConditionalInsert.extension),
      })
    } else if (request.receiptConditionalInsert.kind === 'unavailable') {
      receiptConditionalInsert = Object.freeze({ kind: 'unavailable' })
    } else return invalidLockRequest()
  }
  const normalized = Object.freeze({
    shopId,
    actorProfileId,
    profileIds,
    lockShop: request.lockShop,
    customerIds: normalizeUuidList(request.customerIds),
    vehicleIds: normalizeUuidList(request.vehicleIds),
    ticketIds: normalizeUuidList(request.ticketIds),
    jobIds: normalizeUuidList(request.jobIds),
    includeAllJobsForTickets: request.includeAllJobsForTickets,
    includeAllLinesForJobs: request.includeAllLinesForJobs,
    includeAllQuoteVersionsForTickets: request.includeAllQuoteVersionsForTickets,
    includeAllQuoteEventsForTickets: request.includeAllQuoteEventsForTickets,
    sessionIds: normalizeUuidList(request.sessionIds),
    sessionEventIds: normalizeUuidList(request.sessionEventIds),
    vendorAccountIds: normalizeUuidList(request.vendorAccountIds),
    cannedJobIds: normalizeUuidList(request.cannedJobIds),
    receiptRequestKey,
    receiptConditionalInsert,
    insertionIntents,
  })
  if (receiptConditionalInsert !== null && (
    normalized.lockShop || normalized.customerIds.length > 0 ||
    normalized.vehicleIds.length > 0 || normalized.ticketIds.length > 0 ||
    normalized.jobIds.length > 0 || normalized.includeAllJobsForTickets ||
    normalized.includeAllLinesForJobs || normalized.includeAllQuoteVersionsForTickets ||
    normalized.includeAllQuoteEventsForTickets || normalized.sessionIds.length > 0 ||
    normalized.sessionEventIds.length > 0 || normalized.vendorAccountIds.length > 0 ||
    normalized.cannedJobIds.length > 0 || hasInsertionIntents(normalized.insertionIntents)
  )) return invalidLockRequest()
  return normalized
}

function mergePreparedExtension(
  base: NormalizedMutationLockRequestV1,
  extension: MutationLockExtensionV1,
): NormalizedMutationLockRequestV1 {
  return Object.freeze({
    ...base,
    lockShop: extension.lockShop,
    customerIds: extension.customerIds,
    vehicleIds: extension.vehicleIds,
    ticketIds: extension.ticketIds,
    jobIds: extension.jobIds,
    includeAllJobsForTickets: extension.includeAllJobsForTickets,
    includeAllLinesForJobs: extension.includeAllLinesForJobs,
    includeAllQuoteVersionsForTickets: extension.includeAllQuoteVersionsForTickets,
    includeAllQuoteEventsForTickets: extension.includeAllQuoteEventsForTickets,
    sessionIds: extension.sessionIds,
    sessionEventIds: extension.sessionEventIds,
    vendorAccountIds: extension.vendorAccountIds,
    cannedJobIds: extension.cannedJobIds,
    insertionIntents: extension.insertionIntents,
  })
}

function validateInsertionIntents(request: NormalizedMutationLockRequestV1): void {
  const intents = request.insertionIntents
  if (hasInsertionIntents(intents) && !request.lockShop) return invalidLockRequest()
  const profileIds = new Set(request.profileIds)
  const customerParents = new Set([
    ...request.customerIds,
    ...intents.customers.map(({ id }) => id),
  ])
  const ticketParents = new Set([...request.ticketIds, ...intents.tickets])
  if (
    intents.sessions.some((intent) =>
      intent.shopId !== request.shopId || !profileIds.has(intent.techId)) ||
    intents.customers.some((intent) => intent.shopId !== request.shopId) ||
    intents.vehicles.some((intent) => !customerParents.has(intent.customerId)) ||
    intents.jobs.some((intent) => !ticketParents.has(intent.ticketId))
  ) return invalidLockRequest()
  const collisions = [
    intents.customers.some(({ id }) => request.customerIds.includes(id)),
    intents.vehicles.some(({ id }) => request.vehicleIds.includes(id)),
    intents.tickets.some((id) => request.ticketIds.includes(id)),
    intents.jobs.some(({ id }) => request.jobIds.includes(id)),
    intents.sessions.some(({ id }) => request.sessionIds.includes(id)),
  ]
  if (collisions.some(Boolean)) return invalidLockRequest()
}

async function discoverOwnedReplayRequest(
  tx: AppDb,
  base: NormalizedMutationLockRequestV1,
  resultTicketId: string,
): Promise<NormalizedMutationLockRequestV1> {
  const [ticket] = await tx.select({
    id: tickets.id,
    customerId: tickets.customerId,
    vehicleId: tickets.vehicleId,
  }).from(tickets).where(and(
    eq(tickets.shopId, base.shopId),
    eq(tickets.id, resultTicketId),
  )).limit(1)
  if (!ticket) throw new ShopOsMutationConflict()
  const jobs = await tx.select({
    id: ticketJobs.id,
    sessionId: ticketJobs.sessionId,
  }).from(ticketJobs).where(and(
    eq(ticketJobs.shopId, base.shopId),
    eq(ticketJobs.ticketId, ticket.id),
  )).orderBy(ticketJobs.id)
  return Object.freeze({
    ...base,
    lockShop: false,
    customerIds: Object.freeze(ticket.customerId === null ? [] : [ticket.customerId]),
    vehicleIds: Object.freeze(ticket.vehicleId === null ? [] : [ticket.vehicleId]),
    ticketIds: Object.freeze([ticket.id]),
    jobIds: Object.freeze(jobs.map(({ id }) => id)),
    includeAllJobsForTickets: true,
    includeAllLinesForJobs: true,
    includeAllQuoteVersionsForTickets: false,
    includeAllQuoteEventsForTickets: false,
    sessionIds: Object.freeze([
      ...new Set(jobs.flatMap(({ sessionId }) => sessionId === null ? [] : [sessionId])),
    ].sort()),
    sessionEventIds: Object.freeze([]),
    vendorAccountIds: Object.freeze([]),
    cannedJobIds: Object.freeze([]),
    insertionIntents: base.insertionIntents,
  })
}

const DATE_MUTATORS = new Set<PropertyKey>([
  'setDate',
  'setFullYear',
  'setHours',
  'setMilliseconds',
  'setMinutes',
  'setMonth',
  'setSeconds',
  'setTime',
  'setUTCDate',
  'setUTCFullYear',
  'setUTCHours',
  'setUTCMilliseconds',
  'setUTCMinutes',
  'setUTCMonth',
  'setUTCSeconds',
  'setYear',
])

function invalidLockedValue(): never {
  throw new TypeError('invalid_locked_mutation_value')
}

function immutableDateSnapshot(value: Date): Date {
  const timestamp = value.getTime()
  if (!Number.isFinite(timestamp)) return invalidLockedValue()
  const target = Object.freeze(new Date(timestamp))
  return new Proxy(target, {
    get(date, property) {
      if (DATE_MUTATORS.has(property)) return invalidLockedValue
      const member = Reflect.get(date, property, date)
      if (property === 'constructor') return member
      return typeof member === 'function' ? member.bind(date) : member
    },
    set: invalidLockedValue,
    defineProperty: invalidLockedValue,
    deleteProperty: invalidLockedValue,
    setPrototypeOf: invalidLockedValue,
  })
}

function immutableSnapshot<T>(value: T, ancestors = new WeakSet<object>()): T {
  if (
    value === null || value === undefined ||
    typeof value === 'string' || typeof value === 'number' ||
    typeof value === 'boolean' || typeof value === 'bigint'
  ) return value
  if (typeof value !== 'object') return invalidLockedValue()
  if (value instanceof Date) return immutableDateSnapshot(value) as T
  if (ancestors.has(value)) return invalidLockedValue()

  const prototype = Object.getPrototypeOf(value)
  if (
    prototype !== Object.prototype && prototype !== null &&
    !(Array.isArray(value) && prototype === Array.prototype)
  ) return invalidLockedValue()
  if (Object.getOwnPropertySymbols(value).length > 0) return invalidLockedValue()

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const keys = Object.getOwnPropertyNames(value)
      if (
        keys.length !== value.length + 1 ||
        keys[value.length] !== 'length'
      ) return invalidLockedValue()
      const snapshot: unknown[] = []
      for (let index = 0; index < value.length; index += 1) {
        const key = String(index)
        if (keys[index] !== key) return invalidLockedValue()
        const descriptor = Object.getOwnPropertyDescriptor(value, key)
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
          return invalidLockedValue()
        }
        snapshot.push(immutableSnapshot(descriptor.value, ancestors))
      }
      return Object.freeze(snapshot) as T
    }

    const snapshot = Object.create(prototype) as Record<string, unknown>
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor)) return invalidLockedValue()
      Object.defineProperty(snapshot, key, {
        configurable: false,
        enumerable: descriptor.enumerable,
        writable: false,
        value: immutableSnapshot(descriptor.value, ancestors),
      })
    }
    return Object.freeze(snapshot) as T
  } finally {
    ancestors.delete(value)
  }
}

function freezeRows<T extends object>(rows: readonly T[]): readonly T[] {
  return Object.freeze(rows.map((row) => immutableSnapshot(row)))
}

function requireIds(
  rows: readonly Readonly<{ id: string }>[],
  expectedIds: readonly string[],
): void {
  const found = new Set(rows.map((row) => row.id))
  if (expectedIds.some((id) => !found.has(id))) throw new ShopOsMutationNotFound()
}

function requireReferences(
  values: readonly (string | null)[],
  lockedIds: ReadonlySet<string>,
): void {
  if (values.some((value) => value !== null && !lockedIds.has(value))) {
    throw new ShopOsMutationConflict()
  }
}

function readonlyMap<K, V>(entries: readonly Readonly<[K, V]>[]): ReadonlyMap<K, V> {
  const backing = new Map(entries)
  const result = Object.create(null) as Record<PropertyKey, unknown>
  Object.defineProperties(result, {
    size: { enumerable: true, get: () => backing.size },
    get: { value: (key: K) => backing.get(key) },
    has: { value: (key: K) => backing.has(key) },
    entries: { value: () => backing.entries() },
    keys: { value: () => backing.keys() },
    values: { value: () => backing.values() },
    forEach: {
      value: (callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown) => {
        backing.forEach((value, key) => callback.call(
          thisArg,
          value,
          key,
          result as unknown as ReadonlyMap<K, V>,
        ))
      },
    },
    [Symbol.iterator]: { value: () => backing[Symbol.iterator]() },
    [Symbol.toStringTag]: { value: 'ReadonlyMap' },
  })
  return Object.freeze(result) as unknown as ReadonlyMap<K, V>
}

function freezeSignature(value: ContinuitySignatureV1): ContinuitySignatureV1 {
  const jobs = Object.freeze(value.jobs.map((job) => Object.freeze({
    ...job,
    partStatuses: Object.freeze([...job.partStatuses]),
  })))
  return Object.freeze({
    ...value,
    ticket: Object.freeze({ ...value.ticket }),
    jobs,
  })
}

export async function lockMutationScopeV1(
  tx: AppDb,
  attempt: MutationAttemptCapabilityV1,
  request: MutationLockRequestV1,
  seams?: Readonly<{ afterClass?: (name: RepositoryLockClassV1) => Promise<void> }>,
): Promise<LockedMutationScopeV1> {
  assertLiveMutationAttemptV1(tx, attempt)
  const baseRequest = normalizeBaseRequest(request)
  let normalized = baseRequest
  const lockedProfiles = await tx
    .select()
    .from(profiles)
    .where(and(
      eq(profiles.shopId, baseRequest.shopId),
      inArray(profiles.id, baseRequest.profileIds),
    ))
    .orderBy(profiles.id)
    .for('update', { noWait: true })
  if (lockedProfiles.length !== baseRequest.profileIds.length) throw new ShopOsMutationNotFound()
  const actorRow = lockedProfiles.find((profile) => profile.id === baseRequest.actorProfileId)
  if (
    !actorRow || actorRow.shopId !== baseRequest.shopId ||
    actorRow.membershipStatus !== 'active' || actorRow.deactivatedAt !== null ||
    !ACTOR_ROLES.has(actorRow.role) ||
    (actorRow.skillTier !== null && ![1, 2, 3].includes(actorRow.skillTier))
  ) throw new ShopOsMutationNotFound()
  const actor = Object.freeze({
    id: actorRow.id,
    shopId: baseRequest.shopId,
    role: actorRow.role,
    skillTier: actorRow.skillTier,
  }) as LockedActiveActorV1
  const completeClass = async (name: RepositoryLockClassV1): Promise<void> => {
    await seams?.afterClass?.(name)
    assertLiveMutationAttemptV1(tx, attempt)
  }

  await completeClass('profiles')

  let receiptPeek: LockedMutationScopeV1['receiptPeek'] = Object.freeze({ kind: 'none' })
  if (baseRequest.receiptRequestKey !== null) {
    receiptPeek = await peekMutationReceiptV1(
      tx,
      attempt,
      actor,
      baseRequest.receiptRequestKey,
    )
  }
  let receiptConditionalInsertState: LockedMutationScopeV1['receiptConditionalInsertState'] =
    'not_applicable'
  if (baseRequest.receiptConditionalInsert?.kind === 'prepared') {
    if (receiptPeek.kind === 'none') {
      normalized = mergePreparedExtension(
        baseRequest,
        baseRequest.receiptConditionalInsert.extension,
      )
      receiptConditionalInsertState = 'activated'
    } else {
      receiptConditionalInsertState = receiptPeek.kind === 'owned'
        ? 'suppressed_by_owned_receipt'
        : 'suppressed_by_occupied_receipt'
    }
  } else if (baseRequest.receiptConditionalInsert?.kind === 'unavailable') {
    receiptConditionalInsertState = receiptPeek.kind === 'none'
      ? 'unavailable'
      : receiptPeek.kind === 'owned'
        ? 'suppressed_by_owned_receipt'
        : 'suppressed_by_occupied_receipt'
  }
  if (receiptPeek.kind === 'owned') {
    normalized = await discoverOwnedReplayRequest(
      tx,
      baseRequest,
      receiptPeek.resultTicketId,
    )
  }
  validateInsertionIntents(normalized)
  for (const intent of normalized.insertionIntents.sessions) {
    const technician = lockedProfiles.find((profile) => profile.id === intent.techId)
    if (
      !technician || technician.shopId !== normalized.shopId || technician.role !== 'tech' ||
      technician.membershipStatus !== 'active' || technician.deactivatedAt !== null ||
      technician.skillTier === null || ![1, 2, 3].includes(technician.skillTier)
    ) throw new ShopOsMutationNotFound()
  }
  const ownedReplay = receiptPeek.kind === 'owned'

  const [lockedShopRow] = normalized.lockShop
    ? await tx.select().from(shops).where(eq(shops.id, normalized.shopId)).limit(1)
      .for('update', { noWait: true })
    : []
  if (normalized.lockShop && !lockedShopRow) throw new ShopOsMutationNotFound()
  await completeClass('shop')

  const insertionCustomerIds = normalized.insertionIntents.customers.map(({ id }) => id)
  const customerLookupIds = [...new Set([
    ...normalized.customerIds,
    ...insertionCustomerIds,
  ])].sort()
  const lockedCustomerCandidates = customerLookupIds.length > 0
    ? await tx.select().from(customers).where(and(
      eq(customers.shopId, normalized.shopId),
      inArray(customers.id, customerLookupIds),
    )).orderBy(customers.id).for('update', { noWait: true })
    : []
  requireIds(lockedCustomerCandidates, normalized.customerIds)
  if (lockedCustomerCandidates.some((row) => insertionCustomerIds.includes(row.id))) {
    throw new ShopOsMutationConflict()
  }
  const lockedCustomers = lockedCustomerCandidates.filter((row) =>
    normalized.customerIds.includes(row.id))
  await completeClass('customers')

  const insertionVehicleIds = normalized.insertionIntents.vehicles.map(({ id }) => id)
  const vehicleLookupIds = [...new Set([
    ...normalized.vehicleIds,
    ...insertionVehicleIds,
  ])].sort()
  const lockedVehicleRows = vehicleLookupIds.length > 0
    ? await tx.select({ row: vehicles }).from(vehicles).innerJoin(
      customers,
      eq(customers.id, vehicles.customerId),
    ).where(and(
      eq(customers.shopId, normalized.shopId),
      inArray(vehicles.id, vehicleLookupIds),
    )).orderBy(vehicles.id).for('update', { of: vehicles, noWait: true })
    : []
  const lockedVehicles = lockedVehicleRows.map(({ row }) => row)
  requireIds(lockedVehicles, normalized.vehicleIds)
  if (lockedVehicles.some((row) => insertionVehicleIds.includes(row.id))) {
    throw new ShopOsMutationConflict()
  }
  const customerIdSet = new Set(normalized.customerIds)
  requireReferences(lockedVehicles.map((vehicle) => vehicle.customerId), customerIdSet)
  await completeClass('vehicles')

  const insertionTicketIds = normalized.insertionIntents.tickets
  const ticketLookupIds = [...new Set([
    ...normalized.ticketIds,
    ...insertionTicketIds,
  ])].sort()
  const lockedTicketCandidates = ticketLookupIds.length > 0
    ? await tx.select().from(tickets).where(and(
      eq(tickets.shopId, normalized.shopId),
      inArray(tickets.id, ticketLookupIds),
    )).orderBy(tickets.id).for('update', { noWait: true })
    : []
  requireIds(lockedTicketCandidates, normalized.ticketIds)
  if (lockedTicketCandidates.some((row) => insertionTicketIds.includes(row.id))) {
    throw new ShopOsMutationConflict()
  }
  const lockedTickets = lockedTicketCandidates.filter((row) => normalized.ticketIds.includes(row.id))
  const vehicleIdSet = new Set(normalized.vehicleIds)
  const profileIdSet = new Set(normalized.profileIds)
  for (const ticket of lockedTickets) {
    requireReferences([ticket.customerId], customerIdSet)
    requireReferences([ticket.vehicleId], vehicleIdSet)
    if (!ownedReplay) {
      requireReferences([
        ticket.createdByProfileId,
        ticket.canceledByProfileId,
        ticket.deliveredByProfileId,
        ticket.closedByProfileId,
      ], profileIdSet)
      requireReferences([ticket.separateFromTicketId], new Set(normalized.ticketIds))
    }
  }
  await completeClass('tickets')

  const insertionJobIds = normalized.insertionIntents.jobs.map(({ id }) => id)
  const jobLookupIds = [...new Set([...normalized.jobIds, ...insertionJobIds])].sort()
  const jobParentIds = [...new Set([
    ...normalized.ticketIds,
    ...normalized.insertionIntents.tickets,
  ])].sort()
  const shouldLockJobs = normalized.includeAllJobsForTickets || jobLookupIds.length > 0
  if (shouldLockJobs && jobParentIds.length === 0) throw new ShopOsMutationConflict()
  const lockedJobs = shouldLockJobs
    ? await tx.select().from(ticketJobs).where(and(
      eq(ticketJobs.shopId, normalized.shopId),
      inArray(ticketJobs.ticketId, jobParentIds),
      normalized.includeAllJobsForTickets ? undefined : inArray(ticketJobs.id, jobLookupIds),
    )).orderBy(ticketJobs.id).for('update', { noWait: true })
    : []
  requireIds(lockedJobs, normalized.jobIds)
  if (lockedJobs.some((row) => insertionJobIds.includes(row.id))) {
    throw new ShopOsMutationConflict()
  }
  const ticketIdSet = new Set(normalized.ticketIds)
  const lockedJobIdSet = new Set(lockedJobs.map((job) => job.id))
  for (const job of lockedJobs) {
    requireReferences([job.ticketId], ticketIdSet)
    if (!ownedReplay) requireReferences([
      job.assignedTechId,
      job.createdByProfileId,
      job.statementConfirmedByProfileId,
    ], profileIdSet)
    requireReferences([job.sessionId], new Set(normalized.sessionIds))
    requireReferences([job.createdFromJobId], lockedJobIdSet)
  }
  await completeClass('ticket_jobs')

  const lockedLines = normalized.includeAllLinesForJobs && lockedJobIdSet.size > 0
    ? await tx.select().from(jobLines).where(and(
      eq(jobLines.shopId, normalized.shopId),
      inArray(jobLines.jobId, [...lockedJobIdSet].sort()),
    )).orderBy(jobLines.id).for('update', { noWait: true })
    : []
  const vendorAccountIdSet = new Set(normalized.vendorAccountIds)
  for (const line of lockedLines) {
    requireReferences([line.jobId], lockedJobIdSet)
    if (!ownedReplay) {
      requireReferences([line.orderedByProfileId, line.receivedByProfileId], profileIdSet)
      requireReferences([line.vendorAccountId], vendorAccountIdSet)
    }
  }
  await completeClass('job_lines')

  const lockedVersions = normalized.includeAllQuoteVersionsForTickets && ticketIdSet.size > 0
    ? await tx.select().from(quoteVersions).where(and(
      eq(quoteVersions.shopId, normalized.shopId),
      inArray(quoteVersions.ticketId, [...ticketIdSet].sort()),
    )).orderBy(quoteVersions.id).for('update', { noWait: true })
    : []
  const versionIdSet = new Set(lockedVersions.map((version) => version.id))
  for (const version of lockedVersions) {
    requireReferences([version.ticketId], ticketIdSet)
    if (!ownedReplay) requireReferences([version.createdByProfileId], profileIdSet)
  }
  if (!ownedReplay) {
    for (const job of lockedJobs) requireReferences([job.approvedQuoteVersionId], versionIdSet)
  }
  await completeClass('quote_versions')

  const lockedEvents = normalized.includeAllQuoteEventsForTickets && ticketIdSet.size > 0
    ? await tx.select().from(quoteEvents).where(and(
      eq(quoteEvents.shopId, normalized.shopId),
      inArray(quoteEvents.ticketId, [...ticketIdSet].sort()),
    )).orderBy(quoteEvents.id).for('update', { noWait: true })
    : []
  for (const event of lockedEvents) {
    requireReferences([event.ticketId], ticketIdSet)
    requireReferences([event.jobId], lockedJobIdSet)
    requireReferences([event.quoteVersionId], versionIdSet)
    if (!ownedReplay) requireReferences([event.actorProfileId], profileIdSet)
  }
  if (!ownedReplay) {
    const eventById = new Map(lockedEvents.map((event) => [event.id, event] as const))
    for (const job of lockedJobs) {
      if (job.approvedApprovalEventId === null) continue
      const event = eventById.get(job.approvedApprovalEventId)
      if (
        !event || event.ticketId !== job.ticketId || event.jobId !== job.id
      ) throw new ShopOsMutationConflict()
    }
  }
  await completeClass('quote_events')

  await completeClass('quote_sends_and_orders')

  const insertionSessionIds = normalized.insertionIntents.sessions.map(({ id }) => id)
  const sessionLookupIds = [...new Set([
    ...normalized.sessionIds,
    ...insertionSessionIds,
  ])].sort()
  const lockedSessionCandidates = sessionLookupIds.length > 0
    ? await tx.select().from(sessions).where(and(
      eq(sessions.shopId, normalized.shopId),
      inArray(sessions.id, sessionLookupIds),
    )).orderBy(sessions.id).for('update', { noWait: true })
    : []
  requireIds(lockedSessionCandidates, normalized.sessionIds)
  if (lockedSessionCandidates.some((row) => insertionSessionIds.includes(row.id))) {
    throw new ShopOsMutationConflict()
  }
  const lockedSessions = lockedSessionCandidates.filter((row) => normalized.sessionIds.includes(row.id))
  for (const session of lockedSessions) {
    if (!ownedReplay) requireReferences([session.techId], profileIdSet)
    requireReferences([session.vehicleId], vehicleIdSet)
  }
  await completeClass('sessions')

  if (normalized.sessionEventIds.length > 0 && normalized.sessionIds.length === 0) {
    throw new ShopOsMutationConflict()
  }
  const lockedSessionEventRows = normalized.sessionEventIds.length > 0
    ? await tx.select({ row: sessionEvents }).from(sessionEvents).innerJoin(
      sessions,
      eq(sessions.id, sessionEvents.sessionId),
    ).where(and(
      eq(sessions.shopId, normalized.shopId),
      inArray(sessionEvents.sessionId, normalized.sessionIds),
      inArray(sessionEvents.id, normalized.sessionEventIds),
    )).orderBy(sessionEvents.id).for('update', { of: sessionEvents, noWait: true })
    : []
  const lockedSessionEvents = lockedSessionEventRows.map(({ row }) => row)
  requireIds(lockedSessionEvents, normalized.sessionEventIds)
  const sessionIdSet = new Set(normalized.sessionIds)
  for (const event of lockedSessionEvents) {
    requireReferences([event.sessionId], sessionIdSet)
    requireReferences([event.requestActorProfileId], profileIdSet)
  }
  await completeClass('session_events')

  const lockedVendorAccounts = normalized.vendorAccountIds.length > 0
    ? await tx.select().from(vendorAccounts).where(and(
      eq(vendorAccounts.shopId, normalized.shopId),
      inArray(vendorAccounts.id, normalized.vendorAccountIds),
    )).orderBy(vendorAccounts.id).for('update', { noWait: true })
    : []
  requireIds(lockedVendorAccounts, normalized.vendorAccountIds)
  await completeClass('vendor_accounts')

  const lockedCannedJobs = normalized.cannedJobIds.length > 0
    ? await tx.select().from(cannedJobs).where(and(
      eq(cannedJobs.shopId, normalized.shopId),
      inArray(cannedJobs.id, normalized.cannedJobIds),
    )).orderBy(cannedJobs.id).for('update', { noWait: true })
    : []
  requireIds(lockedCannedJobs, normalized.cannedJobIds)
  await completeClass('canned_jobs')

  if (normalized.receiptRequestKey !== null) {
    const lockedReceipt = await tx.select({
      id: ticketMutationReceipts.id,
      actorProfileId: ticketMutationReceipts.actorProfileId,
      resultTicketId: ticketMutationReceipts.resultTicketId,
    }).from(ticketMutationReceipts).where(and(
      eq(ticketMutationReceipts.shopId, normalized.shopId),
      eq(ticketMutationReceipts.requestKey, normalized.receiptRequestKey),
    )).limit(1).for('update', { noWait: true })
    const row = lockedReceipt[0]
    let receiptDrifted: boolean
    if ('receiptId' in receiptPeek) {
      receiptDrifted = row === undefined || row.id !== receiptPeek.receiptId ||
        row.actorProfileId !== actor.id || row.resultTicketId !== receiptPeek.resultTicketId
    } else if (receiptPeek.kind === 'none') {
      receiptDrifted = row !== undefined
    } else {
      receiptDrifted = row === undefined || row.actorProfileId === actor.id
    }
    if (receiptDrifted) throw new ShopOsMutationConflict()
  }
  await completeClass('mutation_receipts')

  const frozenTickets = freezeRows(lockedTickets)
  const frozenJobs = freezeRows(lockedJobs)
  const frozenLines = freezeRows(lockedLines)
  const frozenVersions = freezeRows(lockedVersions)
  const frozenEvents = freezeRows(lockedEvents)
  const graphs = Object.freeze(frozenTickets.map((ticket) => Object.freeze({
    ticket,
    jobs: Object.freeze(frozenJobs.filter((job) => job.ticketId === ticket.id)),
    lines: Object.freeze(frozenLines.filter((line) =>
      frozenJobs.some((job) => job.ticketId === ticket.id && job.id === line.jobId))),
    versions: Object.freeze(frozenVersions.filter((version) => version.ticketId === ticket.id)),
    events: Object.freeze(frozenEvents.filter((event) => event.ticketId === ticket.id)),
  })))
  const signatures = normalized.includeAllJobsForTickets && normalized.includeAllLinesForJobs
    ? graphs.map((graph) => {
      const customer = graph.ticket.customerId === null
        ? null
        : lockedCustomers.find((row) => row.id === graph.ticket.customerId) ?? null
      const vehicle = graph.ticket.vehicleId === null
        ? null
        : lockedVehicles.find((row) => row.id === graph.ticket.vehicleId) ?? null
      return [graph.ticket.id, freezeSignature(buildContinuitySignatureV1({
        graph,
        customerBelongsToShop: customer?.shopId === normalized.shopId,
        vehicleBelongsToCustomer:
          vehicle !== null && customer !== null && vehicle.customerId === customer.id,
      }))] as const
    })
    : []

  const scope = Object.freeze({
    actor,
    request: normalized,
    profiles: freezeRows(lockedProfiles),
    shop: lockedShopRow ? immutableSnapshot(lockedShopRow) : null,
    customers: freezeRows(lockedCustomers),
    vehicles: freezeRows(lockedVehicles),
    tickets: graphs,
    sessions: freezeRows(lockedSessions),
    sessionEvents: freezeRows(lockedSessionEvents),
    vendorAccounts: freezeRows(lockedVendorAccounts),
    cannedJobs: freezeRows(lockedCannedJobs),
    beforeSignatures: readonlyMap(signatures),
    insertionIntents: normalized.insertionIntents,
    receiptPeek,
    receiptConditionalInsertState,
  })
  bindLockedMutationScopeToAttemptV1(tx, attempt, scope)
  return scope
}
