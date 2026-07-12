import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  messagingConsentEvents,
  messagingConsentState,
  messagingDeletionRequests,
  profiles,
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

export type MessagingActor = {
  profileId: string
  shopId: string
  role: string
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
  | { ok: true; destination: string; fingerprints: ReadonlyArray<SupportedFingerprint> }
  | { ok: false; error: string }

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime())
}

function disclosureIsBounded(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (Object.keys(value).length === 0) return false
  try {
    const serialized = JSON.stringify(value)
    return serialized !== undefined
      && Buffer.byteLength(serialized, 'utf8') <= MAX_DISCLOSURE_BYTES
  } catch {
    return false
  }
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
    || (input.disclosureSnapshot !== undefined && !disclosureIsBounded(input.disclosureSnapshot))
    || (input.disclosureHash !== undefined
      && !fingerprintSchema.safeParse(input.disclosureHash).success)
  ) return { ok: false, error: 'invalid_input' }

  if (!canManageCustomerMessaging(input.actor.role)) {
    return { ok: false, error: 'forbidden' }
  }
  if (input.captureMethod === 'customer_web') {
    return { ok: false, error: 'forbidden' }
  }

  const createsConsent = input.eventType === 'consented' || input.eventType === 'reconsented'
  if (createsConsent && (
    input.captureMethod !== 'signed_form'
    || input.evidenceKind !== 'signed_form_reference'
    || input.customerControlled !== true
    || !validEvidenceRef(input.evidenceRef)
    || !disclosureIsBounded(input.disclosureSnapshot)
    || !fingerprintSchema.safeParse(input.disclosureHash).success
  )) return { ok: false, error: 'invalid_input' }

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
    return { ok: true, destination, fingerprints }
  } catch {
    return { ok: false, error: 'invalid_input' }
  }
}

async function loadPersistedRequest(
  db: AppDb,
  input: { shopId: string; profileId: string; requestKey: string },
): Promise<typeof messagingConsentEvents.$inferSelect | null> {
  const [event] = await db.select().from(messagingConsentEvents).where(and(
    eq(messagingConsentEvents.shopId, input.shopId),
    eq(messagingConsentEvents.actorProfileId, input.profileId),
    eq(messagingConsentEvents.requestKey, input.requestKey),
  )).limit(1)
  return event ?? null
}

function retryResult(
  event: typeof messagingConsentEvents.$inferSelect,
  requestFingerprint: string,
): RecordResult {
  return event.requestFingerprint === requestFingerprint
    ? { ok: true, eventId: event.id, status: statusForEvent(event.eventType) }
    : { ok: false, error: 'request_conflict' }
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
  const validated = validateRecordInput(input)
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
      }).from(customers).innerJoin(profiles, and(
        eq(profiles.id, input.actor.profileId),
        eq(profiles.shopId, input.actor.shopId),
      )).where(and(
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

      const [projection] = await tx.select().from(messagingConsentState).where(and(
        eq(messagingConsentState.shopId, input.actor.shopId),
        eq(messagingConsentState.customerId, input.customerId),
        eq(messagingConsentState.destinationFingerprint, current.fingerprint),
        eq(messagingConsentState.fingerprintKeyVersion, current.keyVersion),
        eq(messagingConsentState.programVersion, input.programVersion),
      )).limit(1).for('update')

      const unliftedSuppressions = suppressions.filter(({ liftedAt }) => liftedAt === null)
      if (input.eventType === 'consented' && unliftedSuppressions.length > 0) {
        return { ok: false, error: 'invalid_transition' as const }
      }
      if (input.eventType === 'reconsented' && (
        unliftedSuppressions.length === 0
        || unliftedSuppressions.some(({ suppressedAt }) => suppressedAt.getTime() >= input.now.getTime())
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
        disclosureSnapshot: input.disclosureSnapshot,
        disclosureHash: input.disclosureHash,
        evidenceKind: input.evidenceKind,
        evidenceRef: input.evidenceRef,
        actorProfileId: input.actor.profileId,
        requestKey: input.requestKey,
        requestFingerprint: input.requestFingerprint,
        retainUntil,
      })

      const status = statusForEvent(input.eventType)
      if (input.eventType !== 'asked') {
        await tx.insert(messagingConsentState).values({
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
        }).onConflictDoUpdate({
          target: [
            messagingConsentState.shopId,
            messagingConsentState.subjectKey,
            messagingConsentState.destinationFingerprint,
            messagingConsentState.fingerprintKeyVersion,
            messagingConsentState.programVersion,
          ],
          set: {
            customerId: input.customerId,
            status,
            sourceEventId: eventId,
            consentedAt: status === 'consented' ? input.now : null,
            revokedAt: status === 'revoked' ? input.now : null,
            retainUntil,
            updatedAt: input.now,
          },
        })
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
        ))
      }

      return { ok: true, eventId, status }
    })
  } catch {
    try {
      const existing = await loadPersistedRequest(input.db, {
        shopId: input.actor.shopId,
        profileId: input.actor.profileId,
        requestKey: input.requestKey,
      })
      if (existing) return retryResult(existing, input.requestFingerprint)
    } catch {
      // The bounded compliance error below is the only safe failure result.
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
  const validConsentProof = projection.status !== 'consented' || (
    (source.eventType === 'consented' || source.eventType === 'reconsented')
    && source.captureMethod === 'signed_form'
    && source.customerControlled === true
    && source.evidenceKind === 'signed_form_reference'
    && validEvidenceRef(source.evidenceRef)
    && disclosureIsBounded(source.disclosureSnapshot)
    && fingerprintSchema.safeParse(source.disclosureHash).success
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
      isNull(smsSuppressions.liftedAt),
    )).orderBy(asc(smsSuppressions.fingerprintKeyVersion))
    if (suppressions.some(({ retainUntil }) => retainUntil.getTime() > currentTime.getTime())) {
      return { allowed: false, reason: 'suppressed' }
    }
    if (suppressions.length > 0) return { allowed: false, reason: 'missing_consent' }

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

    const sourceIds = [...new Set(programCandidates.map(({ sourceEventId }) => sourceEventId))]
    const sources = await input.db.select().from(messagingConsentEvents).where(and(
      eq(messagingConsentEvents.shopId, input.shopId),
      inArray(messagingConsentEvents.id, sourceIds),
    ))
    const sourceById = new Map(sources.map((source) => [source.id, source]))
    if (programCandidates.some((projection) => {
      const source = sourceById.get(projection.sourceEventId)
      return !source || !sourceMatchesProjection(projection, source)
    })) return { allowed: false, reason: 'stale_projection' }

    const latest = [...programCandidates].sort((left, right) => {
      const leftSource = sourceById.get(left.sourceEventId)!
      const rightSource = sourceById.get(right.sourceEventId)!
      return rightSource.committedAt.getTime() - leftSource.committedAt.getTime()
    })[0]
    if (!latest || latest.status !== 'consented') {
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
