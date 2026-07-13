import { sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { unwrapRows } from '@/lib/db/unwrap-rows'
import { canManageMessagingRetention } from '@/lib/shop-os/capabilities'
import type { MessagingActor } from '@/lib/shop-os/messaging-consent'
import {
  addUtcCalendarYearsClamped,
  fingerprintsForKeyRing,
  type FingerprintKeyRing,
} from '@/lib/shop-os/messaging-retention-policy'

export type MessagingDeletionResult =
  | { ok: true; requestId: string; state: 'pending' | 'completed'; counts?: Record<string, number> }
  | { ok: false; error: 'forbidden' | 'not_found' | 'request_conflict' | 'busy' | 'retryable' }

export type PriorRecordCounts = Readonly<{
  consentEvents: number
  consentProjections: number
  notifications: number
  quoteSends: number
  smsLogs: number
}>

export type DeletionResultCounts = Readonly<{
  consentEventsDeleted: number
  notificationsDeleted: number
  smsLogsDeleted: number
  quoteSendsDeleted: number
  quoteSendsRetained: number
}>

export type DeletionHeldCounts = Readonly<{
  heldConsentEvents: number
  heldConsentProjections: number
  heldQuoteSends: number
  heldSmsLogs: number
  heldNotifications: number
  total: number
}>

type Snapshot = {
  db: AppDb
  actor: Readonly<MessagingActor>
  customerId?: string
  destination?: string
  reasonCode?: 'customer_request' | 'shop_request' | 'account_deletion'
  requestKey?: string
  requestFingerprint?: string
  requestId?: string
  now: Date
  fingerprints?: ReadonlyArray<{ keyVersion: string; fingerprint: string }>
}

const uuid = z.uuid()
const fingerprint = z.string().regex(/^[0-9a-f]{64}$/)
const fingerprintKeyVersion = z.string().regex(/^[a-z][a-z0-9_]{0,62}[a-z0-9]$/)
const reasons = new Set(['customer_request', 'shop_request', 'account_deletion'])
const cancellable = new Set(['queued', 'claimed'])
const inFlight = new Set(['submitting', 'submitted'])

// Internal recovery safety ceilings. These are not retention or purge batch sizes.
const MAX_HISTORICAL_PAIRS = 64
const MAX_SENDS = 128
const MAX_CONSENT_EVENTS = 256
const MAX_CONSENT_PROJECTIONS = 128
const MAX_SMS_LOGS = 512
const MAX_NOTIFICATIONS = 256
const MAX_TOTAL_RESOURCES = 1024

function retentionAuthority(role: string): boolean {
  return canManageMessagingRetention(role, role === 'founder')
}

function data(value: unknown, names: ReadonlyArray<string>): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (Object.getPrototypeOf(value) !== Object.prototype) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const result: Record<string, unknown> = {}
  for (const name of names) {
    const descriptor = descriptors[name]
    if (!descriptor?.enumerable || !('value' in descriptor)) return null
    result[name] = descriptor.value
  }
  return result
}

function exactDate(value: unknown): Date | null {
  if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype) return null
  const milliseconds = Date.prototype.getTime.call(value)
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null
}

function timestampMilliseconds(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime()
}

function requestSnapshot(raw: unknown): Snapshot | null {
  const input = data(raw, [
    'db', 'actor', 'customerId', 'destination', 'reasonCode', 'requestKey',
    'requestFingerprint', 'now', 'keyRing',
  ])
  const actor = input && data(input.actor, ['profileId', 'shopId', 'role'])
  const now = input && exactDate(input.now)
  if (!input || !actor || !now
    || !uuid.safeParse(actor.profileId).success
    || !uuid.safeParse(actor.shopId).success
    || typeof actor.role !== 'string'
    || !uuid.safeParse(input.customerId).success
    || typeof input.destination !== 'string'
    || !reasons.has(input.reasonCode as string)
    || !uuid.safeParse(input.requestKey).success
    || !fingerprint.safeParse(input.requestFingerprint).success) return null
  try {
    const fingerprints = fingerprintsForKeyRing(
      input.destination,
      input.keyRing as FingerprintKeyRing,
    ).map((entry) => Object.freeze({ ...entry }))
    return Object.freeze({
      db: input.db as AppDb,
      actor: Object.freeze({
        profileId: actor.profileId as string,
        shopId: actor.shopId as string,
        role: actor.role,
      }),
      customerId: input.customerId as string,
      destination: input.destination,
      reasonCode: input.reasonCode as Snapshot['reasonCode'],
      requestKey: input.requestKey as string,
      requestFingerprint: input.requestFingerprint as string,
      now,
      fingerprints: Object.freeze(fingerprints),
    })
  } catch {
    return null
  }
}

function completionSnapshot(raw: unknown): Snapshot | null {
  const input = data(raw, ['db', 'actor', 'requestId', 'now'])
  const actor = input && data(input.actor, ['profileId', 'shopId', 'role'])
  const now = input && exactDate(input.now)
  if (!input || !actor || !now
    || !uuid.safeParse(actor.profileId).success
    || !uuid.safeParse(actor.shopId).success
    || typeof actor.role !== 'string'
    || !uuid.safeParse(input.requestId).success) return null
  return Object.freeze({
    db: input.db as AppDb,
    actor: Object.freeze({
      profileId: actor.profileId as string,
      shopId: actor.shopId as string,
      role: actor.role,
    }),
    requestId: input.requestId as string,
    now,
  })
}

function own(value: unknown, key: string): unknown {
  if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function exactUnique(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 3 && current; depth += 1) {
    if (own(current, 'code') === '23505'
      && (own(current, 'constraint') === 'messaging_deletion_requests_shop_actor_request_uq'
        || own(current, 'constraint_name') === 'messaging_deletion_requests_shop_actor_request_uq'
        || own(current, 'constraint') === 'messaging_deletion_requests_shop_customer_pending_uq'
        || own(current, 'constraint_name') === 'messaging_deletion_requests_shop_customer_pending_uq')) {
      return true
    }
    current = own(current, 'cause')
  }
  return false
}

type RequestRow = {
  id: string
  shopId: string
  requestKey: string
  requestFingerprint: string
  customerId: string | null
  destinationFingerprint: string
  fingerprintKeyVersion: string
  state: 'pending' | 'completed'
  reasonCode: string
  requestingActorProfileId: string
  counts: Record<string, number> | null
  proof: Record<string, unknown> | null
  requestedAt?: Date | string
}

type MessagingPair = { destinationFingerprint: string; fingerprintKeyVersion: string }

function exactMessagingPairs(rows: ReadonlyArray<MessagingPair>): ReadonlyArray<MessagingPair> {
  const pairs = new Map<string, MessagingPair>()
  for (const row of rows) {
    if (!fingerprint.safeParse(row.destinationFingerprint).success
      || !fingerprintKeyVersion.safeParse(row.fingerprintKeyVersion).success) {
      throw new Error('invalid_historical_messaging_pair')
    }
    const key = `${row.destinationFingerprint}:${row.fingerprintKeyVersion}`
    pairs.set(key, Object.freeze({ ...row }))
  }
  return Object.freeze([...pairs.values()].sort((left, right) =>
    left.destinationFingerprint.localeCompare(right.destinationFingerprint)
      || left.fingerprintKeyVersion.localeCompare(right.fingerprintKeyVersion)))
}

function sameMessagingPairs(
  left: ReadonlyArray<MessagingPair>,
  right: ReadonlyArray<MessagingPair>,
): boolean {
  return left.length === right.length && left.every((pair, index) =>
    pair.destinationFingerprint === right[index]?.destinationFingerprint
      && pair.fingerprintKeyVersion === right[index]?.fingerprintKeyVersion)
}

async function lockCustomerMessagingPairs(input: {
  tx: AppDb
  shopId: string
  customerId: string
  current: ReadonlyArray<{ fingerprint: string; keyVersion: string }>
}): Promise<ReadonlyArray<MessagingPair> | null> {
  const sends = unwrapRows<MessagingPair>(await input.tx.execute(sql`
    select distinct destination_fingerprint as "destinationFingerprint",
      fingerprint_key_version as "fingerprintKeyVersion"
    from quote_sends
    where shop_id = ${input.shopId}::uuid and customer_id = ${input.customerId}::uuid
    order by destination_fingerprint, fingerprint_key_version
    limit ${MAX_HISTORICAL_PAIRS + 1}
  `))
  const projections = unwrapRows<MessagingPair>(await input.tx.execute(sql`
    select distinct destination_fingerprint as "destinationFingerprint",
      fingerprint_key_version as "fingerprintKeyVersion"
    from messaging_consent_state
    where shop_id = ${input.shopId}::uuid and customer_id = ${input.customerId}::uuid
    order by destination_fingerprint, fingerprint_key_version
    limit ${MAX_HISTORICAL_PAIRS + 1}
  `))
  const events = unwrapRows<MessagingPair>(await input.tx.execute(sql`
    select distinct destination_fingerprint as "destinationFingerprint",
      fingerprint_key_version as "fingerprintKeyVersion"
    from messaging_consent_events
    where shop_id = ${input.shopId}::uuid and customer_id = ${input.customerId}::uuid
    order by destination_fingerprint, fingerprint_key_version
    limit ${MAX_HISTORICAL_PAIRS + 1}
  `))
  const requests = unwrapRows<MessagingPair>(await input.tx.execute(sql`
    select distinct destination_fingerprint as "destinationFingerprint",
      fingerprint_key_version as "fingerprintKeyVersion"
    from messaging_deletion_requests
    where shop_id = ${input.shopId}::uuid and customer_id = ${input.customerId}::uuid
      and state = 'pending'
    order by destination_fingerprint, fingerprint_key_version
    limit ${MAX_HISTORICAL_PAIRS + 1}
  `))
  const pairs = exactMessagingPairs([
    ...input.current.map(({ fingerprint: destinationFingerprint, keyVersion }) => ({
      destinationFingerprint,
      fingerprintKeyVersion: keyVersion,
    })),
    ...sends,
    ...projections,
    ...events,
    ...requests,
  ])
  return pairs.length <= MAX_HISTORICAL_PAIRS ? pairs : null
}

function semanticCustomerBinding(input: {
  shopId: string
  customerId: string
  requestKey: string
  requestFingerprint: string
  reasonCode: string
  requestingActorProfileId: string
}): string {
  const canonical = JSON.stringify([
    'vyntechs:messaging-deletion-customer:v1',
    input.shopId,
    input.customerId,
    input.requestKey,
    input.requestFingerprint,
    input.reasonCode,
    input.requestingActorProfileId,
  ])
  return createHash('sha256').update(canonical).digest('hex')
}

function storedResultCounts(row: RequestRow): Record<string, number> {
  const value = row.proof?.resultCounts
  if (!value || typeof value !== 'object' || Array.isArray(value)) return row.counts ?? {}
  const entries = Object.entries(value)
  if (entries.some(([, count]) => !Number.isSafeInteger(count) || (count as number) < 0)) return {}
  return Object.fromEntries(entries) as Record<string, number>
}

function retry(row: RequestRow, input: Snapshot): MessagingDeletionResult {
  const completedBinding = input.customerId && input.requestKey && input.requestFingerprint
    ? semanticCustomerBinding({
        shopId: input.actor.shopId,
        customerId: input.customerId,
        requestKey: input.requestKey,
        requestFingerprint: input.requestFingerprint,
        reasonCode: input.reasonCode!,
        requestingActorProfileId: input.actor.profileId,
      })
    : null
  const matches = row.requestFingerprint === input.requestFingerprint
    && (row.state === 'completed'
      ? typeof row.proof?.customerBinding === 'string'
        && row.proof.customerBinding === completedBinding
      : row.customerId === input.customerId)
    && row.reasonCode === input.reasonCode
    && row.requestingActorProfileId === input.actor.profileId
    && input.fingerprints?.some((item) =>
      item.fingerprint === row.destinationFingerprint
      && item.keyVersion === row.fingerprintKeyVersion)
  if (!matches) return { ok: false, error: 'request_conflict' }
  return row.state === 'completed'
    ? { ok: true, requestId: row.id, state: 'completed', counts: storedResultCounts(row) }
    : { ok: true, requestId: row.id, state: 'pending' }
}

async function liveAuthority(tx: AppDb, input: Snapshot): Promise<'ok' | 'forbidden' | 'not_found'> {
  const result = await tx.execute<{ role: string; membershipStatus: string; deactivatedAt: Date | null }>(sql`
    select role, membership_status as "membershipStatus", deactivated_at as "deactivatedAt"
    from profiles
    where id = ${input.actor.profileId}::uuid and shop_id = ${input.actor.shopId}::uuid
  `)
  const actor = unwrapRows<{ role: string; membershipStatus: string; deactivatedAt: Date | null }>(result)[0]
  if (!actor) return 'not_found'
  if (actor.role !== input.actor.role || actor.membershipStatus !== 'active'
    || actor.deactivatedAt !== null || !retentionAuthority(actor.role)) return 'forbidden'
  return 'ok'
}

async function recoverRequest(input: Snapshot): Promise<MessagingDeletionResult> {
  return input.db.transaction(async (tx) => {
    await tx.execute(sql`select id from shops where id = ${input.actor.shopId}::uuid for update`)
    const authority = await liveAuthority(tx as AppDb, input)
    if (authority !== 'ok') return { ok: false, error: authority }
    const customer = unwrapRows<{ id: string; phone: string }>(await tx.execute(sql`
      select id, phone from customers
      where id = ${input.customerId}::uuid and shop_id = ${input.actor.shopId}::uuid
      for update
    `))[0]
    if (!customer) return { ok: false, error: 'not_found' }
    if (customer.phone !== input.destination) return { ok: false, error: 'request_conflict' }
    const result = await tx.execute<RequestRow>(sql`
      select id, shop_id as "shopId", request_key as "requestKey",
        request_fingerprint as "requestFingerprint", customer_id as "customerId",
        destination_fingerprint as "destinationFingerprint",
        fingerprint_key_version as "fingerprintKeyVersion", state, reason_code as "reasonCode",
        requesting_actor_profile_id as "requestingActorProfileId", prior_record_counts as counts,
        proof_summary as proof
      from messaging_deletion_requests
      where shop_id = ${input.actor.shopId}::uuid
        and requesting_actor_profile_id = ${input.actor.profileId}::uuid
        and request_key = ${input.requestKey}::uuid
      for update
    `)
    const row = unwrapRows<RequestRow>(result)[0]
    if (row) return retry(row, input)

    const canonical = unwrapRows<RequestRow>(await tx.execute(sql`
      select id, shop_id as "shopId", request_key as "requestKey",
        request_fingerprint as "requestFingerprint", customer_id as "customerId",
        destination_fingerprint as "destinationFingerprint",
        fingerprint_key_version as "fingerprintKeyVersion", state,
        reason_code as "reasonCode",
        requesting_actor_profile_id as "requestingActorProfileId",
        prior_record_counts as counts, proof_summary as proof,
        requested_at as "requestedAt"
      from messaging_deletion_requests
      where shop_id = ${input.actor.shopId}::uuid
        and customer_id = ${input.customerId}::uuid and state = 'pending'
      for update
    `))[0]
    if (!canonical?.requestedAt) return { ok: false, error: 'retryable' }

    const pairs = await lockCustomerMessagingPairs({
      tx: tx as AppDb,
      shopId: input.actor.shopId,
      customerId: input.customerId!,
      current: input.fingerprints!,
    })
    if (!pairs) return { ok: false, error: 'busy' }
    const suppressions = unwrapRows<{
      reason: string
      liftedAt: Date | null
      retainUntil: Date | string
    }>(await tx.execute(sql`
      select reason, lifted_at as "liftedAt", retain_until as "retainUntil"
      from sms_suppressions where shop_id = ${input.actor.shopId}::uuid
        and (${sql.join(pairs.map((item) => sql`
          (destination_fingerprint = ${item.destinationFingerprint}
            and fingerprint_key_version = ${item.fingerprintKeyVersion})
        `), sql` or `)})
      order by destination_fingerprint, fingerprint_key_version
      limit ${MAX_HISTORICAL_PAIRS + 1} for update
    `))
    const requestedAt = canonical.requestedAt instanceof Date
      ? canonical.requestedAt
      : new Date(canonical.requestedAt)
    const barrierAt = addUtcCalendarYearsClamped(requestedAt, 5)
    if (suppressions.length !== pairs.length || suppressions.some((suppression) =>
      !['verified_deletion', 'permanent_failure', 'number_reassigned'].includes(suppression.reason)
      || suppression.liftedAt !== null
      || timestampMilliseconds(suppression.retainUntil) < barrierAt.getTime()
    )) return { ok: false, error: 'retryable' }
    return { ok: true, requestId: canonical.id, state: 'pending' }
  })
}

export async function requestMessagingDeletion(rawInput: {
  db: AppDb
  actor: MessagingActor
  customerId: string
  destination: string
  reasonCode: 'customer_request' | 'shop_request' | 'account_deletion'
  requestKey: string
  requestFingerprint: string
  now: Date
  keyRing: FingerprintKeyRing
}): Promise<MessagingDeletionResult> {
  let input: Snapshot | null
  try {
    input = requestSnapshot(rawInput)
  } catch {
    return { ok: false, error: 'forbidden' }
  }
  if (!input) return { ok: false, error: 'forbidden' }
  if (!retentionAuthority(input.actor.role)) return { ok: false, error: 'forbidden' }
  try {
    return await input.db.transaction(async (tx) => {
      const shop = unwrapRows(await tx.execute<{ id: string }>(sql`
        select id from shops where id = ${input.actor.shopId}::uuid for update
      `))[0]
      if (!shop) return { ok: false, error: 'not_found' }
      const authority = await liveAuthority(tx as AppDb, input)
      if (authority !== 'ok') return { ok: false, error: authority }
      const customer = unwrapRows<{ id: string; phone: string }>(
        await tx.execute<{ id: string; phone: string }>(sql`
        select id, phone from customers
        where id = ${input.customerId}::uuid and shop_id = ${input.actor.shopId}::uuid
        for update
      `))[0]
      if (!customer) return { ok: false, error: 'not_found' }
      if (customer.phone !== input.destination) return { ok: false, error: 'request_conflict' }

      const existing = unwrapRows<RequestRow>(await tx.execute(sql`
        select id, shop_id as "shopId", request_key as "requestKey",
          request_fingerprint as "requestFingerprint", customer_id as "customerId",
          destination_fingerprint as "destinationFingerprint",
          fingerprint_key_version as "fingerprintKeyVersion", state, reason_code as "reasonCode",
          requesting_actor_profile_id as "requestingActorProfileId", prior_record_counts as counts,
          proof_summary as proof
        from messaging_deletion_requests
        where shop_id = ${input.actor.shopId}::uuid
          and requesting_actor_profile_id = ${input.actor.profileId}::uuid
          and request_key = ${input.requestKey}::uuid
        for update
      `))[0]
      if (existing) return retry(existing, input)

      const historicalPairs = await lockCustomerMessagingPairs({
        tx: tx as AppDb,
        shopId: input.actor.shopId,
        customerId: input.customerId!,
        current: input.fingerprints!,
      })
      if (!historicalPairs) return { ok: false, error: 'busy' }

      const subject = unwrapRows<{ subjectKey: string }>(await tx.execute(sql`
        select subject_key as "subjectKey" from messaging_consent_state
        where shop_id = ${input.actor.shopId}::uuid and customer_id = ${input.customerId}::uuid
          and (${sql.join(input.fingerprints!.map((item) => sql`
            (destination_fingerprint = ${item.fingerprint}
              and fingerprint_key_version = ${item.keyVersion})
          `), sql` or `)})
        order by updated_at desc, subject_key asc limit 1 for update
      `))[0]
      const subjectKey = subject?.subjectKey ?? input.customerId!

      const transition = unwrapRows<{ at: Date | string }>(await tx.execute(sql`
        with barriers(at) as (
          select requested_at from messaging_deletion_requests where shop_id = ${input.actor.shopId}::uuid
          union all select completed_at from messaging_deletion_requests where shop_id = ${input.actor.shopId}::uuid
          union all select suppressed_at from sms_suppressions where shop_id = ${input.actor.shopId}::uuid
          union all select updated_at from sms_suppressions where shop_id = ${input.actor.shopId}::uuid
        )
        select greatest(clock_timestamp(), coalesce(max(at) + interval '1 millisecond', '-infinity')) as at
        from barriers
      `))[0]?.at
      if (!transition) throw new Error('transition_time_unavailable')

      for (const item of historicalPairs) {
        await tx.execute(sql`
          insert into sms_suppressions (
            shop_id, destination_fingerprint, fingerprint_key_version, source_event_id,
            reason, suppressed_at, lifted_at, retain_until, updated_at
          ) values (
            ${input.actor.shopId}::uuid, ${item.destinationFingerprint},
            ${item.fingerprintKeyVersion}, null,
            'verified_deletion', ${transition}::timestamptz, null,
            ${transition}::timestamptz + interval '5 years', ${transition}::timestamptz
          )
          on conflict (shop_id, destination_fingerprint, fingerprint_key_version) do update
          set reason = case when sms_suppressions.reason = 'customer_revocation'
                            then 'verified_deletion' else sms_suppressions.reason end,
              lifted_at = null,
              retain_until = greatest(excluded.retain_until, sms_suppressions.retain_until),
              updated_at = excluded.updated_at
        `)
      }
      const normalized = unwrapRows<{
        destinationFingerprint: string
        fingerprintKeyVersion: string
        reason: string
        liftedAt: Date | null
        retainUntil: Date | string
        updatedAt: Date | string
      }>(await tx.execute(sql`
        select destination_fingerprint as "destinationFingerprint",
          fingerprint_key_version as "fingerprintKeyVersion", reason,
          lifted_at as "liftedAt", retain_until as "retainUntil", updated_at as "updatedAt"
        from sms_suppressions where shop_id = ${input.actor.shopId}::uuid
          and (${sql.join(historicalPairs.map((item) => sql`
            (destination_fingerprint = ${item.destinationFingerprint}
              and fingerprint_key_version = ${item.fingerprintKeyVersion})
          `), sql` or `)})
        order by destination_fingerprint, fingerprint_key_version
        limit ${MAX_HISTORICAL_PAIRS + 1} for update
      `))
      const transitionAt = transition instanceof Date
        ? new Date(transition.getTime())
        : new Date(transition)
      const barrierAt = addUtcCalendarYearsClamped(transitionAt, 5)
      if (normalized.length !== historicalPairs.length || normalized.some((row) =>
        !['verified_deletion', 'permanent_failure', 'number_reassigned'].includes(row.reason)
        || row.liftedAt !== null
        || timestampMilliseconds(row.retainUntil) < barrierAt.getTime()
        || timestampMilliseconds(row.updatedAt) !== transitionAt.getTime()
      )) throw new Error('suppression_normalization_failed')
      const verifiedPairs = await lockCustomerMessagingPairs({
        tx: tx as AppDb,
        shopId: input.actor.shopId,
        customerId: input.customerId!,
        current: input.fingerprints!,
      })
      if (!verifiedPairs || !sameMessagingPairs(historicalPairs, verifiedPairs)) {
        throw new Error('historical_messaging_pairs_changed')
      }
      const canonical = unwrapRows<RequestRow>(await tx.execute(sql`
        select id, shop_id as "shopId", request_key as "requestKey",
          request_fingerprint as "requestFingerprint", customer_id as "customerId",
          destination_fingerprint as "destinationFingerprint",
          fingerprint_key_version as "fingerprintKeyVersion", state,
          reason_code as "reasonCode",
          requesting_actor_profile_id as "requestingActorProfileId",
          prior_record_counts as counts, proof_summary as proof
        from messaging_deletion_requests
        where shop_id = ${input.actor.shopId}::uuid
          and customer_id = ${input.customerId}::uuid and state = 'pending'
        for update
      `))[0]
      if (canonical) return { ok: true, requestId: canonical.id, state: 'pending' }
      const current = input.fingerprints![0]!
      const inserted = unwrapRows<{ id: string }>(await tx.execute(sql`
        insert into messaging_deletion_requests (
          request_key, request_fingerprint, shop_id, subject_key, customer_id,
          destination_fingerprint, fingerprint_key_version, state, reason_code,
          requesting_actor_profile_id, requested_at
        ) values (
          ${input.requestKey}::uuid, ${input.requestFingerprint}, ${input.actor.shopId}::uuid,
          ${subjectKey}::uuid, ${input.customerId}::uuid, ${current.fingerprint},
          ${current.keyVersion}, 'pending', ${input.reasonCode}, ${input.actor.profileId}::uuid,
          ${transition}::timestamptz
        ) returning id
      `))[0]
      if (!inserted) throw new Error('request_insert_failed')
      return { ok: true, requestId: inserted.id, state: 'pending' }
    })
  } catch (error) {
    if (!exactUnique(error)) return { ok: false, error: 'retryable' }
    try {
      return await recoverRequest(input)
    } catch {
      return { ok: false, error: 'retryable' }
    }
  }
}

type CleanupRequest = RequestRow & { shopId: string; subjectKey: string; requestKey: string }
type HeldWorkSource = WorkItemSource & {
  workOutcome: 'pending' | 'retained'
  resourceHeld: boolean
  subjectHeld: boolean
}
type SendRow = HeldWorkSource & {
  id: string
  state: string
  customerId: string | null
  subjectKey: string
  retentionBasis: 'resource_hold' | 'subject_hold' | 'held_dependency' | null
}
type WorkItemSource = { workItemId: string }
type ConsentProjectionRow = MessagingPair & HeldWorkSource & {
  id: string
  subjectKey: string
  programVersion: string
  sourceEventId: string
}
type ConsentEventRow = MessagingPair & HeldWorkSource & {
  id: string
  subjectKey: string
  programVersion: string
  countsTowardProof: boolean
}
type SmsRow = HeldWorkSource & { id: string; quoteSendId: string }

async function discoverDeletionWorkItems(
  tx: AppDb,
  request: { id: string; shopId: string; customerId: string },
  limit: number,
): Promise<number> {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error('invalid_discovery_limit')
  let remaining = Math.min(limit, MAX_TOTAL_RESOURCES)
  let discovered = 0
  const consume = (count: number) => {
    discovered += count
    remaining -= count
  }

  if (remaining > 0) {
    consume(unwrapRows<{ id: string }>(await tx.execute(sql`
      with candidates as (
        select source.id
        from quote_sends source
        where source.shop_id = ${request.shopId}::uuid
          and source.customer_id = ${request.customerId}::uuid
          and not exists (
            select 1 from messaging_deletion_work_items existing
            where existing.request_id = ${request.id}::uuid
              and existing.resource_type = 'quote_send'
              and existing.resource_id = source.id
          )
        order by source.id
        limit ${remaining}
      )
      insert into messaging_deletion_work_items (
        shop_id, request_id, resource_type, resource_id, outcome
      )
      select ${request.shopId}::uuid, ${request.id}::uuid, 'quote_send', id, 'pending'
      from candidates order by id
      on conflict (request_id, resource_type, resource_id) do nothing
      returning id
    `)).length)
  }

  if (remaining > 0) {
    consume(unwrapRows<{ id: string }>(await tx.execute(sql`
      with candidates as (
        select source.id
        from messaging_consent_state source
        where source.shop_id = ${request.shopId}::uuid
          and source.customer_id = ${request.customerId}::uuid
          and not exists (
            select 1 from messaging_deletion_work_items existing
            where existing.request_id = ${request.id}::uuid
              and existing.resource_type = 'consent_projection'
              and existing.resource_id = source.id
          )
        order by source.id
        limit ${remaining}
      )
      insert into messaging_deletion_work_items (
        shop_id, request_id, resource_type, resource_id, outcome
      )
      select ${request.shopId}::uuid, ${request.id}::uuid, 'consent_projection', id, 'pending'
      from candidates order by id
      on conflict (request_id, resource_type, resource_id) do nothing
      returning id
    `)).length)
  }

  if (remaining > 0) {
    consume(unwrapRows<{ id: string }>(await tx.execute(sql`
      with candidates as (
        select child.id, parent.id as parent_work_item_id,
          not (child.event_type = 'deleted'
            and child.program_version = 'internal_deletion_v1') as counts_toward_proof
        from messaging_consent_events child
        left join messaging_consent_state source_parent
          on source_parent.shop_id = child.shop_id
         and source_parent.subject_key = child.subject_key
         and source_parent.destination_fingerprint = child.destination_fingerprint
         and source_parent.fingerprint_key_version = child.fingerprint_key_version
         and source_parent.program_version = child.program_version
        left join messaging_deletion_work_items parent
          on parent.request_id = ${request.id}::uuid
         and parent.resource_type = 'consent_projection'
         and parent.resource_id = source_parent.id
        where child.shop_id = ${request.shopId}::uuid
          and child.customer_id = ${request.customerId}::uuid
          and (source_parent.id is null or parent.id is not null)
          and not exists (
            select 1 from messaging_deletion_work_items existing
            where existing.request_id = ${request.id}::uuid
              and existing.resource_type = 'consent_event'
              and existing.resource_id = child.id
          )
        order by child.id
        limit ${remaining}
      )
      insert into messaging_deletion_work_items (
        shop_id, request_id, resource_type, resource_id, parent_work_item_id,
        outcome, counts_toward_proof
      )
      select ${request.shopId}::uuid, ${request.id}::uuid, 'consent_event', id,
        parent_work_item_id, 'pending', counts_toward_proof
      from candidates order by id
      on conflict (request_id, resource_type, resource_id) do nothing
      returning id
    `)).length)
  }

  if (remaining > 0) {
    consume(unwrapRows<{ id: string }>(await tx.execute(sql`
      with candidates as (
        select child.id, parent.id as parent_work_item_id
        from sms_log child
        join messaging_deletion_work_items parent
          on parent.request_id = ${request.id}::uuid
         and parent.resource_type = 'quote_send'
         and parent.resource_id = child.quote_send_id
        left join messaging_deletion_work_items existing
          on existing.request_id = parent.request_id
         and existing.resource_type = 'sms_log'
         and existing.resource_id = child.id
        where child.shop_id = ${request.shopId}::uuid and existing.id is null
        order by child.id
        limit ${remaining}
      )
      insert into messaging_deletion_work_items (
        shop_id, request_id, resource_type, resource_id, parent_work_item_id, outcome
      )
      select ${request.shopId}::uuid, ${request.id}::uuid, 'sms_log', id,
        parent_work_item_id, 'pending'
      from candidates order by id
      on conflict (request_id, resource_type, resource_id) do nothing
      returning id
    `)).length)
  }

  if (remaining > 0) {
    consume(unwrapRows<{ id: string }>(await tx.execute(sql`
      with candidates as (
        select child.id, parent.id as parent_work_item_id
        from notifications child
        left join messaging_deletion_work_items parent
          on child.entity_type = 'quote_send'
         and parent.request_id = ${request.id}::uuid
         and parent.resource_type = 'quote_send'
         and parent.resource_id = child.entity_id
        left join messaging_deletion_work_items existing
          on existing.request_id = ${request.id}::uuid
         and existing.resource_type = 'notification'
         and existing.resource_id = child.id
        where child.shop_id = ${request.shopId}::uuid
          and existing.id is null
          and ((child.entity_type = 'customer'
                and child.entity_id = ${request.customerId}::uuid)
            or (child.entity_type = 'quote_send' and parent.id is not null))
        order by child.id
        limit ${remaining}
      )
      insert into messaging_deletion_work_items (
        shop_id, request_id, resource_type, resource_id, parent_work_item_id, outcome
      )
      select ${request.shopId}::uuid, ${request.id}::uuid, 'notification', id,
        parent_work_item_id, 'pending'
      from candidates order by id
      on conflict (request_id, resource_type, resource_id) do nothing
      returning id
    `)).length)
  }

  return discovered
}

export async function completeMessagingDeletion(rawInput: {
  db: AppDb
  actor: MessagingActor
  requestId: string
  now: Date
}): Promise<MessagingDeletionResult> {
  let input: Snapshot | null
  try {
    input = completionSnapshot(rawInput)
  } catch {
    return { ok: false, error: 'forbidden' }
  }
  if (!input || !retentionAuthority(input.actor.role)) return { ok: false, error: 'forbidden' }
  try {
    return await input.db.transaction(async (tx) => {
      // Global order: shop → requests → customer → quote sends → consent → SMS → notifications → holds.
      const shop = unwrapRows(await tx.execute<{ id: string }>(sql`
        select id from shops where id = ${input.actor.shopId}::uuid for update
      `))[0]
      if (!shop) return { ok: false, error: 'not_found' }
      const authority = await liveAuthority(tx as AppDb, input)
      if (authority !== 'ok') return { ok: false, error: authority }
      let request = unwrapRows<CleanupRequest>(await tx.execute(sql`
        select id, shop_id as "shopId", subject_key as "subjectKey", request_key as "requestKey",
          request_fingerprint as "requestFingerprint", customer_id as "customerId",
          destination_fingerprint as "destinationFingerprint",
          fingerprint_key_version as "fingerprintKeyVersion", state, reason_code as "reasonCode",
          requesting_actor_profile_id as "requestingActorProfileId", prior_record_counts as counts,
          proof_summary as proof
        from messaging_deletion_requests
        where id = ${input.requestId}::uuid and shop_id = ${input.actor.shopId}::uuid
        for update
      `))[0]
      if (!request) return { ok: false, error: 'not_found' }
      if (request.state === 'completed') {
        return {
          ok: true,
          requestId: request.id,
          state: 'completed',
          counts: storedResultCounts(request),
        }
      }
      if (!request.customerId) return { ok: false, error: 'request_conflict' }
      const customer = unwrapRows(await tx.execute<{ id: string }>(sql`
        select id from customers where shop_id = ${request.shopId}::uuid
          and id = ${request.customerId}::uuid for update
      `))[0]
      if (!customer) return { ok: false, error: 'not_found' }

      await discoverDeletionWorkItems(tx as AppDb, {
        id: request.id,
        shopId: request.shopId,
        customerId: request.customerId,
      }, MAX_TOTAL_RESOURCES)

      const validRetainedWorkItemIds = unwrapRows<{ id: string }>(await tx.execute(sql`
        with direct_valid as materialized (
          select work.id
          from messaging_deletion_work_items work
          where work.request_id = ${request.id}::uuid
            and work.outcome = 'retained'
            and case work.retention_basis
              when 'resource_hold' then exists (
                select 1 from messaging_retention_holds hold
                where hold.shop_id = work.shop_id
                  and hold.resource_id = work.resource_id
                  and hold.resource_type = case work.resource_type
                    when 'consent_event' then 'messaging_consent_event'
                    else work.resource_type
                  end
                  and hold.released_at is null
                  and hold.starts_at <= clock_timestamp()
                  and hold.expires_at > clock_timestamp()
              )
              when 'subject_hold' then exists (
                select 1 from messaging_retention_holds hold
                where hold.shop_id = work.shop_id
                  and hold.subject_key = case
                    when work.resource_type = 'consent_event' then (
                      select source.subject_key from messaging_consent_events source
                      where source.shop_id = work.shop_id and source.id = work.resource_id
                    )
                    when work.resource_type = 'consent_projection' then (
                      select source.subject_key from messaging_consent_state source
                      where source.shop_id = work.shop_id and source.id = work.resource_id
                    )
                    when work.resource_type = 'quote_send' then (
                      select source.subject_key from quote_sends source
                      where source.shop_id = work.shop_id and source.id = work.resource_id
                    )
                    when work.resource_type = 'sms_log' then (
                      select parent_source.subject_key
                      from sms_log source
                      join quote_sends parent_source
                        on parent_source.shop_id = source.shop_id
                        and parent_source.id = source.quote_send_id
                      where source.shop_id = work.shop_id and source.id = work.resource_id
                    )
                    when work.resource_type = 'notification' then coalesce((
                      select parent_source.subject_key
                      from notifications source
                      join quote_sends parent_source
                        on source.entity_type = 'quote_send'
                        and parent_source.shop_id = source.shop_id
                        and parent_source.id = source.entity_id
                      where source.shop_id = work.shop_id and source.id = work.resource_id
                    ), ${request.subjectKey}::uuid)
                  end
                  and hold.released_at is null
                  and hold.starts_at <= clock_timestamp()
                  and hold.expires_at > clock_timestamp()
              )
              else false
            end
            and not (
              work.resource_type = 'quote_send'
              and exists (
                select 1 from messaging_deletion_work_items retained_child
                where retained_child.request_id = work.request_id
                  and retained_child.parent_work_item_id = work.id
                  and retained_child.outcome = 'retained'
              )
            )
        ), dependency_valid as (
          select parent.id
          from messaging_deletion_work_items parent
          join messaging_deletion_work_items child
            on child.request_id = parent.request_id
            and child.parent_work_item_id = parent.id
          join direct_valid direct_child on direct_child.id = child.id
          where parent.request_id = ${request.id}::uuid
            and parent.outcome = 'retained'
            and parent.retention_basis = 'held_dependency'
            and parent.resource_type in ('quote_send', 'consent_projection')
          union
          select dependent.id
          from messaging_deletion_work_items dependent
          join messaging_deletion_work_items parent
            on parent.id = dependent.parent_work_item_id
            and parent.request_id = dependent.request_id
          join messaging_consent_state projection
            on projection.shop_id = parent.shop_id and projection.id = parent.resource_id
            and projection.source_event_id = dependent.resource_id
          join messaging_deletion_work_items held_sibling
            on held_sibling.request_id = dependent.request_id
            and held_sibling.parent_work_item_id = parent.id
            and held_sibling.id <> dependent.id
          join direct_valid direct_sibling on direct_sibling.id = held_sibling.id
          where dependent.request_id = ${request.id}::uuid
            and dependent.resource_type = 'consent_event'
            and dependent.outcome = 'retained'
            and dependent.retention_basis = 'held_dependency'
            and parent.outcome = 'retained'
            and parent.retention_basis = 'held_dependency'
        )
        select id from direct_valid
        union select id from dependency_valid
      `)).map(({ id }) => id)

      const sendPage = unwrapRows<SendRow>(await tx.execute(sql`
        select source.id, source.state, source.customer_id as "customerId",
          source.subject_key as "subjectKey", work.id as "workItemId",
          work.outcome as "workOutcome", work.retention_basis as "retentionBasis",
          exists (select 1 from messaging_retention_holds hold
            where hold.shop_id = source.shop_id and hold.resource_type = 'quote_send'
              and hold.resource_id = source.id and hold.released_at is null
              and hold.starts_at <= clock_timestamp() and hold.expires_at > clock_timestamp())
            as "resourceHeld",
          exists (select 1 from messaging_retention_holds hold
            where hold.shop_id = source.shop_id and hold.subject_key = source.subject_key
              and hold.released_at is null and hold.starts_at <= clock_timestamp()
              and hold.expires_at > clock_timestamp()) as "subjectHeld"
        from messaging_deletion_work_items work
        join quote_sends source on source.shop_id = work.shop_id and source.id = work.resource_id
        where work.request_id = ${request.id}::uuid
          and work.resource_type = 'quote_send' and work.outcome in ('pending', 'retained')
          and not (work.outcome = 'retained'
            and work.id = any(${sql.param(validRetainedWorkItemIds)}::uuid[]))
        order by "resourceHeld", "subjectHeld", (work.outcome = 'pending') desc, source.id
        limit ${MAX_SENDS + 1} for update of source, work
      `))
      const projectionPage = unwrapRows<ConsentProjectionRow>(await tx.execute(sql`
        select source.id, source.subject_key as "subjectKey",
          source.destination_fingerprint as "destinationFingerprint",
          source.fingerprint_key_version as "fingerprintKeyVersion",
          source.program_version as "programVersion", source.source_event_id as "sourceEventId",
          work.id as "workItemId", work.outcome as "workOutcome", false as "resourceHeld",
          exists (select 1 from messaging_retention_holds hold
            where hold.shop_id = source.shop_id and hold.subject_key = source.subject_key
              and hold.released_at is null and hold.starts_at <= clock_timestamp()
              and hold.expires_at > clock_timestamp()) as "subjectHeld"
        from messaging_deletion_work_items work
        join messaging_consent_state source
          on source.shop_id = work.shop_id and source.id = work.resource_id
        where work.request_id = ${request.id}::uuid
          and work.resource_type = 'consent_projection' and work.outcome in ('pending', 'retained')
          and not (work.outcome = 'retained'
            and work.id = any(${sql.param(validRetainedWorkItemIds)}::uuid[]))
        order by "resourceHeld", "subjectHeld", (work.outcome = 'pending') desc,
          source.subject_key, source.id
        limit ${MAX_CONSENT_PROJECTIONS + 1}
        for update of source, work
      `))
      const eventPage = unwrapRows<ConsentEventRow>(await tx.execute(sql`
        select source.id, source.subject_key as "subjectKey",
          source.destination_fingerprint as "destinationFingerprint",
          source.fingerprint_key_version as "fingerprintKeyVersion",
          source.program_version as "programVersion", work.id as "workItemId",
          work.counts_toward_proof as "countsTowardProof", work.outcome as "workOutcome",
          exists (select 1 from messaging_retention_holds hold
            where hold.shop_id = source.shop_id
              and hold.resource_type = 'messaging_consent_event'
              and hold.resource_id = source.id and hold.released_at is null
              and hold.starts_at <= clock_timestamp() and hold.expires_at > clock_timestamp())
            as "resourceHeld",
          exists (select 1 from messaging_retention_holds hold
            where hold.shop_id = source.shop_id and hold.subject_key = source.subject_key
              and hold.released_at is null and hold.starts_at <= clock_timestamp()
              and hold.expires_at > clock_timestamp()) as "subjectHeld"
        from messaging_deletion_work_items work
        join messaging_consent_events source
          on source.shop_id = work.shop_id and source.id = work.resource_id
        where work.request_id = ${request.id}::uuid
          and work.resource_type = 'consent_event' and work.outcome in ('pending', 'retained')
          and not (work.outcome = 'retained'
            and work.id = any(${sql.param(validRetainedWorkItemIds)}::uuid[]))
        order by "resourceHeld", "subjectHeld", (work.outcome = 'pending') desc,
          source.subject_key, source.id
        limit ${MAX_CONSENT_EVENTS + 1}
        for update of source, work
      `))
      let totalRemaining = MAX_TOTAL_RESOURCES
      const sends = sendPage.slice(0, Math.min(MAX_SENDS, totalRemaining))
      totalRemaining -= sends.length
      const consentProjections = projectionPage.slice(
        0,
        Math.min(MAX_CONSENT_PROJECTIONS, totalRemaining),
      )
      totalRemaining -= consentProjections.length
      const consentEvents = eventPage.slice(0, Math.min(MAX_CONSENT_EVENTS, totalRemaining))
      totalRemaining -= consentEvents.length
      const sendIds = sends.map(({ id }) => id)
      const smsPage = unwrapRows<SmsRow>(await tx.execute(sql`
        select source.id, source.quote_send_id as "quoteSendId", work.id as "workItemId",
          work.outcome as "workOutcome",
          exists (select 1 from messaging_retention_holds hold
            where hold.shop_id = source.shop_id and hold.resource_type = 'sms_log'
              and hold.resource_id = source.id and hold.released_at is null
              and hold.starts_at <= clock_timestamp() and hold.expires_at > clock_timestamp())
            as "resourceHeld",
          exists (select 1 from messaging_retention_holds hold
            join quote_sends parent_source on parent_source.shop_id = source.shop_id
              and parent_source.id = source.quote_send_id
            where hold.shop_id = source.shop_id and hold.subject_key = parent_source.subject_key
              and hold.released_at is null and hold.starts_at <= clock_timestamp()
              and hold.expires_at > clock_timestamp()) as "subjectHeld"
        from messaging_deletion_work_items work
        join sms_log source on source.shop_id = work.shop_id and source.id = work.resource_id
        where work.request_id = ${request.id}::uuid
          and work.resource_type = 'sms_log' and work.outcome in ('pending', 'retained')
          and not (work.outcome = 'retained'
            and work.id = any(${sql.param(validRetainedWorkItemIds)}::uuid[]))
          and source.quote_send_id = any(${sql.param(sendIds)}::uuid[])
        order by "resourceHeld", "subjectHeld", (work.outcome = 'pending') desc, source.id
        limit ${MAX_SMS_LOGS + 1} for update of source, work
      `))
      const notificationPage = unwrapRows<WorkItemSource & {
        id: string; entityType: string; entityId: string; workOutcome: 'pending' | 'retained'
        resourceHeld: boolean; subjectHeld: boolean
      }>(await tx.execute(sql`
        select source.id, source.entity_type as "entityType", source.entity_id as "entityId",
          work.id as "workItemId", work.outcome as "workOutcome",
          exists (select 1 from messaging_retention_holds hold
            where hold.shop_id = source.shop_id and hold.resource_type = 'notification'
              and hold.resource_id = source.id and hold.released_at is null
              and hold.starts_at <= clock_timestamp() and hold.expires_at > clock_timestamp())
            as "resourceHeld",
          exists (select 1 from messaging_retention_holds hold
            where hold.shop_id = source.shop_id
              and hold.subject_key = case when source.entity_type = 'customer'
                then ${request.subjectKey}::uuid else (
                  select parent_source.subject_key from quote_sends parent_source
                  where parent_source.shop_id = source.shop_id and parent_source.id = source.entity_id
                ) end
              and hold.released_at is null and hold.starts_at <= clock_timestamp()
              and hold.expires_at > clock_timestamp()) as "subjectHeld"
        from messaging_deletion_work_items work
        join notifications source on source.shop_id = work.shop_id and source.id = work.resource_id
        where work.request_id = ${request.id}::uuid
          and work.resource_type = 'notification' and work.outcome in ('pending', 'retained')
          and not (work.outcome = 'retained'
            and work.id = any(${sql.param(validRetainedWorkItemIds)}::uuid[]))
          and ((source.entity_type = 'customer' and source.entity_id = ${request.customerId}::uuid)
            or (source.entity_type = 'quote_send'
              and source.entity_id = any(${sql.param(sendIds)}::uuid[])))
        order by "resourceHeld", "subjectHeld", (work.outcome = 'pending') desc, source.id
        limit ${MAX_NOTIFICATIONS + 1} for update of source, work
      `))
      const smsRows = smsPage.slice(0, Math.min(MAX_SMS_LOGS, totalRemaining))
      totalRemaining -= smsRows.length
      const notificationRows = notificationPage.slice(
        0,
        Math.min(MAX_NOTIFICATIONS, totalRemaining),
      )
      totalRemaining -= notificationRows.length
      const deferredSendIds = new Set(notificationPage.slice(notificationRows.length)
        .filter(({ entityType }) => entityType === 'quote_send')
        .map(({ entityId }) => entityId))
      for (const row of smsPage.slice(smsRows.length)) deferredSendIds.add(row.quoteSendId)
      const consentEventHeld = (event: ConsentEventRow) =>
        event.subjectHeld || event.resourceHeld
      const sendHeld = (send: SendRow) => send.subjectHeld || send.resourceHeld
      const smsHeld = (row: SmsRow) => row.subjectHeld || row.resourceHeld
      const notificationHeld = (row: { resourceHeld: boolean; subjectHeld: boolean }) =>
        row.resourceHeld || row.subjectHeld
      const heldSmsParents = new Set(smsRows.filter(smsHeld)
        .map(({ quoteSendId }) => quoteSendId))
      const subjectHeldEventWorkItemIds = consentEvents
        .filter((event) => event.workOutcome === 'pending' && event.subjectHeld)
        .map(({ workItemId }) => workItemId)
      const resourceHeldEventWorkItemIds = consentEvents
        .filter((event) => event.workOutcome === 'pending'
          && !event.subjectHeld && event.resourceHeld)
        .map(({ workItemId }) => workItemId)
      if (subjectHeldEventWorkItemIds.length > 0) {
        await tx.execute(sql`
          update messaging_deletion_work_items set outcome = 'retained',
            retention_basis = 'subject_hold', resolved_at = clock_timestamp()
          where request_id = ${request.id}::uuid
            and id = any(${sql.param(subjectHeldEventWorkItemIds)}::uuid[])
            and outcome = 'pending'
        `)
      }
      if (resourceHeldEventWorkItemIds.length > 0) {
        await tx.execute(sql`
          update messaging_deletion_work_items set outcome = 'retained',
            retention_basis = 'resource_hold', resolved_at = clock_timestamp()
          where request_id = ${request.id}::uuid
            and id = any(${sql.param(resourceHeldEventWorkItemIds)}::uuid[])
            and outcome = 'pending'
        `)
      }
      const consentSubjectKeys = [...new Set([
        ...consentProjections.map(({ subjectKey }) => subjectKey),
        ...consentEvents.map(({ subjectKey }) => subjectKey),
      ])].sort()
      for (const subjectKey of consentSubjectKeys) {
        const subjectEvents = consentEvents.filter((event) =>
          event.subjectKey === subjectKey && !consentEventHeld(event))
        const subjectProjections = consentProjections.filter((projection) =>
          projection.subjectKey === subjectKey)
        const source = subjectEvents[0] ?? subjectProjections[0]
          ?? consentEvents.find((event) => event.subjectKey === subjectKey)
        if (!source) throw new Error('consent_subject_source_unavailable')
        const projectionWorkItemIds = subjectProjections.map(({ workItemId }) => workItemId)
        const selectedEventIds = subjectEvents.map(({ id }) => id)
        const deletableProjectionWorkItemIds = projectionWorkItemIds.length === 0
          ? []
          : unwrapRows<{ id: string }>(await tx.execute(sql`
            select work.id
            from messaging_deletion_work_items work
            join messaging_consent_state projection
              on projection.shop_id = work.shop_id and projection.id = work.resource_id
            where work.request_id = ${request.id}::uuid
              and work.id = any(${sql.param(projectionWorkItemIds)}::uuid[])
              and work.outcome in ('pending', 'retained')
              and not exists (
                select 1 from messaging_consent_events child
                where child.shop_id = projection.shop_id
                  and child.subject_key = projection.subject_key
                  and child.destination_fingerprint = projection.destination_fingerprint
                  and child.fingerprint_key_version = projection.fingerprint_key_version
                  and child.program_version = projection.program_version
                  and not (child.id = any(${sql.param(selectedEventIds)}::uuid[]))
              )
              and not exists (
                select 1 from messaging_retention_holds hold
                where hold.shop_id = projection.shop_id
                  and hold.released_at is null
                  and hold.starts_at <= clock_timestamp()
                  and hold.expires_at > clock_timestamp()
                  and (hold.subject_key = projection.subject_key
                    or (hold.resource_type = 'messaging_consent_event' and exists (
                      select 1 from messaging_consent_events held_child
                      where held_child.shop_id = projection.shop_id
                        and held_child.subject_key = projection.subject_key
                        and held_child.destination_fingerprint = projection.destination_fingerprint
                        and held_child.fingerprint_key_version = projection.fingerprint_key_version
                        and held_child.program_version = projection.program_version
                        and held_child.id = hold.resource_id
                    )))
              )
            order by work.id
          `)).map(({ id }) => id)
        const heldProjectionWorkItemIds = projectionWorkItemIds.length === 0
          ? []
          : unwrapRows<{ id: string }>(await tx.execute(sql`
            select work.id
            from messaging_deletion_work_items work
            join messaging_consent_state projection
              on projection.shop_id = work.shop_id and projection.id = work.resource_id
            where work.request_id = ${request.id}::uuid
              and work.id = any(${sql.param(projectionWorkItemIds)}::uuid[])
              and work.outcome in ('pending', 'retained')
              and exists (
                select 1 from messaging_retention_holds hold
                where hold.shop_id = projection.shop_id
                  and hold.released_at is null
                  and hold.starts_at <= clock_timestamp()
                  and hold.expires_at > clock_timestamp()
                  and (hold.subject_key = projection.subject_key
                    or (hold.resource_type = 'messaging_consent_event' and exists (
                      select 1 from messaging_consent_events held_child
                      where held_child.shop_id = projection.shop_id
                        and held_child.subject_key = projection.subject_key
                        and held_child.destination_fingerprint = projection.destination_fingerprint
                        and held_child.fingerprint_key_version = projection.fingerprint_key_version
                        and held_child.program_version = projection.program_version
                        and held_child.id = hold.resource_id
                    )))
              )
            order by work.id
          `)).map(({ id }) => id)
        const heldProjectionIds = new Set(heldProjectionWorkItemIds)
        const dependencyRetainedEvents = subjectEvents.filter((event) =>
          subjectProjections.some((projection) =>
            heldProjectionIds.has(projection.workItemId)
              && projection.sourceEventId === event.id))
        const dependencyRetainedEventWorkItemIds = dependencyRetainedEvents
          .map(({ workItemId }) => workItemId)
        if (dependencyRetainedEventWorkItemIds.length > 0) {
          await tx.execute(sql`
            update messaging_deletion_work_items set outcome = 'retained',
              retention_basis = 'held_dependency', resolved_at = clock_timestamp()
            where request_id = ${request.id}::uuid
              and id = any(${sql.param(dependencyRetainedEventWorkItemIds)}::uuid[])
              and outcome = 'pending'
          `)
        }
        let compactableEvents = subjectEvents.filter(({ workItemId }) =>
          !dependencyRetainedEventWorkItemIds.includes(workItemId))
        if (deletableProjectionWorkItemIds.length > 0) {
          const removedProjectionWorkItemIds = unwrapRows<{ id: string }>(await tx.execute(sql`
            delete from messaging_consent_state projection
            using messaging_deletion_work_items work
            where work.id = any(${sql.param(deletableProjectionWorkItemIds)}::uuid[])
              and work.request_id = ${request.id}::uuid
              and work.resource_type = 'consent_projection'
              and work.outcome in ('pending', 'retained')
              and projection.shop_id = work.shop_id and projection.id = work.resource_id
            returning work.id
          `)).map(({ id }) => id)
          if (removedProjectionWorkItemIds.length !== deletableProjectionWorkItemIds.length) {
            throw new Error('consent_projection_source_delete_incomplete')
          }
        }
        if (compactableEvents.length > 0) {
          const stillReferencedEventIds = new Set(unwrapRows<{ id: string }>(await tx.execute(sql`
            select source_event_id as id
            from messaging_consent_state
            where shop_id = ${request.shopId}::uuid
              and source_event_id = any(${sql.param(compactableEvents.map(({ id }) => id))}::uuid[])
            order by source_event_id
          `)).map(({ id }) => id))
          compactableEvents = compactableEvents.filter(({ id }) => !stillReferencedEventIds.has(id))
        }
        const compactionItems = compactableEvents.map(({ workItemId }) => workItemId)
        for (let offset = 0; offset < compactionItems.length; offset += MAX_CONSENT_EVENTS) {
          const workItemIds = compactionItems.slice(offset, offset + MAX_CONSENT_EVENTS)
          await tx.execute(sql`
            select compact_messaging_consent_work_items(
              ${request.shopId}::uuid, ${request.id}::uuid,
              ${sql.param(workItemIds)}::uuid[]
            )
          `)
        }
        if (deletableProjectionWorkItemIds.length > 0) {
          const resolvedProjectionCount = unwrapRows<{ count: number }>(await tx.execute(sql`
            with resolved as (
              update messaging_deletion_work_items work set outcome = 'deleted',
                retention_basis = null, resolved_at = clock_timestamp()
              where work.request_id = ${request.id}::uuid
                and work.id = any(${sql.param(deletableProjectionWorkItemIds)}::uuid[])
                and work.resource_type = 'consent_projection'
                and work.outcome in ('pending', 'retained')
                and not exists (
                  select 1 from messaging_deletion_work_items child
                  where child.request_id = work.request_id
                    and child.parent_work_item_id = work.id
                    and child.outcome = 'pending'
                )
              returning 1
            ) select count(*)::int as count from resolved
          `))[0]?.count ?? 0
          if (resolvedProjectionCount !== deletableProjectionWorkItemIds.length) {
            throw new Error('consent_projection_outcome_advance_incomplete')
          }
        }
        if (heldProjectionWorkItemIds.length > 0) {
          await tx.execute(sql`
            update messaging_deletion_work_items work set outcome = 'retained',
              retention_basis = case when exists (
                select 1
                from messaging_consent_state projection
                join messaging_retention_holds hold
                  on hold.shop_id = projection.shop_id
                  and hold.subject_key = projection.subject_key
                  and hold.released_at is null
                  and hold.starts_at <= clock_timestamp()
                  and hold.expires_at > clock_timestamp()
                where projection.shop_id = work.shop_id
                  and projection.id = work.resource_id
              ) then 'subject_hold' else 'held_dependency' end,
              resolved_at = clock_timestamp()
            where work.request_id = ${request.id}::uuid
              and work.id = any(${sql.param(heldProjectionWorkItemIds)}::uuid[])
              and work.outcome = 'pending'
              and not exists (
                select 1 from messaging_deletion_work_items child
                where child.request_id = work.request_id
                  and child.parent_work_item_id = work.id
                  and child.outcome = 'pending'
              )
              and not exists (
                select 1
                from messaging_consent_state projection
                join messaging_consent_events child
                  on child.shop_id = projection.shop_id
                  and child.subject_key = projection.subject_key
                  and child.destination_fingerprint = projection.destination_fingerprint
                  and child.fingerprint_key_version = projection.fingerprint_key_version
                  and child.program_version = projection.program_version
                where projection.shop_id = work.shop_id
                  and projection.id = work.resource_id
                  and not exists (
                    select 1 from messaging_deletion_work_items child_work
                    where child_work.request_id = work.request_id
                      and child_work.resource_type = 'consent_event'
                      and child_work.resource_id = child.id
                  )
              )
          `)
        }
      }
      const deletableSmsIds = smsRows.filter((row) => !smsHeld(row)).map(({ id }) => id)
      unwrapRows<{ count: number }>(await tx.execute(sql`
        with deleted as (
          delete from sms_log source using messaging_deletion_work_items work
          where work.request_id = ${request.id}::uuid
            and work.resource_type = 'sms_log' and work.outcome in ('pending', 'retained')
            and work.resource_id = source.id and work.shop_id = source.shop_id
            and source.shop_id = ${request.shopId}::uuid
            and source.id = any(${sql.param(deletableSmsIds)}::uuid[])
            and not exists (select 1 from messaging_retention_holds hold
              where hold.shop_id = source.shop_id
                and hold.resource_type = 'sms_log' and hold.resource_id = source.id
                and hold.released_at is null and hold.starts_at <= clock_timestamp()
                and hold.expires_at > clock_timestamp())
          returning work.id
        ), resolved as (
          update messaging_deletion_work_items work set outcome = 'deleted',
            retention_basis = null, resolved_at = clock_timestamp()
          from deleted where work.id = deleted.id returning 1
        ) select count(*)::int as count from resolved
      `))[0]?.count ?? 0
      const subjectHeldSmsWorkItemIds = smsRows.filter((row) => smsHeld(row)
        && row.workOutcome === 'pending' && !row.resourceHeld).map(({ workItemId }) => workItemId)
      const resourceHeldSmsWorkItemIds = smsRows.filter((row) =>
        row.workOutcome === 'pending' && row.resourceHeld).map(({ workItemId }) => workItemId)
      if (subjectHeldSmsWorkItemIds.length > 0) {
        await tx.execute(sql`
          update messaging_deletion_work_items set outcome = 'retained',
            retention_basis = 'subject_hold', resolved_at = clock_timestamp()
          where request_id = ${request.id}::uuid
            and id = any(${sql.param(subjectHeldSmsWorkItemIds)}::uuid[])
            and outcome = 'pending'
        `)
      }
      if (resourceHeldSmsWorkItemIds.length > 0) {
        await tx.execute(sql`
          update messaging_deletion_work_items set outcome = 'retained',
            retention_basis = 'resource_hold', resolved_at = clock_timestamp()
          where request_id = ${request.id}::uuid
            and id = any(${sql.param(resourceHeldSmsWorkItemIds)}::uuid[])
            and outcome = 'pending'
        `)
      }
      const deletableNotificationIds = notificationRows.filter((row) => !notificationHeld(row))
        .map(({ id }) => id)
      unwrapRows<{ count: number }>(await tx.execute(sql`
        with deleted as (
          delete from notifications source using messaging_deletion_work_items work
          where work.request_id = ${request.id}::uuid
            and work.resource_type = 'notification' and work.outcome in ('pending', 'retained')
            and work.resource_id = source.id and work.shop_id = source.shop_id
            and source.shop_id = ${request.shopId}::uuid
            and source.id = any(${sql.param(deletableNotificationIds)}::uuid[])
            and not exists (select 1 from messaging_retention_holds hold
              where hold.shop_id = source.shop_id
                and hold.resource_type = 'notification' and hold.resource_id = source.id
                and hold.released_at is null and hold.starts_at <= clock_timestamp()
                and hold.expires_at > clock_timestamp())
          returning work.id
        ), resolved as (
          update messaging_deletion_work_items work set outcome = 'deleted',
            retention_basis = null, resolved_at = clock_timestamp()
          from deleted where work.id = deleted.id returning 1
        ) select count(*)::int as count from resolved
      `))[0]?.count ?? 0
      const subjectHeldNotificationWorkItemIds = notificationRows
        .filter((row) => row.workOutcome === 'pending'
          && notificationHeld(row) && !row.resourceHeld)
        .map(({ workItemId }) => workItemId)
      const resourceHeldNotificationWorkItemIds = notificationRows
        .filter((row) => row.workOutcome === 'pending' && row.resourceHeld)
        .map(({ workItemId }) => workItemId)
      if (subjectHeldNotificationWorkItemIds.length > 0) {
        await tx.execute(sql`
          update messaging_deletion_work_items set outcome = 'retained',
            retention_basis = 'subject_hold', resolved_at = clock_timestamp()
          where request_id = ${request.id}::uuid
            and id = any(${sql.param(subjectHeldNotificationWorkItemIds)}::uuid[])
            and outcome = 'pending'
        `)
      }
      if (resourceHeldNotificationWorkItemIds.length > 0) {
        await tx.execute(sql`
          update messaging_deletion_work_items set outcome = 'retained',
            retention_basis = 'resource_hold', resolved_at = clock_timestamp()
          where request_id = ${request.id}::uuid
            and id = any(${sql.param(resourceHeldNotificationWorkItemIds)}::uuid[])
            and outcome = 'pending'
        `)
      }
      const retainedChildParentWorkItemIds = new Set(unwrapRows<{ id: string }>(await tx.execute(sql`
        select distinct parent.id
        from messaging_deletion_work_items parent
        join messaging_deletion_work_items child
          on child.request_id = parent.request_id
          and child.parent_work_item_id = parent.id
        where parent.request_id = ${request.id}::uuid
          and parent.id = any(${sql.param(sends.map(({ workItemId }) => workItemId))}::uuid[])
          and child.outcome = 'retained'
      `)).map(({ id }) => id))
      const deletableSendWorkItemIds = new Set(unwrapRows<{ id: string }>(await tx.execute(sql`
        select parent.id
        from messaging_deletion_work_items parent
        join quote_sends source on source.shop_id = parent.shop_id
          and source.id = parent.resource_id
        where parent.request_id = ${request.id}::uuid
          and parent.id = any(${sql.param(sends.map(({ workItemId }) => workItemId))}::uuid[])
          and parent.outcome in ('pending', 'retained')
          and not exists (
            select 1 from sms_log child
            where child.shop_id = source.shop_id and child.quote_send_id = source.id
          )
          and not exists (
            select 1 from notifications child
            where child.shop_id = source.shop_id
              and child.entity_type = 'quote_send' and child.entity_id = source.id
          )
          and not exists (
            select 1 from messaging_deletion_work_items child
            where child.request_id = parent.request_id
              and child.parent_work_item_id = parent.id
              and child.outcome = 'pending'
          )
      `)).map(({ id }) => id))
      for (const send of sends) {
        if (deferredSendIds.has(send.id)) continue
        if (!sendHeld(send) && !retainedChildParentWorkItemIds.has(send.workItemId)
          && !heldSmsParents.has(send.id) && deletableSendWorkItemIds.has(send.workItemId)) {
          const resolved = unwrapRows<{ count: number }>(await tx.execute(sql`
            with deleted as (
              delete from quote_sends source using messaging_deletion_work_items work
              where work.id = ${send.workItemId}::uuid
                and work.request_id = ${request.id}::uuid
                and work.resource_type = 'quote_send' and work.outcome in ('pending', 'retained')
                and source.shop_id = work.shop_id and source.id = work.resource_id
              returning work.id
            ), resolved as (
              update messaging_deletion_work_items work set outcome = 'deleted',
                retention_basis = null, resolved_at = clock_timestamp()
              from deleted where work.id = deleted.id returning 1
            ) select count(*)::int as count from resolved
          `))[0]?.count ?? 0
          if (resolved !== 1) throw new Error('quote_send_outcome_mismatch')
          continue
        }
        const dependencyHeld = retainedChildParentWorkItemIds.has(send.workItemId)
          || heldSmsParents.has(send.id)
        const retentionBasis = dependencyHeld
          ? 'held_dependency'
          : sendHeld(send) ? (send.resourceHeld ? 'resource_hold' : 'subject_hold') : null
        if (!retentionBasis) continue
        if (send.workOutcome === 'retained') {
          if (retentionBasis === 'held_dependency' && send.retentionBasis !== retentionBasis) {
            await tx.execute(sql`
              update messaging_deletion_work_items set retention_basis = 'held_dependency'
              where id = ${send.workItemId}::uuid and request_id = ${request.id}::uuid
                and outcome = 'retained'
                and retention_basis in ('resource_hold', 'subject_hold')
            `)
          }
          continue
        }
        if (cancellable.has(send.state)) {
          await tx.execute(sql`
            with transition as (select clock_timestamp() as at), detached as (
              update quote_sends source set customer_id = null, state = 'cancelled',
                token_hash = null, token_expires_at = null, terminal_at = transition.at,
                retain_until = transition.at + interval '1 year', updated_at = transition.at
              from transition where source.id = ${send.id}::uuid returning source.id
            ) update messaging_deletion_work_items work set outcome = 'retained',
              retention_basis = ${retentionBasis}, resolved_at = clock_timestamp()
            from detached where work.id = ${send.workItemId}::uuid
              and work.request_id = ${request.id}::uuid and work.outcome = 'pending'
          `)
        } else if (inFlight.has(send.state) || send.state === 'delivered') {
          await tx.execute(sql`
            with detached as (
              update quote_sends source set customer_id = null, token_hash = null,
                token_expires_at = null, updated_at = clock_timestamp()
              where source.id = ${send.id}::uuid returning source.id
            ) update messaging_deletion_work_items work set outcome = 'retained',
              retention_basis = ${retentionBasis}, resolved_at = clock_timestamp()
            from detached where work.id = ${send.workItemId}::uuid
              and work.request_id = ${request.id}::uuid and work.outcome = 'pending'
          `)
        } else {
          await tx.execute(sql`
            with detached as (
              update quote_sends source set customer_id = null,
                updated_at = clock_timestamp()
              where source.id = ${send.id}::uuid returning source.id
            ) update messaging_deletion_work_items work set outcome = 'retained',
              retention_basis = ${retentionBasis}, resolved_at = clock_timestamp()
            from detached where work.id = ${send.workItemId}::uuid
              and work.request_id = ${request.id}::uuid and work.outcome = 'pending'
          `)
        }
      }
      const finalized = unwrapRows<{
        state: 'pending' | 'completed'
        priorRecordCounts: Record<string, number> | null
        proofSummary: Record<string, unknown> | null
      }>(await tx.execute(sql`
        select state, prior_record_counts as "priorRecordCounts",
          proof_summary as "proofSummary"
        from finalize_messaging_deletion_request(
          ${request.shopId}::uuid, ${request.id}::uuid
        )
      `))[0]
      if (!finalized) throw new Error('deletion_finalizer_result_unavailable')
      if (finalized.state === 'pending') {
        return { ok: true, requestId: request.id, state: 'pending' }
      }
      const completed: RequestRow = {
        ...request,
        state: 'completed',
        customerId: null,
        counts: finalized.priorRecordCounts,
        proof: finalized.proofSummary,
      }
      return {
        ok: true,
        requestId: request.id,
        state: 'completed',
        counts: storedResultCounts(completed),
      }
    })
  } catch {
    return { ok: false, error: 'retryable' }
  }
}
