import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
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
      destination: string
      fingerprints: ReadonlyArray<SupportedFingerprint>
      disclosureSnapshot?: MessagingDisclosureSnapshot
      disclosureHash?: string
    }
  | { ok: false; error: string }

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
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
  const parsed = new URL(value)
  return parsed.protocol === 'https:'
    && parsed.username === ''
    && parsed.password === ''
    && parsed.hash === ''
    && parsed.hostname.includes('.')
    && isIP(parsed.hostname) === 0
    && !parsed.hostname.endsWith('.local')
    && !parsed.hostname.endsWith('.internal')
    && !parsed.hostname.endsWith('.localhost')
    && parsed.href === value
}

function exactSignedDisclosure(snapshot: MessagingDisclosureSnapshot): string {
  return `By signing below, I agree to receive recurring transactional text messages from ${snapshot.senderIdentity} about estimates, authorizations, repair status, and pickup for vehicles I bring to this shop. Message frequency varies by repair order. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is not a condition of purchase. SMS Terms: ${snapshot.smsTermsUrl}. Privacy Policy: ${snapshot.privacyPolicyUrl}. Vyntechs provides the messaging technology.`
}

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
  if (
    !boundedVersionSchema.safeParse(snapshot.disclosureVersion).success
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
    || snapshot.renderedDisclosure !== exactSignedDisclosure(snapshot)
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

function validateRecordInput(input: {
  actor: MessagingActor
  customerId: string
  destination: string
  programVersion: string
  eventType: string
  captureMethod: string
  customerControlled: boolean
  disclosureSnapshot?: Record<string, unknown>
  disclosureHash?: string
  evidenceKind: string
  evidenceRef?: string
  requestKey: string
  requestFingerprint: string
  occurredAt: Date
  now: Date
  keyRing: FingerprintKeyRing
}): ValidatedRecordInput {
  const disclosureSnapshot = input.disclosureSnapshot
  const disclosureHash = input.disclosureHash
  if (
    !uuidSchema.safeParse(input.actor.profileId).success
    || !uuidSchema.safeParse(input.actor.shopId).success
    || !uuidSchema.safeParse(input.customerId).success
    || !uuidSchema.safeParse(input.requestKey).success
    || !boundedVersionSchema.safeParse(input.programVersion).success
    || !fingerprintSchema.safeParse(input.requestFingerprint).success
    || !eventTypes.has(input.eventType)
    || !captureMethods.has(input.captureMethod)
    || !evidenceKinds.has(input.evidenceKind)
    || typeof input.customerControlled !== 'boolean'
    || !validDate(input.occurredAt)
    || !validDate(input.now)
    || input.occurredAt.getTime() > input.now.getTime()
    || (input.evidenceRef !== undefined && !validEvidenceRef(input.evidenceRef))
  ) return { ok: false, error: 'invalid_input' }

  if (!canManageCustomerMessaging(input.actor.role)) {
    return { ok: false, error: 'forbidden' }
  }
  if (input.captureMethod === 'customer_web') {
    return { ok: false, error: 'forbidden' }
  }

  const createsConsent = input.eventType === 'consented' || input.eventType === 'reconsented'
  const hasDisclosure = disclosureSnapshot !== undefined || disclosureHash !== undefined
  const disclosure = hasDisclosure
    ? validatedDisclosureProof(
        disclosureSnapshot,
        disclosureHash,
        input.programVersion,
        true,
      )
    : null
  if (createsConsent && (
    input.captureMethod !== 'signed_form'
    || input.evidenceKind !== 'signed_form_reference'
    || input.customerControlled !== true
    || !validEvidenceRef(input.evidenceRef)
    || !disclosure
  )) return { ok: false, error: 'invalid_input' }
  if (!createsConsent && hasDisclosure && !disclosure) {
    return { ok: false, error: 'invalid_input' }
  }

  if (input.eventType === 'revoked') {
    const staffRequest = input.captureMethod === 'staff_request'
      && input.evidenceKind === 'staff_request'
      && input.customerControlled === false
    const providerRevocation = input.captureMethod === 'provider_webhook'
      && input.evidenceKind === 'provider_event'
      && input.customerControlled === true
      && validEvidenceRef(input.evidenceRef)
    if (!staffRequest && !providerRevocation) return { ok: false, error: 'invalid_input' }
  }

  if ((input.eventType === 'asked' || input.eventType === 'declined') && (
    input.captureMethod !== 'staff_request'
    || input.evidenceKind !== 'staff_request'
    || input.customerControlled !== false
  )) return { ok: false, error: 'invalid_input' }

  try {
    const destination = normalizeE164(input.destination)
    const fingerprints = fingerprintsForKeyRing(destination, input.keyRing)
    return {
      ok: true,
      destination,
      fingerprints,
      disclosureSnapshot: disclosure?.snapshot,
      disclosureHash: disclosure?.hash,
    }
  } catch {
    return { ok: false, error: 'invalid_input' }
  }
}

function retryResult(
  event: typeof messagingConsentEvents.$inferSelect,
  requestFingerprint: string,
): RecordResult {
  return event.requestFingerprint === requestFingerprint
    ? { ok: true, eventId: event.id, status: statusForEvent(event.eventType) }
    : { ok: false, error: 'request_conflict' }
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
      ?? ownDataProperty(current, 'constraint_name')
    const message = ownDataProperty(current, 'message')
    if (
      code === '23505'
      && (constraint === 'messaging_consent_events_shop_request_uq'
        || (typeof message === 'string'
          && message.includes('messaging_consent_events_shop_request_uq')))
    ) return true
    current = ownDataProperty(current, 'cause')
  }
  return false
}

async function recoverExactRequestRace(
  db: AppDb,
  input: {
    actor: MessagingActor
    customerId: string
    requestKey: string
    requestFingerprint: string
  },
  validated: Extract<ValidatedRecordInput, { ok: true }>,
): Promise<RecordResult> {
  return db.transaction(async (tx) => {
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
    if (context.customerPhone !== validated.destination) {
      return { ok: false, error: 'customer_mismatch' as const }
    }
    if (
      validated.disclosureSnapshot
      && validated.disclosureSnapshot.senderIdentity !== context.shopName
    ) return { ok: false, error: 'invalid_input' as const }
    return retryResult(event, input.requestFingerprint)
  })
}

export async function recordMessagingConsentEvent(input: {
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
    validated = validateRecordInput(input)
  } catch {
    return { ok: false, error: 'invalid_input' }
  }
  if (!validated.ok) return validated
  const current = validated.fingerprints[0]
  if (!current) return { ok: false, error: 'invalid_input' }
  const sortedFingerprints = [...validated.fingerprints]
    .sort((left, right) => left.keyVersion.localeCompare(right.keyVersion))

  try {
    return await input.db.transaction(async (tx) => {
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
      if (existingRequest) return retryResult(existingRequest, input.requestFingerprint)

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
      const [deletionBarrier] = await tx.select({ id: messagingDeletionRequests.id })
        .from(messagingDeletionRequests).where(and(
          eq(messagingDeletionRequests.shopId, input.actor.shopId),
          deletionPair,
        )).limit(1)

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
        || latestRevocation.committedAt.getTime() >= input.now.getTime()
        || unliftedSuppressions.some((suppression) =>
          suppression.reason !== 'customer_revocation'
          || suppression.sourceEventId !== latestRevocation.id
          || suppression.suppressedAt.getTime() !== latestRevocation.committedAt.getTime()
        )
      )) return { ok: false, error: 'invalid_transition' as const }

      const retainUntil = consentProofRetainUntil(input.now)
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
        committedAt: input.now,
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
          consentedAt: status === 'consented' ? input.now : null,
          revokedAt: status === 'revoked' ? input.now : null,
          retainUntil,
          updatedAt: input.now,
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
            suppressedAt: input.now,
            liftedAt: null,
            retainUntil,
            updatedAt: input.now,
          }).onConflictDoUpdate({
            target: [
              smsSuppressions.shopId,
              smsSuppressions.destinationFingerprint,
              smsSuppressions.fingerprintKeyVersion,
            ],
            set: {
              sourceEventId: eventId,
              reason: 'customer_revocation',
              suppressedAt: input.now,
              liftedAt: null,
              retainUntil,
              updatedAt: input.now,
            },
          })
        }
      } else if (input.eventType === 'reconsented') {
        await tx.update(smsSuppressions).set({
          liftedAt: input.now,
          updatedAt: input.now,
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
      return await recoverExactRequestRace(input.db, input, validated)
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
    && source.occurredAt.getTime() <= source.committedAt.getTime()
    && validConsentProof
    && validRevocationProof
}

export async function getMessagingEligibility(input: {
  db: AppDb
  shopId: string
  customerId: string
  destination: string
  programVersion: string
  keyRing: FingerprintKeyRing
}): Promise<MessagingEligibility> {
  try {
    if (
      !uuidSchema.safeParse(input.shopId).success
      || !uuidSchema.safeParse(input.customerId).success
      || !boundedVersionSchema.safeParse(input.programVersion).success
    ) return { allowed: false, reason: 'compliance_unavailable' }
    const destination = normalizeE164(input.destination)
    const fingerprints = fingerprintsForKeyRing(destination, input.keyRing)
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
