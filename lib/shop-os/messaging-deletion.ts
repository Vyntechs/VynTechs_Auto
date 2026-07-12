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
const MAX_PENDING_REQUESTS = 32
const MAX_SENDS = 128
const MAX_CONSENT_EVENTS = 256
const MAX_CONSENT_PROJECTIONS = 128
const MAX_SMS_LOGS = 512
const MAX_NOTIFICATIONS = 256
const MAX_HOLDS = 256
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
        || own(current, 'constraint_name') === 'messaging_deletion_requests_shop_actor_request_uq')) {
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
    return row ? retry(row, input) : { ok: false, error: 'retryable' }
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
type SendRow = { id: string; state: string; customerId: string | null }
type HoldRow = { resourceType: string | null; resourceId: string | null; subjectKey: string | null }
type ConsentProjectionRow = MessagingPair & { id: string; subjectKey: string }
type ConsentEventRow = MessagingPair & { id: string; subjectKey: string }
type SmsRow = { id: string; quoteSendId: string }

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

      const pendingRequests = unwrapRows<{ id: string }>(await tx.execute(sql`
        select id from messaging_deletion_requests
        where shop_id = ${request.shopId}::uuid and state = 'pending'
          and (subject_key = ${request.subjectKey}::uuid
            or customer_id = ${request.customerId}::uuid)
        order by id limit ${MAX_PENDING_REQUESTS + 1} for update
      `))
      if (pendingRequests.length > MAX_PENDING_REQUESTS) return { ok: false, error: 'busy' }
      request = unwrapRows<CleanupRequest>(await tx.execute(sql`
        select id, shop_id as "shopId", subject_key as "subjectKey", request_key as "requestKey",
          request_fingerprint as "requestFingerprint", customer_id as "customerId",
          destination_fingerprint as "destinationFingerprint",
          fingerprint_key_version as "fingerprintKeyVersion", state, reason_code as "reasonCode",
          requesting_actor_profile_id as "requestingActorProfileId", prior_record_counts as counts,
          proof_summary as proof
        from messaging_deletion_requests where id = ${input.requestId}::uuid
      `))[0]
      if (!request || request.state !== 'pending' || !request.customerId) {
        return { ok: false, error: 'request_conflict' }
      }
      const customer = unwrapRows(await tx.execute<{ id: string }>(sql`
        select id from customers where shop_id = ${request.shopId}::uuid
          and id = ${request.customerId}::uuid for update
      `))[0]
      if (!customer) return { ok: false, error: 'not_found' }

      const sends = unwrapRows<SendRow>(await tx.execute(sql`
        select id, state, customer_id as "customerId" from quote_sends
        where shop_id = ${request.shopId}::uuid and customer_id = ${request.customerId}::uuid
        order by id limit ${MAX_SENDS + 1} for update
      `))
      const consentProjections = unwrapRows<ConsentProjectionRow>(await tx.execute(sql`
        select id, subject_key as "subjectKey",
          destination_fingerprint as "destinationFingerprint",
          fingerprint_key_version as "fingerprintKeyVersion"
        from messaging_consent_state
        where shop_id = ${request.shopId}::uuid and customer_id = ${request.customerId}::uuid
        order by subject_key, id limit ${MAX_CONSENT_PROJECTIONS + 1} for update
      `))
      const consentEvents = unwrapRows<ConsentEventRow>(await tx.execute(sql`
        select id, subject_key as "subjectKey",
          destination_fingerprint as "destinationFingerprint",
          fingerprint_key_version as "fingerprintKeyVersion"
        from messaging_consent_events
        where shop_id = ${request.shopId}::uuid and customer_id = ${request.customerId}::uuid
        order by subject_key, id limit ${MAX_CONSENT_EVENTS + 1} for update
      `))
      const sendIds = sends.map(({ id }) => id)
      const smsRows = unwrapRows<SmsRow>(await tx.execute(sql`
        select id, quote_send_id as "quoteSendId" from sms_log
        where shop_id = ${request.shopId}::uuid
          and quote_send_id = any(${sql.param(sendIds)}::uuid[])
        order by id limit ${MAX_SMS_LOGS + 1} for update
      `))
      const notificationRows = unwrapRows<{ id: string }>(await tx.execute(sql`
        select id from notifications where shop_id = ${request.shopId}::uuid
          and ((entity_type = 'customer' and entity_id = ${request.customerId}::uuid)
            or (entity_type = 'quote_send'
              and entity_id = any(${sql.param(sendIds)}::uuid[])))
        order by id limit ${MAX_NOTIFICATIONS + 1} for update
      `))
      const subjectKeys = [...new Set([
        request.subjectKey,
        ...consentProjections.map(({ subjectKey }) => subjectKey),
        ...consentEvents.map(({ subjectKey }) => subjectKey),
      ])].sort()
      const smsIds = smsRows.map(({ id }) => id)
      const notificationIds = notificationRows.map(({ id }) => id)
      const consentEventIds = consentEvents.map(({ id }) => id)
      const holds = unwrapRows<HoldRow>(await tx.execute(sql`
        select resource_type as "resourceType", resource_id as "resourceId", subject_key as "subjectKey"
        from messaging_retention_holds
        where shop_id = ${request.shopId}::uuid and released_at is null
          and starts_at <= clock_timestamp() and expires_at > clock_timestamp()
          and (subject_key = any(${sql.param(subjectKeys)}::uuid[])
            or (resource_type = 'quote_send'
              and resource_id = any(${sql.param(sendIds)}::uuid[]))
            or (resource_type = 'sms_log'
              and resource_id = any(${sql.param(smsIds)}::uuid[]))
            or (resource_type = 'notification'
              and resource_id = any(${sql.param(notificationIds)}::uuid[]))
            or (resource_type = 'messaging_consent_event'
              and resource_id = any(${sql.param(consentEventIds)}::uuid[])))
        order by id limit ${MAX_HOLDS + 1} for update
      `))

      const overLimit = sends.length > MAX_SENDS
        || consentEvents.length > MAX_CONSENT_EVENTS
        || consentProjections.length > MAX_CONSENT_PROJECTIONS
        || smsRows.length > MAX_SMS_LOGS
        || notificationRows.length > MAX_NOTIFICATIONS
        || holds.length > MAX_HOLDS
        || sends.length + consentEvents.length + consentProjections.length + smsRows.length
          + notificationRows.length + holds.length > MAX_TOTAL_RESOURCES
      if (overLimit) return { ok: false, error: 'busy' }

      const heldSubjectKeys = new Set(subjectKeys.filter((subjectKey) =>
        holds.some((hold) => hold.subjectKey === subjectKey)
          || consentEvents.some((event) => event.subjectKey === subjectKey
            && holds.some((hold) => hold.resourceType === 'messaging_consent_event'
              && hold.resourceId === event.id))))
      const customerSubjectHeld = heldSubjectKeys.size > 0
      const held = (type: string, id: string) => customerSubjectHeld || holds.some((hold) =>
        hold.resourceType === type && hold.resourceId === id)
      const heldSmsParents = new Set(smsRows.filter(({ id }) => held('sms_log', id))
        .map(({ quoteSendId }) => quoteSendId))

      const priorCounts = Object.freeze({
        consentEvents: consentEvents.length,
        consentProjections: consentProjections.length,
        notifications: notificationRows.length,
        quoteSends: sends.length,
        smsLogs: smsRows.length,
      })

      let consentDeleted = 0
      let detachedSuppressionSources = 0
      const consentSubjectKeys = [...new Set([
        ...consentProjections.map(({ subjectKey }) => subjectKey),
        ...consentEvents.map(({ subjectKey }) => subjectKey),
      ])].sort()
      for (const subjectKey of consentSubjectKeys) {
        if (heldSubjectKeys.has(subjectKey)) continue
        const subjectEvents = consentEvents.filter((event) => event.subjectKey === subjectKey)
        const subjectProjections = consentProjections.filter((projection) =>
          projection.subjectKey === subjectKey)
        const source = subjectEvents[0] ?? subjectProjections[0]
        if (!source) throw new Error('consent_subject_source_unavailable')
        const eventIds = subjectEvents.map(({ id }) => id)
        detachedSuppressionSources += unwrapRows<{ id: string }>(await tx.execute(sql`
          update sms_suppressions set source_event_id = null, updated_at = clock_timestamp()
          where shop_id = ${request.shopId}::uuid
            and source_event_id = any(${sql.param(eventIds)}::uuid[])
          returning id
        `)).length
        await tx.execute(sql`
          insert into messaging_consent_events (
            shop_id, subject_key, customer_id, destination_fingerprint,
            fingerprint_key_version, program_version, event_type, committed_at, occurred_at,
            capture_method, customer_controlled, evidence_kind, actor_profile_id,
            request_key, request_fingerprint, retain_until
          ) values (
            ${request.shopId}::uuid, ${subjectKey}::uuid, ${request.customerId}::uuid,
            ${source.destinationFingerprint}, ${source.fingerprintKeyVersion}, 'internal_deletion_v1',
            'deleted', clock_timestamp(), clock_timestamp(), 'staff_request', false,
            'staff_request', ${input.actor.profileId}::uuid, gen_random_uuid(),
            ${request.requestFingerprint}, clock_timestamp() + interval '5 years'
          )
        `)
        await tx.execute(sql`
          delete from messaging_consent_state
          where shop_id = ${request.shopId}::uuid and customer_id = ${request.customerId}::uuid
            and subject_key = ${subjectKey}::uuid
        `)
        const compacted = unwrapRows<{ count: number }>(await tx.execute(sql`
          select compact_messaging_consent_events(
            ${request.shopId}::uuid, ${subjectKey}::uuid, ${request.id}::uuid
          ) as count
        `))[0]?.count ?? 0
        consentDeleted += Math.max(0, compacted - 1)
      }

      const smsDeleted = unwrapRows<{ count: number }>(await tx.execute(sql`
        with deleted as (delete from sms_log l where l.shop_id = ${request.shopId}::uuid
          and ${!customerSubjectHeld}
          and l.quote_send_id = any(${sql.param(sendIds)}::uuid[])
          and not exists (select 1 from messaging_retention_holds h
            where h.shop_id = l.shop_id and h.resource_type = 'sms_log' and h.resource_id = l.id
              and h.released_at is null and h.starts_at <= clock_timestamp()
              and h.expires_at > clock_timestamp()) returning 1)
        select count(*)::int as count from deleted
      `))[0]?.count ?? 0
      const notificationsDeleted = unwrapRows<{ count: number }>(await tx.execute(sql`
        with deleted as (delete from notifications n where n.shop_id = ${request.shopId}::uuid
          and ${!customerSubjectHeld}
          and ((n.entity_type = 'customer' and n.entity_id = ${request.customerId}::uuid)
            or (n.entity_type = 'quote_send'
              and n.entity_id = any(${sql.param(sendIds)}::uuid[])))
          and not exists (select 1 from messaging_retention_holds h
              where h.shop_id = n.shop_id and h.resource_type = 'notification' and h.resource_id = n.id
                and h.released_at is null and h.starts_at <= clock_timestamp()
                and h.expires_at > clock_timestamp()) returning 1)
        select count(*)::int as count from deleted
      `))[0]?.count ?? 0

      let sendsDeleted = 0
      let sendsRetained = 0
      for (const send of sends) {
        if (!held('quote_send', send.id) && !heldSmsParents.has(send.id)) {
          await tx.execute(sql`delete from quote_sends where id = ${send.id}::uuid`)
          sendsDeleted += 1
          continue
        }
        if (cancellable.has(send.state)) {
          await tx.execute(sql`update quote_sends set customer_id = null, state = 'cancelled',
            token_hash = null, token_expires_at = null, terminal_at = transition.at,
            retain_until = transition.at + interval '1 year', updated_at = transition.at
            from (select clock_timestamp() as at) transition where id = ${send.id}::uuid`)
        } else if (inFlight.has(send.state) || send.state === 'delivered') {
          await tx.execute(sql`update quote_sends set customer_id = null, token_hash = null,
            token_expires_at = null, updated_at = clock_timestamp() where id = ${send.id}::uuid`)
        } else {
          await tx.execute(sql`update quote_sends set customer_id = null,
            updated_at = clock_timestamp() where id = ${send.id}::uuid`)
        }
        sendsRetained += 1
      }

      const completedAt = unwrapRows<{ at: Date | string }>(await tx.execute(sql`
        with barriers(at) as (
          select requested_at from messaging_deletion_requests where shop_id = ${request.shopId}::uuid
          union all select completed_at from messaging_deletion_requests where shop_id = ${request.shopId}::uuid
          union all select committed_at from messaging_consent_events where shop_id = ${request.shopId}::uuid
          union all select updated_at from quote_sends where shop_id = ${request.shopId}::uuid
          union all select updated_at from sms_suppressions where shop_id = ${request.shopId}::uuid
        ) select greatest(clock_timestamp(), coalesce(max(at) + interval '1 millisecond', '-infinity')) as at
          from barriers
      `))[0]?.at
      if (!completedAt) throw new Error('completion_time_unavailable')
      const counts = Object.freeze({
        consentEventsDeleted: consentDeleted,
        notificationsDeleted,
        smsLogsDeleted: smsDeleted,
        quoteSendsDeleted: sendsDeleted,
        quoteSendsRetained: sendsRetained,
      })
      const heldConsentEvents = consentEvents.filter(({ subjectKey }) =>
        heldSubjectKeys.has(subjectKey)).length
      const heldConsentProjections = consentProjections.filter(({ subjectKey }) =>
        heldSubjectKeys.has(subjectKey)).length
      const heldQuoteSends = sendsRetained
      const heldSmsLogs = customerSubjectHeld
        ? smsRows.length
        : smsRows.filter(({ id }) => held('sms_log', id)).length
      const heldNotifications = customerSubjectHeld
        ? notificationRows.length
        : notificationRows.filter(({ id }) => held('notification', id)).length
      const retained = Object.freeze({
        heldConsentEvents,
        heldConsentProjections,
        heldQuoteSends,
        heldSmsLogs,
        heldNotifications,
        total: heldConsentEvents + heldConsentProjections + heldQuoteSends
          + heldSmsLogs + heldNotifications,
      })
      const proof = Object.freeze({
        version: 2,
        customerBinding: semanticCustomerBinding({
          shopId: request.shopId,
          customerId: request.customerId,
          requestKey: request.requestKey,
          requestFingerprint: request.requestFingerprint,
          reasonCode: request.reasonCode,
          requestingActorProfileId: request.requestingActorProfileId,
        }),
        suppressionActive: 1,
        deletedBarrier: 1,
        suppressionSourceReferencesDetached: detachedSuppressionSources,
        suppressionSourcesDetached: detachedSuppressionSources > 0,
        retained,
        resultCounts: counts,
      })
      await tx.execute(sql`
        update messaging_deletion_requests set customer_id = null, state = 'completed',
          completed_at = ${completedAt}::timestamptz,
          latest_relevant_at = ${completedAt}::timestamptz,
          prior_record_counts = ${JSON.stringify(priorCounts)}::jsonb,
          proof_summary = ${JSON.stringify(proof)}::jsonb,
          retain_until = ${completedAt}::timestamptz + interval '5 years'
        where id = ${request.id}::uuid
      `)
      return { ok: true, requestId: request.id, state: 'completed', counts }
    })
  } catch {
    return { ok: false, error: 'retryable' }
  }
}
