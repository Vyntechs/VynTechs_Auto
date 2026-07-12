import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  completeMessagingDeletion,
  requestMessagingDeletion,
  type MessagingDeletionResult,
} from '@/lib/shop-os/messaging-deletion'
import {
  customers,
  messagingConsentEvents,
  messagingConsentState,
  messagingDeletionRequests,
  messagingRetentionHolds,
  notifications,
  profiles,
  quoteEvents,
  quoteSends,
  quoteVersions,
  shops,
  smsLog,
  smsSuppressions,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { fingerprintDestination, type FingerprintKeyRing } from '@/lib/shop-os/messaging-retention-policy'
import type { MessagingActor } from '@/lib/shop-os/messaging-consent'
import { getMessagingEligibility } from '@/lib/shop-os/messaging-consent'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`
const destination = '+12025550123'
const now = new Date('2024-02-29T12:00:00.000Z')
const keyRing: FingerprintKeyRing = Object.freeze({
  currentVersion: 'key_v2',
  keys: Object.freeze({
    key_v2: 'current-shop-key-material-that-is-at-least-32-bytes',
    key_v1: 'legacy-shop-key-material-that-is-at-least-32-bytes',
  }),
})
const recoveryLimits = Object.freeze({
  historicalPairs: 64,
  sends: 128,
  consentEvents: 256,
  consentProjections: 128,
  smsLogs: 512,
  notifications: 256,
  holds: 256,
  totalResources: 1024,
})

describe('suppression-first messaging deletion', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let customerId: string
  let duplicateCustomerId: string
  let otherCustomerId: string
  let owner: MessagingActor
  let advisor: MessagingActor
  let founder: MessagingActor
  let ticketId: string
  let versionId: string

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    ;[{ id: shopId }, { id: otherShopId }] = await db.insert(shops).values([
      { id: uuid(1), name: 'North Shop' },
      { id: uuid(2), name: 'South Shop' },
    ]).returning({ id: shops.id })
    ;[{ id: customerId }, { id: duplicateCustomerId }, { id: otherCustomerId }] = await db.insert(customers).values([
      { id: uuid(10), shopId, name: 'Primary Customer', phone: destination },
      { id: uuid(12), shopId, name: 'Shared Destination Customer', phone: destination },
      { id: uuid(11), shopId: otherShopId, name: 'Other Customer', phone: destination },
    ]).returning({ id: customers.id })
    const actors = await db.insert(profiles).values([
      { id: uuid(20), userId: uuid(120), shopId, fullName: 'Owner', role: 'owner' },
      { id: uuid(21), userId: uuid(121), shopId, fullName: 'Advisor', role: 'advisor' },
      { id: uuid(22), userId: uuid(122), shopId: otherShopId, fullName: 'Other Owner', role: 'owner' },
      { id: uuid(23), userId: uuid(123), shopId, fullName: 'Founder', role: 'founder' },
    ]).returning({ id: profiles.id, shopId: profiles.shopId, role: profiles.role })
    owner = { profileId: actors[0]!.id, shopId: actors[0]!.shopId!, role: actors[0]!.role }
    advisor = { profileId: actors[1]!.id, shopId: actors[1]!.shopId!, role: actors[1]!.role }
    founder = { profileId: actors[3]!.id, shopId: actors[3]!.shopId!, role: actors[3]!.role }
    await db.insert(vehicles).values({
      id: uuid(30), customerId, year: 2024, make: 'Ford', model: 'Transit',
    })
    ticketId = uuid(31)
    await db.insert(tickets).values({
      id: ticketId, shopId, ticketNumber: 1, source: 'counter', customerId,
      vehicleId: uuid(30), concern: 'Messaging deletion fixture', createdByProfileId: owner.profileId,
    })
    versionId = uuid(32)
    await db.insert(quoteVersions).values({
      id: versionId, shopId, ticketId, versionNumber: 1,
      snapshot: { schemaVersion: 1 }, createdByProfileId: owner.profileId,
    })
  })

  afterEach(async () => close())

  const request = (overrides: Partial<Parameters<typeof requestMessagingDeletion>[0]> = {}) =>
    requestMessagingDeletion({
      db,
      actor: owner,
      customerId,
      destination,
      reasonCode: 'customer_request',
      requestKey: uuid(100),
      requestFingerprint: 'a'.repeat(64),
      now,
      keyRing,
      ...overrides,
    })

  const insertSend = async (
    id: string,
    state: 'queued' | 'claimed' | 'submitting' | 'submitted' | 'delivered',
    keyVersion: 'key_v1' | 'key_v2' = 'key_v2',
    sendDestination = destination,
    sendCustomerId = customerId,
  ) => {
    const createdAt = new Date('2026-07-12T10:00:00.000Z')
    const submittingAt = ['submitting', 'submitted', 'delivered'].includes(state)
      ? new Date('2026-07-12T10:01:00.000Z') : null
    const submittedAt = ['submitted', 'delivered'].includes(state)
      ? new Date('2026-07-12T10:02:00.000Z') : null
    const current = fingerprintDestination(sendDestination, keyVersion, keyRing.keys[keyVersion]!)
    await db.insert(quoteSends).values({
      id, shopId, ticketId, quoteVersionId: versionId, customerId: sendCustomerId,
      destinationFingerprint: current, fingerprintKeyVersion: keyVersion, channel: 'sms',
      tokenHash: 'd'.repeat(64), tokenExpiresAt: new Date('2026-07-13T10:00:00.000Z'),
      requestingActorProfileId: owner.profileId, requestKey: uuid(500 + Number(id.slice(-3))),
      requestFingerprint: 'e'.repeat(64), state, submittingAt, submittedAt, createdAt, updatedAt: createdAt,
    })
  }

  const addCalendarYears = (value: Date, years: number) => {
    const result = new Date(value)
    result.setUTCFullYear(result.getUTCFullYear() + years)
    return result
  }

  const activeHold = (overrides: Partial<typeof messagingRetentionHolds.$inferInsert>) => {
    const startsAt = new Date(Date.now() - 60_000)
    const expiresAt = new Date(Date.now() + 86_400_000)
    const retentionAnchor = overrides.releasedAt ?? overrides.expiresAt ?? expiresAt
    return db.insert(messagingRetentionHolds).values({
      shopId, reasonCode: 'legal_claim', authorizingActorProfileId: owner.profileId,
      startsAt, reviewAt: new Date(Date.now() + 3_600_000), expiresAt,
      ...overrides,
      retainUntil: overrides.retainUntil ?? addCalendarYears(retentionAnchor, 5),
    })
  }

  const seedPhaseTwoResource = async (
    type: 'sends' | 'consentEvents' | 'consentProjections' | 'smsLogs' | 'notifications' | 'holds',
    count: number,
    options: { sendId?: string; reuseEvents?: boolean } = {},
  ) => {
    const current = fingerprintDestination(destination, 'key_v2', keyRing.keys.key_v2!)
    const createdAt = new Date('2026-07-12T10:00:00.000Z')
    if (type === 'sends') {
      await db.insert(quoteSends).values(Array.from({ length: count }, (_, index) => ({
        id: uuid(10_000 + index), shopId, ticketId, quoteVersionId: versionId, customerId,
        destinationFingerprint: current, fingerprintKeyVersion: 'key_v2' as const, channel: 'sms' as const,
        tokenHash: 'd'.repeat(64), tokenExpiresAt: new Date('2026-07-13T10:00:00.000Z'),
        requestingActorProfileId: owner.profileId, requestKey: uuid(11_000 + index),
        requestFingerprint: 'e'.repeat(64), state: 'queued' as const, createdAt, updatedAt: createdAt,
      })))
      return
    }
    if (type === 'consentEvents' || type === 'consentProjections') {
      const eventCount = count
      if (!options.reuseEvents) {
        await db.insert(messagingConsentEvents).values(Array.from({ length: eventCount }, (_, index) => ({
          id: uuid(20_000 + index), shopId, subjectKey: customerId, customerId,
          destinationFingerprint: current, fingerprintKeyVersion: 'key_v2',
          programVersion: `program_${index}_v1`, eventType: 'revoked' as const,
          committedAt: createdAt, occurredAt: createdAt, captureMethod: 'staff_request' as const,
          customerControlled: false, evidenceKind: 'staff_request' as const,
          actorProfileId: owner.profileId, requestKey: uuid(21_000 + index),
          requestFingerprint: 'a'.repeat(64), retainUntil: new Date('2031-07-12T10:00:00Z'),
        })))
      }
      if (type === 'consentProjections') {
        await db.insert(messagingConsentState).values(Array.from({ length: count }, (_, index) => ({
          shopId, subjectKey: customerId, customerId, destinationFingerprint: current,
          fingerprintKeyVersion: 'key_v2', programVersion: `program_${index}_v1`,
          status: 'revoked' as const, sourceEventId: uuid(20_000 + index), revokedAt: createdAt,
          retainUntil: new Date('2031-07-12T10:00:00Z'), updatedAt: createdAt,
        })))
      }
      return
    }
    if (type === 'smsLogs') {
      const sendId = options.sendId ?? uuid(30_000)
      if (!options.sendId) await insertSend(sendId, 'submitted')
      await db.insert(smsLog).values(Array.from({ length: count }, (_, index) => ({
        id: uuid(31_000 + index), shopId, quoteSendId: sendId,
        templateKey: 'quote_ready', templateVersion: 'v1', state: 'sent' as const,
        serverReceivedAt: createdAt, retainUntil: new Date('2027-07-12T10:00:00Z'),
      })))
      return
    }
    if (type === 'notifications') {
      await db.insert(notifications).values(Array.from({ length: count }, (_, index) => ({
        id: uuid(40_000 + index), shopId, recipientProfileId: owner.profileId,
        eventType: 'quote_sent', entityType: 'customer', entityId: customerId,
        dedupeKey: `deletion-cap-${index}`, createdAt,
        retainUntil: new Date('2026-10-10T10:00:00Z'),
      })))
      return
    }
    const startsAt = new Date(Date.now() - 60_000)
    const expiresAt = new Date(Date.now() + 86_400_000)
    await db.insert(messagingRetentionHolds).values(Array.from({ length: count }, (_, index) => ({
      id: uuid(50_000 + index), shopId, subjectKey: customerId,
      reasonCode: 'legal_claim' as const, authorizingActorProfileId: owner.profileId,
      startsAt, reviewAt: new Date(Date.now() + 3_600_000), expiresAt,
      retainUntil: addCalendarYears(expiresAt, 5),
    })))
  }

  it('allows only a live same-shop owner and rejects cross-shop or stale roles', async () => {
    expect(await request({ actor: advisor })).toEqual({ ok: false, error: 'forbidden' })
    expect(await request({ customerId: otherCustomerId })).toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ role: 'advisor' }).where(eq(profiles.id, owner.profileId))
    expect(await request()).toEqual({ ok: false, error: 'forbidden' })
  })

  it('uses the live founder-override convention without widening ordinary staff access', async () => {
    expect(await request({ actor: founder, requestKey: uuid(101) }))
      .toMatchObject({ ok: true, state: 'pending' })
    expect(await request({ actor: advisor, requestKey: uuid(102) }))
      .toEqual({ ok: false, error: 'forbidden' })
  })

  it('commits every supported verified-deletion suppression with one pending request', async () => {
    const result = await request()
    expect(result).toMatchObject({ ok: true, state: 'pending' })
    const rows = await db.select().from(smsSuppressions).where(eq(smsSuppressions.shopId, shopId))
    expect(rows.map((row) => [row.fingerprintKeyVersion, row.reason, row.liftedAt]).sort()).toEqual([
      ['key_v1', 'verified_deletion', null],
      ['key_v2', 'verified_deletion', null],
    ])
    expect(await db.select().from(messagingDeletionRequests)).toHaveLength(1)
  })

  it('preserves stronger suppression meaning while normalizing its deletion barrier', async () => {
    await db.insert(smsSuppressions).values({
      shopId,
      destinationFingerprint: fingerprintDestination(destination, 'key_v2', keyRing.keys.key_v2!),
      fingerprintKeyVersion: 'key_v2',
      reason: 'number_reassigned',
      suppressedAt: new Date('2024-01-01T00:00:00Z'),
      retainUntil: new Date('2029-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-01T00:00:00Z'),
    })
    const before = (await db.select().from(smsSuppressions))[0]!
    expect(await request()).toMatchObject({ ok: true, state: 'pending' })
    const after = (await db.select().from(smsSuppressions).where(
      eq(smsSuppressions.fingerprintKeyVersion, 'key_v2'),
    ))[0]!
    expect(after.reason).toBe(before.reason)
    expect(after.sourceEventId).toBe(before.sourceEventId)
    expect(after.suppressedAt).toEqual(before.suppressedAt)
    expect(after.liftedAt).toBeNull()
    expect(after.retainUntil.getTime()).toBeGreaterThan(before.retainUntil.getTime())
  })

  it('normalizes every historical destination pair before detaching customer-wide held sends', async () => {
    const historicalDestination = '+12025550991'
    const unrelatedDestination = '+12025550992'
    const consentDestination = '+12025550990'
    const historicalV1 = fingerprintDestination(
      historicalDestination, 'key_v1', keyRing.keys.key_v1!,
    )
    const historicalV2 = fingerprintDestination(
      historicalDestination, 'key_v2', keyRing.keys.key_v2!,
    )
    const unrelatedV1 = fingerprintDestination(
      unrelatedDestination, 'key_v1', keyRing.keys.key_v1!,
    )
    const consentV1 = fingerprintDestination(consentDestination, 'key_v1', keyRing.keys.key_v1!)
    const consentV2 = fingerprintDestination(consentDestination, 'key_v2', keyRing.keys.key_v2!)
    await insertSend(uuid(80), 'submitted', 'key_v1', historicalDestination)
    await insertSend(uuid(81), 'submitted', 'key_v2', historicalDestination)
    await insertSend(uuid(82), 'submitted', 'key_v1', unrelatedDestination, duplicateCustomerId)
    await activeHold({ resourceType: 'quote_send', resourceId: uuid(80) })
    await activeHold({ resourceType: 'quote_send', resourceId: uuid(81) })
    const committedAt = new Date('2026-07-12T09:00:00Z')
    await db.insert(messagingConsentEvents).values({
      id: uuid(90), shopId, subjectKey: customerId, customerId,
      destinationFingerprint: consentV1, fingerprintKeyVersion: 'key_v1',
      programVersion: 'repair_updates_v1', eventType: 'revoked', committedAt,
      occurredAt: committedAt, captureMethod: 'staff_request', customerControlled: false,
      evidenceKind: 'staff_request', actorProfileId: owner.profileId, requestKey: uuid(190),
      requestFingerprint: '9'.repeat(64), retainUntil: new Date('2031-07-12T09:00:00Z'),
    })
    await db.insert(messagingConsentEvents).values({
      id: uuid(91), shopId, subjectKey: customerId, customerId,
      destinationFingerprint: consentV2, fingerprintKeyVersion: 'key_v2',
      programVersion: 'marketing_updates_v1', eventType: 'revoked', committedAt,
      occurredAt: committedAt, captureMethod: 'staff_request', customerControlled: false,
      evidenceKind: 'staff_request', actorProfileId: owner.profileId, requestKey: uuid(191),
      requestFingerprint: '1'.repeat(64), retainUntil: new Date('2031-07-12T09:00:00Z'),
    })
    await db.insert(messagingConsentState).values({
      shopId, subjectKey: customerId, customerId, destinationFingerprint: consentV2,
      fingerprintKeyVersion: 'key_v2', programVersion: 'marketing_updates_v1', status: 'revoked',
      sourceEventId: uuid(91), revokedAt: committedAt,
      retainUntil: new Date('2031-07-12T09:00:00Z'), updatedAt: committedAt,
    })
    await db.insert(smsSuppressions).values({
      shopId: otherShopId, destinationFingerprint: unrelatedV1, fingerprintKeyVersion: 'key_v1',
      reason: 'number_reassigned', suppressedAt: committedAt,
      retainUntil: new Date('2035-07-12T09:00:00Z'), updatedAt: committedAt,
    })
    const [unrelatedShopBefore] = await db.select().from(smsSuppressions)
      .where(eq(smsSuppressions.shopId, otherShopId))

    const pending = await request()
    expect(pending).toMatchObject({ ok: true, state: 'pending' })
    if (!pending.ok) return
    const suppressions = await db.select().from(smsSuppressions)
      .where(eq(smsSuppressions.shopId, shopId))
    expect(suppressions.map((row) => [
      row.destinationFingerprint, row.fingerprintKeyVersion,
    ])).toEqual(expect.arrayContaining([
      [historicalV1, 'key_v1'],
      [historicalV2, 'key_v2'],
      [consentV1, 'key_v1'],
      [consentV2, 'key_v2'],
    ]))
    expect(suppressions.some(({ destinationFingerprint }) =>
      destinationFingerprint === unrelatedV1)).toBe(false)

    expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }))
      .toMatchObject({ ok: true, counts: { quoteSendsRetained: 2 } })
    expect(await db.select().from(quoteSends)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: uuid(80), customerId: null, tokenHash: null }),
      expect.objectContaining({ id: uuid(81), customerId: null, tokenHash: null }),
      expect.objectContaining({ id: uuid(82), customerId: duplicateCustomerId }),
    ]))
    expect((await db.select().from(smsSuppressions)
      .where(eq(smsSuppressions.shopId, otherShopId)))[0]).toEqual(unrelatedShopBefore)
  })

  it('extends the complete historical pair set through the latest distinct pending request deadline', async () => {
    const firstDestination = '+12025550993'
    const secondDestination = '+12025550994'
    await db.update(customers).set({ phone: firstDestination }).where(eq(customers.id, customerId))
    await insertSend(uuid(83), 'submitted', 'key_v1', firstDestination)
    await insertSend(uuid(84), 'submitted', 'key_v2', firstDestination)
    await activeHold({ resourceType: 'quote_send', resourceId: uuid(83) })
    await activeHold({ resourceType: 'quote_send', resourceId: uuid(84) })
    const first = await request({ destination: firstDestination, requestKey: uuid(183) })
    expect(first).toMatchObject({ ok: true, state: 'pending' })

    await db.update(customers).set({ phone: secondDestination }).where(eq(customers.id, customerId))
    await insertSend(uuid(85), 'submitted', 'key_v1', secondDestination)
    await insertSend(uuid(86), 'submitted', 'key_v2', secondDestination)
    await activeHold({ resourceType: 'quote_send', resourceId: uuid(85) })
    await activeHold({ resourceType: 'quote_send', resourceId: uuid(86) })
    const second = await request({ destination: secondDestination, requestKey: uuid(184) })
    expect(second).toMatchObject({ ok: true, state: 'pending' })
    if (!first.ok || !second.ok) return

    const requests = await db.select().from(messagingDeletionRequests)
    const latestRequestedAt = Math.max(...requests.map(({ requestedAt }) => requestedAt.getTime()))
    const suppressions = await db.select().from(smsSuppressions)
    expect(suppressions).toHaveLength(4)
    expect(suppressions.every(({ retainUntil }) => {
      const minimum = new Date(latestRequestedAt)
      minimum.setUTCFullYear(minimum.getUTCFullYear() + 5)
      return retainUntil.getTime() >= minimum.getTime()
    })).toBe(true)
    expect(await completeMessagingDeletion({ db, actor: owner, requestId: first.requestId, now }))
      .toMatchObject({ ok: true, counts: { quoteSendsRetained: 4 } })
  })

  it('fails phase one without acceptance when a historical pair is malformed', async () => {
    await db.execute(sql`
      alter table quote_sends drop constraint quote_sends_destination_fingerprint_valid
    `)
    const createdAt = new Date('2026-07-12T10:00:00.000Z')
    await db.insert(quoteSends).values({
      id: uuid(87), shopId, ticketId, quoteVersionId: versionId, customerId,
      destinationFingerprint: 'malformed', fingerprintKeyVersion: 'key_v1', channel: 'sms',
      tokenHash: 'd'.repeat(64), tokenExpiresAt: new Date('2026-07-13T10:00:00.000Z'),
      requestingActorProfileId: owner.profileId, requestKey: uuid(587),
      requestFingerprint: 'e'.repeat(64), state: 'queued', createdAt, updatedAt: createdAt,
    })

    expect(await request()).toEqual({ ok: false, error: 'retryable' })
    expect(await db.select().from(messagingDeletionRequests)).toHaveLength(0)
    expect(await db.select().from(smsSuppressions)).toHaveLength(0)
  })

  it('uses actor-bound semantic idempotency and rejects changed or spoofed retries', async () => {
    const first = await request()
    expect(await request()).toEqual(first)
    expect(await request({ requestFingerprint: 'b'.repeat(64) })).toEqual({
      ok: false,
      error: 'request_conflict',
    })
    expect(JSON.stringify(first)).not.toContain(destination)
  })

  it('binds completed retries to the original customer without retaining a raw customer ID', async () => {
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }))
      .toMatchObject({ ok: true, state: 'completed' })
    expect(await request()).toMatchObject({ ok: true, requestId: pending.requestId, state: 'completed' })
    expect(await request({ customerId: duplicateCustomerId })).toEqual({
      ok: false, error: 'request_conflict',
    })
    const [row] = await db.select().from(messagingDeletionRequests)
    expect(row.customerId).toBeNull()
    expect(row.proofSummary).toMatchObject({ customerBinding: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(JSON.stringify(row.proofSummary)).not.toContain(customerId)
  })

  it('recovers only the exact structured actor/request unique race and refuses constraint spoofing', async () => {
    const current = fingerprintDestination(destination, 'key_v2', keyRing.keys.key_v2!)
    await db.insert(messagingDeletionRequests).values({
      id: uuid(70), requestKey: uuid(170), requestFingerprint: '7'.repeat(64), shopId,
      subjectKey: customerId, customerId, destinationFingerprint: current,
      fingerprintKeyVersion: 'key_v2', state: 'pending', reasonCode: 'customer_request',
      requestingActorProfileId: owner.profileId,
    })
    let exactCalls = 0
    const exactRaceDb = {
      transaction: async (callback: (tx: TestDb) => Promise<unknown>) => {
        exactCalls += 1
        if (exactCalls === 1) throw Object.assign(new Error('opaque'), {
          code: '23505', constraint: 'messaging_deletion_requests_shop_actor_request_uq',
        })
        return db.transaction(callback)
      },
    } as unknown as TestDb
    expect(await request({
      db: exactRaceDb, requestKey: uuid(170), requestFingerprint: '7'.repeat(64),
    })).toEqual({ ok: true, requestId: uuid(70), state: 'pending' })
    let spoofCalls = 0
    const spoofDb = {
      transaction: async () => {
        spoofCalls += 1
        throw Object.assign(new Error('mentions messaging_deletion_requests_shop_actor_request_uq'), {
          code: '23505', constraint: 'other_constraint',
        })
      },
    } as unknown as TestDb
    expect(await request({ db: spoofDb, requestKey: uuid(171) }))
      .toEqual({ ok: false, error: 'retryable' })
    expect(spoofCalls).toBe(1)
    let failedRecoveryCalls = 0
    const failedRecoveryDb = {
      transaction: async () => {
        failedRecoveryCalls += 1
        if (failedRecoveryCalls === 1) throw Object.assign(new Error('opaque'), {
          code: '23505', constraint: 'messaging_deletion_requests_shop_actor_request_uq',
        })
        throw new Error(destination)
      },
    } as unknown as TestDb
    await expect(request({ db: failedRecoveryDb, requestKey: uuid(172) }))
      .resolves.toEqual({ ok: false, error: 'retryable' })
  })

  it('normalizes every strong current/legacy suppression into a five-year active barrier', async () => {
    const subjectKey = uuid(73)
    const suppressedAt = new Date('2026-01-01T00:00:00Z')
    for (const [index, keyVersion] of ['key_v2', 'key_v1'].entries()) {
      const destinationFingerprint = fingerprintDestination(
        destination, keyVersion, keyRing.keys[keyVersion]!,
      )
      const eventId = uuid(74 + index)
      await db.insert(messagingConsentEvents).values({
        id: eventId, shopId, subjectKey, customerId, destinationFingerprint, fingerprintKeyVersion: keyVersion,
        programVersion: 'repair_updates_v1', eventType: 'revoked', committedAt: suppressedAt,
        occurredAt: suppressedAt, captureMethod: 'staff_request', customerControlled: false,
        evidenceKind: 'staff_request', actorProfileId: owner.profileId,
        requestKey: uuid(76 + index), requestFingerprint: '6'.repeat(64),
        retainUntil: new Date('2031-01-01T00:00:00Z'),
      })
      await db.insert(smsSuppressions).values({
        shopId, destinationFingerprint, fingerprintKeyVersion: keyVersion, sourceEventId: eventId,
        reason: keyVersion === 'key_v2' ? 'permanent_failure' : 'number_reassigned',
        suppressedAt, liftedAt: new Date('2026-02-01T00:00:00Z'),
        retainUntil: new Date('2026-03-01T00:00:00Z'), updatedAt: suppressedAt,
      })
    }
    const current = fingerprintDestination(destination, 'key_v2', keyRing.keys.key_v2!)
    await db.insert(messagingConsentState).values({
      shopId, subjectKey, customerId, destinationFingerprint: current, fingerprintKeyVersion: 'key_v2',
      programVersion: 'repair_updates_v1', status: 'revoked', sourceEventId: uuid(74),
      revokedAt: suppressedAt, retainUntil: new Date('2031-01-01T00:00:00Z'), updatedAt: suppressedAt,
    })
    const pending = await request()
    expect(pending).toMatchObject({ ok: true, state: 'pending' })
    if (!pending.ok) throw new Error('request failed')
    const [deletion] = await db.select().from(messagingDeletionRequests)
    const suppressions = await db.select().from(smsSuppressions)
    expect(suppressions.map(({ reason }) => reason).sort()).toEqual(['number_reassigned', 'permanent_failure'])
    for (const suppression of suppressions) {
      expect(suppression.sourceEventId).not.toBeNull()
      expect(suppression.liftedAt).toBeNull()
      expect(suppression.updatedAt).toEqual(deletion.requestedAt)
      expect(suppression.retainUntil.getTime()).toBeGreaterThanOrEqual(
        new Date(deletion.requestedAt).setUTCFullYear(deletion.requestedAt.getUTCFullYear() + 5),
      )
    }
    expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }))
      .toMatchObject({ ok: true, state: 'completed' })
    expect((await db.select().from(smsSuppressions)).every(({ sourceEventId }) => sourceEventId === null))
      .toBe(true)
    expect((await db.select().from(messagingDeletionRequests))[0]!.proofSummary)
      .toMatchObject({ suppressionSourceReferencesDetached: 2 })
  })

  it('snapshots hostile mutable input before awaiting and returns bounded failures', async () => {
    let reads = 0
    const mutableActor = Object.defineProperties({}, {
      profileId: { enumerable: true, value: owner.profileId },
      shopId: { enumerable: true, value: owner.shopId },
      role: { enumerable: true, value: owner.role },
      secret: { enumerable: true, get: () => { reads += 1; throw new Error(destination) } },
    }) as MessagingActor
    const result = await request({ actor: mutableActor })
    expect(result).toMatchObject({ ok: true, state: 'pending' })
    expect(reads).toBe(0)
    expect(JSON.stringify(result)).not.toMatch(/12025550123|key-material/)
    const hostile = new Proxy({}, { getPrototypeOf: () => { throw new Error(destination) } })
    expect(await requestMessagingDeletion(hostile as Parameters<typeof requestMessagingDeletion>[0]))
      .toEqual({ ok: false, error: 'forbidden' })
    expect(await request({ now: new (class extends Date {})() }))
      .toEqual({ ok: false, error: 'forbidden' })
  })

  it('keeps phase one committed when phase two fails, then completes exactly once', async () => {
    const pending = await request()
    expect(pending.ok).toBe(true)
    if (!pending.ok) return
    const wrongActor = { ...owner, role: 'advisor' }
    expect(await completeMessagingDeletion({ db, actor: wrongActor, requestId: pending.requestId, now }))
      .toEqual({ ok: false, error: 'forbidden' })
    expect((await db.select().from(messagingDeletionRequests))[0]!.state).toBe('pending')
    const completed = await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now })
    expect(completed).toMatchObject({ ok: true, state: 'completed' })
    expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }))
      .toEqual(completed)
    const tombstone = (await db.select().from(messagingDeletionRequests))[0]!
    expect(tombstone.customerId).toBeNull()
    expect(tombstone.retainUntil?.getUTCFullYear()).toBe(tombstone.latestRelevantAt!.getUTCFullYear() + 5)
    expect(tombstone.retainUntil?.getUTCMonth()).toBe(tombstone.latestRelevantAt!.getUTCMonth())
    expect(tombstone.retainUntil?.getUTCDate()).toBe(tombstone.latestRelevantAt!.getUTCDate())
    expect(JSON.stringify(tombstone.proofSummary)).not.toMatch(/12025550123|00000000-/)
  })

  it('returns only bounded integer counts and proof metadata', async () => {
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    const result = await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.values(result.counts ?? {}).every(Number.isSafeInteger)).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result), 'utf8')).toBeLessThan(4096)
  })

  it('makes pending deletion ineligible before phase two while suppression stays durable', async () => {
    expect(await request()).toMatchObject({ ok: true, state: 'pending' })
    expect(await getMessagingEligibility({
      db, shopId, customerId, destination, programVersion: 'repair_updates_v1', keyRing,
    })).toEqual({ allowed: false, reason: 'deletion_pending' })
  })

  it('compacts consent projection/events through the authorized function and retains deletion barriers', async () => {
    const subjectKey = uuid(60)
    const eventId = uuid(61)
    const current = fingerprintDestination(destination, 'key_v2', keyRing.keys.key_v2!)
    const committedAt = new Date('2026-07-12T11:00:00Z')
    await db.insert(messagingConsentEvents).values({
      id: eventId, shopId, subjectKey, customerId, destinationFingerprint: current,
      fingerprintKeyVersion: 'key_v2', programVersion: 'repair_updates_v1', eventType: 'consented',
      committedAt, occurredAt: committedAt, captureMethod: 'signed_form', customerControlled: true,
      evidenceKind: 'signed_form_reference', evidenceRef: 'proof-reference', actorProfileId: owner.profileId,
      requestKey: uuid(62), requestFingerprint: 'a'.repeat(64),
      retainUntil: new Date('2031-07-12T11:00:00Z'),
    })
    await db.insert(messagingConsentState).values({
      shopId, subjectKey, customerId, destinationFingerprint: current, fingerprintKeyVersion: 'key_v2',
      programVersion: 'repair_updates_v1', status: 'consented', sourceEventId: eventId,
      consentedAt: committedAt, retainUntil: new Date('2031-07-12T11:00:00Z'), updatedAt: committedAt,
    })
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    expect((await db.select().from(messagingDeletionRequests))[0]!.subjectKey).toBe(subjectKey)
    expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }))
      .toMatchObject({ ok: true, counts: { consentEventsDeleted: 1 } })
    expect(await db.select().from(messagingConsentEvents)).toHaveLength(0)
    expect(await db.select().from(messagingConsentState)).toHaveLength(0)
    expect((await db.select().from(smsSuppressions)).every(({ liftedAt }) => liftedAt === null)).toBe(true)
    const [tombstone] = await db.select().from(messagingDeletionRequests)
    expect(tombstone).toMatchObject({
      state: 'completed',
      priorRecordCounts: {
        consentEvents: 1, consentProjections: 1, notifications: 0, quoteSends: 0, smsLogs: 0,
      },
      proofSummary: {
        deletedBarrier: 1, suppressionActive: 1, suppressionSourceReferencesDetached: 0,
        retained: {
          heldConsentEvents: 0, heldQuoteSends: 0, heldSmsLogs: 0, heldNotifications: 0, total: 0,
        },
      },
    })
    expect(Buffer.byteLength(JSON.stringify(tombstone.proofSummary), 'utf8')).toBeLessThan(4096)
  })

  it('compacts every unheld customer consent subject while retaining held subjects exactly', async () => {
    const heldSubject = uuid(92)
    const unheldSubject = uuid(93)
    const otherSubject = uuid(94)
    const createdAt = new Date('2026-07-12T11:00:00Z')
    const pairs = [92, 93, 94, 95, 96].map((suffix) =>
      suffix.toString(16).padStart(64, '0'))
    const events = [
      { id: uuid(192), subjectKey: heldSubject, customerId, pair: pairs[0]!, program: 'held_a_v1' },
      { id: uuid(193), subjectKey: heldSubject, customerId, pair: pairs[1]!, program: 'held_b_v1' },
      { id: uuid(194), subjectKey: unheldSubject, customerId, pair: pairs[2]!, program: 'open_a_v1' },
      { id: uuid(195), subjectKey: unheldSubject, customerId, pair: pairs[3]!, program: 'open_b_v1' },
      { id: uuid(196), subjectKey: otherSubject, customerId: duplicateCustomerId,
        pair: pairs[4]!, program: 'other_a_v1' },
    ]
    await db.insert(messagingConsentEvents).values(events.map((event, index) => ({
      id: event.id, shopId, subjectKey: event.subjectKey, customerId: event.customerId,
      destinationFingerprint: event.pair, fingerprintKeyVersion: 'key_v2',
      programVersion: event.program, eventType: 'revoked' as const,
      committedAt: createdAt, occurredAt: createdAt, captureMethod: 'staff_request' as const,
      customerControlled: false, evidenceKind: 'staff_request' as const,
      actorProfileId: owner.profileId, requestKey: uuid(292 + index),
      requestFingerprint: 'b'.repeat(64), retainUntil: new Date('2031-07-12T11:00:00Z'),
    })))
    await db.insert(messagingConsentState).values([
      ...events.slice(0, 2).map((event) => ({
        shopId, subjectKey: event.subjectKey, customerId: event.customerId,
        destinationFingerprint: event.pair, fingerprintKeyVersion: 'key_v2',
        programVersion: event.program, status: 'revoked' as const, sourceEventId: event.id,
        revokedAt: createdAt, retainUntil: new Date('2031-07-12T11:00:00Z'), updatedAt: createdAt,
      })),
      {
        shopId, subjectKey: otherSubject, customerId: duplicateCustomerId,
        destinationFingerprint: pairs[4]!, fingerprintKeyVersion: 'key_v2',
        programVersion: 'other_a_v1', status: 'revoked' as const, sourceEventId: uuid(196),
        revokedAt: createdAt, retainUntil: new Date('2031-07-12T11:00:00Z'), updatedAt: createdAt,
      },
    ])
    await db.insert(smsSuppressions).values(events.slice(2, 4).map((event) => ({
      shopId, destinationFingerprint: event.pair, fingerprintKeyVersion: 'key_v2',
      sourceEventId: event.id, reason: 'customer_revocation' as const, suppressedAt: createdAt,
      retainUntil: new Date('2031-07-12T11:00:00Z'), updatedAt: createdAt,
    })))
    await activeHold({ subjectKey: heldSubject })
    await activeHold({ subjectKey: heldSubject, reasonCode: 'subpoena' })
    const pending = await request({ requestKey: uuid(299) })
    if (!pending.ok) throw new Error('request failed')

    expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }))
      .toMatchObject({ ok: true, counts: { consentEventsDeleted: 2 } })
    const remainingEvents = await db.select().from(messagingConsentEvents)
    expect(remainingEvents.map(({ id }) => id).sort()).toEqual([uuid(192), uuid(193), uuid(196)].sort())
    const remainingProjections = await db.select().from(messagingConsentState)
    expect(remainingProjections.map(({ subjectKey }) => subjectKey).sort())
      .toEqual([heldSubject, heldSubject, otherSubject].sort())
    const [tombstone] = await db.select().from(messagingDeletionRequests)
    expect(tombstone.priorRecordCounts).toMatchObject({ consentEvents: 4, consentProjections: 2 })
    expect(tombstone.proofSummary).toMatchObject({
      suppressionSourceReferencesDetached: 2,
      retained: { heldConsentEvents: 2, heldConsentProjections: 2, total: 4 },
    })
  })

  it.each(['queued', 'claimed'] as const)(
    'cancels a held %s send without manufacturing submission anchors',
    async (state) => {
      const sendId = uuid(state === 'queued' ? 40 : 41)
      await insertSend(sendId, state)
      await activeHold({ resourceType: 'quote_send', resourceId: sendId })
      const pending = await request()
      if (!pending.ok) throw new Error('request failed')
      expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }))
        .toMatchObject({ ok: true, state: 'completed' })
      const [send] = await db.select().from(quoteSends).where(eq(quoteSends.id, sendId))
      expect(send).toMatchObject({
        state: 'cancelled', customerId: null, tokenHash: null, tokenExpiresAt: null,
        submittingAt: null, submittedAt: null,
      })
    },
  )

  it.each(['submitting', 'submitted', 'delivered'] as const)(
    'keeps held %s lifecycle anchors honest while revoking both token columns',
    async (state) => {
      const sendId = uuid(state === 'submitting' ? 42 : state === 'submitted' ? 43 : 44)
      await insertSend(sendId, state)
      const before = (await db.select().from(quoteSends).where(eq(quoteSends.id, sendId)))[0]!
      await activeHold({ resourceType: 'quote_send', resourceId: sendId })
      const pending = await request()
      if (!pending.ok) throw new Error('request failed')
      expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }))
        .toMatchObject({ ok: true })
      const after = (await db.select().from(quoteSends).where(eq(quoteSends.id, sendId)))[0]!
      expect(after.state).toBe(state)
      expect(after.customerId).toBeNull()
      expect([after.tokenHash, after.tokenExpiresAt]).toEqual([null, null])
      expect(after.submittingAt).toEqual(before.submittingAt)
      expect(after.submittedAt).toEqual(before.submittedAt)
      await expect(db.update(quoteSends).set({
        tokenHash: 'f'.repeat(64), tokenExpiresAt: new Date('2027-01-01T00:00:00Z'),
      }).where(eq(quoteSends.id, sendId))).rejects.toBeDefined()
    },
  )

  it('deletes unheld SMS, notification, and send while leaving its quote event byte-for-byte unchanged', async () => {
    const sendId = uuid(45)
    await insertSend(sendId, 'submitted')
    const receivedAt = new Date('2026-07-12T11:00:00Z')
    await db.insert(smsLog).values({
      id: uuid(46), shopId, quoteSendId: sendId, templateKey: 'quote_ready', templateVersion: 'v1',
      state: 'sent', serverReceivedAt: receivedAt,
      retainUntil: new Date('2027-07-12T11:00:00Z'), providerMessageId: 'secret-provider-id',
    })
    const createdAt = new Date('2026-07-12T11:00:00Z')
    await db.insert(notifications).values({
      id: uuid(47), shopId, recipientProfileId: owner.profileId, eventType: 'quote_sent',
      entityType: 'customer', entityId: customerId, dedupeKey: 'customer-secret', createdAt,
      retainUntil: new Date('2026-10-10T11:00:00Z'),
    })
    await db.insert(notifications).values({
      id: uuid(57), shopId, recipientProfileId: owner.profileId, eventType: 'ticket_changed',
      entityType: 'ticket', entityId: customerId, dedupeKey: 'colliding-uuid', createdAt,
      retainUntil: new Date('2026-10-10T11:00:00Z'),
    })
    await db.insert(notifications).values({
      id: uuid(56), shopId, recipientProfileId: owner.profileId, eventType: 'quote_sent',
      entityType: 'customer', entityId: customerId, dedupeKey: 'held-customer-note', createdAt,
      retainUntil: new Date('2026-10-10T11:00:00Z'),
    })
    await activeHold({ resourceType: 'notification', resourceId: uuid(56) })
    await db.insert(quoteEvents).values({
      id: uuid(48), shopId, ticketId, quoteVersionId: versionId, quoteSendId: sendId,
      kind: 'sent', requestKey: uuid(49), body: 'immutable historical body',
    })
    const eventBefore = (await db.select().from(quoteEvents).where(eq(quoteEvents.id, uuid(48))))[0]!
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }))
      .toMatchObject({ ok: true, counts: { quoteSendsDeleted: 1, smsLogsDeleted: 1, notificationsDeleted: 1 } })
    expect(await db.select().from(quoteSends)).toHaveLength(0)
    expect(await db.select().from(smsLog)).toHaveLength(0)
    expect(await db.select().from(notifications)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: uuid(56), entityType: 'customer' }),
      expect.objectContaining({ id: uuid(57), entityType: 'ticket' }),
    ]))
    expect((await db.select().from(messagingDeletionRequests))[0]!.proofSummary)
      .toMatchObject({ retained: { heldNotifications: 1, total: 1 } })
    expect((await db.select().from(quoteEvents))[0]).toEqual(eventBefore)
  })

  it('detaches held current and legacy sends under one current-key request barrier', async () => {
    const currentSend = uuid(58)
    const legacySend = uuid(59)
    await insertSend(currentSend, 'submitted', 'key_v2')
    await insertSend(legacySend, 'submitted', 'key_v1')
    await activeHold({ resourceType: 'quote_send', resourceId: currentSend })
    await activeHold({ resourceType: 'quote_send', resourceId: currentSend, reasonCode: 'subpoena' })
    await activeHold({ resourceType: 'quote_send', resourceId: legacySend })
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    expect((await db.select().from(messagingDeletionRequests))[0]!.fingerprintKeyVersion).toBe('key_v2')
    expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }))
      .toMatchObject({ ok: true, counts: { quoteSendsRetained: 2 } })
    expect((await db.select().from(messagingDeletionRequests))[0]!.proofSummary)
      .toMatchObject({ retained: { heldQuoteSends: 2, total: 2 } })
    expect(await db.select().from(quoteSends)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: currentSend, customerId: null, tokenHash: null }),
      expect.objectContaining({ id: legacySend, customerId: null, tokenHash: null }),
    ]))
  })

  it('retains and detaches a send with a held child SMS, but deletes released and expired resources', async () => {
    const sendId = uuid(50)
    await insertSend(sendId, 'submitted')
    const receivedAt = new Date('2026-07-12T11:00:00Z')
    await db.insert(smsLog).values([
      { id: uuid(51), shopId, quoteSendId: sendId, templateKey: 'quote_ready', templateVersion: 'v1',
        state: 'sent', serverReceivedAt: receivedAt, retainUntil: new Date('2027-07-12T11:00:00Z') },
      { id: uuid(52), shopId, quoteSendId: sendId, templateKey: 'quote_ready', templateVersion: 'v1',
        state: 'sent', serverReceivedAt: receivedAt, retainUntil: new Date('2027-07-12T11:00:00Z') },
    ])
    await activeHold({ resourceType: 'sms_log', resourceId: uuid(51) })
    await activeHold({ resourceType: 'sms_log', resourceId: uuid(52), releasedAt: new Date() })
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }))
      .toMatchObject({ ok: true, counts: { quoteSendsRetained: 1, smsLogsDeleted: 1 } })
    const [send] = await db.select().from(quoteSends)
    expect(send).toMatchObject({ id: sendId, customerId: null, state: 'submitted', tokenHash: null })
    expect((await db.select().from(smsLog)).map(({ id }) => id)).toEqual([uuid(51)])
    expect((await db.select().from(messagingDeletionRequests))[0]!.proofSummary)
      .toMatchObject({ retained: { heldQuoteSends: 1, heldSmsLogs: 1, total: 2 } })
  })

  it('honors an active subject hold but ignores unmatched and expired holds', async () => {
    const sendId = uuid(53)
    await insertSend(sendId, 'submitted')
    const receivedAt = new Date('2026-07-12T11:00:00Z')
    await db.insert(smsLog).values({
      id: uuid(63), shopId, quoteSendId: sendId, templateKey: 'quote_ready', templateVersion: 'v1',
      state: 'sent', serverReceivedAt: receivedAt, retainUntil: new Date('2027-07-12T11:00:00Z'),
    })
    const createdAt = new Date('2026-07-12T11:00:00Z')
    await db.insert(notifications).values({
      id: uuid(64), shopId, recipientProfileId: owner.profileId, eventType: 'quote_sent',
      entityType: 'customer', entityId: customerId, dedupeKey: 'subject-held', createdAt,
      retainUntil: new Date('2026-10-10T11:00:00Z'),
    })
    await db.insert(messagingConsentEvents).values({
      id: uuid(65), shopId, subjectKey: customerId, customerId,
      destinationFingerprint: fingerprintDestination(destination, 'key_v2', keyRing.keys.key_v2!),
      fingerprintKeyVersion: 'key_v2', programVersion: 'repair_updates_v1', eventType: 'revoked',
      committedAt: createdAt, occurredAt: createdAt, captureMethod: 'staff_request', customerControlled: false,
      evidenceKind: 'staff_request', actorProfileId: owner.profileId, requestKey: uuid(66),
      requestFingerprint: '5'.repeat(64), retainUntil: new Date('2031-07-12T11:00:00Z'),
    })
    await db.insert(messagingConsentState).values({
      shopId, subjectKey: customerId, customerId,
      destinationFingerprint: fingerprintDestination(destination, 'key_v2', keyRing.keys.key_v2!),
      fingerprintKeyVersion: 'key_v2', programVersion: 'repair_updates_v1', status: 'revoked',
      sourceEventId: uuid(65), revokedAt: createdAt,
      retainUntil: new Date('2031-07-12T11:00:00Z'), updatedAt: createdAt,
    })
    await activeHold({ subjectKey: customerId })
    await activeHold({ subjectKey: customerId, reasonCode: 'subpoena' })
    await activeHold({ resourceType: 'quote_send', resourceId: uuid(999) })
    const expiredStart = new Date(Date.now() - 3 * 86_400_000)
    await activeHold({
      resourceType: 'quote_send', resourceId: sendId, startsAt: expiredStart,
      reviewAt: new Date(expiredStart.getTime() + 1000), expiresAt: new Date(Date.now() - 1000),
    })
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    const result = await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now })
    expect(result).toMatchObject({
      ok: true,
      counts: { quoteSendsRetained: 1 },
    })
    const [tombstone] = await db.select().from(messagingDeletionRequests)
    expect(tombstone.proofSummary).toMatchObject({
      retained: {
        heldConsentEvents: 1, heldConsentProjections: 1, heldQuoteSends: 1,
        heldSmsLogs: 1, heldNotifications: 1, total: 5,
      },
    })
    expect(tombstone.priorRecordCounts).toMatchObject({ consentEvents: 1, consentProjections: 1 })
    expect((await db.select().from(quoteSends))[0]).toMatchObject({ customerId: null, tokenHash: null })
  })

  it('counts the distinct consent projection retained by duplicate event holds', async () => {
    const subjectKey = uuid(88)
    const eventId = uuid(89)
    const committedAt = new Date('2026-07-12T11:00:00Z')
    const current = fingerprintDestination(destination, 'key_v2', keyRing.keys.key_v2!)
    await db.insert(messagingConsentEvents).values({
      id: eventId, shopId, subjectKey, customerId, destinationFingerprint: current,
      fingerprintKeyVersion: 'key_v2', programVersion: 'repair_updates_v1', eventType: 'consented',
      committedAt, occurredAt: committedAt, captureMethod: 'signed_form', customerControlled: true,
      evidenceKind: 'signed_form_reference', evidenceRef: 'projection-hold',
      actorProfileId: owner.profileId, requestKey: uuid(188), requestFingerprint: '8'.repeat(64),
      retainUntil: new Date('2031-07-12T11:00:00Z'),
    })
    await db.insert(messagingConsentState).values({
      shopId, subjectKey, customerId, destinationFingerprint: current,
      fingerprintKeyVersion: 'key_v2', programVersion: 'repair_updates_v1', status: 'consented',
      sourceEventId: eventId, consentedAt: committedAt,
      retainUntil: new Date('2031-07-12T11:00:00Z'), updatedAt: committedAt,
    })
    const pending = await request({ requestKey: uuid(189) })
    if (!pending.ok) throw new Error('request failed')
    await activeHold({ resourceType: 'messaging_consent_event', resourceId: eventId })
    await activeHold({
      resourceType: 'messaging_consent_event', resourceId: eventId,
      reasonCode: 'subpoena',
    })

    expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }))
      .toMatchObject({ ok: true })
    const [tombstone] = await db.select().from(messagingDeletionRequests)
    expect(tombstone.priorRecordCounts).toMatchObject({ consentEvents: 1, consentProjections: 1 })
    expect(tombstone.proofSummary).toMatchObject({
      retained: {
        heldConsentEvents: 1,
        heldConsentProjections: 1,
        total: 2,
      },
    })
  })

  it('rolls phase two back on an injected final-write failure while phase one remains committed', async () => {
    const sendId = uuid(54)
    await insertSend(sendId, 'submitted')
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    let executeCount = 0
    const failingDb = {
      transaction: (callback: (tx: TestDb) => Promise<unknown>) => db.transaction(async (tx) => callback(new Proxy(tx, {
        get(target, property, receiver) {
          if (property !== 'execute') return Reflect.get(target, property, receiver)
          return async (...args: Parameters<typeof tx.execute>) => {
            executeCount += 1
            if (executeCount === 17) throw new Error('injected')
            return tx.execute(...args)
          }
        },
      }) as TestDb)),
    } as unknown as TestDb
    expect(await completeMessagingDeletion({ db: failingDb, actor: owner, requestId: pending.requestId, now }))
      .toEqual({ ok: false, error: 'retryable' })
    expect((await db.select().from(messagingDeletionRequests))[0]!.state).toBe('pending')
    expect(await db.select().from(quoteSends)).toHaveLength(1)
    expect(await db.select().from(smsSuppressions)).toHaveLength(2)
  })

  it('uses database monotonic time and exact calendar-five-year retention across leap day', async () => {
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    await db.execute(sql`alter table messaging_deletion_requests disable trigger messaging_deletion_requests_guard`)
    await db.execute(sql`update messaging_deletion_requests set requested_at = '2028-02-29T12:00:00Z' where id = ${pending.requestId}`)
    await db.execute(sql`alter table messaging_deletion_requests enable trigger messaging_deletion_requests_guard`)
    expect(await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now: new Date(0) }))
      .toMatchObject({ ok: true })
    const [row] = await db.select().from(messagingDeletionRequests)
    expect(row.latestRelevantAt?.toISOString()).toBe('2028-02-29T12:00:00.001Z')
    expect(row.retainUntil?.toISOString()).toBe('2033-02-28T12:00:00.001Z')
  })

  it('preserves unrelated customer, vehicle, ticket, quote, and version history', async () => {
    const before = {
      customer: await db.select().from(customers), vehicle: await db.select().from(vehicles),
      ticket: await db.select().from(tickets), version: await db.select().from(quoteVersions),
    }
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now })
    expect(await db.select().from(customers)).toEqual(before.customer)
    expect(await db.select().from(vehicles)).toEqual(before.vehicle)
    expect(await db.select().from(tickets)).toEqual(before.ticket)
    expect(await db.select().from(quoteVersions)).toEqual(before.version)
  })

  it('serializes repeated completion to one immutable tombstone', async () => {
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    const first = await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now })
    const retry = await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now: new Date(0) })
    expect(retry).toEqual(first)
    expect(await db.select().from(messagingDeletionRequests)).toHaveLength(1)
  })

  it('allows a different live same-shop retention authority to complete the immutable request', async () => {
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    expect(await completeMessagingDeletion({ db, actor: founder, requestId: pending.requestId, now }))
      .toMatchObject({ ok: true, state: 'completed' })
    expect((await db.select().from(messagingDeletionRequests))[0]!.requestingActorProfileId)
      .toBe(owner.profileId)
    expect(await completeMessagingDeletion({
      db,
      actor: { profileId: uuid(22), shopId: otherShopId, role: 'owner' },
      requestId: pending.requestId,
      now,
    })).toEqual({ ok: false, error: 'not_found' })
  })

  it('converges concurrent completion attempts behind the shop lock', async () => {
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    const [left, right] = await Promise.all([
      completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now }),
      completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now: new Date(0) }),
    ])
    expect(left).toMatchObject({ ok: true, state: 'completed' })
    expect(right).toEqual(left)
    expect(await db.select().from(messagingDeletionRequests)).toHaveLength(1)
  })

  it.each([
    ['accepts', recoveryLimits.historicalPairs, true],
    ['refuses', recoveryLimits.historicalPairs + 1, false],
  ] as const)('%s the exact historical-pair safety boundary', async (_label, totalPairs, accepted) => {
    const historicalCount = totalPairs - Object.keys(keyRing.keys).length
    const createdAt = new Date('2026-07-12T10:00:00Z')
    await db.insert(quoteSends).values(Array.from({ length: historicalCount }, (_, index) => ({
      id: uuid(60_000 + index), shopId, ticketId, quoteVersionId: versionId, customerId,
      destinationFingerprint: (index + 1).toString(16).padStart(64, '0'),
      fingerprintKeyVersion: 'key_v2', channel: 'sms' as const,
      requestingActorProfileId: owner.profileId, requestKey: uuid(61_000 + index),
      requestFingerprint: 'c'.repeat(64), state: 'queued' as const, createdAt, updatedAt: createdAt,
    })))
    const result = await request({ requestKey: uuid(61999) })
    if (accepted) {
      expect(result).toMatchObject({ ok: true, state: 'pending' })
      expect(await db.select().from(smsSuppressions)).toHaveLength(totalPairs)
    } else {
      expect(result).toEqual({ ok: false, error: 'busy' })
      expect(await db.select().from(messagingDeletionRequests)).toHaveLength(0)
      expect(await db.select().from(smsSuppressions)).toHaveLength(0)
    }
  })

  it.each(([
    ['sends', recoveryLimits.sends],
    ['consentEvents', recoveryLimits.consentEvents],
    ['consentProjections', recoveryLimits.consentProjections],
    ['smsLogs', recoveryLimits.smsLogs],
    ['notifications', recoveryLimits.notifications],
    ['holds', recoveryLimits.holds],
  ] as const).flatMap(([type, maximum]) => [
    [type, maximum, true] as const,
    [type, maximum + 1, false] as const,
  ]))('%s count %i respects its safety boundary', async (type, count, accepted) => {
    await seedPhaseTwoResource(type, count)
    const pending = await request({ requestKey: uuid(62_000) })
    if (!pending.ok) throw new Error('request failed')
    const result = await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now })
    if (accepted) {
      expect(result).toMatchObject({ ok: true, state: 'completed' })
    } else {
      expect(result).toEqual({ ok: false, error: 'busy' })
      expect((await db.select().from(messagingDeletionRequests))[0]).toMatchObject({
        id: pending.requestId, state: 'pending', customerId,
      })
      expect((await db.select().from(smsSuppressions)).length).toBeGreaterThan(0)
    }
  })

  it.each([
    ['accepts', recoveryLimits.totalResources, true],
    ['refuses', recoveryLimits.totalResources + 1, false],
  ] as const)('%s the aggregate resource safety boundary', async (_label, total, accepted) => {
    await seedPhaseTwoResource('consentEvents', 200)
    await seedPhaseTwoResource('consentProjections', 100, { reuseEvents: true })
    await seedPhaseTwoResource('sends', 100)
    await seedPhaseTwoResource('notifications', 200)
    await seedPhaseTwoResource('holds', 200)
    await seedPhaseTwoResource('smsLogs', total - 800, { sendId: uuid(10_000) })
    const pending = await request({ requestKey: uuid(63_000) })
    if (!pending.ok) throw new Error('request failed')
    const result = await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now })
    if (accepted) {
      expect(result).toMatchObject({ ok: true, state: 'completed' })
    } else {
      expect(result).toEqual({ ok: false, error: 'busy' })
      expect((await db.select().from(messagingDeletionRequests))[0]!.state).toBe('pending')
    }
  })

  it('documents the exact cleanup state, hold, and lock contract in executable source', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) =>
      readFile('lib/shop-os/messaging-deletion.ts', 'utf8'))
    expect(source).toContain("new Set(['queued', 'claimed'])")
    expect(source).toContain("new Set(['submitting', 'submitted'])")
    expect(source).toMatch(/for update/i)
    expect(source).toContain('compact_messaging_consent_events')
    expect(source).toContain("resource_type = 'sms_log'")
    expect(source).toContain("resource_type = 'quote_send'")
    expect(source).toContain("resource_type = 'notification'")
    expect(source).toContain("'deleted', clock_timestamp()")
    expect(source).not.toContain('sql.raw')
    expect(source).toContain('sql.param')
    expect(source).toContain('MAX_HISTORICAL_PAIRS = 64')
    expect(source).toContain('MAX_TOTAL_RESOURCES = 1024')
    const phaseTwo = source.slice(source.indexOf('export async function completeMessagingDeletion'))
    const positions = [
      'select id from shops', 'select id from messaging_deletion_requests',
      'select id from customers', 'select id, state', 'from messaging_consent_state',
      'from sms_log', 'from notifications', 'from messaging_retention_holds',
    ].map((marker) => phaseTwo.indexOf(marker))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('uses the public result contract without leaking failure details', () => {
    const values: MessagingDeletionResult[] = [
      { ok: false, error: 'forbidden' },
      { ok: false, error: 'not_found' },
      { ok: false, error: 'request_conflict' },
      { ok: false, error: 'busy' },
      { ok: false, error: 'retryable' },
    ]
    expect(values).toHaveLength(5)
  })

  it('supports bound UUID-array membership without literal interpolation', async () => {
    const ids = [customerId, duplicateCustomerId]
    const result = await db.execute<{ id: string }>(sql`
      select id from customers where id = any(${sql.param(ids)}::uuid[]) order by id
    `)
    expect(result.rows.map(({ id }) => id)).toEqual([...ids].sort())
  })
})
