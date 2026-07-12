import { and, eq } from 'drizzle-orm'
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

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`
const destination = '+12025550123'
const programVersion = 'repair_updates_v1'
const disclosureHash = 'a'.repeat(64)
const keyRing: FingerprintKeyRing = Object.freeze({
  currentVersion: 'key_v2',
  keys: Object.freeze({
    key_v2: 'current-shop-key-material-that-is-at-least-32-bytes',
    key_v1: 'legacy-shop-key-material-that-is-at-least-32-bytes',
  }),
})
const disclosureSnapshot = Object.freeze({
  programVersion,
  senderIdentity: 'North Shop',
  messagePurpose: 'transactional_repair_updates',
  variableFrequency: true,
  messageDataRates: true,
  stopInstructions: true,
  helpInstructions: true,
  noPurchaseCondition: true,
  smsTermsUrl: 'https://example.test/sms-terms',
  privacyUrl: 'https://example.test/privacy',
})
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
  const signedConsent = (
    actor: MessagingActor,
    targetCustomerId = customerId,
    overrides: Partial<Parameters<typeof recordMessagingConsentEvent>[0]> = {},
  ) => recordMessagingConsentEvent({
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

  const eligibility = (targetCustomerId = customerId, targetShopId = shopId) =>
    getMessagingEligibility({
      db,
      shopId: targetShopId,
      customerId: targetCustomerId,
      destination,
      programVersion,
      keyRing,
    })

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
      occurredAt: new Date(Number.NaN),
    })).toEqual({ ok: false, error: 'invalid_input' })
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
    expect(await signedConsent(otherOwner, otherShopCustomerId)).toMatchObject({ ok: true })

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
    const retry = await signedConsent(owner, customerId, { requestKey: stableKey })
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

  it('requires a later full-disclosure re-consent before lifting suppression', async () => {
    await signedConsent(owner)
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
})
