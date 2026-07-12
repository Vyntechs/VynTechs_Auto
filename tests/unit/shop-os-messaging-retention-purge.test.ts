import { readFile } from 'node:fs/promises'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createMessagingRetentionHold,
  purgeExpiredMessagingRecords,
  releaseMessagingRetentionHold,
  type PurgeCounts,
} from '@/lib/shop-os/messaging-retention-purge'
import {
  customers,
  messagingConsentEvents,
  messagingConsentState,
  messagingDeletionRequests,
  messagingRetentionHolds,
  notifications,
  profiles,
  quoteSends,
  quoteVersions,
  shops,
  smsLog,
  smsSuppressions,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import type { MessagingActor } from '@/lib/shop-os/messaging-consent'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`
const start = new Date('2024-02-29T12:00:00.000Z')
const review = new Date('2024-08-01T12:00:00.000Z')
const expiry = new Date('2025-02-28T12:00:00.000Z')
const DAY = 86_400_000

describe('messaging retention holds and bounded purge', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let owner: MessagingActor
  let founder: MessagingActor
  let advisor: MessagingActor
  let notificationId: string
  const customerId = uuid(30)
  const vehicleId = uuid(31)
  const ticketId = uuid(32)
  const quoteVersionId = uuid(33)
  const subjectKey = customerId
  const fingerprint = 'a'.repeat(64)

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values([
      { id: uuid(1), name: 'North Shop' },
      { id: uuid(2), name: 'South Shop' },
    ])
    shopId = uuid(1)
    otherShopId = uuid(2)
    await db.insert(profiles).values([
      { id: uuid(10), userId: uuid(110), shopId, fullName: 'Owner', role: 'owner' },
      { id: uuid(11), userId: uuid(111), shopId, fullName: 'Founder', role: 'founder' },
      { id: uuid(12), userId: uuid(112), shopId, fullName: 'Advisor', role: 'advisor' },
      { id: uuid(13), userId: uuid(113), shopId: otherShopId, fullName: 'Other owner', role: 'owner' },
    ])
    owner = { profileId: uuid(10), shopId, role: 'owner' }
    founder = { profileId: uuid(11), shopId, role: 'founder' }
    advisor = { profileId: uuid(12), shopId, role: 'advisor' }
    await db.insert(customers).values({
      id: customerId, shopId, name: 'Retention customer', phone: '+12025550123',
    })
    await db.insert(vehicles).values({
      id: vehicleId, customerId, year: 2024, make: 'Ford', model: 'Transit',
    })
    await db.insert(tickets).values({
      id: ticketId, shopId, ticketNumber: 1, source: 'counter', customerId, vehicleId,
      concern: 'Retention fixture', createdByProfileId: owner.profileId,
    })
    await db.insert(quoteVersions).values({
      id: quoteVersionId, shopId, ticketId, versionNumber: 1,
      snapshot: { schemaVersion: 1 }, createdByProfileId: owner.profileId,
    })
    notificationId = uuid(20)
    const createdAt = new Date('2020-01-01T00:00:00.000Z')
    await db.insert(notifications).values({
      id: notificationId,
      shopId,
      recipientProfileId: owner.profileId,
      eventType: 'quote_ready',
      entityType: 'customer',
      entityId: uuid(21),
      dedupeKey: 'retention-fixture',
      createdAt,
      retainUntil: new Date('2020-03-31T00:00:00.000Z'),
    })
  })

  afterEach(async () => close())

  const createHold = (
    overrides: Partial<Parameters<typeof createMessagingRetentionHold>[0]> = {},
  ) => createMessagingRetentionHold({
    db,
    actor: owner,
    resourceType: 'notification',
    resourceId: notificationId,
    reasonCode: 'legal_claim',
    startsAt: start,
    reviewAt: review,
    expiresAt: expiry,
    ...overrides,
  })

  const seedTerminalSend = async (sendId = uuid(40), logId?: string) => {
    const createdAt = new Date('2019-01-01T00:00:00.000Z')
    const terminalAt = new Date('2020-01-01T00:00:00.000Z')
    await db.insert(quoteSends).values({
      id: sendId, shopId, ticketId, quoteVersionId, customerId,
      destinationFingerprint: fingerprint, fingerprintKeyVersion: 'key_v1', channel: 'sms',
      requestingActorProfileId: owner.profileId, requestKey: uuid(140 + Number(sendId.slice(-2))),
      requestFingerprint: 'b'.repeat(64), state: 'cancelled', createdAt, terminalAt,
      retainUntil: new Date('2021-01-01T00:00:00.000Z'), updatedAt: terminalAt,
    })
    if (logId) {
      const serverReceivedAt = new Date('2020-01-01T00:00:00.000Z')
      await db.insert(smsLog).values({
        id: logId, shopId, quoteSendId: sendId, templateKey: 'quote_ready',
        templateVersion: 'v1', state: 'delivered', serverReceivedAt,
        retainUntil: new Date('2021-01-01T00:00:00.000Z'),
      })
    }
  }

  const seedConsentChain = async () => {
    const eventId = uuid(50)
    await db.insert(messagingConsentEvents).values({
      id: eventId, shopId, subjectKey, customerId, destinationFingerprint: fingerprint,
      fingerprintKeyVersion: 'key_v1', programVersion: 'program_v1', eventType: 'revoked',
      committedAt: new Date('2015-01-01T00:00:00.000Z'),
      occurredAt: new Date('2015-01-01T00:00:00.000Z'), captureMethod: 'staff_request',
      customerControlled: true, evidenceKind: 'staff_request', actorProfileId: owner.profileId,
      requestKey: uuid(150), requestFingerprint: 'c'.repeat(64),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
    })
    await db.insert(messagingConsentState).values({
      id: uuid(51), shopId, subjectKey, customerId, destinationFingerprint: fingerprint,
      fingerprintKeyVersion: 'key_v1', programVersion: 'program_v1', status: 'revoked',
      sourceEventId: eventId, revokedAt: new Date('2015-01-01T00:00:00.000Z'),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2015-01-01T00:00:00.000Z'),
    })
    await db.insert(smsSuppressions).values({
      id: uuid(52), shopId, destinationFingerprint: fingerprint, fingerprintKeyVersion: 'key_v1',
      sourceEventId: eventId, reason: 'customer_revocation',
      suppressedAt: new Date('2015-01-01T00:00:00.000Z'),
      liftedAt: new Date('2016-01-01T00:00:00.000Z'),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2016-01-01T00:00:00.000Z'),
    })
    return eventId
  }

  it('creates an immutable same-shop resource hold with an exact clamped calendar retention window', async () => {
    const result = await createHold()
    expect(result.ok).toBe(true)
    const [hold] = await db.select().from(messagingRetentionHolds)
    expect(hold).toMatchObject({
      shopId,
      resourceType: 'notification',
      resourceId: notificationId,
      subjectKey: null,
      reasonCode: 'legal_claim',
      authorizingActorProfileId: owner.profileId,
      startsAt: start,
      reviewAt: review,
      expiresAt: expiry,
      retainUntil: new Date('2030-02-28T12:00:00.000Z'),
      releasedAt: null,
    })
  })

  it('validates and locks every canonical polymorphic resource target', async () => {
    await seedTerminalSend(uuid(40), uuid(41))
    await seedConsentChain()
    await db.insert(messagingDeletionRequests).values({
      id: uuid(60), requestKey: uuid(160), requestFingerprint: 'd'.repeat(64),
      shopId, subjectKey, customerId, destinationFingerprint: fingerprint,
      fingerprintKeyVersion: 'key_v1', state: 'pending', reasonCode: 'customer_request',
      requestingActorProfileId: owner.profileId,
    })
    const targets = [
      ['messaging_consent_event', uuid(50)],
      ['sms_suppression', uuid(52)],
      ['quote_send', uuid(40)],
      ['sms_log', uuid(41)],
      ['notification', notificationId],
      ['messaging_deletion_request', uuid(60)],
    ] as const
    for (const [resourceType, resourceId] of targets) {
      expect((await createHold({ resourceType, resourceId })).ok).toBe(true)
    }
    expect(await db.select().from(messagingRetentionHolds)).toHaveLength(targets.length)
  })

  it('permits owner and founder but rechecks live active same-shop authority', async () => {
    expect((await createHold({ actor: advisor })).ok).toBe(false)
    expect((await createHold({ actor: founder })).ok).toBe(true)
    await db.update(profiles).set({ deactivatedAt: start })
      .where((await import('drizzle-orm')).eq(profiles.id, owner.profileId))
    expect((await createHold()).ok).toBe(false)
  })

  it('rejects missing, cross-shop, malformed, dual, and getter-backed targets without invoking getters', async () => {
    expect((await createHold({ resourceId: uuid(999) })).ok).toBe(false)
    expect((await createHold({
      actor: { profileId: uuid(13), shopId: otherShopId, role: 'owner' },
    })).ok).toBe(false)
    expect((await createHold({ subjectKey: uuid(30) })).ok).toBe(false)
    expect((await createHold({ resourceType: undefined, resourceId: undefined })).ok).toBe(false)
    expect((await createHold({ reasonCode: 'free text' as never })).ok).toBe(false)

    let reads = 0
    const hostile = Object.defineProperty({}, 'db', {
      enumerable: true,
      get() { reads += 1; return db },
    })
    expect(await createMessagingRetentionHold(hostile as never)).toEqual({
      ok: false,
      error: 'invalid_input',
    })
    expect(reads).toBe(0)
    expect(await createMessagingRetentionHold(new Proxy({
      db, actor: owner, resourceType: 'notification', resourceId: notificationId,
      reasonCode: 'legal_claim', startsAt: start, reviewAt: review, expiresAt: expiry,
    }, {}) as never)).toEqual({ ok: false, error: 'invalid_input' })
  })

  it.each([
    ['review equals start', { reviewAt: start }],
    ['review after expiry', { reviewAt: new Date(expiry.getTime() + 1) }],
    ['expiry after 365 days', { expiresAt: new Date(start.getTime() + 365 * 86_400_000 + 1) }],
    ['invalid date subclass', { startsAt: new (class extends Date {})(start) }],
  ])('rejects %s', async (_label, overrides) => {
    expect((await createHold(overrides)).ok).toBe(false)
  })

  it('releases once, recalculates from release with calendar leap clamping, and renewal inserts a new row', async () => {
    await db.insert(smsSuppressions).values({
      id: uuid(80), shopId, destinationFingerprint: fingerprint,
      fingerprintKeyVersion: 'key_v1', reason: 'number_reassigned',
      suppressedAt: start, retainUntil: new Date('2030-01-01T00:00:00.000Z'), updatedAt: start,
    })
    const suppressionBefore = (await db.select().from(smsSuppressions))[0]
    const created = await createHold()
    if (!created.ok) throw new Error('hold creation failed')
    const releasedAt = new Date('2024-02-29T18:00:00.000Z')
    expect(await releaseMessagingRetentionHold({ db, actor: owner, holdId: created.holdId, releasedAt }))
      .toEqual({ ok: true })
    expect((await db.select().from(messagingRetentionHolds))[0]).toMatchObject({
      releasedAt,
      retainUntil: new Date('2029-02-28T18:00:00.000Z'),
    })
    expect((await releaseMessagingRetentionHold({
      db, actor: owner, holdId: created.holdId, releasedAt,
    })).ok).toBe(false)
    expect((await createHold()).ok).toBe(true)
    expect(await db.select().from(messagingRetentionHolds)).toHaveLength(2)
    expect((await db.select().from(smsSuppressions))[0]).toEqual(suppressionBefore)
  })

  it('purges the exact edge once, reports private bounded counts, and is idempotent', async () => {
    const atEdge = new Date('2020-03-31T00:00:00.000Z')
    const first = await purgeExpiredMessagingRecords({ db, now: atEdge, batchSize: 1 })
    expect(first).toEqual<PurgeCounts>({
      consentProjections: 0,
      consentEvents: 0,
      suppressions: 0,
      quoteSends: 0,
      smsLog: 0,
      notifications: 1,
      deletionRequests: 0,
      retentionHolds: 0,
      skippedHeld: 0,
      failed: 0,
    })
    expect(Object.values(first).every((value) => Number.isSafeInteger(value) && value >= 0)).toBe(true)
    expect(JSON.stringify(first)).not.toContain(notificationId)
    expect((await purgeExpiredMessagingRecords({ db, now: atEdge, batchSize: 1 })).notifications)
      .toBe(0)
  })

  it('uses one global successful-delete budget and an active exact hold skips only its target', async () => {
    const activeStart = new Date(Date.now() - DAY)
    const activeExpiry = new Date(Date.now() + 2 * DAY)
    expect((await createHold({
      startsAt: activeStart,
      reviewAt: new Date(Date.now() + DAY),
      expiresAt: activeExpiry,
    })).ok).toBe(true)
    const createdAt = new Date('2020-01-01T00:00:00.000Z')
    await db.insert(notifications).values({
      id: uuid(22), shopId, recipientProfileId: owner.profileId,
      eventType: 'quote_ready', entityType: 'customer', entityId: uuid(23),
      dedupeKey: 'unheld-retention-fixture', createdAt,
      retainUntil: new Date('2020-03-31T00:00:00.000Z'),
    })
    const result = await purgeExpiredMessagingRecords({
      db,
      now: new Date(),
      batchSize: 1,
    })
    expect(result.notifications).toBe(1)
    expect(result.skippedHeld).toBe(1)
    expect((await db.select().from(notifications)).map(({ id }) => id)).toEqual([notificationId])
    expect(Object.entries(result).reduce((total, [key, value]) =>
      key === 'skippedHeld' || key === 'failed' ? total : total + value, 0)).toBeLessThanOrEqual(1)
  })

  it('uses the database clock as an upper authority against a future caller time', async () => {
    await purgeExpiredMessagingRecords({
      db, now: new Date('2020-03-31T00:00:00.000Z'), batchSize: 1,
    })
    const createdAt = new Date(Date.now() + DAY)
    await db.insert(notifications).values({
      id: uuid(24), shopId, recipientProfileId: owner.profileId,
      eventType: 'quote_ready', entityType: 'customer', entityId: uuid(25),
      dedupeKey: 'future-retention-fixture', createdAt,
      retainUntil: new Date(createdAt.getTime() + 90 * DAY),
    })
    const result = await purgeExpiredMessagingRecords({
      db, now: new Date(createdAt.getTime() + 365 * DAY), batchSize: 100,
    })
    expect(result.notifications).toBe(0)
    expect(await db.select().from(notifications)).toHaveLength(1)
  })

  it('purges every family in dependency order with exact public counts and definer deletes', async () => {
    await seedTerminalSend(uuid(40), uuid(41))
    await seedConsentChain()
    await db.insert(messagingDeletionRequests).values({
      id: uuid(60), requestKey: uuid(160), requestFingerprint: 'd'.repeat(64),
      shopId, subjectKey, customerId: null, destinationFingerprint: fingerprint,
      fingerprintKeyVersion: 'key_v1', state: 'completed', reasonCode: 'customer_request',
      requestingActorProfileId: owner.profileId,
      requestedAt: new Date('2014-01-01T00:00:00.000Z'),
      completedAt: new Date('2015-01-01T00:00:00.000Z'),
      latestRelevantAt: new Date('2015-01-01T00:00:00.000Z'),
      priorRecordCounts: {}, proofSummary: {},
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
    })
    await db.insert(messagingRetentionHolds).values({
      id: uuid(61), shopId, resourceType: 'notification', resourceId: notificationId,
      reasonCode: 'legal_claim', authorizingActorProfileId: owner.profileId,
      startsAt: new Date('2014-01-01T00:00:00.000Z'),
      reviewAt: new Date('2014-06-01T00:00:00.000Z'),
      expiresAt: new Date('2015-01-01T00:00:00.000Z'),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
    })

    expect(await purgeExpiredMessagingRecords({
      db, now: new Date('2021-01-01T00:00:00.000Z'), batchSize: 100,
    })).toEqual<PurgeCounts>({
      notifications: 1,
      smsLog: 1,
      quoteSends: 1,
      consentProjections: 1,
      suppressions: 1,
      consentEvents: 1,
      deletionRequests: 1,
      retentionHolds: 1,
      skippedHeld: 0,
      failed: 0,
    })
    expect(await db.select().from(notifications)).toHaveLength(0)
    expect(await db.select().from(smsLog)).toHaveLength(0)
    expect(await db.select().from(quoteSends)).toHaveLength(0)
    expect(await db.select().from(messagingConsentState)).toHaveLength(0)
    expect(await db.select().from(smsSuppressions)).toHaveLength(0)
    expect(await db.select().from(messagingConsentEvents)).toHaveLength(0)
    expect(await db.select().from(messagingDeletionRequests)).toHaveLength(0)
    expect(await db.select().from(messagingRetentionHolds)).toHaveLength(0)
  })

  it('spends one global budget across notification and SMS families before quote sends', async () => {
    await seedTerminalSend(uuid(42), uuid(43))
    const result = await purgeExpiredMessagingRecords({
      db, now: new Date('2021-01-01T00:00:00.000Z'), batchSize: 2,
    })
    expect(result).toMatchObject({ notifications: 1, smsLog: 1, quoteSends: 0 })
    expect(await db.select().from(quoteSends)).toHaveLength(1)
  })

  it('does not purge a terminal quote send until every child SMS row is gone', async () => {
    await seedTerminalSend(uuid(44), uuid(45))
    const first = await purgeExpiredMessagingRecords({
      db, now: new Date('2021-01-01T00:00:00.000Z'), batchSize: 1,
    })
    expect(first.notifications).toBe(1)
    expect(first.quoteSends).toBe(0)
    expect(await db.select().from(quoteSends)).toHaveLength(1)
    const second = await purgeExpiredMessagingRecords({
      db, now: new Date('2021-01-01T00:00:00.000Z'), batchSize: 1,
    })
    expect(second.smsLog).toBe(1)
    expect(second.quoteSends).toBe(0)
    const third = await purgeExpiredMessagingRecords({
      db, now: new Date('2021-01-01T00:00:00.000Z'), batchSize: 1,
    })
    expect(third.quoteSends).toBe(1)
  })

  it('rolls back an injected SMS family failure, counts it once, and skips dependent quote sends', async () => {
    await seedTerminalSend(uuid(46), uuid(47))
    await db.execute(sql`create function task7_fail_sms_delete() returns trigger language plpgsql as $$
      begin raise exception 'injected sms failure'; end $$`)
    await db.execute(sql`create trigger task7_fail_sms_delete before delete on sms_log
      for each row execute function task7_fail_sms_delete()`)
    const result = await purgeExpiredMessagingRecords({
      db, now: new Date('2021-01-01T00:00:00.000Z'), batchSize: 100,
    })
    expect(result.failed).toBe(1)
    expect(result.smsLog).toBe(0)
    expect(result.quoteSends).toBe(0)
    expect(await db.select().from(smsLog)).toHaveLength(1)
    expect(await db.select().from(quoteSends)).toHaveLength(1)
  })

  it('skips suppression and event families after an injected projection rollback', async () => {
    await seedConsentChain()
    await db.execute(sql`create function task7_fail_projection_delete() returns trigger language plpgsql as $$
      begin raise exception 'injected projection failure'; end $$`)
    await db.execute(sql`create trigger task7_fail_projection_delete
      before delete on messaging_consent_state
      for each row execute function task7_fail_projection_delete()`)
    const result = await purgeExpiredMessagingRecords({
      db, now: new Date('2021-01-01T00:00:00.000Z'), batchSize: 100,
    })
    expect(result).toMatchObject({
      failed: 1, consentProjections: 0, suppressions: 0, consentEvents: 0,
    })
    expect(await db.select().from(messagingConsentState)).toHaveLength(1)
    expect(await db.select().from(smsSuppressions)).toHaveLength(1)
    expect(await db.select().from(messagingConsentEvents)).toHaveLength(1)
  })

  it('removes an expired suppression only after its stale consented projection is gone', async () => {
    await seedConsentChain()
    await db.update(messagingConsentState).set({
      status: 'consented', consentedAt: new Date('2015-01-01T00:00:00.000Z'), revokedAt: null,
    })
    const result = await purgeExpiredMessagingRecords({
      db, now: new Date('2021-01-01T00:00:00.000Z'), batchSize: 100,
    })
    expect(result).toMatchObject({
      consentProjections: 1, suppressions: 1, consentEvents: 1,
    })
    expect(await db.select().from(messagingConsentState)).toHaveLength(0)
    expect(await db.select().from(smsSuppressions)).toHaveLength(0)
  })

  it('applies active subject holds and release makes only the held subject eligible again', async () => {
    await seedConsentChain()
    await db.delete(notifications)
    const createdAt = new Date('2020-01-01T00:00:00.000Z')
    await db.insert(notifications).values({
      id: uuid(70), shopId, recipientProfileId: owner.profileId,
      eventType: 'quote_ready', entityType: 'customer', entityId: subjectKey,
      dedupeKey: 'subject-held', createdAt,
      retainUntil: new Date('2020-03-31T00:00:00.000Z'),
    })
    const created = await createHold({
      resourceType: undefined, resourceId: undefined, subjectKey,
      startsAt: new Date(Date.now() - DAY), reviewAt: new Date(Date.now() + DAY),
      expiresAt: new Date(Date.now() + 2 * DAY),
    })
    if (!created.ok) throw new Error('subject hold creation failed')
    const held = await purgeExpiredMessagingRecords({ db, now: new Date(), batchSize: 100 })
    expect(held.notifications).toBe(0)
    expect(held.skippedHeld).toBeGreaterThan(0)
    expect(await db.select().from(notifications)).toHaveLength(1)
    expect(await releaseMessagingRetentionHold({
      db, actor: founder, holdId: created.holdId, releasedAt: new Date(),
    })).toEqual({ ok: true })
    expect((await purgeExpiredMessagingRecords({ db, now: new Date(), batchSize: 100 })).notifications)
      .toBe(1)
  })

  it('uses stable retain-until and ID ordering across shops', async () => {
    const createdAt = new Date('2020-01-01T00:00:00.000Z')
    await db.insert(notifications).values({
      id: uuid(19), shopId: otherShopId, recipientProfileId: uuid(13),
      eventType: 'quote_ready', entityType: 'customer', entityId: uuid(29),
      dedupeKey: 'other-shop-retention', createdAt,
      retainUntil: new Date('2020-03-31T00:00:00.000Z'),
    })
    expect((await purgeExpiredMessagingRecords({
      db, now: new Date('2020-03-31T00:00:00.000Z'), batchSize: 1,
    })).notifications).toBe(1)
    expect((await db.select().from(notifications)).map(({ id }) => id)).toEqual([notificationId])
    expect((await purgeExpiredMessagingRecords({
      db, now: new Date('2020-03-31T00:00:00.000Z'), batchSize: 1,
    })).notifications).toBe(1)
  })

  it('does not extend clocks on reads, failed release retries, or ineligible purge scans', async () => {
    const created = await createHold()
    if (!created.ok) throw new Error('hold creation failed')
    const before = (await db.select().from(messagingRetentionHolds))[0]!
    expect((await releaseMessagingRetentionHold({
      db, actor: owner, holdId: created.holdId, releasedAt: new Date(start.getTime() - 1),
    })).ok).toBe(false)
    await purgeExpiredMessagingRecords({ db, now: start, batchSize: 100 })
    const after = (await db.select().from(messagingRetentionHolds))[0]!
    expect(after).toMatchObject({
      startsAt: before.startsAt,
      reviewAt: before.reviewAt,
      expiresAt: before.expiresAt,
      releasedAt: null,
      retainUntil: before.retainUntil,
    })
  })

  it.each([0, 1.5, 101, Number.NaN])('rejects unsafe purge batch %s', async (batchSize) => {
    await expect(purgeExpiredMessagingRecords({ db, now: start, batchSize }))
      .rejects.toThrow('invalid_purge_input')
  })

  it('pins shop-first, stable, clock-clamped, dependency-safe, definer-only source contracts', async () => {
    const source = await readFile('lib/shop-os/messaging-retention-purge.ts', 'utf8')
    expect(source).not.toContain('sql.raw')
    expect(source).toMatch(/order by retain_until, id/i)
    expect(source).toMatch(/for update skip locked/i)
    expect(source).toMatch(/retain_until <= clock_timestamp\(\)/i)
    expect(source).toContain('purge_expired_messaging_consent_event')
    expect(source).toContain('purge_expired_messaging_deletion_request')
    expect(source).toContain('purge_expired_messaging_retention_hold')
    expect(source).toContain("state in ('cancelled', 'failed', 'responded', 'expired')")
    const create = source.slice(
      source.indexOf('export async function createMessagingRetentionHold'),
      source.indexOf('export async function releaseMessagingRetentionHold'),
    )
    expect(create.indexOf('lockShop')).toBeLessThan(create.indexOf('lockResourceTarget'))
    const release = source.slice(
      source.indexOf('export async function releaseMessagingRetentionHold'),
      source.indexOf('function cursorValues'),
    )
    expect(release.indexOf('lockShop')).toBeLessThan(release.indexOf('from messaging_retention_holds'))
    expect(release.indexOf('from messaging_retention_holds')).toBeLessThan(release.indexOf('liveAuthority'))
    const purge = source.slice(source.indexOf('export async function purgeExpiredMessagingRecords'))
    const order = [
      "'notifications'", "'smsLog'", "'quoteSends'", "'consentProjections'",
      "'suppressions'", "'consentEvents'", "'deletionRequests'", "'retentionHolds'",
    ].map((marker) => purge.indexOf(marker))
    expect(order.every((position) => position >= 0)).toBe(true)
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
})
