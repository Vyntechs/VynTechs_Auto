import { sql } from 'drizzle-orm'
import { types as utilTypes } from 'node:util'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { unwrapRows } from '@/lib/db/unwrap-rows'
import { canManageMessagingRetention } from '@/lib/shop-os/capabilities'
import type { MessagingActor } from '@/lib/shop-os/messaging-consent'
import {
  addUtcCalendarYearsClamped,
  validatePurgeBatchSize,
} from '@/lib/shop-os/messaging-retention-policy'

const uuid = z.uuid()
const resourceTypes = new Set([
  'messaging_consent_event',
  'sms_suppression',
  'quote_send',
  'sms_log',
  'notification',
  'messaging_deletion_request',
])
const reasonCodes = new Set([
  'legal_claim',
  'subpoena',
  'fraud_review',
  'security_investigation',
])
const DAY = 86_400_000

type ResourceType =
  | 'messaging_consent_event'
  | 'sms_suppression'
  | 'quote_send'
  | 'sms_log'
  | 'notification'
  | 'messaging_deletion_request'
type ReasonCode = 'legal_claim' | 'subpoena' | 'fraud_review' | 'security_investigation'

export type PurgeCounts = {
  consentProjections: number
  consentEvents: number
  suppressions: number
  quoteSends: number
  smsLog: number
  notifications: number
  deletionRequests: number
  retentionHolds: number
  skippedHeld: number
  failed: number
}

type HoldSnapshot = {
  db: AppDb
  actor: Readonly<MessagingActor>
  resourceType?: ResourceType
  resourceId?: string
  subjectKey?: string
  reasonCode: ReasonCode
  startsAt: Date
  reviewAt: Date
  expiresAt: Date
}

type ReleaseSnapshot = {
  db: AppDb
  actor: Readonly<MessagingActor>
  holdId: string
  releasedAt: Date
}

type PurgeSnapshot = { db: AppDb; now: Date; batchSize: number }
type Hint = { retainUntil: Date | string; id: string; shopId: string }
type CandidateCursor = Readonly<{ retainUntil: Date; id: string }>
type Family =
  | 'notifications'
  | 'smsLog'
  | 'quoteSends'
  | 'consentProjections'
  | 'suppressions'
  | 'consentEvents'
  | 'deletionRequests'
  | 'retentionHolds'
type RowOutcome = 'deleted' | 'held' | 'skipped'

function dataObject(value: unknown, allowed: ReadonlySet<string>): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (utilTypes.isProxy(value)) return null
  let descriptors: PropertyDescriptorMap
  try {
    if (Object.getPrototypeOf(value) !== Object.prototype) return null
    descriptors = Object.getOwnPropertyDescriptors(value)
  } catch {
    return null
  }
  if (Reflect.ownKeys(descriptors).some((key) =>
    typeof key !== 'string'
      || !allowed.has(key)
      || !descriptors[key]?.enumerable
      || !('value' in descriptors[key]!))) return null
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [
    key,
    (descriptor as PropertyDescriptor & { value: unknown }).value,
  ]))
}

function exactDate(value: unknown): Date | null {
  if (value !== null && typeof value === 'object' && utilTypes.isProxy(value)) return null
  if (!(value instanceof Date) || Object.getPrototypeOf(value) !== Date.prototype) return null
  const milliseconds = Date.prototype.getTime.call(value)
  return Number.isFinite(milliseconds) ? new Date(milliseconds) : null
}

function validDbReference(value: unknown): value is AppDb {
  return value !== null && typeof value === 'object' && !utilTypes.isProxy(value)
}

function actorSnapshot(value: unknown): Readonly<MessagingActor> | null {
  const actor = dataObject(value, new Set(['profileId', 'shopId', 'role']))
  if (!actor
    || !uuid.safeParse(actor.profileId).success
    || !uuid.safeParse(actor.shopId).success
    || typeof actor.role !== 'string') return null
  return Object.freeze({
    profileId: actor.profileId as string,
    shopId: actor.shopId as string,
    role: actor.role,
  })
}

function holdSnapshot(raw: unknown): HoldSnapshot | null {
  const input = dataObject(raw, new Set([
    'db', 'actor', 'resourceType', 'resourceId', 'subjectKey', 'reasonCode',
    'startsAt', 'reviewAt', 'expiresAt',
  ]))
  const actor = input && actorSnapshot(input.actor)
  const startsAt = input && exactDate(input.startsAt)
  const reviewAt = input && exactDate(input.reviewAt)
  const expiresAt = input && exactDate(input.expiresAt)
  if (!input || !validDbReference(input.db) || !actor || !startsAt || !reviewAt || !expiresAt
    || !reasonCodes.has(input.reasonCode as string)) return null

  const resourceType = input.resourceType
  const resourceId = input.resourceId
  const subjectKey = input.subjectKey
  const resourceTarget = resourceTypes.has(resourceType as string)
    && uuid.safeParse(resourceId).success && subjectKey === undefined
  const subjectTarget = resourceType === undefined && resourceId === undefined
    && uuid.safeParse(subjectKey).success
  if (resourceTarget === subjectTarget
    || reviewAt.getTime() <= startsAt.getTime()
    || reviewAt.getTime() > expiresAt.getTime()
    || expiresAt.getTime() <= startsAt.getTime()
    || expiresAt.getTime() - startsAt.getTime() > 365 * DAY) return null

  return Object.freeze({
    db: input.db as AppDb,
    actor,
    ...(resourceTarget ? {
      resourceType: resourceType as ResourceType,
      resourceId: resourceId as string,
    } : { subjectKey: subjectKey as string }),
    reasonCode: input.reasonCode as ReasonCode,
    startsAt,
    reviewAt,
    expiresAt,
  })
}

function releaseSnapshot(raw: unknown): ReleaseSnapshot | null {
  const input = dataObject(raw, new Set(['db', 'actor', 'holdId', 'releasedAt']))
  const actor = input && actorSnapshot(input.actor)
  const releasedAt = input && exactDate(input.releasedAt)
  if (!input || !validDbReference(input.db) || !actor || !releasedAt
    || !uuid.safeParse(input.holdId).success) return null
  return Object.freeze({
    db: input.db as AppDb,
    actor,
    holdId: input.holdId as string,
    releasedAt,
  })
}

function purgeSnapshot(raw: unknown): PurgeSnapshot | null {
  const input = dataObject(raw, new Set(['db', 'now', 'batchSize']))
  const now = input && exactDate(input.now)
  if (!input || !validDbReference(input.db) || !now) return null
  try {
    return Object.freeze({
      db: input.db as AppDb,
      now,
      batchSize: validatePurgeBatchSize(input.batchSize),
    })
  } catch {
    return null
  }
}

async function lockShop(db: AppDb, shopId: string): Promise<boolean> {
  return unwrapRows(await db.execute(sql`
    select id from shops where id = ${shopId}::uuid for update
  `)).length === 1
}

async function liveAuthority(db: AppDb, actor: MessagingActor): Promise<boolean> {
  const row = unwrapRows<{ role: string; membershipStatus: string; deactivatedAt: Date | null }>(
    await db.execute(sql`
      select role, membership_status as "membershipStatus", deactivated_at as "deactivatedAt"
      from profiles
      where shop_id = ${actor.shopId}::uuid and id = ${actor.profileId}::uuid
      for update
    `),
  )[0]
  return Boolean(row
    && row.role === actor.role
    && row.membershipStatus === 'active'
    && row.deactivatedAt === null
    && canManageMessagingRetention(row.role, row.role === 'founder'))
}

async function lockResourceTarget(
  db: AppDb,
  shopId: string,
  resourceType: ResourceType,
  resourceId: string,
): Promise<boolean> {
  switch (resourceType) {
    case 'messaging_consent_event':
      return unwrapRows(await db.execute(sql`select id from messaging_consent_events
        where shop_id = ${shopId}::uuid and id = ${resourceId}::uuid for update`)).length === 1
    case 'sms_suppression':
      return unwrapRows(await db.execute(sql`select id from sms_suppressions
        where shop_id = ${shopId}::uuid and id = ${resourceId}::uuid for update`)).length === 1
    case 'quote_send':
      return unwrapRows(await db.execute(sql`select id from quote_sends
        where shop_id = ${shopId}::uuid and id = ${resourceId}::uuid for update`)).length === 1
    case 'sms_log':
      return unwrapRows(await db.execute(sql`select id from sms_log
        where shop_id = ${shopId}::uuid and id = ${resourceId}::uuid for update`)).length === 1
    case 'notification':
      return unwrapRows(await db.execute(sql`select id from notifications
        where shop_id = ${shopId}::uuid and id = ${resourceId}::uuid for update`)).length === 1
    case 'messaging_deletion_request':
      return unwrapRows(await db.execute(sql`select id from messaging_deletion_requests
        where shop_id = ${shopId}::uuid and id = ${resourceId}::uuid for update`)).length === 1
  }
}

async function lockSubjectTarget(db: AppDb, shopId: string, subjectKey: string): Promise<boolean> {
  if (unwrapRows(await db.execute(sql`select id from messaging_consent_events
    where shop_id = ${shopId}::uuid and subject_key = ${subjectKey}::uuid
    order by id limit 1 for update`)).length === 1) return true
  if (unwrapRows(await db.execute(sql`select id from messaging_consent_state
    where shop_id = ${shopId}::uuid and subject_key = ${subjectKey}::uuid
    order by id limit 1 for update`)).length === 1) return true
  return unwrapRows(await db.execute(sql`select id from messaging_deletion_requests
    where shop_id = ${shopId}::uuid and subject_key = ${subjectKey}::uuid
    order by id limit 1 for update`)).length === 1
}

export async function createMessagingRetentionHold(rawInput: {
  db: AppDb
  actor: MessagingActor
  resourceType?: ResourceType
  resourceId?: string
  subjectKey?: string
  reasonCode: ReasonCode
  startsAt: Date
  reviewAt: Date
  expiresAt: Date
}): Promise<{ ok: true; holdId: string } | { ok: false; error: string }> {
  const input = holdSnapshot(rawInput)
  if (!input) return { ok: false, error: 'invalid_input' }
  try {
    return await input.db.transaction(async (transaction) => {
      const tx = transaction as AppDb
      if (!await lockShop(tx, input.actor.shopId)) return { ok: false, error: 'not_found' }
      const targetExists = input.resourceType && input.resourceId
        ? await lockResourceTarget(tx, input.actor.shopId, input.resourceType, input.resourceId)
        : input.subjectKey
          ? await lockSubjectTarget(tx, input.actor.shopId, input.subjectKey)
          : false
      if (!targetExists) return { ok: false, error: 'not_found' }
      if (!await liveAuthority(tx, input.actor)) return { ok: false, error: 'forbidden' }
      const retainUntil = addUtcCalendarYearsClamped(input.expiresAt, 5)
      const inserted = unwrapRows<{ id: string }>(await tx.execute(sql`
        insert into messaging_retention_holds (
          shop_id, resource_type, resource_id, subject_key, reason_code,
          authorizing_actor_profile_id, starts_at, review_at, expires_at, retain_until
        ) values (
          ${input.actor.shopId}::uuid, ${input.resourceType ?? null},
          ${input.resourceId ?? null}::uuid, ${input.subjectKey ?? null}::uuid,
          ${input.reasonCode}, ${input.actor.profileId}::uuid, ${input.startsAt}::timestamptz,
          ${input.reviewAt}::timestamptz, ${input.expiresAt}::timestamptz,
          ${retainUntil}::timestamptz
        ) returning id
      `))[0]
      return inserted ? { ok: true, holdId: inserted.id } : { ok: false, error: 'retryable' }
    })
  } catch {
    return { ok: false, error: 'retryable' }
  }
}

export async function releaseMessagingRetentionHold(rawInput: {
  db: AppDb
  actor: MessagingActor
  holdId: string
  releasedAt: Date
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const input = releaseSnapshot(rawInput)
  if (!input) return { ok: false, error: 'invalid_input' }
  try {
    return await input.db.transaction(async (transaction) => {
      const tx = transaction as AppDb
      if (!await lockShop(tx, input.actor.shopId)) return { ok: false, error: 'not_found' }
      const hold = unwrapRows<{ releasedAt: Date | null; startsAt: Date }>(await tx.execute(sql`
        select released_at as "releasedAt", starts_at as "startsAt"
        from messaging_retention_holds
        where shop_id = ${input.actor.shopId}::uuid and id = ${input.holdId}::uuid
        for update
      `))[0]
      if (!hold) return { ok: false, error: 'not_found' }
      if (!await liveAuthority(tx, input.actor)) return { ok: false, error: 'forbidden' }
      if (hold.releasedAt !== null) return { ok: false, error: 'already_released' }
      if (input.releasedAt.getTime() < new Date(hold.startsAt).getTime()) {
        return { ok: false, error: 'invalid_input' }
      }
      const retainUntil = addUtcCalendarYearsClamped(input.releasedAt, 5)
      const released = unwrapRows(await tx.execute(sql`
        update messaging_retention_holds
        set released_at = ${input.releasedAt}::timestamptz,
          retain_until = ${retainUntil}::timestamptz
        where shop_id = ${input.actor.shopId}::uuid and id = ${input.holdId}::uuid
          and released_at is null
        returning id
      `))
      return released.length === 1 ? { ok: true } : { ok: false, error: 'already_released' }
    })
  } catch {
    return { ok: false, error: 'retryable' }
  }
}

async function candidateHints(
  db: AppDb,
  family: Family,
  now: Date,
  limit: number,
  cursor?: CandidateCursor,
): Promise<Hint[]> {
  switch (family) {
    case 'notifications': return unwrapRows(await db.execute(sql`
      select n.shop_id as "shopId", n.id, n.retain_until as "retainUntil"
      from notifications n
      where n.retain_until <= ${now}::timestamptz and n.retain_until <= clock_timestamp()
        and (${cursor?.retainUntil ?? null}::timestamptz is null
          or (n.retain_until, n.id) > (
            ${cursor?.retainUntil ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        and not exists (select 1 from messaging_retention_holds h
          where h.shop_id = n.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and ((h.resource_type = 'notification' and h.resource_id = n.id)
              or (n.entity_type = 'customer' and h.subject_key = n.entity_id)
              or (n.entity_type = 'quote_send' and exists (select 1 from quote_sends q
                where q.shop_id = n.shop_id and q.id = n.entity_id
                  and q.subject_key = h.subject_key))))
      order by n.retain_until, n.id limit ${limit}
    `))
    case 'smsLog': return unwrapRows(await db.execute(sql`
      select l.shop_id as "shopId", l.id, l.retain_until as "retainUntil"
      from sms_log l
      where l.retain_until <= ${now}::timestamptz and l.retain_until <= clock_timestamp()
        and (${cursor?.retainUntil ?? null}::timestamptz is null
          or (l.retain_until, l.id) > (
            ${cursor?.retainUntil ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        and not exists (select 1 from messaging_retention_holds h
          where h.shop_id = l.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and ((h.resource_type = 'sms_log' and h.resource_id = l.id)
              or exists (select 1 from quote_sends q
                where q.shop_id = l.shop_id and q.id = l.quote_send_id
                  and q.subject_key = h.subject_key)))
      order by l.retain_until, l.id limit ${limit}
    `))
    case 'quoteSends': return unwrapRows(await db.execute(sql`
      select q.shop_id as "shopId", q.id, q.retain_until as "retainUntil"
      from quote_sends q
      where q.state in ('cancelled', 'failed', 'responded', 'expired')
        and q.retain_until <= ${now}::timestamptz and q.retain_until <= clock_timestamp()
        and (${cursor?.retainUntil ?? null}::timestamptz is null
          or (q.retain_until, q.id) > (
            ${cursor?.retainUntil ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        and not exists (select 1 from sms_log l
          where l.shop_id = q.shop_id and l.quote_send_id = q.id)
        and not exists (select 1 from messaging_retention_holds h
          where h.shop_id = q.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and ((h.resource_type = 'quote_send' and h.resource_id = q.id)
              or h.subject_key = q.subject_key))
      order by q.retain_until, q.id limit ${limit}
    `))
    case 'consentProjections': return unwrapRows(await db.execute(sql`
      select s.shop_id as "shopId", s.id, s.retain_until as "retainUntil"
      from messaging_consent_state s
      where s.retain_until <= ${now}::timestamptz and s.retain_until <= clock_timestamp()
        and (${cursor?.retainUntil ?? null}::timestamptz is null
          or (s.retain_until, s.id) > (
            ${cursor?.retainUntil ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        and exists (select 1 from messaging_consent_events e
          where e.shop_id = s.shop_id and e.id = s.source_event_id
            and e.retain_until <= ${now}::timestamptz and e.retain_until <= clock_timestamp())
        and not exists (select 1 from sms_suppressions x
          where x.shop_id = s.shop_id
            and x.destination_fingerprint = s.destination_fingerprint
            and x.fingerprint_key_version = s.fingerprint_key_version
            and (x.retain_until > ${now}::timestamptz or x.retain_until > clock_timestamp()))
        and not exists (select 1 from messaging_retention_holds h
          where h.shop_id = s.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and (h.subject_key = s.subject_key
              or (h.resource_type = 'messaging_consent_event'
                and h.resource_id = s.source_event_id)))
      order by s.retain_until, s.id limit ${limit}
    `))
    case 'suppressions': return unwrapRows(await db.execute(sql`
      select x.shop_id as "shopId", x.id, x.retain_until as "retainUntil"
      from sms_suppressions x
      where x.retain_until <= ${now}::timestamptz and x.retain_until <= clock_timestamp()
        and (${cursor?.retainUntil ?? null}::timestamptz is null
          or (x.retain_until, x.id) > (
            ${cursor?.retainUntil ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        and not exists (select 1 from messaging_consent_state s
          where s.shop_id = x.shop_id and s.status = 'consented'
            and s.destination_fingerprint = x.destination_fingerprint
            and s.fingerprint_key_version = x.fingerprint_key_version)
        and not exists (select 1 from messaging_retention_holds h
          where h.shop_id = x.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and ((h.resource_type = 'sms_suppression' and h.resource_id = x.id)
              or (h.subject_key is not null and exists (
                select 1 from messaging_consent_events e where e.shop_id = x.shop_id
                  and e.subject_key = h.subject_key
                  and e.destination_fingerprint = x.destination_fingerprint
                  and e.fingerprint_key_version = x.fingerprint_key_version))
              or (h.subject_key is not null and exists (
                select 1 from messaging_consent_state s where s.shop_id = x.shop_id
                  and s.subject_key = h.subject_key
                  and s.destination_fingerprint = x.destination_fingerprint
                  and s.fingerprint_key_version = x.fingerprint_key_version))
              or (h.subject_key is not null and exists (
                select 1 from messaging_deletion_requests r where r.shop_id = x.shop_id
                  and r.subject_key = h.subject_key
                  and r.destination_fingerprint = x.destination_fingerprint
                  and r.fingerprint_key_version = x.fingerprint_key_version))))
      order by x.retain_until, x.id limit ${limit}
    `))
    case 'consentEvents': return unwrapRows(await db.execute(sql`
      select e.shop_id as "shopId", e.id, e.retain_until as "retainUntil"
      from messaging_consent_events e
      where e.retain_until <= ${now}::timestamptz and e.retain_until <= clock_timestamp()
        and (${cursor?.retainUntil ?? null}::timestamptz is null
          or (e.retain_until, e.id) > (
            ${cursor?.retainUntil ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        and not exists (select 1 from messaging_consent_state s
          where s.shop_id = e.shop_id and s.source_event_id = e.id)
        and not exists (select 1 from sms_suppressions x
          where x.shop_id = e.shop_id and x.source_event_id = e.id)
        and not exists (select 1 from messaging_retention_holds h
          where h.shop_id = e.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and (h.subject_key = e.subject_key
              or (h.resource_type = 'messaging_consent_event' and h.resource_id = e.id)))
      order by e.retain_until, e.id limit ${limit}
    `))
    case 'deletionRequests': return unwrapRows(await db.execute(sql`
      select r.shop_id as "shopId", r.id, r.retain_until as "retainUntil"
      from messaging_deletion_requests r
      where r.state = 'completed' and r.retain_until <= ${now}::timestamptz
        and r.retain_until <= clock_timestamp()
        and (${cursor?.retainUntil ?? null}::timestamptz is null
          or (r.retain_until, r.id) > (
            ${cursor?.retainUntil ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
        and not exists (select 1 from messaging_retention_holds h
          where h.shop_id = r.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and (h.subject_key = r.subject_key
              or (h.resource_type = 'messaging_deletion_request' and h.resource_id = r.id)))
      order by r.retain_until, r.id limit ${limit}
    `))
    case 'retentionHolds': return unwrapRows(await db.execute(sql`
      select h.shop_id as "shopId", h.id, h.retain_until as "retainUntil"
      from messaging_retention_holds h
      where h.retain_until <= ${now}::timestamptz and h.retain_until <= clock_timestamp()
        and (${cursor?.retainUntil ?? null}::timestamptz is null
          or (h.retain_until, h.id) > (
            ${cursor?.retainUntil ?? null}::timestamptz, ${cursor?.id ?? null}::uuid))
      order by h.retain_until, h.id limit ${limit}
    `))
  }
}

function nextCursor(hint: Hint): CandidateCursor {
  return Object.freeze({ retainUntil: new Date(hint.retainUntil), id: hint.id })
}

async function boundedHeldCount(
  db: AppDb,
  family: Family,
  now: Date,
  limit: number,
): Promise<number> {
  let rows: Array<{ count: number }>
  switch (family) {
    case 'notifications': rows = unwrapRows(await db.execute(sql`
      select count(*)::int as count from (select n.id from notifications n
      where n.retain_until <= ${now}::timestamptz and n.retain_until <= clock_timestamp()
        and exists (select 1 from messaging_retention_holds h
          where h.shop_id = n.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and ((h.resource_type = 'notification' and h.resource_id = n.id)
              or (n.entity_type = 'customer' and h.subject_key = n.entity_id)
              or (n.entity_type = 'quote_send' and exists (select 1 from quote_sends q
                where q.shop_id = n.shop_id and q.id = n.entity_id
                  and q.subject_key = h.subject_key))))
      order by n.retain_until, n.id limit ${limit}) held`)); break
    case 'smsLog': rows = unwrapRows(await db.execute(sql`
      select count(*)::int as count from (select l.id from sms_log l
      where l.retain_until <= ${now}::timestamptz and l.retain_until <= clock_timestamp()
        and exists (select 1 from messaging_retention_holds h
          where h.shop_id = l.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and ((h.resource_type = 'sms_log' and h.resource_id = l.id)
              or exists (select 1 from quote_sends q where q.shop_id = l.shop_id
                and q.id = l.quote_send_id and q.subject_key = h.subject_key)))
      order by l.retain_until, l.id limit ${limit}) held`)); break
    case 'quoteSends': rows = unwrapRows(await db.execute(sql`
      select count(*)::int as count from (select q.id from quote_sends q
      where q.state in ('cancelled', 'failed', 'responded', 'expired')
        and q.retain_until <= ${now}::timestamptz and q.retain_until <= clock_timestamp()
        and not exists (select 1 from sms_log l where l.shop_id = q.shop_id
          and l.quote_send_id = q.id)
        and exists (select 1 from messaging_retention_holds h
          where h.shop_id = q.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and ((h.resource_type = 'quote_send' and h.resource_id = q.id)
              or h.subject_key = q.subject_key))
      order by q.retain_until, q.id limit ${limit}) held`)); break
    case 'consentProjections': rows = unwrapRows(await db.execute(sql`
      select count(*)::int as count from (select s.id from messaging_consent_state s
      where s.retain_until <= ${now}::timestamptz and s.retain_until <= clock_timestamp()
        and exists (select 1 from messaging_consent_events e
          where e.shop_id = s.shop_id and e.id = s.source_event_id
            and e.retain_until <= ${now}::timestamptz and e.retain_until <= clock_timestamp())
        and not exists (select 1 from sms_suppressions x
          where x.shop_id = s.shop_id
            and x.destination_fingerprint = s.destination_fingerprint
            and x.fingerprint_key_version = s.fingerprint_key_version
            and (x.retain_until > ${now}::timestamptz or x.retain_until > clock_timestamp()))
        and exists (select 1 from messaging_retention_holds h
          where h.shop_id = s.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and (h.subject_key = s.subject_key
              or (h.resource_type = 'messaging_consent_event' and h.resource_id = s.source_event_id)))
      order by s.retain_until, s.id limit ${limit}) held`)); break
    case 'suppressions': rows = unwrapRows(await db.execute(sql`
      select count(*)::int as count from (select x.id from sms_suppressions x
      where x.retain_until <= ${now}::timestamptz and x.retain_until <= clock_timestamp()
        and not exists (select 1 from messaging_consent_state s
          where s.shop_id = x.shop_id and s.status = 'consented'
            and s.destination_fingerprint = x.destination_fingerprint
            and s.fingerprint_key_version = x.fingerprint_key_version)
        and exists (select 1 from messaging_retention_holds h
          where h.shop_id = x.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and ((h.resource_type = 'sms_suppression' and h.resource_id = x.id)
              or (h.subject_key is not null and exists (select 1 from messaging_consent_events e
                where e.shop_id = x.shop_id and e.subject_key = h.subject_key
                  and e.destination_fingerprint = x.destination_fingerprint
                  and e.fingerprint_key_version = x.fingerprint_key_version))
              or (h.subject_key is not null and exists (select 1 from messaging_consent_state s
                where s.shop_id = x.shop_id and s.subject_key = h.subject_key
                  and s.destination_fingerprint = x.destination_fingerprint
                  and s.fingerprint_key_version = x.fingerprint_key_version))
              or (h.subject_key is not null and exists (select 1 from messaging_deletion_requests r
                where r.shop_id = x.shop_id and r.subject_key = h.subject_key
                  and r.destination_fingerprint = x.destination_fingerprint
                  and r.fingerprint_key_version = x.fingerprint_key_version))))
      order by x.retain_until, x.id limit ${limit}) held`)); break
    case 'consentEvents': rows = unwrapRows(await db.execute(sql`
      select count(*)::int as count from (select e.id from messaging_consent_events e
      where e.retain_until <= ${now}::timestamptz and e.retain_until <= clock_timestamp()
        and not exists (select 1 from messaging_consent_state s
          where s.shop_id = e.shop_id and s.source_event_id = e.id)
        and not exists (select 1 from sms_suppressions x
          where x.shop_id = e.shop_id and x.source_event_id = e.id)
        and exists (select 1 from messaging_retention_holds h
          where h.shop_id = e.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and (h.subject_key = e.subject_key
              or (h.resource_type = 'messaging_consent_event' and h.resource_id = e.id)))
      order by e.retain_until, e.id limit ${limit}) held`)); break
    case 'deletionRequests': rows = unwrapRows(await db.execute(sql`
      select count(*)::int as count from (select r.id from messaging_deletion_requests r
      where r.state = 'completed' and r.retain_until <= ${now}::timestamptz
        and r.retain_until <= clock_timestamp()
        and exists (select 1 from messaging_retention_holds h
          where h.shop_id = r.shop_id and h.released_at is null
            and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
            and (h.subject_key = r.subject_key
              or (h.resource_type = 'messaging_deletion_request' and h.resource_id = r.id)))
      order by r.retain_until, r.id limit ${limit}) held`)); break
    case 'retentionHolds': return 0
  }
  return rows[0]?.count ?? 0
}

async function deleteLockedCandidate(
  tx: AppDb,
  family: Family,
  hint: Hint,
  now: Date,
): Promise<RowOutcome> {
  let row: { held: boolean } | undefined
  switch (family) {
    case 'notifications':
      row = unwrapRows<{ held: boolean }>(await tx.execute(sql`
          select exists (select 1 from messaging_retention_holds h
            where h.shop_id = n.shop_id and h.released_at is null
              and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
              and ((h.resource_type = 'notification' and h.resource_id = n.id)
                or (h.subject_key is not null and (
                  (n.entity_type = 'customer' and h.subject_key = n.entity_id)
                  or (n.entity_type = 'quote_send' and exists (select 1 from quote_sends q
                    where q.shop_id = n.shop_id and q.id = n.entity_id
                      and q.subject_key = h.subject_key)))))) as held
          from notifications n where n.shop_id = ${hint.shopId}::uuid and n.id = ${hint.id}::uuid
            and n.retain_until <= ${now}::timestamptz and n.retain_until <= clock_timestamp()
          for update skip locked`))[0]
      if (!row) return 'skipped'
      if (row.held) return 'held'
      return unwrapRows(await tx.execute(sql`delete from notifications where
          shop_id = ${hint.shopId}::uuid and id = ${hint.id}::uuid returning id`)).length === 1
          ? 'deleted' : 'skipped'
    case 'smsLog':
      row = unwrapRows<{ held: boolean }>(await tx.execute(sql`
          select exists (select 1 from messaging_retention_holds h
            where h.shop_id = l.shop_id and h.released_at is null
              and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
              and ((h.resource_type = 'sms_log' and h.resource_id = l.id)
                or (h.subject_key is not null and exists (select 1 from quote_sends q
                  where q.shop_id = l.shop_id and q.id = l.quote_send_id
                    and q.subject_key = h.subject_key)))) as held
          from sms_log l where l.shop_id = ${hint.shopId}::uuid and l.id = ${hint.id}::uuid
            and l.retain_until <= ${now}::timestamptz and l.retain_until <= clock_timestamp()
          for update skip locked`))[0]
      if (!row) return 'skipped'
      if (row.held) return 'held'
      return unwrapRows(await tx.execute(sql`delete from sms_log where
          shop_id = ${hint.shopId}::uuid and id = ${hint.id}::uuid returning id`)).length === 1
          ? 'deleted' : 'skipped'
    case 'quoteSends':
        row = unwrapRows<{ held: boolean }>(await tx.execute(sql`
          select exists (select 1 from messaging_retention_holds h
            where h.shop_id = q.shop_id and h.released_at is null
              and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
              and ((h.resource_type = 'quote_send' and h.resource_id = q.id)
                or h.subject_key = q.subject_key)) as held
          from quote_sends q where q.shop_id = ${hint.shopId}::uuid and q.id = ${hint.id}::uuid
            and q.state in ('cancelled', 'failed', 'responded', 'expired')
            and q.retain_until <= ${now}::timestamptz and q.retain_until <= clock_timestamp()
            and not exists (select 1 from sms_log l
              where l.shop_id = q.shop_id and l.quote_send_id = q.id)
          for update skip locked`))[0]
      if (!row) return 'skipped'
      if (row.held) return 'held'
      return unwrapRows(await tx.execute(sql`delete from quote_sends where
          shop_id = ${hint.shopId}::uuid and id = ${hint.id}::uuid returning id`)).length === 1
          ? 'deleted' : 'skipped'
    case 'consentProjections':
        row = unwrapRows<{ held: boolean }>(await tx.execute(sql`
          select exists (select 1 from messaging_retention_holds h
            where h.shop_id = s.shop_id and h.released_at is null
              and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
              and (h.subject_key = s.subject_key
                or (h.resource_type = 'messaging_consent_event'
                  and h.resource_id = s.source_event_id))) as held
          from messaging_consent_state s
          where s.shop_id = ${hint.shopId}::uuid and s.id = ${hint.id}::uuid
            and s.retain_until <= ${now}::timestamptz and s.retain_until <= clock_timestamp()
            and exists (select 1 from messaging_consent_events e
              where e.shop_id = s.shop_id and e.id = s.source_event_id
                and e.retain_until <= ${now}::timestamptz and e.retain_until <= clock_timestamp())
            and not exists (select 1 from sms_suppressions x
              where x.shop_id = s.shop_id
                and x.destination_fingerprint = s.destination_fingerprint
                and x.fingerprint_key_version = s.fingerprint_key_version
                and (x.retain_until > ${now}::timestamptz or x.retain_until > clock_timestamp()))
          for update skip locked`))[0]
      if (!row) return 'skipped'
      if (row.held) return 'held'
      return unwrapRows(await tx.execute(sql`delete from messaging_consent_state where
          shop_id = ${hint.shopId}::uuid and id = ${hint.id}::uuid returning id`)).length === 1
          ? 'deleted' : 'skipped'
    case 'suppressions':
        row = unwrapRows<{ held: boolean }>(await tx.execute(sql`
          select exists (select 1 from messaging_retention_holds h
            where h.shop_id = x.shop_id and h.released_at is null
              and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
              and ((h.resource_type = 'sms_suppression' and h.resource_id = x.id)
                or (h.subject_key is not null and exists (
                  select 1 from messaging_consent_events e where e.shop_id = x.shop_id
                    and e.subject_key = h.subject_key
                    and e.destination_fingerprint = x.destination_fingerprint
                    and e.fingerprint_key_version = x.fingerprint_key_version))
                or (h.subject_key is not null and exists (
                  select 1 from messaging_consent_state s where s.shop_id = x.shop_id
                    and s.subject_key = h.subject_key
                    and s.destination_fingerprint = x.destination_fingerprint
                    and s.fingerprint_key_version = x.fingerprint_key_version))
                or (h.subject_key is not null and exists (
                  select 1 from messaging_deletion_requests r where r.shop_id = x.shop_id
                    and r.subject_key = h.subject_key
                    and r.destination_fingerprint = x.destination_fingerprint
                    and r.fingerprint_key_version = x.fingerprint_key_version)))) as held
          from sms_suppressions x
          where x.shop_id = ${hint.shopId}::uuid and x.id = ${hint.id}::uuid
            and x.retain_until <= ${now}::timestamptz and x.retain_until <= clock_timestamp()
            and not exists (select 1 from messaging_consent_state s
              where s.shop_id = x.shop_id and s.status = 'consented'
                and s.destination_fingerprint = x.destination_fingerprint
                and s.fingerprint_key_version = x.fingerprint_key_version)
          for update skip locked`))[0]
      if (!row) return 'skipped'
      if (row.held) return 'held'
      return unwrapRows(await tx.execute(sql`delete from sms_suppressions where
          shop_id = ${hint.shopId}::uuid and id = ${hint.id}::uuid returning id`)).length === 1
          ? 'deleted' : 'skipped'
    case 'consentEvents':
        row = unwrapRows<{ held: boolean }>(await tx.execute(sql`
          select exists (select 1 from messaging_retention_holds h
            where h.shop_id = e.shop_id and h.released_at is null
              and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
              and (h.subject_key = e.subject_key
                or (h.resource_type = 'messaging_consent_event' and h.resource_id = e.id))) as held
          from messaging_consent_events e
          where e.shop_id = ${hint.shopId}::uuid and e.id = ${hint.id}::uuid
            and e.retain_until <= ${now}::timestamptz and e.retain_until <= clock_timestamp()
            and not exists (select 1 from messaging_consent_state s
              where s.shop_id = e.shop_id and s.source_event_id = e.id)
            and not exists (select 1 from sms_suppressions x
              where x.shop_id = e.shop_id and x.source_event_id = e.id)
          for update skip locked`))[0]
      if (!row) return 'skipped'
      if (row.held) return 'held'
      return unwrapRows<{ purged: boolean }>(await tx.execute(sql`
          select purge_expired_messaging_consent_event(
            ${hint.shopId}::uuid, ${hint.id}::uuid
          ) as purged
        `))[0]?.purged ? 'deleted' : 'skipped'
    case 'deletionRequests':
        row = unwrapRows<{ held: boolean }>(await tx.execute(sql`
          select exists (select 1 from messaging_retention_holds h
            where h.shop_id = r.shop_id and h.released_at is null
              and h.starts_at <= clock_timestamp() and h.expires_at > clock_timestamp()
              and (h.subject_key = r.subject_key
                or (h.resource_type = 'messaging_deletion_request' and h.resource_id = r.id))) as held
          from messaging_deletion_requests r
          where r.shop_id = ${hint.shopId}::uuid and r.id = ${hint.id}::uuid
            and r.state = 'completed' and r.retain_until <= ${now}::timestamptz
            and r.retain_until <= clock_timestamp()
          for update skip locked`))[0]
      if (!row) return 'skipped'
      if (row.held) return 'held'
      return unwrapRows<{ purged: boolean }>(await tx.execute(sql`
          select purge_expired_messaging_deletion_request(
            ${hint.shopId}::uuid, ${hint.id}::uuid
          ) as purged
        `))[0]?.purged ? 'deleted' : 'skipped'
    case 'retentionHolds':
        row = unwrapRows<{ held: boolean }>(await tx.execute(sql`
          select false as held from messaging_retention_holds h
          where h.shop_id = ${hint.shopId}::uuid and h.id = ${hint.id}::uuid
            and h.retain_until <= ${now}::timestamptz and h.retain_until <= clock_timestamp()
          for update skip locked`))[0]
      if (!row) return 'skipped'
      return unwrapRows<{ purged: boolean }>(await tx.execute(sql`
          select purge_expired_messaging_retention_hold(
            ${hint.shopId}::uuid, ${hint.id}::uuid
          ) as purged
        `))[0]?.purged ? 'deleted' : 'skipped'
  }
}

async function runAtomicFamily(
  db: AppDb,
  family: Family,
  hints: ReadonlyArray<Hint>,
  now: Date,
): Promise<{ deleted: number; newlyHeld: number }> {
  if (hints.length === 0) return { deleted: 0, newlyHeld: 0 }
  const shopIds = [...new Set(hints.map(({ shopId }) => shopId))].sort()
  return db.transaction(async (transaction) => {
    const tx = transaction as AppDb
    const lockedShops = new Set<string>()
    for (const shopId of shopIds) {
      if (await lockShop(tx, shopId)) lockedShops.add(shopId)
    }
    let deleted = 0
    let newlyHeld = 0
    for (const hint of hints) {
      if (!lockedShops.has(hint.shopId)) continue
      const outcome = await deleteLockedCandidate(tx, family, hint, now)
      if (outcome === 'deleted') deleted += 1
      if (outcome === 'held') newlyHeld += 1
    }
    return { deleted, newlyHeld }
  })
}

async function runFirstProcessableShop(
  db: AppDb,
  family: Family,
  now: Date,
  limit: number,
): Promise<{ deleted: number; newlyHeld: number }> {
  let cursor: CandidateCursor | undefined
  while (true) {
    const hints = await candidateHints(db, family, now, limit, cursor)
    if (hints.length === 0) return { deleted: 0, newlyHeld: 0 }

    for (let start = 0; start < hints.length;) {
      let end = start + 1
      while (end < hints.length && hints[end]!.shopId === hints[start]!.shopId) end += 1
      const run = hints.slice(start, end)
      const result = await runAtomicFamily(db, family, run, now)
      if (result.deleted > 0 || result.newlyHeld > 0) return result
      cursor = nextCursor(run[run.length - 1]!)
      start = end
    }

    if (hints.length < limit) return { deleted: 0, newlyHeld: 0 }
  }
}

function emptyCounts(): PurgeCounts {
  return {
    consentProjections: 0,
    consentEvents: 0,
    suppressions: 0,
    quoteSends: 0,
    smsLog: 0,
    notifications: 0,
    deletionRequests: 0,
    retentionHolds: 0,
    skippedHeld: 0,
    failed: 0,
  }
}

export async function purgeExpiredMessagingRecords(rawInput: {
  db: AppDb
  now: Date
  batchSize: number
}): Promise<PurgeCounts> {
  const input = purgeSnapshot(rawInput)
  if (!input) throw new Error('invalid_purge_input')
  const counts = emptyCounts()
  let remaining = input.batchSize
  const families: ReadonlyArray<Family> = [
    'notifications',
    'smsLog',
    'quoteSends',
    'consentProjections',
    'suppressions',
    'consentEvents',
    'deletionRequests',
    'retentionHolds',
  ]
  const failed = new Set<Family>()

  for (const family of families) {
    if (remaining === 0) break
    if (family === 'quoteSends' && failed.has('smsLog')) continue
    if (family === 'suppressions' && failed.has('consentProjections')) continue
    if (family === 'consentEvents'
      && (failed.has('consentProjections') || failed.has('suppressions'))) continue
    try {
      counts.skippedHeld += await boundedHeldCount(
        input.db, family, input.now, remaining,
      )
      const result = await runFirstProcessableShop(
        input.db, family, input.now, remaining,
      )
      counts[family] += result.deleted
      counts.skippedHeld += result.newlyHeld
      remaining -= result.deleted
    } catch {
      failed.add(family)
      counts.failed += 1
    }
  }
  return Object.freeze(counts)
}
