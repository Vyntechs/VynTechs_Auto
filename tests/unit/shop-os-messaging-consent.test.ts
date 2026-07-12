import { and, eq, inArray } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getMessagingEligibility,
  recordMessagingConsentEvent,
  type MessagingActor,
} from '@/lib/shop-os/messaging-consent'
import {
  customers,
  messagingConsentEvents,
  messagingConsentState,
  messagingDeletionRequests,
  profiles,
  shops,
  smsSuppressions,
} from '@/lib/db/schema'
import { fingerprintDestination, type FingerprintKeyRing } from '@/lib/shop-os/messaging-retention-policy'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import type { AppDb } from '@/lib/db/queries'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`
const destination = '+12025550123'
const programVersion = 'repair_updates_v1'
const keyRing: FingerprintKeyRing = Object.freeze({
  currentVersion: 'key_v2',
  keys: Object.freeze({
    key_v2: 'current-shop-key-material-that-is-at-least-32-bytes',
    key_v1: 'legacy-shop-key-material-that-is-at-least-32-bytes',
  }),
})
const signedDisclosure = (
  senderIdentity: string,
  smsTermsUrl: string,
  privacyPolicyUrl: string,
) => `By signing below, I agree to receive recurring transactional text messages from ${senderIdentity} about estimates, authorizations, repair status, and pickup for vehicles I bring to this shop. Message frequency varies by repair order. Message and data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is not a condition of purchase. SMS Terms: ${smsTermsUrl}. Privacy Policy: ${privacyPolicyUrl}. Vyntechs provides the messaging technology.`

const canonicalDisclosure = (snapshot: Record<string, unknown>) => JSON.stringify(
  Object.fromEntries(Object.keys(snapshot).sort().map((key) => [key, snapshot[key]])),
)

const hashDisclosure = (snapshot: Record<string, unknown>) => createHash('sha256')
  .update(canonicalDisclosure(snapshot))
  .digest('hex')

const disclosureFor = (senderIdentity: string) => Object.freeze({
  disclosureVersion: 'signed_repair_updates_v1',
  programVersion,
  senderIdentity,
  messagePurpose: 'estimates_authorizations_repair_status_pickup',
  messageFrequency: 'varies_by_repair_order',
  messageAndDataRates: 'may_apply',
  stopKeyword: 'STOP',
  helpKeyword: 'HELP',
  consentNotConditionOfPurchase: true,
  smsTermsUrl: 'https://example.com/sms-terms',
  privacyPolicyUrl: 'https://example.com/privacy',
  technologyProvider: 'Vyntechs',
  renderedDisclosure: signedDisclosure(
    senderIdentity,
    'https://example.com/sms-terms',
    'https://example.com/privacy',
  ),
})
const disclosureSnapshot = disclosureFor('North Shop')
const disclosureHash = hashDisclosure(disclosureSnapshot)
const now = new Date('2026-07-12T18:00:00.000Z')

describe('Shop OS messaging consent truth', () => {
  let db: TestDb
  let client: Awaited<ReturnType<typeof createTestDb>>['client']
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let customerId: string
  let duplicateCustomerId: string
  let otherShopCustomerId: string
  let owner: MessagingActor
  let advisor: MessagingActor
  let tech: MessagingActor
  let parts: MessagingActor
  let requestSequence: number

  beforeEach(async () => {
    ;({ db, client, close } = await createTestDb())
    requestSequence = 100
    ;[{ id: shopId }, { id: otherShopId }] = await db.insert(shops).values([
      { id: uuid(1), name: 'North Shop' },
      { id: uuid(2), name: 'South Shop' },
    ]).returning({ id: shops.id })
    ;[{ id: customerId }, { id: duplicateCustomerId }, { id: otherShopCustomerId }] =
      await db.insert(customers).values([
        { id: uuid(10), shopId, name: 'Primary Customer', phone: destination },
        { id: uuid(11), shopId, name: 'Duplicate Customer', phone: destination },
        { id: uuid(12), shopId: otherShopId, name: 'Other Shop Customer', phone: destination },
      ]).returning({ id: customers.id })
    const profileRows = await db.insert(profiles).values([
      { id: uuid(20), userId: uuid(120), shopId, fullName: 'Owner', role: 'owner' },
      { id: uuid(21), userId: uuid(121), shopId, fullName: 'Advisor', role: 'advisor' },
      { id: uuid(22), userId: uuid(122), shopId, fullName: 'Tech', role: 'tech' },
      { id: uuid(23), userId: uuid(123), shopId, fullName: 'Parts', role: 'parts' },
      { id: uuid(24), userId: uuid(124), shopId: otherShopId, fullName: 'Other Owner', role: 'owner' },
    ]).returning({ id: profiles.id, shopId: profiles.shopId, role: profiles.role })
    ;[owner, advisor, tech, parts] = profileRows.slice(0, 4).map((profile) => ({
      profileId: profile.id,
      shopId: profile.shopId!,
      role: profile.role,
    }))
  })

  afterEach(async () => {
    await close()
  })

  const requestKey = () => uuid(requestSequence++)
  const signedConsentInput = (
    actor: MessagingActor,
    targetCustomerId = customerId,
    overrides: Partial<Parameters<typeof recordMessagingConsentEvent>[0]> = {},
  ): Parameters<typeof recordMessagingConsentEvent>[0] => ({
    db,
    actor,
    customerId: targetCustomerId,
    destination,
    programVersion,
    eventType: 'consented',
    captureMethod: 'signed_form',
    customerControlled: true,
    disclosureSnapshot,
    disclosureHash,
    evidenceKind: 'signed_form_reference',
    evidenceRef: 'signed-source-42',
    requestKey: requestKey(),
    requestFingerprint: 'b'.repeat(64),
    occurredAt: new Date('2026-07-12T17:55:00.000Z'),
    now,
    keyRing,
    ...overrides,
  })

  const signedConsent = (
    actor: MessagingActor,
    targetCustomerId = customerId,
    overrides: Partial<Parameters<typeof recordMessagingConsentEvent>[0]> = {},
  ) => recordMessagingConsentEvent(signedConsentInput(actor, targetCustomerId, overrides))

  const revoke = (
    actor: MessagingActor,
    targetCustomerId = customerId,
    overrides: Partial<Parameters<typeof recordMessagingConsentEvent>[0]> = {},
  ) => recordMessagingConsentEvent({
    db,
    actor,
    customerId: targetCustomerId,
    destination,
    programVersion,
    eventType: 'revoked',
    captureMethod: 'staff_request',
    customerControlled: false,
    evidenceKind: 'staff_request',
    evidenceRef: 'phone-request',
    requestKey: requestKey(),
    requestFingerprint: 'c'.repeat(64),
    occurredAt: new Date('2026-07-12T17:59:00.000Z'),
    now,
    keyRing,
    ...overrides,
  })

  const eligibilityInput = (
    targetCustomerId = customerId,
    targetShopId = shopId,
  ): Parameters<typeof getMessagingEligibility>[0] => ({
      db,
      shopId: targetShopId,
      customerId: targetCustomerId,
      destination,
      programVersion,
      keyRing,
    })

  const eligibility = (targetCustomerId = customerId, targetShopId = shopId) =>
    getMessagingEligibility(eligibilityInput(targetCustomerId, targetShopId))

  it('allows advisor/owner signed evidence and revocation but denies tech/parts mutation', async () => {
    expect(await signedConsent(advisor)).toMatchObject({ ok: true, status: 'consented' })
    expect(await revoke(owner)).toMatchObject({ ok: true, status: 'revoked' })
    expect(await signedConsent(tech, duplicateCustomerId)).toEqual({ ok: false, error: 'forbidden' })
    expect(await revoke(parts, duplicateCustomerId)).toEqual({ ok: false, error: 'forbidden' })
  })

  it('rejects fabricated web consent, provider re-consent, incomplete proof, and malformed time', async () => {
    expect(await signedConsent(owner, customerId, {
      captureMethod: 'customer_web',
      evidenceKind: 'customer_checkbox',
    })).toEqual({ ok: false, error: 'forbidden' })
    expect(await signedConsent(owner, customerId, {
      eventType: 'reconsented',
      captureMethod: 'provider_webhook',
      evidenceKind: 'provider_event',
      evidenceRef: 'START-event',
    })).toEqual({ ok: false, error: 'invalid_input' })
    expect(await signedConsent(owner, customerId, {
      disclosureSnapshot: undefined,
    })).toEqual({ ok: false, error: 'invalid_input' })
    expect(await signedConsent(owner, customerId, {
      disclosureSnapshot: { value: 'x'.repeat(4097) },
    })).toEqual({ ok: false, error: 'invalid_input' })
    expect(await signedConsent(owner, customerId, {
      disclosureSnapshot: Object.freeze({ x: true }),
      disclosureHash: 'a'.repeat(64),
    })).toEqual({ ok: false, error: 'invalid_input' })
    expect(await signedConsent(owner, customerId, {
      disclosureHash: 'a'.repeat(64),
    })).toEqual({ ok: false, error: 'invalid_input' })
    const privateLinkDisclosure = Object.freeze({
      ...disclosureSnapshot,
      smsTermsUrl: 'https://127.0.0.1/sms-terms',
      renderedDisclosure: signedDisclosure(
        'North Shop',
        'https://127.0.0.1/sms-terms',
        disclosureSnapshot.privacyPolicyUrl,
      ),
    })
    expect(await signedConsent(owner, customerId, {
      disclosureSnapshot: privateLinkDisclosure,
      disclosureHash: hashDisclosure(privateLinkDisclosure),
    })).toEqual({ ok: false, error: 'invalid_input' })
    expect(await signedConsent(owner, customerId, {
      occurredAt: new Date(Number.NaN),
    })).toEqual({ ok: false, error: 'invalid_input' })
  })

  it('rejects extra, inherited, accessor, proxy, and mutable disclosure input without invoking it', async () => {
    const extra = Object.freeze({ ...disclosureSnapshot, extra: 'ambiguous' })
    const inherited = Object.freeze(Object.assign(
      Object.create({ inherited: 'ambiguous' }) as Record<string, unknown>,
      disclosureSnapshot,
    ))
    let getterCalls = 0
    const accessor = { ...disclosureSnapshot } as Record<string, unknown>
    Object.defineProperty(accessor, 'senderIdentity', {
      enumerable: true,
      get() {
        getterCalls += 1
        throw new Error(`${destination}:private-disclosure`)
      },
    })
    Object.freeze(accessor)
    const proxy = new Proxy({ ...disclosureSnapshot }, {
      ownKeys() {
        throw new Error(`${destination}:private-proxy`)
      },
    })
    const mutable = { ...disclosureSnapshot }

    for (const snapshot of [extra, inherited, accessor, proxy, mutable]) {
      expect(await signedConsent(owner, customerId, {
        disclosureSnapshot: snapshot,
        disclosureHash: 'a'.repeat(64),
      })).toEqual({ ok: false, error: 'invalid_input' })
    }
    expect(getterCalls).toBe(0)
  })

  it('rejects accessor-backed domain input without reading the accessor', async () => {
    const input = signedConsentInput(owner) as Record<string, unknown>
    let getterCalls = 0
    Object.defineProperty(input, 'eventType', {
      enumerable: true,
      get() {
        getterCalls += 1
        return getterCalls === 1 ? 'consented' : 'deleted'
      },
    })

    expect(await recordMessagingConsentEvent(
      input as Parameters<typeof recordMessagingConsentEvent>[0],
    )).toEqual({ ok: false, error: 'invalid_input' })
    expect(getterCalls).toBe(0)
  })

  it('uses one immutable input snapshot across awaited database work', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const delayedDb = {
      transaction: async (callback: Parameters<AppDb['transaction']>[0]) => {
        await gate
        return db.transaction(callback as never)
      },
    } as unknown as AppDb
    const mutableActor = { ...owner }
    const input = signedConsentInput(mutableActor, customerId, { db: delayedDb })

    const pending = recordMessagingConsentEvent(input)
    mutableActor.profileId = tech.profileId
    mutableActor.role = tech.role
    input.customerId = duplicateCustomerId
    input.eventType = 'deleted' as never
    input.evidenceRef = 'mutated-after-validation'
    release()

    expect(await pending).toMatchObject({ ok: true, status: 'consented' })
    const [stored] = await db.select().from(messagingConsentEvents)
    expect(stored).toMatchObject({
      actorProfileId: owner.profileId,
      customerId,
      eventType: 'consented',
      evidenceRef: 'signed-source-42',
    })
  })

  it('persists the one validated immutable disclosure copy and revalidates its hash for eligibility', async () => {
    const result = await signedConsent(owner)
    expect(result).toMatchObject({ ok: true })
    const [stored] = await db.select().from(messagingConsentEvents)
    expect(stored.disclosureSnapshot).toEqual(disclosureSnapshot)
    expect(stored.disclosureHash).toBe(disclosureHash)
    expect(await eligibility()).toMatchObject({ allowed: true })

    await client.exec('drop trigger messaging_consent_events_append_only on messaging_consent_events')
    await db.update(messagingConsentEvents).set({
      disclosureHash: 'a'.repeat(64),
    }).where(eq(messagingConsentEvents.id, stored.id))
    expect(await eligibility()).toEqual({ allowed: false, reason: 'stale_projection' })
  })

  it('keeps declined destinations ineligible and binds consent to customer and program', async () => {
    expect(await recordMessagingConsentEvent({
      db,
      actor: advisor,
      customerId,
      destination,
      programVersion,
      eventType: 'declined',
      captureMethod: 'staff_request',
      customerControlled: false,
      evidenceKind: 'staff_request',
      requestKey: requestKey(),
      requestFingerprint: 'd'.repeat(64),
      occurredAt: now,
      now,
      keyRing,
    })).toMatchObject({ ok: true, status: 'declined' })
    expect(await eligibility()).toEqual({ allowed: false, reason: 'missing_consent' })

    expect(await signedConsent(owner)).toMatchObject({ ok: true })
    expect(await eligibility()).toMatchObject({ allowed: true, keyVersion: 'key_v2' })
    expect(await eligibility(duplicateCustomerId)).toEqual({
      allowed: false,
      reason: 'customer_mismatch',
    })
    expect(await getMessagingEligibility({
      db,
      shopId,
      customerId,
      destination,
      programVersion: 'marketing_v1',
      keyRing,
    })).toEqual({ allowed: false, reason: 'program_mismatch' })
  })

  it('makes one revocation suppress duplicate customers without crossing shops', async () => {
    expect(await signedConsent(owner, customerId)).toMatchObject({ ok: true })
    expect(await signedConsent(advisor, duplicateCustomerId)).toMatchObject({ ok: true })
    const otherOwner: MessagingActor = { profileId: uuid(24), shopId: otherShopId, role: 'owner' }
    const otherDisclosure = disclosureFor('South Shop')
    expect(await signedConsent(otherOwner, otherShopCustomerId, {
      disclosureSnapshot: otherDisclosure,
      disclosureHash: hashDisclosure(otherDisclosure),
    })).toMatchObject({ ok: true })

    expect(await revoke(owner)).toMatchObject({ ok: true })
    expect(await eligibility()).toEqual({ allowed: false, reason: 'suppressed' })
    expect(await eligibility(duplicateCustomerId)).toEqual({ allowed: false, reason: 'suppressed' })
    expect(await eligibility(otherShopCustomerId, otherShopId)).toMatchObject({ allowed: true })

    const suppressions = await db.select().from(smsSuppressions).where(eq(smsSuppressions.shopId, shopId))
    expect(suppressions.map(({ fingerprintKeyVersion }) => fingerprintKeyVersion).sort()).toEqual([
      'key_v1',
      'key_v2',
    ])
  })

  it('returns the original actor-bound event on exact retry and conflicts on changed fingerprint', async () => {
    const stableKey = requestKey()
    const first = await signedConsent(owner, customerId, { requestKey: stableKey })
    const [persistedBeforeRetry] = await db.select().from(messagingConsentEvents)
    const retry = await signedConsent(owner, customerId, {
      requestKey: stableKey,
      now: new Date('2036-07-12T18:00:00.000Z'),
    })
    const conflict = await signedConsent(owner, customerId, {
      requestKey: stableKey,
      requestFingerprint: 'e'.repeat(64),
    })

    expect(first).toMatchObject({ ok: true })
    expect(retry).toEqual(first)
    expect(conflict).toEqual({ ok: false, error: 'request_conflict' })
    expect(await db.select().from(messagingConsentEvents).where(and(
      eq(messagingConsentEvents.shopId, shopId),
      eq(messagingConsentEvents.actorProfileId, owner.profileId),
      eq(messagingConsentEvents.requestKey, stableKey),
    ))).toHaveLength(1)
    const [persistedAfterRetry] = await db.select().from(messagingConsentEvents)
    expect(persistedAfterRetry?.committedAt).toEqual(persistedBeforeRetry?.committedAt)
  })

  it('serializes concurrent identical actor-bound retries to one event', async () => {
    const stableKey = requestKey()
    const [left, right] = await Promise.all([
      signedConsent(owner, customerId, { requestKey: stableKey }),
      signedConsent(owner, customerId, { requestKey: stableKey }),
    ])
    expect(left).toEqual(right)
    expect(left).toMatchObject({ ok: true, status: 'consented' })
    expect(await db.select().from(messagingConsentEvents)).toHaveLength(1)
  })

  it('recovers only the exact request unique race and rechecks current authority', async () => {
    const stableKey = requestKey()
    const first = await signedConsent(owner, customerId, { requestKey: stableKey })
    expect(first).toMatchObject({ ok: true })
    let transactions = 0
    const uniqueRaceDb = {
      transaction: async (callback: Parameters<AppDb['transaction']>[0]) => {
        transactions += 1
        if (transactions === 1) {
          throw Object.assign(new Error('safe unique race'), {
            code: '23505',
            constraint: 'messaging_consent_events_shop_request_uq',
          })
        }
        return db.transaction(callback as never)
      },
    } as unknown as AppDb

    expect(await signedConsent(owner, customerId, {
      db: uniqueRaceDb,
      requestKey: stableKey,
    })).toEqual(first)
    expect(transactions).toBe(2)

    await db.update(profiles).set({ deactivatedAt: now }).where(eq(profiles.id, owner.profileId))
    transactions = 0
    expect(await signedConsent(owner, customerId, {
      db: uniqueRaceDb,
      requestKey: stableKey,
    })).toEqual({ ok: false, error: 'forbidden' })
  })

  it('does not recover a free-form unique-constraint message', async () => {
    const stableKey = requestKey()
    expect(await signedConsent(owner, customerId, { requestKey: stableKey })).toMatchObject({ ok: true })
    let transactions = 0
    const spoofedDb = {
      transaction: async () => {
        transactions += 1
        throw Object.assign(new Error('messaging_consent_events_shop_request_uq'), {
          code: '23505',
        })
      },
    } as unknown as AppDb

    expect(await signedConsent(owner, customerId, {
      db: spoofedDb,
      requestKey: stableKey,
    })).toEqual({ ok: false, error: 'compliance_unavailable' })
    expect(transactions).toBe(1)
  })

  it.each(['normal', 'race'] as const)(
    'fails closed when a %s retry spoofs canonical request meaning',
    async (path) => {
      const stableKey = requestKey()
      expect(await signedConsent(owner, customerId, { requestKey: stableKey })).toMatchObject({ ok: true })
      let transactions = 0
      const exactRaceDb = {
        transaction: async (callback: Parameters<AppDb['transaction']>[0]) => {
          transactions += 1
          if (transactions === 1) {
            throw Object.assign(new Error('unique race'), {
              code: '23505',
              constraint_name: 'messaging_consent_events_shop_request_uq',
            })
          }
          return db.transaction(callback as never)
        },
      } as unknown as AppDb

      expect(await signedConsent(owner, customerId, {
        db: path === 'race' ? exactRaceDb : db,
        requestKey: stableKey,
        evidenceRef: 'different-signed-source',
      })).toEqual({ ok: false, error: 'request_conflict' })
    },
  )

  it('does not reinterpret a generic database failure as a successful retry', async () => {
    const stableKey = requestKey()
    expect(await signedConsent(owner, customerId, { requestKey: stableKey })).toMatchObject({ ok: true })
    const failingDb = {
      transaction: async () => {
        throw new Error(`${destination}:private-database-failure`)
      },
      select: db.select.bind(db),
    } as unknown as AppDb
    expect(await signedConsent(owner, customerId, {
      db: failingDb,
      requestKey: stableKey,
    })).toEqual({ ok: false, error: 'compliance_unavailable' })
  })

  it('allows only A fresh re-consent after A/B shared-number revocation, even if suppression rows disappear', async () => {
    await signedConsent(owner)
    await signedConsent(advisor, duplicateCustomerId)
    await revoke(owner)
    expect(await signedConsent(owner, customerId, {
      now: new Date(now.getTime() + 1),
    })).toEqual({ ok: false, error: 'invalid_transition' })

    const reconsent = await signedConsent(owner, customerId, {
      eventType: 'reconsented',
      now: new Date(now.getTime() + 1),
    })
    expect(reconsent).toMatchObject({ ok: true, status: 'consented' })
    expect(await eligibility()).toMatchObject({
      allowed: true,
      consentEventId: reconsent.ok ? reconsent.eventId : '',
    })
    expect(
      (await db.select().from(smsSuppressions)).every(({ liftedAt }) => liftedAt !== null),
    ).toBe(true)
    expect(await eligibility(duplicateCustomerId)).toEqual({
      allowed: false,
      reason: 'missing_consent',
    })

    await db.delete(smsSuppressions).where(eq(smsSuppressions.shopId, shopId))
    expect(await eligibility()).toMatchObject({ allowed: true })
    expect(await eligibility(duplicateCustomerId)).toEqual({
      allowed: false,
      reason: 'missing_consent',
    })
  })

  it('requires an explicit re-consent event after suppression rows have expired or been purged', async () => {
    await signedConsent(owner)
    await signedConsent(advisor, duplicateCustomerId)
    await revoke(owner)
    await db.delete(smsSuppressions).where(eq(smsSuppressions.shopId, shopId))

    expect(await signedConsent(owner, customerId, {
      now: new Date(now.getTime() + 1),
    })).toEqual({ ok: false, error: 'invalid_transition' })
    expect(await signedConsent(owner, customerId, {
      eventType: 'reconsented',
      now: new Date(now.getTime() + 1),
    })).toMatchObject({ ok: true, status: 'consented' })
    expect(await eligibility()).toMatchObject({ allowed: true })
    expect(await eligibility(duplicateCustomerId)).toEqual({
      allowed: false,
      reason: 'missing_consent',
    })
  })

  it.each(['verified_deletion', 'permanent_failure', 'number_reassigned'] as const)(
    'never lifts a %s suppression through re-consent',
    async (reason) => {
      await signedConsent(owner)
      const fingerprint = fingerprintDestination(
        destination,
        keyRing.currentVersion,
        keyRing.keys[keyRing.currentVersion]!,
      )
      await db.insert(smsSuppressions).values({
        shopId,
        destinationFingerprint: fingerprint,
        fingerprintKeyVersion: keyRing.currentVersion,
        reason,
        suppressedAt: now,
        retainUntil: new Date('2031-07-12T18:00:00.000Z'),
      })
      expect(await signedConsent(owner, customerId, {
        eventType: 'reconsented',
        now: new Date(now.getTime() + 1),
      })).toEqual({ ok: false, error: 'invalid_transition' })
      expect((await db.select().from(smsSuppressions))[0]?.liftedAt).toBeNull()
    },
  )

  it.each(['verified_deletion', 'permanent_failure', 'number_reassigned'] as const)(
    'preserves every %s suppression byte-for-byte through revocation and re-consent',
    async (reason) => {
      await signedConsent(owner)
      const fingerprints = Object.entries(keyRing.keys).map(([keyVersion, secret], index) => ({
        id: uuid(200 + index),
        shopId,
        destinationFingerprint: fingerprintDestination(destination, keyVersion, secret),
        fingerprintKeyVersion: keyVersion,
        sourceEventId: null,
        reason,
        suppressedAt: new Date(`2026-07-0${index + 1}T01:02:03.000Z`),
        liftedAt: null,
        retainUntil: new Date(`2031-07-0${index + 1}T01:02:03.000Z`),
        updatedAt: new Date(`2026-07-0${index + 2}T01:02:03.000Z`),
      }))
      await db.insert(smsSuppressions).values(fingerprints)
      const before = await db.select().from(smsSuppressions).orderBy(smsSuppressions.id)

      expect(await revoke(owner, customerId, {
        now: new Date(now.getTime() + 1),
      })).toMatchObject({ ok: true, status: 'revoked' })
      expect(await db.select().from(smsSuppressions).orderBy(smsSuppressions.id)).toEqual(before)
      expect(await signedConsent(owner, customerId, {
        eventType: 'reconsented',
        now: new Date(now.getTime() + 2),
      })).toEqual({ ok: false, error: 'invalid_transition' })
    },
  )

  it.each([
    'https://localhost./sms-terms',
    'https://foo.local./sms-terms',
    'https://.com/sms-terms',
    'https://invalid/sms-terms',
    'https://127.0.0.1/sms-terms',
    'https://10.0.0.1/sms-terms',
    'https://example.com:444/sms-terms',
    'https://user@example.com/sms-terms',
    'https://example.com/sms-terms#fragment',
  ])('rejects non-public disclosure URL %s', async (smsTermsUrl) => {
    const snapshot = Object.freeze({
      ...disclosureSnapshot,
      smsTermsUrl,
      renderedDisclosure: signedDisclosure(
        disclosureSnapshot.senderIdentity,
        smsTermsUrl,
        disclosureSnapshot.privacyPolicyUrl,
      ),
    })
    expect(await signedConsent(owner, customerId, {
      disclosureSnapshot: snapshot,
      disclosureHash: hashDisclosure(snapshot),
    })).toEqual({ ok: false, error: 'invalid_input' })
  })

  it('rejects disclosure versions without a known immutable renderer', async () => {
    const snapshot = Object.freeze({
      ...disclosureSnapshot,
      disclosureVersion: 'invented_disclosure_v99',
    })
    expect(await signedConsent(owner, customerId, {
      disclosureSnapshot: snapshot,
      disclosureHash: hashDisclosure(snapshot),
    })).toEqual({ ok: false, error: 'invalid_input' })
  })

  it('preserves one valid legacy projection during key rotation and migrates it on the next event', async () => {
    const legacyOnlyRing: FingerprintKeyRing = {
      currentVersion: 'key_v1',
      keys: { key_v1: keyRing.keys.key_v1! },
    }
    expect(await signedConsent(owner, customerId, { keyRing: legacyOnlyRing })).toMatchObject({ ok: true })
    expect(await eligibility()).toMatchObject({ allowed: true, keyVersion: 'key_v1' })

    expect(await revoke(owner, customerId, {
      keyRing,
      now: new Date(now.getTime() + 1),
    })).toMatchObject({ ok: true })
    const projections = await db.select().from(messagingConsentState)
    expect(projections).toHaveLength(1)
    expect(projections[0]?.fingerprintKeyVersion).toBe('key_v2')
  })

  it('fails closed on multiple or equal-time projection truths instead of choosing key order', async () => {
    const legacyOnlyRing: FingerprintKeyRing = {
      currentVersion: 'key_v1',
      keys: { key_v1: keyRing.keys.key_v1! },
    }
    await signedConsent(owner, customerId, { keyRing: legacyOnlyRing })
    const [legacyProjection] = await db.select().from(messagingConsentState)
    await db.insert(messagingConsentState).values({
      ...legacyProjection,
      id: uuid(95),
      destinationFingerprint: fingerprintDestination(
        destination,
        keyRing.currentVersion,
        keyRing.keys[keyRing.currentVersion]!,
      ),
      fingerprintKeyVersion: keyRing.currentVersion,
    })
    expect(await eligibility()).toEqual({ allowed: false, reason: 'stale_projection' })
  })

  it('rolls back the event when projection mutation fails', async () => {
    await client.exec(`
      create function fail_test_consent_projection() returns trigger language plpgsql as $$
      begin raise exception 'projection unavailable'; end $$;
      create trigger fail_test_consent_projection before insert or update on messaging_consent_state
      for each row execute function fail_test_consent_projection();
    `)
    const result = await signedConsent(owner)
    expect(result).toEqual({ ok: false, error: 'compliance_unavailable' })
    expect(await db.select().from(messagingConsentEvents)).toHaveLength(0)
  })

  it('fails closed when projection and append-only source disagree', async () => {
    const primary = await signedConsent(owner, customerId)
    const duplicate = await signedConsent(advisor, duplicateCustomerId)
    expect(primary.ok && duplicate.ok).toBe(true)
    if (!duplicate.ok) throw new Error('test setup failed')
    await db.update(messagingConsentState).set({ sourceEventId: duplicate.eventId }).where(and(
      eq(messagingConsentState.shopId, shopId),
      eq(messagingConsentState.customerId, customerId),
    ))
    expect(await eligibility()).toEqual({ allowed: false, reason: 'stale_projection' })
  })

  it('checks pending deletion before consent and suppression', async () => {
    const consent = await signedConsent(owner)
    expect(consent.ok).toBe(true)
    const fingerprint = fingerprintDestination(destination, keyRing.currentVersion, keyRing.keys[keyRing.currentVersion]!)
    await db.insert(messagingDeletionRequests).values({
      id: uuid(90),
      requestKey: uuid(91),
      requestFingerprint: 'f'.repeat(64),
      shopId,
      subjectKey: customerId,
      customerId,
      destinationFingerprint: fingerprint,
      fingerprintKeyVersion: keyRing.currentVersion,
      state: 'pending',
      reasonCode: 'customer_request',
      requestingActorProfileId: owner.profileId,
    })
    expect(await eligibility()).toEqual({ allowed: false, reason: 'deletion_pending' })
  })

  it('keeps a completed deletion barrier authoritative after suppression rows are absent', async () => {
    await signedConsent(owner)
    const fingerprint = fingerprintDestination(
      destination,
      keyRing.currentVersion,
      keyRing.keys[keyRing.currentVersion]!,
    )
    await db.insert(messagingDeletionRequests).values({
      id: uuid(92),
      requestKey: uuid(93),
      requestFingerprint: 'f'.repeat(64),
      shopId,
      subjectKey: customerId,
      customerId: null,
      destinationFingerprint: fingerprint,
      fingerprintKeyVersion: keyRing.currentVersion,
      state: 'completed',
      reasonCode: 'customer_request',
      requestingActorProfileId: owner.profileId,
      requestedAt: now,
      completedAt: now,
      latestRelevantAt: now,
      priorRecordCounts: {},
      proofSummary: {},
      retainUntil: new Date('2031-07-12T18:00:00.000Z'),
    })
    expect(await eligibility()).toEqual({ allowed: false, reason: 'missing_consent' })
  })

  it('does not restore duplicate-customer consent when suppression expires', async () => {
    await signedConsent(owner, customerId)
    await signedConsent(advisor, duplicateCustomerId)
    await revoke(owner)
    await db.update(smsSuppressions).set({
      retainUntil: new Date('2000-01-01T00:00:00.000Z'),
    }).where(eq(smsSuppressions.shopId, shopId))
    expect(await eligibility(duplicateCustomerId)).toEqual({
      allowed: false,
      reason: 'missing_consent',
    })
  })

  it('returns a bounded denial without logging destination data when compliance storage fails', async () => {
    const sensitiveFailure = `${destination}:private-evidence`
    const brokenDb = {
      select() {
        throw new Error(sensitiveFailure)
      },
    } as unknown as TestDb
    const spies = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'error').mockImplementation(() => undefined),
    ]

    const result = await getMessagingEligibility({
      db: brokenDb,
      shopId,
      customerId,
      destination,
      programVersion,
      keyRing,
    })

    expect(result).toEqual({ allowed: false, reason: 'compliance_unavailable' })
    expect(JSON.stringify(result)).not.toContain(destination)
    expect(spies.every((spy) => spy.mock.calls.length === 0)).toBe(true)
    spies.forEach((spy) => spy.mockRestore())
  })

  it.each([
    'db',
    'shopId',
    'customerId',
    'destination',
    'programVersion',
    'keyRing',
  ] as const)('rejects accessor-backed eligibility field %s without reading it', async (field) => {
    const input = eligibilityInput() as Record<string, unknown>
    const original = input[field]
    let getterCalls = 0
    Object.defineProperty(input, field, {
      enumerable: true,
      get() {
        getterCalls += 1
        return original
      },
    })

    expect(await getMessagingEligibility(
      input as Parameters<typeof getMessagingEligibility>[0],
    )).toEqual({ allowed: false, reason: 'compliance_unavailable' })
    expect(getterCalls).toBe(0)
  })

  it('bounds a trapping eligibility proxy without querying compliance state', async () => {
    let trapCalls = 0
    const input = new Proxy(eligibilityInput(), {
      ownKeys() {
        trapCalls += 1
        throw new Error(`${destination}:private-eligibility-proxy`)
      },
    })

    expect(await getMessagingEligibility(input)).toEqual({
      allowed: false,
      reason: 'compliance_unavailable',
    })
    expect(trapCalls).toBe(1)
  })

  it('keeps tenant-A eligibility meaning after input mutates toward tenant B', async () => {
    const otherOwner: MessagingActor = { profileId: uuid(24), shopId: otherShopId, role: 'owner' }
    const otherDisclosure = disclosureFor('South Shop')
    expect(await signedConsent(otherOwner, otherShopCustomerId, {
      disclosureSnapshot: otherDisclosure,
      disclosureHash: hashDisclosure(otherDisclosure),
    })).toMatchObject({ ok: true })
    const mutableKeyRing: FingerprintKeyRing = {
      currentVersion: keyRing.currentVersion,
      keys: { ...keyRing.keys },
    }
    const input = { ...eligibilityInput(customerId, shopId), keyRing: mutableKeyRing }

    const pending = getMessagingEligibility(input)
    input.db = { select: () => { throw new Error('mutated-db') } } as unknown as AppDb
    input.shopId = otherShopId
    input.customerId = otherShopCustomerId
    input.destination = '+12025550124'
    input.programVersion = 'marketing_v1'
    input.keyRing = { currentVersion: 'bad', keys: {} }
    mutableKeyRing.currentVersion = 'mutated'
    ;(mutableKeyRing.keys as Record<string, string>).key_v2 = 'short'

    expect(await pending).toEqual({ allowed: false, reason: 'missing_consent' })
  })

  it('orders shared-destination transitions by the database, not inverted caller time', async () => {
    const first = await signedConsent(owner, customerId, {
      occurredAt: new Date('2030-01-01T00:00:00.000Z'),
      now: new Date('2030-01-01T00:00:00.000Z'),
    })
    expect(first).toMatchObject({ ok: true })
    const second = await revoke(advisor, duplicateCustomerId, {
      occurredAt: new Date('2020-01-01T00:00:00.000Z'),
      now: new Date('2020-01-01T00:00:00.000Z'),
    })
    expect(second).toMatchObject({ ok: true })
    const third = await signedConsent(owner, customerId, {
      eventType: 'reconsented',
      occurredAt: new Date('2025-01-01T00:00:00.000Z'),
      now: new Date('2025-01-01T00:00:00.000Z'),
    })
    expect(third).toMatchObject({ ok: true })

    const events = await db.select().from(messagingConsentEvents).orderBy(
      messagingConsentEvents.committedAt,
      messagingConsentEvents.id,
    )
    expect(events.map(({ id }) => id)).toEqual([
      first.ok ? first.eventId : '',
      second.ok ? second.eventId : '',
      third.ok ? third.eventId : '',
    ])
    expect(events[1]!.committedAt.getTime()).toBeGreaterThan(events[0]!.committedAt.getTime())
    expect(events[2]!.committedAt.getTime()).toBeGreaterThan(events[1]!.committedAt.getTime())

    await db.delete(smsSuppressions).where(eq(smsSuppressions.shopId, shopId))
    expect(await eligibility()).toMatchObject({
      allowed: true,
      consentEventId: third.ok ? third.eventId : '',
    })
  })

  it('clamps equal database clock values strictly above the persisted barrier', async () => {
    await client.exec(`
      create function public.clock_timestamp() returns timestamptz
      language sql immutable
      as $$ select '2026-07-12T18:00:00.000Z'::timestamptz $$;
      set search_path = public, pg_catalog;
    `)
    const consent = await signedConsent(owner)
    const revocation = await revoke(owner)
    expect(consent.ok && revocation.ok).toBe(true)
    if (!consent.ok || !revocation.ok) throw new Error('test setup failed')

    const events = await db.select().from(messagingConsentEvents).where(
      inArray(messagingConsentEvents.id, [consent.eventId, revocation.eventId]),
    ).orderBy(messagingConsentEvents.committedAt)
    expect(events).toHaveLength(2)
    expect(events[0]!.committedAt.toISOString()).toBe('2026-07-12T18:00:00.000Z')
    expect(events[1]!.committedAt.getTime() - events[0]!.committedAt.getTime()).toBe(1)
  })

  it('serializes concurrent shared-number re-consent before a later revocation', async () => {
    await signedConsent(owner, customerId)
    await revoke(advisor, duplicateCustomerId)
    await signedConsent(owner, customerId, {
      eventType: 'reconsented',
      now: new Date(now.getTime() + 1),
    })
    await db.delete(smsSuppressions).where(eq(smsSuppressions.shopId, shopId))

    const reconsentPromise = signedConsent(owner, customerId, {
      eventType: 'reconsented',
      now: new Date(now.getTime() + 2),
    })
    await Promise.resolve()
    const revocationPromise = revoke(advisor, duplicateCustomerId, {
      now: new Date(now.getTime() - 10_000),
      occurredAt: new Date(now.getTime() - 20_000),
    })
    const [reconsent, revocation] = await Promise.all([reconsentPromise, revocationPromise])
    expect(reconsent.ok && revocation.ok).toBe(true)
    if (!reconsent.ok || !revocation.ok) throw new Error('test setup failed')

    const events = await db.select({
      id: messagingConsentEvents.id,
      committedAt: messagingConsentEvents.committedAt,
    }).from(messagingConsentEvents).where(inArray(
      messagingConsentEvents.id,
      [reconsent.eventId, revocation.eventId],
    )).orderBy(messagingConsentEvents.committedAt)
    expect(events.map(({ id }) => id)).toEqual([reconsent.eventId, revocation.eventId])
    expect(events[1]!.committedAt.getTime()).toBeGreaterThan(events[0]!.committedAt.getTime())
    expect(await eligibility()).toEqual({ allowed: false, reason: 'suppressed' })
  })
})
