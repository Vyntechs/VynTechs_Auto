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

export type DeletionCursor = Readonly<{ at: string; id: string }>

export type PendingDeletionProgress = Readonly<{
  progressVersion: 1
  resultCounts: DeletionResultCounts
  heldCounts: DeletionHeldCounts
  detachedSuppressionSources: number
  cursors: Readonly<Partial<Record<
    'quoteSends' | 'consentSubjects' | 'consentEvents' |
    'smsLogs' | 'notifications' | 'holds',
    DeletionCursor
  >>>
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
type SendRow = { id: string; state: string; customerId: string | null; subjectKey: string }
type HoldRow = { id: string; startsAt: Date | string; resourceType: string | null; resourceId: string | null; subjectKey: string | null }
type ConsentProjectionRow = MessagingPair & { id: string; subjectKey: string }
type ConsentEventRow = MessagingPair & { id: string; subjectKey: string }
type SmsRow = { id: string; quoteSendId: string }

const emptyPrior = (): PriorRecordCounts => ({ consentEvents: 0, consentProjections: 0,
  notifications: 0, quoteSends: 0, smsLogs: 0 })
const emptyResults = (): DeletionResultCounts => ({ consentEventsDeleted: 0,
  notificationsDeleted: 0, smsLogsDeleted: 0, quoteSendsDeleted: 0, quoteSendsRetained: 0 })
const emptyHeld = (): DeletionHeldCounts => ({ heldConsentEvents: 0, heldConsentProjections: 0,
  heldQuoteSends: 0, heldSmsLogs: 0, heldNotifications: 0, total: 0 })

function exactCounts<T extends Record<string, number>>(value: unknown, keys: string[]): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error('invalid_progress')
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)
      || !Number.isSafeInteger(descriptor.value) || descriptor.value < 0) throw new Error('invalid_progress')
  }
  return value as T
}

function parsePendingProgress(row: CleanupRequest): { prior: PriorRecordCounts; progress: PendingDeletionProgress } {
  if (row.counts === null && row.proof === null) return { prior: emptyPrior(), progress: {
    progressVersion: 1, resultCounts: emptyResults(), heldCounts: emptyHeld(),
    detachedSuppressionSources: 0, cursors: {},
  } }
  const prior = exactCounts<PriorRecordCounts>(row.counts,
    ['consentEvents', 'consentProjections', 'notifications', 'quoteSends', 'smsLogs'])
  if (!row.proof || typeof row.proof !== 'object' || Array.isArray(row.proof)
    || Object.getPrototypeOf(row.proof) !== Object.prototype
    || Object.keys(row.proof).sort().join() !== ['progressVersion', 'resultCounts', 'heldCounts',
      'detachedSuppressionSources', 'cursors'].sort().join()
    || row.proof.progressVersion !== 1
    || !Number.isSafeInteger(row.proof.detachedSuppressionSources)
    || (row.proof.detachedSuppressionSources as number) < 0) throw new Error('invalid_progress')
  const resultCounts = exactCounts<DeletionResultCounts>(row.proof.resultCounts,
    ['consentEventsDeleted', 'notificationsDeleted', 'smsLogsDeleted', 'quoteSendsDeleted', 'quoteSendsRetained'])
  const heldCounts = exactCounts<DeletionHeldCounts>(row.proof.heldCounts,
    ['heldConsentEvents', 'heldConsentProjections', 'heldQuoteSends', 'heldSmsLogs', 'heldNotifications', 'total'])
  const cursors = row.proof.cursors
  if (!cursors || typeof cursors !== 'object' || Array.isArray(cursors)
    || Object.getPrototypeOf(cursors) !== Object.prototype) throw new Error('invalid_progress')
  const allowed = new Set(['quoteSends', 'consentSubjects', 'consentEvents',
    'smsLogs', 'notifications', 'holds'])
  for (const [key, cursor] of Object.entries(cursors)) {
    if (!allowed.has(key) || !cursor || typeof cursor !== 'object' || Array.isArray(cursor)
      || Object.getPrototypeOf(cursor) !== Object.prototype
      || Object.keys(cursor).sort().join() !== 'at,id') throw new Error('invalid_progress')
    const descriptorAt = Object.getOwnPropertyDescriptor(cursor, 'at')
    const descriptorId = Object.getOwnPropertyDescriptor(cursor, 'id')
    if (!descriptorAt?.enumerable || !descriptorId?.enumerable
      || !('value' in descriptorAt) || !('value' in descriptorId)
      || typeof descriptorAt.value !== 'string' || !Number.isFinite(Date.parse(descriptorAt.value))
      || typeof descriptorId.value !== 'string' || !uuid.safeParse(descriptorId.value).success) {
      throw new Error('invalid_progress')
    }
  }
  return { prior, progress: { progressVersion: 1, resultCounts, heldCounts,
    detachedSuppressionSources: row.proof.detachedSuppressionSources as number,
    cursors: cursors as PendingDeletionProgress['cursors'] } }
}

function addCount(left: number, right: number): number {
  const result = left + right
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0
    || !Number.isSafeInteger(result)) throw new Error('count_overflow')
  return result
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
      let stored = parsePendingProgress(request)
      const customer = unwrapRows(await tx.execute<{ id: string }>(sql`
        select id from customers where shop_id = ${request.shopId}::uuid
          and id = ${request.customerId}::uuid for update
      `))[0]
      if (!customer) return { ok: false, error: 'not_found' }

      const sendPage = unwrapRows<SendRow>(await tx.execute(sql`
        select id, state, customer_id as "customerId", subject_key as "subjectKey" from quote_sends
        where shop_id = ${request.shopId}::uuid and (customer_id = ${request.customerId}::uuid
          or (customer_id is null and exists (
            select 1 from messaging_retention_holds history
            where history.shop_id = quote_sends.shop_id
              and (history.resource_type = 'quote_send' and history.resource_id = quote_sends.id
                or history.subject_key = quote_sends.subject_key)
          ) and not exists (
            select 1 from messaging_retention_holds active
            where active.shop_id = quote_sends.shop_id
              and (active.resource_type = 'quote_send' and active.resource_id = quote_sends.id
                or active.subject_key = quote_sends.subject_key)
              and active.released_at is null and active.starts_at <= clock_timestamp()
              and active.expires_at > clock_timestamp()
          )))
        order by id limit ${MAX_SENDS + 1} for update
      `))
      const projectionPage = unwrapRows<ConsentProjectionRow>(await tx.execute(sql`
        select id, subject_key as "subjectKey",
          destination_fingerprint as "destinationFingerprint",
          fingerprint_key_version as "fingerprintKeyVersion"
        from messaging_consent_state
        where shop_id = ${request.shopId}::uuid and customer_id = ${request.customerId}::uuid
        order by subject_key, id limit ${MAX_CONSENT_PROJECTIONS + 1} for update
      `))
      const eventPage = unwrapRows<ConsentEventRow>(await tx.execute(sql`
        select id, subject_key as "subjectKey",
          destination_fingerprint as "destinationFingerprint",
          fingerprint_key_version as "fingerprintKeyVersion"
        from messaging_consent_events
        where shop_id = ${request.shopId}::uuid and customer_id = ${request.customerId}::uuid
        order by subject_key, id limit ${MAX_CONSENT_EVENTS + 1} for update
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
        select id, quote_send_id as "quoteSendId" from sms_log
        where shop_id = ${request.shopId}::uuid
          and quote_send_id = any(${sql.param(sendIds)}::uuid[])
        order by id limit ${MAX_SMS_LOGS + 1} for update
      `))
      const notificationPage = unwrapRows<{ id: string; entityType: string; entityId: string }>(await tx.execute(sql`
        select id, entity_type as "entityType", entity_id as "entityId"
        from notifications where shop_id = ${request.shopId}::uuid
          and ((entity_type = 'customer' and entity_id = ${request.customerId}::uuid)
            or (entity_type = 'quote_send'
              and entity_id = any(${sql.param(sendIds)}::uuid[])))
        order by id limit ${MAX_NOTIFICATIONS + 1} for update
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
      const subjectKeys = [...new Set([
        request.subjectKey,
        ...sends.map(({ subjectKey }) => subjectKey),
        ...consentProjections.map(({ subjectKey }) => subjectKey),
        ...consentEvents.map(({ subjectKey }) => subjectKey),
      ])].sort()
      const smsIds = smsRows.map(({ id }) => id)
      const notificationIds = notificationRows.map(({ id }) => id)
      const consentEventIds = consentEvents.map(({ id }) => id)
      const holdCursor = stored.progress.cursors.holds
      const holdPage = unwrapRows<HoldRow>(await tx.execute(sql`
        select id, starts_at as "startsAt", resource_type as "resourceType",
          resource_id as "resourceId", subject_key as "subjectKey"
        from messaging_retention_holds
        where shop_id = ${request.shopId}::uuid and released_at is null
          and starts_at <= clock_timestamp() and expires_at > clock_timestamp()
          and (${holdCursor ? sql`(starts_at, id) > (${holdCursor.at}::timestamptz, ${holdCursor.id}::uuid)` : sql`true`})
          and (subject_key = any(${sql.param(subjectKeys)}::uuid[])
            or (resource_type = 'quote_send'
              and resource_id = any(${sql.param(sendIds)}::uuid[]))
            or (resource_type = 'sms_log'
              and resource_id = any(${sql.param(smsIds)}::uuid[]))
            or (resource_type = 'notification'
              and resource_id = any(${sql.param(notificationIds)}::uuid[]))
            or (resource_type = 'messaging_consent_event'
              and resource_id = any(${sql.param(consentEventIds)}::uuid[])))
        order by starts_at, id limit ${MAX_HOLDS + 1} for update
      `))
      const holds = holdPage.slice(0, Math.min(MAX_HOLDS, totalRemaining))
      totalRemaining -= holds.length

      const overLimit = sendPage.length > sends.length || eventPage.length > consentEvents.length
        || projectionPage.length > consentProjections.length || smsPage.length > smsRows.length
        || notificationPage.length > notificationRows.length
        || holdPage.length > holds.length

      const heldSubjectKeys = new Set(subjectKeys.filter((subjectKey) =>
        holds.some((hold) => hold.subjectKey === subjectKey)
          || consentEvents.some((event) => event.subjectKey === subjectKey
            && holds.some((hold) => hold.resourceType === 'messaging_consent_event'
              && hold.resourceId === event.id))))
      const resourceHeld = (type: string, id: string) => holds.some((hold) =>
        hold.resourceType === type && hold.resourceId === id)
      const sendsById = new Map(sends.map((send) => [send.id, send]))
      const sendHeld = (send: SendRow) => heldSubjectKeys.has(send.subjectKey)
        || resourceHeld('quote_send', send.id)
      const smsHeld = (row: SmsRow) => resourceHeld('sms_log', row.id)
        || heldSubjectKeys.has(sendsById.get(row.quoteSendId)?.subjectKey ?? '')
      const notificationHeld = (row: { id: string; entityType: string; entityId: string }) =>
        resourceHeld('notification', row.id)
        || (row.entityType === 'customer' && heldSubjectKeys.has(request.subjectKey))
        || (row.entityType === 'quote_send'
          && heldSubjectKeys.has(sendsById.get(row.entityId)?.subjectKey ?? ''))
      const heldSmsParents = new Set(smsRows.filter(smsHeld)
        .map(({ quoteSendId }) => quoteSendId))

      let priorCounts: PriorRecordCounts = Object.freeze({
        consentEvents: 0,
        consentProjections: 0,
        notifications: 0,
        quoteSends: 0,
        smsLogs: 0,
      })

      let consentDeleted = 0
      let detachedSuppressionSources = 0
      const consentSubjectKeys = [...new Set([
        ...consentProjections.map(({ subjectKey }) => subjectKey),
        ...consentEvents.map(({ subjectKey }) => subjectKey),
      ])].sort().filter((subjectKey) => !heldSubjectKeys.has(subjectKey))
      for (const subjectKey of consentSubjectKeys) {
        const subjectEvents = consentEvents.filter((event) => event.subjectKey === subjectKey)
        const subjectProjections = consentProjections.filter((projection) =>
          projection.subjectKey === subjectKey)
        const source = subjectEvents[0] ?? subjectProjections[0]
        if (!source) throw new Error('consent_subject_source_unavailable')
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
            'staff_request', ${input.actor.profileId}::uuid,
            (md5(${request.id}::text || ':' || ${subjectKey}::text))::uuid,
            ${request.requestFingerprint}, clock_timestamp() + interval '5 years'
          )
          on conflict do nothing
        `)
        const compacted = unwrapRows<{ count: number }>(await tx.execute(sql`
          select deleted_count as count from compact_messaging_consent_events(
            ${request.shopId}::uuid, ${subjectKey}::uuid, ${request.id}::uuid,
            ${stored.progress.cursors.consentEvents?.id
              ?? '00000000-0000-0000-0000-000000000000'}::uuid,
            ${MAX_CONSENT_EVENTS}
          )
        `))[0]?.count ?? 0
        consentDeleted += compacted
        const refreshed = unwrapRows<CleanupRequest>(await tx.execute(sql`
          select id, shop_id as "shopId", subject_key as "subjectKey", request_key as "requestKey",
            request_fingerprint as "requestFingerprint", customer_id as "customerId",
            destination_fingerprint as "destinationFingerprint",
            fingerprint_key_version as "fingerprintKeyVersion", state, reason_code as "reasonCode",
            requesting_actor_profile_id as "requestingActorProfileId", prior_record_counts as counts,
            proof_summary as proof
          from messaging_deletion_requests where id = ${request.id}::uuid
        `))[0]
        stored = parsePendingProgress(refreshed!)
        priorCounts = Object.freeze({ ...priorCounts, consentEvents: 0, consentProjections: 0 })
        consentDeleted = 0
        detachedSuppressionSources = 0
      }

      const deletableSmsIds = smsRows.filter((row) => !smsHeld(row)).map(({ id }) => id)
      const smsDeleted = unwrapRows<{ count: number }>(await tx.execute(sql`
        with deleted as (delete from sms_log l where l.shop_id = ${request.shopId}::uuid
          and l.id = any(${sql.param(deletableSmsIds)}::uuid[])
          and not exists (select 1 from messaging_retention_holds h
            where h.shop_id = l.shop_id and h.resource_type = 'sms_log' and h.resource_id = l.id
              and h.released_at is null and h.starts_at <= clock_timestamp()
              and h.expires_at > clock_timestamp()) returning 1)
        select count(*)::int as count from deleted
      `))[0]?.count ?? 0
      const deletableNotificationIds = notificationRows.filter((row) => !notificationHeld(row))
        .map(({ id }) => id)
      const notificationsDeleted = unwrapRows<{ count: number }>(await tx.execute(sql`
        with deleted as (delete from notifications n where n.shop_id = ${request.shopId}::uuid
          and n.id = any(${sql.param(deletableNotificationIds)}::uuid[])
          and not exists (select 1 from messaging_retention_holds h
              where h.shop_id = n.shop_id and h.resource_type = 'notification' and h.resource_id = n.id
                and h.released_at is null and h.starts_at <= clock_timestamp()
                and h.expires_at > clock_timestamp()) returning 1)
        select count(*)::int as count from deleted
      `))[0]?.count ?? 0
      priorCounts = Object.freeze({
        ...priorCounts,
        notifications: notificationsDeleted,
        smsLogs: smsDeleted,
      })

      let sendsDeleted = 0
      let sendsRetained = 0
      for (const send of sends) {
        if (deferredSendIds.has(send.id)) continue
        if (!sendHeld(send) && !heldSmsParents.has(send.id)) {
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
      priorCounts = Object.freeze({ ...priorCounts, quoteSends: sendsDeleted + sendsRetained })

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
        consentEventsDeleted: addCount(stored.progress.resultCounts.consentEventsDeleted, consentDeleted),
        notificationsDeleted: addCount(stored.progress.resultCounts.notificationsDeleted, notificationsDeleted),
        smsLogsDeleted: addCount(stored.progress.resultCounts.smsLogsDeleted, smsDeleted),
        quoteSendsDeleted: addCount(stored.progress.resultCounts.quoteSendsDeleted, sendsDeleted),
        quoteSendsRetained: addCount(stored.progress.resultCounts.quoteSendsRetained, sendsRetained),
      })
      const accumulatedPrior = Object.freeze({
        consentEvents: addCount(stored.prior.consentEvents, priorCounts.consentEvents),
        consentProjections: addCount(stored.prior.consentProjections, priorCounts.consentProjections),
        notifications: addCount(stored.prior.notifications, priorCounts.notifications),
        quoteSends: addCount(stored.prior.quoteSends, priorCounts.quoteSends),
        smsLogs: addCount(stored.prior.smsLogs, priorCounts.smsLogs),
      })
      const heldConsentEvents = consentEvents.filter(({ subjectKey }) =>
        heldSubjectKeys.has(subjectKey)).length
      const heldConsentProjections = consentProjections.filter(({ subjectKey }) =>
        heldSubjectKeys.has(subjectKey)).length
      const reconciledHeldSends = unwrapRows<{ count: number }>(await tx.execute(sql`
        select count(distinct q.id)::int as count
        from quote_sends q
        join messaging_retention_holds h on h.shop_id = q.shop_id
          and (h.resource_type = 'quote_send' and h.resource_id = q.id
            or h.subject_key = q.subject_key)
        where q.shop_id = ${request.shopId}::uuid
          and (q.customer_id = ${request.customerId}::uuid or q.customer_id is null)
          and h.released_at is null and h.starts_at <= clock_timestamp()
          and h.expires_at > clock_timestamp()
      `))[0]?.count ?? 0
      const heldQuoteSends = Math.max(sendsRetained, reconciledHeldSends)
      const reconciledHeldSms = unwrapRows<{ count: number }>(await tx.execute(sql`
        select count(distinct l.id)::int as count
        from sms_log l join quote_sends q on q.id = l.quote_send_id and q.shop_id = l.shop_id
        join messaging_retention_holds h on h.shop_id = l.shop_id
          and (h.resource_type = 'sms_log' and h.resource_id = l.id
            or h.subject_key = q.subject_key)
        where l.shop_id = ${request.shopId}::uuid
          and h.released_at is null and h.starts_at <= clock_timestamp()
          and h.expires_at > clock_timestamp()
      `))[0]?.count ?? 0
      const heldSmsLogs = Math.max(smsRows.filter(smsHeld).length, reconciledHeldSms)
      const heldNotifications = notificationRows.filter(notificationHeld).length
      const retained = Object.freeze({
        heldConsentEvents,
        heldConsentProjections,
        heldQuoteSends,
        heldSmsLogs,
        heldNotifications,
        total: heldConsentEvents + heldConsentProjections + heldQuoteSends
          + heldSmsLogs + heldNotifications,
      })
      const finalPrior = Object.freeze({
        ...accumulatedPrior,
        consentEvents: addCount(accumulatedPrior.consentEvents, heldConsentEvents),
        consentProjections: addCount(accumulatedPrior.consentProjections, heldConsentProjections),
        notifications: addCount(accumulatedPrior.notifications, heldNotifications),
        smsLogs: addCount(accumulatedPrior.smsLogs, heldSmsLogs),
      })
      const accumulatedDetached = addCount(
        stored.progress.detachedSuppressionSources,
        detachedSuppressionSources,
      )
      if (overLimit) {
        const lastHold = holds.at(-1)
        const progress: PendingDeletionProgress = Object.freeze({
          progressVersion: 1,
          resultCounts: counts,
          heldCounts: emptyHeld(),
          detachedSuppressionSources: accumulatedDetached,
          cursors: Object.freeze({
            ...stored.progress.cursors,
            ...(holdPage.length > holds.length && lastHold ? { holds: {
              at: new Date(lastHold.startsAt).toISOString(), id: lastHold.id,
            } } : {}),
          }),
        })
        await tx.execute(sql`
          update messaging_deletion_requests
          set prior_record_counts = ${JSON.stringify(accumulatedPrior)}::jsonb,
              proof_summary = ${JSON.stringify(progress)}::jsonb
          where id = ${request.id}::uuid and state = 'pending'
        `)
        return { ok: true, requestId: request.id, state: 'pending', counts }
      }
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
        suppressionSourceReferencesDetached: accumulatedDetached,
        suppressionSourcesDetached: accumulatedDetached > 0,
        retained,
        resultCounts: counts,
      })
      await tx.execute(sql`
        update messaging_deletion_requests set customer_id = null, state = 'completed',
          completed_at = ${completedAt}::timestamptz,
          latest_relevant_at = ${completedAt}::timestamptz,
          prior_record_counts = ${JSON.stringify(finalPrior)}::jsonb,
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
