import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import { unwrapRows } from '@/lib/db/unwrap-rows'
import {
  customers,
  messagingConsentEvents,
  messagingConsentState,
  messagingDeletionRequests,
  profiles,
  shops,
  smsSuppressions,
} from '@/lib/db/schema'
import { canManageCustomerMessaging } from '@/lib/shop-os/capabilities'
import {
  consentProofRetainUntil,
  fingerprintsForKeyRing,
  normalizeE164,
  type FingerprintKeyRing,
} from '@/lib/shop-os/messaging-retention-policy'

const uuidSchema = z.uuid()
const boundedVersionSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}[a-z0-9]$/)
const fingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/)
const eventTypes = new Set(['asked', 'declined', 'consented', 'revoked', 'reconsented'])
const captureMethods = new Set(['customer_web', 'signed_form', 'provider_webhook', 'staff_request'])
const evidenceKinds = new Set(['customer_checkbox', 'signed_form_reference', 'provider_event', 'staff_request'])
const MAX_DISCLOSURE_BYTES = 4_096
const MAX_EVIDENCE_REF_LENGTH = 256
const MAX_DISCLOSURE_STRING_LENGTH = 2_048
const SIGNED_DISCLOSURE_VERSION = 'signed_repair_updates_v1'
const BLOCKED_PUBLIC_HOSTS = new Set(['localhost'])
const BLOCKED_PUBLIC_SUFFIXES = [
  '.arpa',
  '.example',
  '.internal',
  '.invalid',
  '.local',
  '.localhost',
  '.onion',
  '.test',
] as const
const DISCLOSURE_KEYS = [
  'consentNotConditionOfPurchase',
  'disclosureVersion',
  'helpKeyword',
  'messageAndDataRates',
  'messageFrequency',
  'messagePurpose',
  'privacyPolicyUrl',
  'programVersion',
  'renderedDisclosure',
  'senderIdentity',
  'smsTermsUrl',
  'stopKeyword',
  'technologyProvider',
] as const

export type MessagingActor = {
  profileId: string
  shopId: string
  role: string
}

export type MessagingDisclosureSnapshot = {
  disclosureVersion: string
  programVersion: string
  senderIdentity: string
  messagePurpose: 'estimates_authorizations_repair_status_pickup'
  messageFrequency: 'varies_by_repair_order'
  messageAndDataRates: 'may_apply'
  stopKeyword: 'STOP'
  helpKeyword: 'HELP'
  consentNotConditionOfPurchase: true
  smsTermsUrl: string
  privacyPolicyUrl: string
  technologyProvider: 'Vyntechs'
  renderedDisclosure: string
}

export type MessagingEligibility =
  | {
      allowed: true
      consentEventId: string
      destinationFingerprint: string
      keyVersion: string
    }
  | {
      allowed: false
      reason:
        | 'missing_consent'
        | 'suppressed'
        | 'stale_projection'
        | 'customer_mismatch'
        | 'program_mismatch'
        | 'deletion_pending'
        | 'compliance_unavailable'
    }

type ConsentStatus = 'declined' | 'consented' | 'revoked'
type RecordResult =
  | { ok: true; eventId: string; status: ConsentStatus }
  | { ok: false; error: string }

type SupportedFingerprint = { keyVersion: string; fingerprint: string }
type ValidatedRecordInput =
  | {
      ok: true
      db: AppDb
      actor: Readonly<MessagingActor>
      customerId: string
      destination: string
      fingerprints: ReadonlyArray<SupportedFingerprint>
      programVersion: string
      eventType: 'asked' | 'declined' | 'consented' | 'revoked' | 'reconsented'
      captureMethod: 'customer_web' | 'signed_form' | 'provider_webhook' | 'staff_request'
      customerControlled: boolean
      disclosureSnapshot?: MessagingDisclosureSnapshot
      disclosureHash?: string
      evidenceKind: 'customer_checkbox' | 'signed_form_reference' | 'provider_event' | 'staff_request'
      evidenceRef?: string
      requestKey: string
      requestFingerprint: string
      occurredAt: Date
      now: Date
    }
  | { ok: false; error: string }

function validDate(value: unknown): value is Date {
  return value instanceof Date
    && Object.getPrototypeOf(value) === Date.prototype
    && Number.isFinite(Date.prototype.getTime.call(value))
}

function boundedDisclosureString(value: unknown, maximum = MAX_DISCLOSURE_STRING_LENGTH): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value)
}

function publicHttpsUrl(value: unknown): value is string {
  if (!boundedDisclosureString(value)) return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  const hostname = parsed.hostname.toLowerCase()
  const labels = hostname.split('.')
  return parsed.protocol === 'https:'
    && parsed.username === ''
    && parsed.password === ''
    && parsed.port === ''
    && parsed.hash === ''
    && hostname === parsed.hostname
    && hostname.length <= 253
    && !hostname.endsWith('.')
    && labels.length >= 2
    && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    && isIP(hostname) === 0
    && !BLOCKED_PUBLIC_HOSTS.has(hostname)
    && !BLOCKED_PUBLIC_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
    && parsed.href === value
}

function exactSignedDisclosure(snapshot: MessagingDisclosureSnapshot): string {
  return `By signing below, I agree to receive recurring transactional text messages from ${snapshot.senderIdentity} about estimates, authorizations, repair status, and pickup for vehicles I bring to this shop. Message frequency varies by repair order. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is not a condition of purchase. SMS Terms: ${snapshot.smsTermsUrl}. Privacy Policy: ${snapshot.privacyPolicyUrl}. Vyntechs provides the messaging technology.`
}

const SIGNED_DISCLOSURE_RENDERERS = Object.freeze({
  [SIGNED_DISCLOSURE_VERSION]: exactSignedDisclosure,
})

function canonicalDisclosure(snapshot: MessagingDisclosureSnapshot): string {
  const ordered = Object.fromEntries(DISCLOSURE_KEYS.map((key) => [key, snapshot[key]]))
  return JSON.stringify(ordered)
}

function validatedDisclosureProof(
  value: unknown,
  disclosureHash: unknown,
  programVersion: string,
  requireFrozen: boolean,
): { snapshot: MessagingDisclosureSnapshot; hash: string } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (requireFrozen && !Object.isFrozen(value)) return null
  if (Object.getPrototypeOf(value) !== Object.prototype) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const keys = Reflect.ownKeys(descriptors)
  if (keys.some((key) => typeof key !== 'string')) return null
  const sortedKeys = (keys as string[]).sort()
  if (
    sortedKeys.length !== DISCLOSURE_KEYS.length
    || sortedKeys.some((key, index) => key !== DISCLOSURE_KEYS[index])
  ) return null
  const data = {} as Record<string, unknown>
  for (const key of DISCLOSURE_KEYS) {
    const descriptor = descriptors[key]
    if (!descriptor?.enumerable || !('value' in descriptor)) return null
    if (requireFrozen && (descriptor.configurable || descriptor.writable)) return null
    data[key] = descriptor.value
  }
  const snapshot = Object.freeze({
    disclosureVersion: data.disclosureVersion,
    programVersion: data.programVersion,
    senderIdentity: data.senderIdentity,
    messagePurpose: data.messagePurpose,
    messageFrequency: data.messageFrequency,
    messageAndDataRates: data.messageAndDataRates,
    stopKeyword: data.stopKeyword,
    helpKeyword: data.helpKeyword,
    consentNotConditionOfPurchase: data.consentNotConditionOfPurchase,
    smsTermsUrl: data.smsTermsUrl,
    privacyPolicyUrl: data.privacyPolicyUrl,
    technologyProvider: data.technologyProvider,
    renderedDisclosure: data.renderedDisclosure,
  }) as MessagingDisclosureSnapshot
  const renderer = Object.hasOwn(SIGNED_DISCLOSURE_RENDERERS, snapshot.disclosureVersion)
    ? SIGNED_DISCLOSURE_RENDERERS[
        snapshot.disclosureVersion as keyof typeof SIGNED_DISCLOSURE_RENDERERS
      ]
    : undefined
  if (
    !renderer
    || snapshot.programVersion !== programVersion
    || !boundedDisclosureString(snapshot.senderIdentity, 160)
    || snapshot.messagePurpose !== 'estimates_authorizations_repair_status_pickup'
    || snapshot.messageFrequency !== 'varies_by_repair_order'
    || snapshot.messageAndDataRates !== 'may_apply'
    || snapshot.stopKeyword !== 'STOP'
    || snapshot.helpKeyword !== 'HELP'
    || snapshot.consentNotConditionOfPurchase !== true
    || !publicHttpsUrl(snapshot.smsTermsUrl)
    || !publicHttpsUrl(snapshot.privacyPolicyUrl)
    || snapshot.technologyProvider !== 'Vyntechs'
    || snapshot.renderedDisclosure !== renderer(snapshot)
  ) return null
  const canonical = canonicalDisclosure(snapshot)
  if (Buffer.byteLength(canonical, 'utf8') > MAX_DISCLOSURE_BYTES) return null
  const hash = createHash('sha256').update(canonical).digest('hex')
  return disclosureHash === hash ? { snapshot, hash } : null
}

function validEvidenceRef(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= MAX_EVIDENCE_REF_LENGTH
}

function statusForEvent(eventType: string): ConsentStatus {
  if (eventType === 'consented' || eventType === 'reconsented') return 'consented'
  if (eventType === 'revoked') return 'revoked'
  return 'declined'
}

function fingerprintPredicate(
  fingerprints: ReadonlyArray<SupportedFingerprint>,
  fingerprintColumn: AnyPgColumn,
  versionColumn: AnyPgColumn,
) {
  return or(...fingerprints.map(({ fingerprint, keyVersion }) => and(
    eq(fingerprintColumn, fingerprint),
    eq(versionColumn, keyVersion),
  )))!
}

function domainDataProperties(
  value: unknown,
  required: ReadonlyArray<string>,
  optional: ReadonlyArray<string> = [],
): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (Object.getPrototypeOf(value) !== Object.prototype) return null
  const descriptors = Object.getOwnPropertyDescriptors(value)
  const result: Record<string, unknown> = {}
  for (const key of [...required, ...optional]) {
    const descriptor = descriptors[key]
    if (!descriptor) {
      if (required.includes(key)) return null
      continue
    }
    if (!descriptor.enumerable || !('value' in descriptor)) return null
    result[key] = descriptor.value
  }
  return result
}

function validateRecordInput(input: unknown): ValidatedRecordInput {
  const data = domainDataProperties(input, [
    'db',
    'actor',
    'customerId',
    'destination',
    'programVersion',
    'eventType',
    'captureMethod',
    'customerControlled',
    'evidenceKind',
    'requestKey',
    'requestFingerprint',
    'occurredAt',
    'now',
    'keyRing',
  ], ['disclosureSnapshot', 'disclosureHash', 'evidenceRef'])
  if (!data) return { ok: false, error: 'invalid_input' }
  const actorData = domainDataProperties(data.actor, ['profileId', 'shopId', 'role'])
  if (!actorData) return { ok: false, error: 'invalid_input' }

  const disclosureSnapshot = data.disclosureSnapshot
  const disclosureHash = data.disclosureHash
  if (
    !uuidSchema.safeParse(actorData.profileId).success
    || !uuidSchema.safeParse(actorData.shopId).success
    || typeof actorData.role !== 'string'
    || !uuidSchema.safeParse(data.customerId).success
    || !uuidSchema.safeParse(data.requestKey).success
    || !boundedVersionSchema.safeParse(data.programVersion).success
    || !fingerprintSchema.safeParse(data.requestFingerprint).success
    || typeof data.eventType !== 'string'
    || !eventTypes.has(data.eventType)
    || typeof data.captureMethod !== 'string'
    || !captureMethods.has(data.captureMethod)
    || typeof data.evidenceKind !== 'string'
    || !evidenceKinds.has(data.evidenceKind)
    || typeof data.customerControlled !== 'boolean'
    || !validDate(data.occurredAt)
    || !validDate(data.now)
    || Date.prototype.getTime.call(data.occurredAt) > Date.prototype.getTime.call(data.now)
    || (data.evidenceRef !== undefined && !validEvidenceRef(data.evidenceRef))
  ) return { ok: false, error: 'invalid_input' }

  if (!canManageCustomerMessaging(actorData.role as string)) {
    return { ok: false, error: 'forbidden' }
  }
  if (data.captureMethod === 'customer_web') {
    return { ok: false, error: 'forbidden' }
  }

  const createsConsent = data.eventType === 'consented' || data.eventType === 'reconsented'
  const hasDisclosure = disclosureSnapshot !== undefined || disclosureHash !== undefined
  const disclosure = hasDisclosure
    ? validatedDisclosureProof(
        disclosureSnapshot,
        disclosureHash,
        data.programVersion as string,
        true,
      )
    : null
  if (createsConsent && (
    data.captureMethod !== 'signed_form'
    || data.evidenceKind !== 'signed_form_reference'
    || data.customerControlled !== true
    || !validEvidenceRef(data.evidenceRef)
    || !disclosure
  )) return { ok: false, error: 'invalid_input' }
  if (!createsConsent && hasDisclosure && !disclosure) {
    return { ok: false, error: 'invalid_input' }
  }

  if (data.eventType === 'revoked') {
    const staffRequest = data.captureMethod === 'staff_request'
      && data.evidenceKind === 'staff_request'
      && data.customerControlled === false
    const providerRevocation = data.captureMethod === 'provider_webhook'
      && data.evidenceKind === 'provider_event'
      && data.customerControlled === true
      && validEvidenceRef(data.evidenceRef)
    if (!staffRequest && !providerRevocation) return { ok: false, error: 'invalid_input' }
  }

  if ((data.eventType === 'asked' || data.eventType === 'declined') && (
    data.captureMethod !== 'staff_request'
    || data.evidenceKind !== 'staff_request'
    || data.customerControlled !== false
  )) return { ok: false, error: 'invalid_input' }

  try {
    const destination = normalizeE164(data.destination)
    const fingerprints = fingerprintsForKeyRing(destination, data.keyRing as FingerprintKeyRing)
    return Object.freeze({
      ok: true,
      db: data.db as AppDb,
      actor: Object.freeze({
        profileId: actorData.profileId as string,
        shopId: actorData.shopId as string,
        role: actorData.role as string,
      }),
      customerId: data.customerId as string,
      destination,
      fingerprints,
      programVersion: data.programVersion as string,
      eventType: data.eventType as Extract<typeof data.eventType, string> as
        'asked' | 'declined' | 'consented' | 'revoked' | 'reconsented',
      captureMethod: data.captureMethod as
        'customer_web' | 'signed_form' | 'provider_webhook' | 'staff_request',
      customerControlled: data.customerControlled,
      disclosureSnapshot: disclosure?.snapshot,
      disclosureHash: disclosure?.hash,
      evidenceKind: data.evidenceKind as
        'customer_checkbox' | 'signed_form_reference' | 'provider_event' | 'staff_request',
      evidenceRef: data.evidenceRef as string | undefined,
      requestKey: data.requestKey as string,
      requestFingerprint: data.requestFingerprint as string,
      occurredAt: new Date(Date.prototype.getTime.call(data.occurredAt)),
      now: new Date(Date.prototype.getTime.call(data.now)),
    })
  } catch {
    return { ok: false, error: 'invalid_input' }
  }
}

function retryResult(
  event: typeof messagingConsentEvents.$inferSelect,
  input: Extract<ValidatedRecordInput, { ok: true }>,
): RecordResult {
  const storedDisclosure = event.disclosureSnapshot === null && event.disclosureHash === null
    ? null
    : validatedDisclosureProof(
        event.disclosureSnapshot,
        event.disclosureHash,
        event.programVersion,
        false,
      )
  const disclosureMatches = input.disclosureSnapshot
    ? storedDisclosure !== null
      && storedDisclosure.hash === input.disclosureHash
      && canonicalDisclosure(storedDisclosure.snapshot) === canonicalDisclosure(input.disclosureSnapshot)
    : event.disclosureSnapshot === null && event.disclosureHash === null
  const exactMeaning = event.shopId === input.actor.shopId
    && event.actorProfileId === input.actor.profileId
    && event.customerId === input.customerId
    && event.programVersion === input.programVersion
    && event.requestKey === input.requestKey
    && event.requestFingerprint === input.requestFingerprint
    && input.fingerprints.some(({ fingerprint, keyVersion }) =>
      event.destinationFingerprint === fingerprint
      && event.fingerprintKeyVersion === keyVersion,
    )
    && event.eventType === input.eventType
    && statusForEvent(event.eventType) === statusForEvent(input.eventType)
    && event.captureMethod === input.captureMethod
    && event.customerControlled === input.customerControlled
    && event.evidenceKind === input.evidenceKind
    && (event.evidenceRef ?? undefined) === input.evidenceRef
    && event.occurredAt.getTime() === input.occurredAt.getTime()
    && disclosureMatches
  return exactMeaning
    ? { ok: true, eventId: event.id, status: statusForEvent(event.eventType) }
    : { ok: false, error: 'request_conflict' }
}

async function databaseTransitionTime(db: AppDb, shopId: string): Promise<Date> {
  const result = await db.execute<{
    transitionAt: Date | string
    latestBarrier: Date | string | null
  }>(sql`
    with barriers(at) as (
      select committed_at from messaging_consent_events where shop_id = ${shopId}::uuid
      union all select suppressed_at from sms_suppressions where shop_id = ${shopId}::uuid
      union all select lifted_at from sms_suppressions where shop_id = ${shopId}::uuid
      union all select updated_at from sms_suppressions where shop_id = ${shopId}::uuid
      union all select consented_at from messaging_consent_state where shop_id = ${shopId}::uuid
      union all select revoked_at from messaging_consent_state where shop_id = ${shopId}::uuid
      union all select updated_at from messaging_consent_state where shop_id = ${shopId}::uuid
      union all select requested_at from messaging_deletion_requests where shop_id = ${shopId}::uuid
      union all select completed_at from messaging_deletion_requests where shop_id = ${shopId}::uuid
      union all select latest_relevant_at from messaging_deletion_requests where shop_id = ${shopId}::uuid
    ), latest as (
      select max(at) as at from barriers
    )
    select
      greatest(clock_timestamp(), latest.at + interval '1 millisecond') as "transitionAt",
      latest.at as "latestBarrier"
    from latest
  `)
  const [row] = unwrapRows<{
    transitionAt: Date | string
    latestBarrier: Date | string | null
  }>(result)
  const transitionAt = row?.transitionAt instanceof Date
    ? new Date(row.transitionAt.getTime())
    : new Date(row?.transitionAt ?? Number.NaN)
  if (!Number.isFinite(transitionAt.getTime())) throw new Error('invalid_database_transition_time')
  const latestBarrier = row?.latestBarrier === null || row?.latestBarrier === undefined
    ? null
    : row.latestBarrier instanceof Date
      ? row.latestBarrier
      : new Date(row.latestBarrier)
  if (latestBarrier && (
    !Number.isFinite(latestBarrier.getTime())
    || transitionAt.getTime() <= latestBarrier.getTime()
  )) {
    throw new Error('non_monotonic_database_transition_time')
  }
  return transitionAt
}

function ownDataProperty(value: unknown, key: string): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  return descriptor && 'value' in descriptor ? descriptor.value : undefined
}

function isExactRequestUniqueViolation(error: unknown): boolean {
  let current: unknown = error
  for (let depth = 0; depth < 3 && current; depth += 1) {
    const code = ownDataProperty(current, 'code')
    const constraint = ownDataProperty(current, 'constraint')
    const constraintName = ownDataProperty(current, 'constraint_name')
    if (
      code === '23505'
      && (constraint === 'messaging_consent_events_shop_request_uq'
        || constraintName === 'messaging_consent_events_shop_request_uq')
    ) return true
    current = ownDataProperty(current, 'cause')
  }
  return false
}

async function recoverExactRequestRace(
  db: AppDb,
  input: Extract<ValidatedRecordInput, { ok: true }>,
): Promise<RecordResult> {
  return db.transaction(async (tx) => {
    const [lockedShop] = await tx.select({ id: shops.id }).from(shops).where(
      eq(shops.id, input.actor.shopId),
    ).limit(1).for('update')
    if (!lockedShop) return { ok: false, error: 'not_found' as const }

    const [event] = await tx.select().from(messagingConsentEvents).where(and(
      eq(messagingConsentEvents.shopId, input.actor.shopId),
      eq(messagingConsentEvents.actorProfileId, input.actor.profileId),
      eq(messagingConsentEvents.requestKey, input.requestKey),
    )).limit(1).for('update')
    if (!event) return { ok: false, error: 'compliance_unavailable' as const }

    const [context] = await tx.select({
      customerPhone: customers.phone,
      actorShopId: profiles.shopId,
      actorRole: profiles.role,
      membershipStatus: profiles.membershipStatus,
      deactivatedAt: profiles.deactivatedAt,
      shopName: shops.name,
    }).from(customers).innerJoin(profiles, and(
      eq(profiles.id, input.actor.profileId),
      eq(profiles.shopId, input.actor.shopId),
    )).innerJoin(shops, eq(shops.id, input.actor.shopId)).where(and(
      eq(customers.id, input.customerId),
      eq(customers.shopId, input.actor.shopId),
    )).limit(1).for('update')
    if (!context) return { ok: false, error: 'not_found' as const }
    if (
      context.actorShopId !== input.actor.shopId
      || context.actorRole !== input.actor.role
      || context.membershipStatus !== 'active'
      || context.deactivatedAt !== null
      || !canManageCustomerMessaging(context.actorRole)
    ) return { ok: false, error: 'forbidden' as const }
    if (context.customerPhone !== input.destination) {
      return { ok: false, error: 'customer_mismatch' as const }
    }
    if (
      input.disclosureSnapshot
      && input.disclosureSnapshot.senderIdentity !== context.shopName
    ) return { ok: false, error: 'invalid_input' as const }
    return retryResult(event, input)
  })
}

export async function recordMessagingConsentEvent(rawInput: {
  db: AppDb
  actor: MessagingActor
  customerId: string
  destination: string
  programVersion: string
  eventType: 'asked' | 'declined' | 'consented' | 'revoked' | 'reconsented'
  captureMethod: 'customer_web' | 'signed_form' | 'provider_webhook' | 'staff_request'
  customerControlled: boolean
  disclosureSnapshot?: Record<string, unknown>
  disclosureHash?: string
  evidenceKind: 'customer_checkbox' | 'signed_form_reference' | 'provider_event' | 'staff_request'
  evidenceRef?: string
  requestKey: string
  requestFingerprint: string
  occurredAt: Date
  now: Date
  keyRing: FingerprintKeyRing
}): Promise<RecordResult> {
  let validated: ValidatedRecordInput
  try {
    validated = validateRecordInput(rawInput)
  } catch {
    return { ok: false, error: 'invalid_input' }
  }
  if (!validated.ok) return validated
  const input = validated
  const current = validated.fingerprints[0]
  if (!current) return { ok: false, error: 'invalid_input' }
  const sortedFingerprints = [...validated.fingerprints]
    .sort((left, right) => left.keyVersion.localeCompare(right.keyVersion))

  try {
    return await input.db.transaction(async (tx) => {
      const [lockedShop] = await tx.select({ id: shops.id }).from(shops).where(
        eq(shops.id, input.actor.shopId),
      ).limit(1).for('update')
      if (!lockedShop) return { ok: false, error: 'not_found' as const }

      const [existingRequest] = await tx.select().from(messagingConsentEvents).where(and(
        eq(messagingConsentEvents.shopId, input.actor.shopId),
        eq(messagingConsentEvents.actorProfileId, input.actor.profileId),
        eq(messagingConsentEvents.requestKey, input.requestKey),
      )).limit(1).for('update')

      const [context] = await tx.select({
        customerId: customers.id,
        customerPhone: customers.phone,
        actorShopId: profiles.shopId,
        actorRole: profiles.role,
        membershipStatus: profiles.membershipStatus,
        deactivatedAt: profiles.deactivatedAt,
        shopName: shops.name,
      }).from(customers).innerJoin(profiles, and(
        eq(profiles.id, input.actor.profileId),
        eq(profiles.shopId, input.actor.shopId),
      )).innerJoin(shops, eq(shops.id, input.actor.shopId)).where(and(
        eq(customers.id, input.customerId),
        eq(customers.shopId, input.actor.shopId),
      )).limit(1).for('update')

      if (!context) return { ok: false, error: 'not_found' as const }
      if (
        context.actorShopId !== input.actor.shopId
        || context.actorRole !== input.actor.role
        || context.membershipStatus !== 'active'
        || context.deactivatedAt !== null
        || !canManageCustomerMessaging(context.actorRole)
      ) return { ok: false, error: 'forbidden' as const }
      if (context.customerPhone !== validated.destination) {
        return { ok: false, error: 'customer_mismatch' as const }
      }
      if (
        validated.disclosureSnapshot
        && validated.disclosureSnapshot.senderIdentity !== context.shopName
      ) return { ok: false, error: 'invalid_input' as const }
      if (existingRequest) return retryResult(existingRequest, input)

      const matchingSuppression = fingerprintPredicate(
        sortedFingerprints,
        smsSuppressions.destinationFingerprint,
        smsSuppressions.fingerprintKeyVersion,
      )
      const suppressions = await tx.select().from(smsSuppressions).where(and(
        eq(smsSuppressions.shopId, input.actor.shopId),
        matchingSuppression,
      )).orderBy(asc(smsSuppressions.fingerprintKeyVersion)).for('update')

      const matchingProjection = fingerprintPredicate(
        sortedFingerprints,
        messagingConsentState.destinationFingerprint,
        messagingConsentState.fingerprintKeyVersion,
      )
      const projections = await tx.select().from(messagingConsentState).where(and(
        eq(messagingConsentState.shopId, input.actor.shopId),
        eq(messagingConsentState.customerId, input.customerId),
        eq(messagingConsentState.programVersion, input.programVersion),
        matchingProjection,
      )).orderBy(
        asc(messagingConsentState.fingerprintKeyVersion),
        asc(messagingConsentState.id),
      ).for('update')
      if (projections.length > 1) {
        return { ok: false, error: 'stale_projection' as const }
      }
      const projection = projections[0]

      const eventPair = fingerprintPredicate(
        sortedFingerprints,
        messagingConsentEvents.destinationFingerprint,
        messagingConsentEvents.fingerprintKeyVersion,
      )
      const revocations = await tx.select().from(messagingConsentEvents).where(and(
        eq(messagingConsentEvents.shopId, input.actor.shopId),
        eq(messagingConsentEvents.eventType, 'revoked'),
        eventPair,
      )).orderBy(
        asc(messagingConsentEvents.committedAt),
        asc(messagingConsentEvents.id),
      )
      const latestRevocation = revocations.at(-1)

      const deletionPair = fingerprintPredicate(
        sortedFingerprints,
        messagingDeletionRequests.destinationFingerprint,
        messagingDeletionRequests.fingerprintKeyVersion,
      )
      const deletionBarriers = await tx.select({
        id: messagingDeletionRequests.id,
        requestedAt: messagingDeletionRequests.requestedAt,
        completedAt: messagingDeletionRequests.completedAt,
        latestRelevantAt: messagingDeletionRequests.latestRelevantAt,
      })
        .from(messagingDeletionRequests).where(and(
          eq(messagingDeletionRequests.shopId, input.actor.shopId),
          deletionPair,
        )).orderBy(
          asc(messagingDeletionRequests.fingerprintKeyVersion),
          asc(messagingDeletionRequests.id),
        ).for('update')
      const deletionBarrier = deletionBarriers[0]

      const transitionAt = await databaseTransitionTime(tx as AppDb, input.actor.shopId)

      const unliftedSuppressions = suppressions.filter(({ liftedAt }) => liftedAt === null)
      if (
        input.eventType === 'consented'
        && (unliftedSuppressions.length > 0 || latestRevocation !== undefined)
      ) {
        return { ok: false, error: 'invalid_transition' as const }
      }
      if (input.eventType === 'reconsented' && (
        (suppressions.length > 0 && unliftedSuppressions.length === 0)
        || suppressions.some(({ reason }) => reason !== 'customer_revocation')
        || deletionBarrier !== undefined
        || !latestRevocation
        || latestRevocation.committedAt.getTime() >= transitionAt.getTime()
        || unliftedSuppressions.some((suppression) =>
          suppression.reason !== 'customer_revocation'
          || suppression.sourceEventId !== latestRevocation.id
          || suppression.suppressedAt.getTime() !== latestRevocation.committedAt.getTime()
        )
      )) return { ok: false, error: 'invalid_transition' as const }

      const retainUntil = consentProofRetainUntil(transitionAt)
      const eventId = crypto.randomUUID()
      await tx.insert(messagingConsentEvents).values({
        id: eventId,
        shopId: input.actor.shopId,
        subjectKey: projection?.subjectKey ?? input.customerId,
        customerId: input.customerId,
        destinationFingerprint: current.fingerprint,
        fingerprintKeyVersion: current.keyVersion,
        programVersion: input.programVersion,
        eventType: input.eventType,
        committedAt: transitionAt,
        occurredAt: input.occurredAt,
        captureMethod: input.captureMethod,
        customerControlled: input.customerControlled,
        disclosureSnapshot: validated.disclosureSnapshot,
        disclosureHash: validated.disclosureHash,
        evidenceKind: input.evidenceKind,
        evidenceRef: input.evidenceRef,
        actorProfileId: input.actor.profileId,
        requestKey: input.requestKey,
        requestFingerprint: input.requestFingerprint,
        retainUntil,
      })

      const status = statusForEvent(input.eventType)
      if (input.eventType !== 'asked') {
        const projectedValues = {
          shopId: input.actor.shopId,
          subjectKey: projection?.subjectKey ?? input.customerId,
          customerId: input.customerId,
          destinationFingerprint: current.fingerprint,
          fingerprintKeyVersion: current.keyVersion,
          programVersion: input.programVersion,
          status,
          sourceEventId: eventId,
          consentedAt: status === 'consented' ? transitionAt : null,
          revokedAt: status === 'revoked' ? transitionAt : null,
          retainUntil,
          updatedAt: transitionAt,
        } as const
        if (projection) {
          await tx.update(messagingConsentState).set(projectedValues).where(and(
            eq(messagingConsentState.shopId, input.actor.shopId),
            eq(messagingConsentState.id, projection.id),
          ))
        } else {
          await tx.insert(messagingConsentState).values(projectedValues)
        }
      }

      if (input.eventType === 'revoked') {
        for (const supported of sortedFingerprints) {
          await tx.insert(smsSuppressions).values({
            shopId: input.actor.shopId,
            destinationFingerprint: supported.fingerprint,
            fingerprintKeyVersion: supported.keyVersion,
            sourceEventId: eventId,
            reason: 'customer_revocation',
            suppressedAt: transitionAt,
            liftedAt: null,
            retainUntil,
            updatedAt: transitionAt,
          }).onConflictDoUpdate({
            target: [
              smsSuppressions.shopId,
              smsSuppressions.destinationFingerprint,
              smsSuppressions.fingerprintKeyVersion,
            ],
            setWhere: eq(smsSuppressions.reason, 'customer_revocation'),
            set: {
              sourceEventId: eventId,
              reason: 'customer_revocation',
              suppressedAt: transitionAt,
              liftedAt: null,
              retainUntil,
              updatedAt: transitionAt,
            },
          })
        }
      } else if (input.eventType === 'reconsented') {
        await tx.update(smsSuppressions).set({
          liftedAt: transitionAt,
          updatedAt: transitionAt,
        }).where(and(
          eq(smsSuppressions.shopId, input.actor.shopId),
          matchingSuppression,
          isNull(smsSuppressions.liftedAt),
          eq(smsSuppressions.reason, 'customer_revocation'),
          eq(smsSuppressions.sourceEventId, latestRevocation!.id),
        ))
      }

      return { ok: true, eventId, status }
    })
  } catch (error) {
    let exactRequestRace = false
    try {
      exactRequestRace = isExactRequestUniqueViolation(error)
    } catch {
      return { ok: false, error: 'compliance_unavailable' }
    }
    if (!exactRequestRace) {
      return { ok: false, error: 'compliance_unavailable' }
    }
    try {
      return await recoverExactRequestRace(input.db, input)
    } catch {
      // The bounded compliance error below is the only safe recovery failure.
    }
    return { ok: false, error: 'compliance_unavailable' }
  }
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left === null ? right === null : right !== null && left.getTime() === right.getTime()
}

function sourceMatchesProjection(
  projection: typeof messagingConsentState.$inferSelect,
  source: typeof messagingConsentEvents.$inferSelect,
  shopName: string,
): boolean {
  const expectedStatus = statusForEvent(source.eventType)
  const projectableEvent = source.eventType === 'declined'
    || source.eventType === 'consented'
    || source.eventType === 'revoked'
    || source.eventType === 'reconsented'
  const statusTimestampMatches = projection.status === 'consented'
    ? sameInstant(projection.consentedAt, source.committedAt) && projection.revokedAt === null
    : projection.status === 'revoked'
      ? sameInstant(projection.revokedAt, source.committedAt)
      : projection.consentedAt === null && projection.revokedAt === null
  const disclosure = projection.status === 'consented'
    ? validatedDisclosureProof(
        source.disclosureSnapshot,
        source.disclosureHash,
        source.programVersion,
        false,
      )
    : null
  const validConsentProof = projection.status !== 'consented' || (
    (source.eventType === 'consented' || source.eventType === 'reconsented')
    && source.captureMethod === 'signed_form'
    && source.customerControlled === true
    && source.evidenceKind === 'signed_form_reference'
    && validEvidenceRef(source.evidenceRef)
    && disclosure?.snapshot.senderIdentity === shopName
  )
  const validRevocationProof = projection.status !== 'revoked' || (
    source.eventType === 'revoked'
    && (
      (source.captureMethod === 'staff_request'
        && source.evidenceKind === 'staff_request'
        && source.customerControlled === false)
      || (source.captureMethod === 'provider_webhook'
        && source.evidenceKind === 'provider_event'
        && source.customerControlled === true
        && validEvidenceRef(source.evidenceRef))
    )
  )
  return projectableEvent
    && source.id === projection.sourceEventId
    && source.shopId === projection.shopId
    && source.subjectKey === projection.subjectKey
    && source.customerId === projection.customerId
    && source.destinationFingerprint === projection.destinationFingerprint
    && source.fingerprintKeyVersion === projection.fingerprintKeyVersion
    && source.programVersion === projection.programVersion
    && expectedStatus === projection.status
    && statusTimestampMatches
    && sameInstant(source.retainUntil, projection.retainUntil)
    && sameInstant(source.retainUntil, consentProofRetainUntil(source.committedAt))
    && validConsentProof
    && validRevocationProof
}

type ValidatedEligibilityInput = Readonly<{
  db: AppDb
  shopId: string
  customerId: string
  destination: string
  programVersion: string
  fingerprints: ReadonlyArray<SupportedFingerprint>
}>

function validateEligibilityInput(input: unknown): ValidatedEligibilityInput | null {
  const data = domainDataProperties(input, [
    'db',
    'shopId',
    'customerId',
    'destination',
    'programVersion',
    'keyRing',
  ])
  if (
    !data
    || !uuidSchema.safeParse(data.shopId).success
    || !uuidSchema.safeParse(data.customerId).success
    || !boundedVersionSchema.safeParse(data.programVersion).success
  ) return null
  const destination = normalizeE164(data.destination)
  const fingerprints = fingerprintsForKeyRing(destination, data.keyRing as FingerprintKeyRing)
  if (fingerprints.length === 0) return null
  return Object.freeze({
    db: data.db as AppDb,
    shopId: data.shopId as string,
    customerId: data.customerId as string,
    destination,
    programVersion: data.programVersion as string,
    fingerprints,
  })
}

export async function getMessagingEligibility(rawInput: {
  db: AppDb
  shopId: string
  customerId: string
  destination: string
  programVersion: string
  keyRing: FingerprintKeyRing
}): Promise<MessagingEligibility> {
  try {
    const input = validateEligibilityInput(rawInput)
    if (!input) return { allowed: false, reason: 'compliance_unavailable' }
    const fingerprints = input.fingerprints
    const currentTime = new Date()
    const consentPair = fingerprintPredicate(
      fingerprints,
      messagingConsentState.destinationFingerprint,
      messagingConsentState.fingerprintKeyVersion,
    )
    const suppressionPair = fingerprintPredicate(
      fingerprints,
      smsSuppressions.destinationFingerprint,
      smsSuppressions.fingerprintKeyVersion,
    )
    const deletionPair = fingerprintPredicate(
      fingerprints,
      messagingDeletionRequests.destinationFingerprint,
      messagingDeletionRequests.fingerprintKeyVersion,
    )

    const [pendingDeletion] = await input.db.select({ id: messagingDeletionRequests.id })
      .from(messagingDeletionRequests).where(and(
        eq(messagingDeletionRequests.shopId, input.shopId),
        eq(messagingDeletionRequests.state, 'pending'),
        or(eq(messagingDeletionRequests.customerId, input.customerId), deletionPair),
      )).limit(1)
    if (pendingDeletion) return { allowed: false, reason: 'deletion_pending' }

    const suppressions = await input.db.select().from(smsSuppressions).where(and(
      eq(smsSuppressions.shopId, input.shopId),
      suppressionPair,
    )).orderBy(asc(smsSuppressions.fingerprintKeyVersion))
    const blockingSuppressions = suppressions.filter((suppression) =>
      suppression.liftedAt === null || suppression.reason !== 'customer_revocation',
    )
    if (blockingSuppressions.some(
      ({ retainUntil }) => retainUntil.getTime() > currentTime.getTime(),
    )) {
      return { allowed: false, reason: 'suppressed' }
    }
    if (blockingSuppressions.length > 0) {
      return { allowed: false, reason: 'missing_consent' }
    }

    const [shop] = await input.db.select({ name: shops.name }).from(shops).where(
      eq(shops.id, input.shopId),
    ).limit(1)
    if (!shop) return { allowed: false, reason: 'compliance_unavailable' }

    const eventPair = fingerprintPredicate(
      fingerprints,
      messagingConsentEvents.destinationFingerprint,
      messagingConsentEvents.fingerprintKeyVersion,
    )
    const revocations = await input.db.select({
      id: messagingConsentEvents.id,
      committedAt: messagingConsentEvents.committedAt,
    }).from(messagingConsentEvents).where(and(
      eq(messagingConsentEvents.shopId, input.shopId),
      eq(messagingConsentEvents.eventType, 'revoked'),
      eventPair,
    )).orderBy(
      asc(messagingConsentEvents.committedAt),
      asc(messagingConsentEvents.id),
    )
    const completedDeletions = await input.db.select({
      id: messagingDeletionRequests.id,
      barrierAt: messagingDeletionRequests.latestRelevantAt,
    }).from(messagingDeletionRequests).where(and(
      eq(messagingDeletionRequests.shopId, input.shopId),
      eq(messagingDeletionRequests.state, 'completed'),
      deletionPair,
    )).orderBy(
      asc(messagingDeletionRequests.latestRelevantAt),
      asc(messagingDeletionRequests.id),
    )
    if (completedDeletions.some(({ barrierAt }) => barrierAt === null)) {
      return { allowed: false, reason: 'compliance_unavailable' }
    }
    const barrierTimes = [
      ...revocations.map(({ committedAt }) => committedAt.getTime()),
      ...completedDeletions.map(({ barrierAt }) => barrierAt!.getTime()),
    ]
    const latestBarrierAt = barrierTimes.length > 0 ? Math.max(...barrierTimes) : null

    const candidates = await input.db.select().from(messagingConsentState).where(and(
      eq(messagingConsentState.shopId, input.shopId),
      consentPair,
    )).orderBy(asc(messagingConsentState.fingerprintKeyVersion))
    if (candidates.length === 0) return { allowed: false, reason: 'missing_consent' }
    const customerCandidates = candidates.filter(({ customerId }) => customerId === input.customerId)
    if (customerCandidates.length === 0) return { allowed: false, reason: 'customer_mismatch' }
    const programCandidates = customerCandidates.filter(
      ({ programVersion }) => programVersion === input.programVersion,
    )
    if (programCandidates.length === 0) return { allowed: false, reason: 'program_mismatch' }
    if (programCandidates.length !== 1) {
      return { allowed: false, reason: 'stale_projection' }
    }

    const sourceIds = [...new Set(programCandidates.map(({ sourceEventId }) => sourceEventId))]
    const sources = await input.db.select().from(messagingConsentEvents).where(and(
      eq(messagingConsentEvents.shopId, input.shopId),
      inArray(messagingConsentEvents.id, sourceIds),
    ))
    const sourceById = new Map(sources.map((source) => [source.id, source]))
    if (programCandidates.some((projection) => {
      const source = sourceById.get(projection.sourceEventId)
      return !source || !sourceMatchesProjection(projection, source, shop.name)
    })) return { allowed: false, reason: 'stale_projection' }

    const latest = programCandidates[0]
    const latestSource = sourceById.get(latest.sourceEventId)!
    if (
      latest.status !== 'consented'
      || (latestBarrierAt !== null && (
        latestSource.committedAt.getTime() <= latestBarrierAt
        || latestSource.eventType !== 'reconsented'
      ))
    ) {
      return { allowed: false, reason: 'missing_consent' }
    }
    return {
      allowed: true,
      consentEventId: latest.sourceEventId,
      destinationFingerprint: latest.destinationFingerprint,
      keyVersion: latest.fingerprintKeyVersion,
    }
  } catch {
    return { allowed: false, reason: 'compliance_unavailable' }
  }
}
