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
  messagingDeletionWorkItems,
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
import type { AppDb } from '@/lib/db/queries'
import {
  completeMessagingDeletion,
  requestMessagingDeletion,
} from '@/lib/shop-os/messaging-deletion'
import type { FingerprintKeyRing } from '@/lib/shop-os/messaging-retention-policy'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`
const start = new Date('2024-02-29T12:00:00.000Z')
const review = new Date('2024-08-01T12:00:00.000Z')
const expiry = new Date('2025-02-28T12:00:00.000Z')
const DAY = 86_400_000
const keyRing: FingerprintKeyRing = Object.freeze({
  currentVersion: 'key_v1',
  keys: Object.freeze({
    key_v1: 'task-seven-current-key-material-at-least-32-bytes',
  }),
})

type PurgeHint = Readonly<{ retainUntil: Date; id: string; shopId: string }>

function purgeHint(id: string, shopId: string, order: number): PurgeHint {
  return Object.freeze({
    id,
    shopId,
    retainUntil: new Date(`2020-01-${order.toString().padStart(2, '0')}T00:00:00.000Z`),
  })
}

function queryParts(query: unknown): { text: string; params: unknown[] } {
  const chunks = (query as { queryChunks: unknown[] }).queryChunks
  const params: unknown[] = []
  const text = chunks.map((chunk) => {
    if (typeof chunk === 'object' && chunk !== null && 'value' in chunk) {
      return (chunk as { value: string[] }).value.join('')
    }
    params.push(chunk)
    return '?'
  }).join('')
  return { text, params }
}

function purgeDb(input: {
  pages: ReadonlyArray<ReadonlyArray<PurgeHint>>
  locked: ReadonlySet<string>
}): { db: AppDb; deleted: string[] } {
  const candidates = input.pages.flat()
  const deleted: string[] = []
  let transactionState: {
    lockedShop?: string
    lockCount: number
    candidateShops: Set<string>
  } | undefined

  const execute = async (query: unknown) => {
    const { text, params } = queryParts(query)
    if (/select count\(\*\)::int as count/.test(text)) return [{ count: 0 }]
    if (/select n\.shop_id as "shopId"/.test(text)) {
      const limit = params.findLast((param): param is number => typeof param === 'number') ?? 0
      const cursorId = params.find((param) =>
        typeof param === 'string' && candidates.some(({ id }) => id === param))
      const cursorIndex = cursorId
        ? candidates.findIndex(({ id }) => id === cursorId) + 1
        : 0
      return candidates.slice(cursorIndex, cursorIndex + limit)
    }
    if (/select [a-z]\.shop_id as "shopId"/.test(text)) return []
    if (/select id from shops/.test(text)) {
      expect(transactionState).toBeDefined()
      const shopId = params.find((param): param is string => typeof param === 'string')
      expect(shopId).toBeDefined()
      transactionState!.lockCount += 1
      transactionState!.lockedShop = shopId
      return [{ id: shopId }]
    }
    if (/from notifications n where/.test(text) && /for update skip locked/.test(text)) {
      expect(transactionState?.lockCount).toBe(1)
      const [shopId, id] = params.filter((param): param is string => typeof param === 'string')
      expect(shopId).toBe(transactionState?.lockedShop)
      transactionState!.candidateShops.add(shopId!)
      expect(transactionState!.candidateShops.size).toBe(1)
      return input.locked.has(id!) ? [] : [{ held: false }]
    }
    if (/delete from notifications/.test(text)) {
      const [, id] = params.filter((param): param is string => typeof param === 'string')
      deleted.push(id!)
      return [{ id }]
    }
    throw new Error(`unexpected purge query: ${text}`)
  }

  const fake = {
    execute,
    transaction: async (callback: (tx: AppDb) => Promise<unknown>) => {
      expect(transactionState).toBeUndefined()
      transactionState = { lockCount: 0, candidateShops: new Set() }
      try {
        const result = await callback(fake as unknown as AppDb)
        expect(transactionState.lockCount).toBe(1)
        expect(transactionState.candidateShops.size).toBe(1)
        return result
      } finally {
        transactionState = undefined
      }
    },
  }
  return { db: fake as unknown as AppDb, deleted }
}

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

  const seedTerminalSend = async (
    sendId = uuid(40),
    logId?: string,
    sendSubjectKey = customerId,
  ) => {
    const createdAt = new Date('2019-01-01T00:00:00.000Z')
    const terminalAt = new Date('2020-01-01T00:00:00.000Z')
    await db.insert(quoteSends).values({
      id: sendId, shopId, ticketId, quoteVersionId, customerId, subjectKey: sendSubjectKey,
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
    await db.insert(smsLog).values({
      id: uuid(48), shopId, quoteSendId: uuid(46), templateKey: 'quote_ready',
      templateVersion: 'v1', state: 'delivered',
      serverReceivedAt: new Date('2020-01-01T00:00:00.000Z'),
      retainUntil: new Date('2021-01-01T00:00:00.000Z'),
    })
    await db.execute(sql`create function task7_fail_sms_delete() returns trigger language plpgsql as $$
      begin
        if old.id = '00000000-0000-4000-8000-000000000048'::uuid then
          raise exception 'injected second sms failure';
        end if;
        return old;
      end $$`)
    await db.execute(sql`create trigger task7_fail_sms_delete before delete on sms_log
      for each row execute function task7_fail_sms_delete()`)
    const result = await purgeExpiredMessagingRecords({
      db, now: new Date('2021-01-01T00:00:00.000Z'), batchSize: 100,
    })
    expect(result.failed).toBe(1)
    expect(result.smsLog).toBe(0)
    expect(result.quoteSends).toBe(0)
    expect(await db.select().from(smsLog)).toHaveLength(2)
    expect(await db.select().from(quoteSends)).toHaveLength(1)
  })

  it('skips suppression and event families after an injected projection rollback', async () => {
    await seedConsentChain()
    await db.insert(messagingConsentEvents).values({
      id: uuid(53), shopId, subjectKey: uuid(54), customerId,
      destinationFingerprint: 'e'.repeat(64), fingerprintKeyVersion: 'key_v1',
      programVersion: 'program_v2', eventType: 'revoked',
      committedAt: new Date('2015-01-01T00:00:00.000Z'),
      occurredAt: new Date('2015-01-01T00:00:00.000Z'), captureMethod: 'staff_request',
      customerControlled: true, evidenceKind: 'staff_request', actorProfileId: owner.profileId,
      requestKey: uuid(153), requestFingerprint: 'f'.repeat(64),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
    })
    await db.insert(messagingConsentState).values({
      id: uuid(54), shopId, subjectKey: uuid(54), customerId,
      destinationFingerprint: 'e'.repeat(64), fingerprintKeyVersion: 'key_v1',
      programVersion: 'program_v2', status: 'revoked', sourceEventId: uuid(53),
      revokedAt: new Date('2015-01-01T00:00:00.000Z'),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2015-01-01T00:00:00.000Z'),
    })
    await db.execute(sql`create function task7_fail_projection_delete() returns trigger language plpgsql as $$
      begin
        if old.id = '00000000-0000-4000-8000-000000000054'::uuid then
          raise exception 'injected second projection failure';
        end if;
        return old;
      end $$`)
    await db.execute(sql`create trigger task7_fail_projection_delete
      before delete on messaging_consent_state
      for each row execute function task7_fail_projection_delete()`)
    const result = await purgeExpiredMessagingRecords({
      db, now: new Date('2021-01-01T00:00:00.000Z'), batchSize: 100,
    })
    expect(result).toMatchObject({
      failed: 1, consentProjections: 0, suppressions: 0, consentEvents: 0,
    })
    expect(await db.select().from(messagingConsentState)).toHaveLength(2)
    expect(await db.select().from(smsSuppressions)).toHaveLength(1)
    expect(await db.select().from(messagingConsentEvents)).toHaveLength(2)
  })

  it('keeps compaction authorization separate from purge authorization', async () => {
    await db.delete(notifications)
    const eventId = uuid(70)
    const eventFingerprint = '7'.repeat(64)
    await db.insert(messagingConsentEvents).values({
      id: eventId,
      shopId,
      subjectKey,
      customerId,
      destinationFingerprint: eventFingerprint,
      fingerprintKeyVersion: 'key_v1',
      programVersion: 'authorization_separation_v1',
      eventType: 'revoked',
      committedAt: new Date('2015-01-01T00:00:00.000Z'),
      occurredAt: new Date('2015-01-01T00:00:00.000Z'),
      captureMethod: 'staff_request',
      customerControlled: true,
      evidenceKind: 'staff_request',
      actorProfileId: owner.profileId,
      requestKey: uuid(170),
      requestFingerprint: '8'.repeat(64),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
    })
    const deletion = await requestMessagingDeletion({
      db,
      actor: owner,
      customerId,
      destination: '+12025550123',
      reasonCode: 'customer_request',
      requestKey: uuid(171),
      requestFingerprint: '9'.repeat(64),
      now: new Date(),
      keyRing,
    })
    if (!deletion.ok) throw new Error(`deletion request failed: ${deletion.error}`)
    const [{ id: workItemId }] = await db.insert(messagingDeletionWorkItems).values({
      shopId,
      requestId: deletion.requestId,
      resourceType: 'consent_event',
      resourceId: eventId,
    }).returning({ id: messagingDeletionWorkItems.id })

    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config(
          'vyntechs.messaging_consent_purge_shop', ${shopId}::text, true
        )`)
        await tx.execute(sql`select set_config(
          'vyntechs.messaging_consent_purge_events', ${`{${eventId}}`}::text, true
        )`)
        await tx.execute(sql`select compact_messaging_consent_work_items(
          ${shopId}::uuid, ${deletion.requestId}::uuid,
          ${sql.param([workItemId!])}::uuid[]
        )`)
      })
      throw new Error('purge context unexpectedly authorized compaction')
    } catch (error) {
      expect((error as { cause?: Error }).cause?.message)
        .toContain('compaction transaction cannot mix consent event purge context')
    }

    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`select set_config(
          'vyntechs.messaging_consent_compaction_request', ${deletion.requestId}::text, true
        )`)
        await tx.execute(sql`select set_config(
          'vyntechs.messaging_consent_compaction_shop', ${shopId}::text, true
        )`)
        await tx.execute(sql`select set_config(
          'vyntechs.messaging_consent_compaction_events', ${`{${eventId}}`}::text, true
        )`)
        await tx.execute(sql`select purge_expired_messaging_consent_event(
          ${shopId}::uuid, ${eventId}::uuid
        )`)
      })
      throw new Error('compaction context unexpectedly authorized purge')
    } catch (error) {
      expect((error as { cause?: Error }).cause?.message)
        .toContain('consent event purge transaction cannot mix compaction context')
    }

    expect(await db.select({ id: messagingConsentEvents.id }).from(messagingConsentEvents))
      .toEqual([{ id: eventId }])
    expect((await db.select().from(messagingDeletionWorkItems))[0]).toMatchObject({
      id: workItemId,
      outcome: 'pending',
    })
  })

  it('keeps durable subject-held send records after verified deletion nulls customer identity', async () => {
    await db.delete(notifications)
    await seedConsentChain()
    await seedTerminalSend(uuid(90), uuid(91))
    const createdAt = new Date('2020-01-01T00:00:00.000Z')
    await db.insert(notifications).values({
      id: uuid(92), shopId, recipientProfileId: owner.profileId,
      eventType: 'quote_ready', entityType: 'quote_send', entityId: uuid(90),
      dedupeKey: 'durable-subject-notification', createdAt,
      retainUntil: new Date('2020-03-31T00:00:00.000Z'),
    })
    const held = await createHold({
      resourceType: undefined, resourceId: undefined, subjectKey,
      startsAt: new Date(Date.now() - DAY), reviewAt: new Date(Date.now() + DAY),
      expiresAt: new Date(Date.now() + 2 * DAY),
    })
    if (!held.ok) throw new Error('subject hold creation failed')
    const deletion = await requestMessagingDeletion({
      db, actor: owner, customerId, destination: '+12025550123',
      reasonCode: 'customer_request', requestKey: uuid(190),
      requestFingerprint: '9'.repeat(64), now: new Date(), keyRing,
    })
    if (!deletion.ok) throw new Error(`deletion request failed: ${deletion.error}`)
    const completed = await completeMessagingDeletion({
      db, actor: owner, requestId: deletion.requestId, now: new Date(),
    })
    expect(completed).toMatchObject({ ok: true, state: 'completed' })
    expect((await db.select().from(quoteSends))[0]).toMatchObject({
      id: uuid(90), customerId: null, subjectKey,
    })

    const beforeRelease = await purgeExpiredMessagingRecords({
      db, now: new Date(), batchSize: 100,
    })
    expect(beforeRelease).toMatchObject({ notifications: 0, smsLog: 0, quoteSends: 0 })
    expect(await db.select().from(notifications)).toHaveLength(1)
    expect(await db.select().from(smsLog)).toHaveLength(1)
    expect(await db.select().from(quoteSends)).toHaveLength(1)

    expect(await releaseMessagingRetentionHold({
      db, actor: founder, holdId: held.holdId, releasedAt: new Date(),
    })).toEqual({ ok: true })
    const afterRelease = await purgeExpiredMessagingRecords({
      db, now: new Date(), batchSize: 100,
    })
    expect(afterRelease).toMatchObject({ notifications: 1, smsLog: 1, quoteSends: 1 })
  })

  it('applies a durable subject hold without blocking another subject on the same customer', async () => {
    await db.delete(notifications)
    await seedConsentChain()
    const otherSubject = uuid(99)
    await seedTerminalSend(uuid(93), uuid(94), subjectKey)
    await seedTerminalSend(uuid(95), uuid(96), otherSubject)
    const createdAt = new Date('2020-01-01T00:00:00.000Z')
    await db.insert(notifications).values([
      {
        id: uuid(97), shopId, recipientProfileId: owner.profileId,
        eventType: 'quote_ready', entityType: 'quote_send', entityId: uuid(93),
        dedupeKey: 'held-subject-notification', createdAt,
        retainUntil: new Date('2020-03-31T00:00:00.000Z'),
      },
      {
        id: uuid(98), shopId, recipientProfileId: owner.profileId,
        eventType: 'quote_ready', entityType: 'quote_send', entityId: uuid(95),
        dedupeKey: 'other-subject-notification', createdAt,
        retainUntil: new Date('2020-03-31T00:00:00.000Z'),
      },
    ])
    const held = await createHold({
      resourceType: undefined, resourceId: undefined, subjectKey,
      startsAt: new Date(Date.now() - DAY), reviewAt: new Date(Date.now() + DAY),
      expiresAt: new Date(Date.now() + 2 * DAY),
    })
    expect(held.ok).toBe(true)
    const result = await purgeExpiredMessagingRecords({ db, now: new Date(), batchSize: 100 })
    expect(result).toMatchObject({ notifications: 1, smsLog: 1, quoteSends: 1 })
    expect((await db.select().from(quoteSends)).map(({ id }) => id)).toEqual([uuid(93)])
    expect((await db.select().from(smsLog)).map(({ id }) => id)).toEqual([uuid(94)])
    expect((await db.select().from(notifications)).map(({ id }) => id)).toEqual([uuid(97)])
  })

  it('ignores an expired durable subject hold for send, SMS, and quote-linked notification purge', async () => {
    await db.delete(notifications)
    await seedConsentChain()
    await seedTerminalSend(uuid(100), uuid(101))
    const createdAt = new Date('2020-01-01T00:00:00.000Z')
    await db.insert(notifications).values({
      id: uuid(102), shopId, recipientProfileId: owner.profileId,
      eventType: 'quote_ready', entityType: 'quote_send', entityId: uuid(100),
      dedupeKey: 'expired-subject-notification', createdAt,
      retainUntil: new Date('2020-03-31T00:00:00.000Z'),
    })
    expect((await createHold({
      resourceType: undefined, resourceId: undefined, subjectKey,
      startsAt: new Date('2019-01-01T00:00:00.000Z'),
      reviewAt: new Date('2019-06-01T00:00:00.000Z'),
      expiresAt: new Date('2019-12-31T00:00:00.000Z'),
    })).ok).toBe(true)
    const result = await purgeExpiredMessagingRecords({ db, now: new Date(), batchSize: 100 })
    expect(result).toMatchObject({ notifications: 1, smsLog: 1, quoteSends: 1 })
  })

  it('reaches an unheld eligible row beyond more than 1100 held prefix rows across invocations', async () => {
    await db.delete(notifications)
    const createdAt = new Date('2020-01-01T00:00:00.000Z')
    const heldCount = 1_101
    await db.insert(notifications).values(Array.from({ length: heldCount + 1 }, (_, index) => ({
      id: uuid(1_000 + index), shopId, recipientProfileId: owner.profileId,
      eventType: 'quote_ready', entityType: 'customer', entityId: uuid(30_000 + index),
      dedupeKey: `held-prefix-${index}`, createdAt,
      retainUntil: new Date('2020-03-31T00:00:00.000Z'),
    })))
    const activeStart = new Date(Date.now() - DAY)
    const activeExpiry = new Date(Date.now() + 2 * DAY)
    const auditUntil = new Date(activeExpiry)
    auditUntil.setUTCFullYear(auditUntil.getUTCFullYear() + 5)
    await db.insert(messagingRetentionHolds).values(Array.from({ length: heldCount }, (_, index) => ({
      id: uuid(5_000 + index), shopId, resourceType: 'notification' as const,
      resourceId: uuid(1_000 + index), reasonCode: 'legal_claim' as const,
      authorizingActorProfileId: owner.profileId, startsAt: activeStart,
      reviewAt: new Date(Date.now() + DAY), expiresAt: activeExpiry,
      retainUntil: auditUntil,
    })))
    const first = await purgeExpiredMessagingRecords({ db, now: new Date(), batchSize: 1 })
    expect(first.notifications).toBe(1)
    expect((await db.select().from(notifications)).some(({ id }) => id === uuid(2_101))).toBe(false)
    const second = await purgeExpiredMessagingRecords({ db, now: new Date(), batchSize: 1 })
    expect(second.notifications).toBe(0)
    expect(await db.select().from(notifications)).toHaveLength(heldCount)
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

  it('walks past an arbitrary locked prefix to the next eligible shop', async () => {
    const shopA = uuid(401)
    const shopB = uuid(402)
    const shopC = uuid(403)
    const fake = purgeDb({
      pages: [
        [purgeHint('A1', shopA, 1)],
        [purgeHint('B1', shopB, 2)],
        [purgeHint('C1', shopC, 3)],
      ],
      locked: new Set(['A1', 'B1']),
    })

    const result = await purgeExpiredMessagingRecords({
      db: fake.db,
      now: new Date('2026-07-12T00:00:00.000Z'),
      batchSize: 1,
    })

    expect(result.notifications).toBe(1)
    expect(fake.deleted).toEqual(['C1'])
  })

  it('does not coalesce non-contiguous runs from the same shop', async () => {
    const shopA = uuid(411)
    const shopB = uuid(412)
    const fake = purgeDb({
      pages: [
        [purgeHint('A1', shopA, 1), purgeHint('B1', shopB, 2)],
        [purgeHint('A2', shopA, 3)],
      ],
      locked: new Set(['A1']),
    })

    await purgeExpiredMessagingRecords({
      db: fake.db,
      now: new Date('2026-07-12T00:00:00.000Z'),
      batchSize: 2,
    })

    expect(fake.deleted).toEqual(['B1'])
  })

  it('does not count a held projection whose source event is not purge-eligible', async () => {
    await db.delete(notifications)
    const eventId = uuid(301)
    const heldSubject = uuid(302)
    await db.insert(messagingConsentEvents).values({
      id: eventId, shopId, subjectKey: heldSubject, customerId,
      destinationFingerprint: '1'.repeat(64), fingerprintKeyVersion: 'key_v1',
      programVersion: 'projection_dependency', eventType: 'revoked',
      committedAt: new Date('2020-01-01T00:00:00.000Z'),
      occurredAt: new Date('2020-01-01T00:00:00.000Z'), captureMethod: 'staff_request',
      customerControlled: true, evidenceKind: 'staff_request', actorProfileId: owner.profileId,
      requestKey: uuid(303), requestFingerprint: '2'.repeat(64),
      retainUntil: new Date('2035-01-01T00:00:00.000Z'),
    })
    await db.insert(messagingConsentState).values({
      id: uuid(304), shopId, subjectKey: heldSubject, customerId,
      destinationFingerprint: '1'.repeat(64), fingerprintKeyVersion: 'key_v1',
      programVersion: 'projection_dependency', status: 'revoked', sourceEventId: eventId,
      revokedAt: new Date('2020-01-01T00:00:00.000Z'),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    })
    await db.insert(messagingRetentionHolds).values({
      id: uuid(305), shopId, subjectKey: heldSubject, reasonCode: 'legal_claim',
      authorizingActorProfileId: owner.profileId,
      startsAt: new Date('2026-07-11T00:00:00.000Z'),
      reviewAt: new Date('2026-07-12T00:00:00.000Z'),
      expiresAt: new Date('2026-07-13T00:00:00.000Z'),
      retainUntil: new Date('2031-07-13T00:00:00.000Z'),
    })

    const result = await purgeExpiredMessagingRecords({ db, now: new Date(), batchSize: 100 })
    expect(result.skippedHeld).toBe(0)
    expect(await db.select().from(messagingConsentState)).toHaveLength(1)
  })

  it('does not count a held suppression blocked by a consented projection', async () => {
    await db.delete(notifications)
    const eventId = uuid(311)
    const heldSubject = uuid(312)
    const heldFingerprint = '3'.repeat(64)
    await db.insert(messagingConsentEvents).values({
      id: eventId, shopId, subjectKey: heldSubject, customerId,
      destinationFingerprint: heldFingerprint, fingerprintKeyVersion: 'key_v1',
      programVersion: 'suppression_dependency', eventType: 'consented',
      committedAt: new Date('2020-01-01T00:00:00.000Z'),
      occurredAt: new Date('2020-01-01T00:00:00.000Z'), captureMethod: 'staff_request',
      customerControlled: true, evidenceKind: 'staff_request', actorProfileId: owner.profileId,
      requestKey: uuid(313), requestFingerprint: '4'.repeat(64),
      retainUntil: new Date('2035-01-01T00:00:00.000Z'),
    })
    await db.insert(messagingConsentState).values({
      id: uuid(314), shopId, subjectKey: heldSubject, customerId,
      destinationFingerprint: heldFingerprint, fingerprintKeyVersion: 'key_v1',
      programVersion: 'suppression_dependency', status: 'consented', sourceEventId: eventId,
      consentedAt: new Date('2020-01-01T00:00:00.000Z'),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    })
    await db.insert(smsSuppressions).values({
      id: uuid(315), shopId, destinationFingerprint: heldFingerprint,
      fingerprintKeyVersion: 'key_v1', sourceEventId: eventId, reason: 'customer_revocation',
      suppressedAt: new Date('2020-01-01T00:00:00.000Z'),
      liftedAt: new Date('2020-02-01T00:00:00.000Z'),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
      updatedAt: new Date('2020-02-01T00:00:00.000Z'),
    })
    await db.insert(messagingRetentionHolds).values({
      id: uuid(316), shopId, resourceType: 'sms_suppression', resourceId: uuid(315),
      reasonCode: 'legal_claim', authorizingActorProfileId: owner.profileId,
      startsAt: new Date('2026-07-11T00:00:00.000Z'),
      reviewAt: new Date('2026-07-12T00:00:00.000Z'),
      expiresAt: new Date('2026-07-13T00:00:00.000Z'),
      retainUntil: new Date('2031-07-13T00:00:00.000Z'),
    })

    const result = await purgeExpiredMessagingRecords({ db, now: new Date(), batchSize: 100 })
    expect(result.skippedHeld).toBe(0)
    expect(await db.select().from(smsSuppressions)).toHaveLength(1)
  })

  it('does not count a held consent event still referenced by a projection', async () => {
    await db.delete(notifications)
    const eventId = uuid(321)
    const heldSubject = uuid(322)
    await db.insert(messagingConsentEvents).values({
      id: eventId, shopId, subjectKey: heldSubject, customerId,
      destinationFingerprint: '5'.repeat(64), fingerprintKeyVersion: 'key_v1',
      programVersion: 'event_dependency', eventType: 'revoked',
      committedAt: new Date('2020-01-01T00:00:00.000Z'),
      occurredAt: new Date('2020-01-01T00:00:00.000Z'), captureMethod: 'staff_request',
      customerControlled: true, evidenceKind: 'staff_request', actorProfileId: owner.profileId,
      requestKey: uuid(323), requestFingerprint: '6'.repeat(64),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
    })
    await db.insert(messagingConsentState).values({
      id: uuid(324), shopId, subjectKey: heldSubject, customerId,
      destinationFingerprint: '5'.repeat(64), fingerprintKeyVersion: 'key_v1',
      programVersion: 'event_dependency', status: 'revoked', sourceEventId: eventId,
      revokedAt: new Date('2020-01-01T00:00:00.000Z'),
      retainUntil: new Date('2035-01-01T00:00:00.000Z'),
      updatedAt: new Date('2020-01-01T00:00:00.000Z'),
    })
    await db.insert(messagingRetentionHolds).values({
      id: uuid(325), shopId, resourceType: 'messaging_consent_event', resourceId: eventId,
      reasonCode: 'legal_claim', authorizingActorProfileId: owner.profileId,
      startsAt: new Date('2026-07-11T00:00:00.000Z'),
      reviewAt: new Date('2026-07-12T00:00:00.000Z'),
      expiresAt: new Date('2026-07-13T00:00:00.000Z'),
      retainUntil: new Date('2031-07-13T00:00:00.000Z'),
    })

    const result = await purgeExpiredMessagingRecords({ db, now: new Date(), batchSize: 100 })
    expect(result.skippedHeld).toBe(0)
    expect(await db.select().from(messagingConsentEvents)).toHaveLength(1)
  })

  it('underfills event and hold families at the first different-shop prefix', async () => {
    await db.delete(notifications)
    const otherCustomerId = uuid(120)
    await db.insert(customers).values({
      id: otherCustomerId, shopId: otherShopId, name: 'Other retention customer',
      phone: '+12025550124',
    })
    const eventRows = [
      { id: uuid(110), eventShopId: shopId, eventCustomerId: customerId, actorId: owner.profileId },
      { id: uuid(111), eventShopId: shopId, eventCustomerId: customerId, actorId: owner.profileId },
      { id: uuid(112), eventShopId: otherShopId, eventCustomerId: otherCustomerId, actorId: uuid(13) },
    ]
    await db.insert(messagingConsentEvents).values(eventRows.map((row, index) => ({
      id: row.id, shopId: row.eventShopId, subjectKey: row.eventCustomerId,
      customerId: row.eventCustomerId, destinationFingerprint: `${index + 1}`.repeat(64),
      fingerprintKeyVersion: 'key_v1', programVersion: `prefix_v${index + 1}`,
      eventType: 'revoked' as const, committedAt: new Date('2015-01-01T00:00:00.000Z'),
      occurredAt: new Date('2015-01-01T00:00:00.000Z'), captureMethod: 'staff_request' as const,
      customerControlled: true, evidenceKind: 'staff_request' as const,
      actorProfileId: row.actorId, requestKey: uuid(210 + index),
      requestFingerprint: `${index + 4}`.repeat(64),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
    })))
    const futureCreatedAt = new Date('2030-01-01T00:00:00.000Z')
    await db.insert(notifications).values([
      {
        id: uuid(130), shopId, recipientProfileId: owner.profileId,
        eventType: 'quote_ready', entityType: 'customer', entityId: customerId,
        dedupeKey: 'hold-target-130', createdAt: futureCreatedAt,
        retainUntil: new Date('2030-04-01T00:00:00.000Z'),
      },
      {
        id: uuid(131), shopId, recipientProfileId: owner.profileId,
        eventType: 'quote_ready', entityType: 'customer', entityId: customerId,
        dedupeKey: 'hold-target-131', createdAt: futureCreatedAt,
        retainUntil: new Date('2030-04-01T00:00:00.000Z'),
      },
      {
        id: uuid(132), shopId: otherShopId, recipientProfileId: uuid(13),
        eventType: 'quote_ready', entityType: 'customer', entityId: otherCustomerId,
        dedupeKey: 'hold-target-132', createdAt: futureCreatedAt,
        retainUntil: new Date('2030-04-01T00:00:00.000Z'),
      },
    ])
    await db.insert(messagingRetentionHolds).values([
      [uuid(120), shopId, uuid(130), owner.profileId],
      [uuid(121), shopId, uuid(131), owner.profileId],
      [uuid(122), otherShopId, uuid(132), uuid(13)],
    ].map(([id, holdShopId, resourceId, actorId]) => ({
      id, shopId: holdShopId, resourceType: 'notification' as const, resourceId,
      reasonCode: 'legal_claim' as const, authorizingActorProfileId: actorId,
      startsAt: new Date('2014-01-01T00:00:00.000Z'),
      reviewAt: new Date('2014-06-01T00:00:00.000Z'),
      expiresAt: new Date('2015-01-01T00:00:00.000Z'),
      retainUntil: new Date('2020-01-01T00:00:00.000Z'),
    })))

    const first = await purgeExpiredMessagingRecords({ db, now: new Date(), batchSize: 100 })
    expect(first).toMatchObject({ consentEvents: 2, retentionHolds: 2, failed: 0 })
    expect((await db.select().from(messagingConsentEvents)).map(({ id }) => id)).toEqual([uuid(112)])
    expect((await db.select().from(messagingRetentionHolds)).map(({ id }) => id)).toEqual([uuid(122)])
    const second = await purgeExpiredMessagingRecords({ db, now: new Date(), batchSize: 100 })
    expect(second).toMatchObject({ consentEvents: 1, retentionHolds: 1, failed: 0 })
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
    expect(source).toMatch(/order by (?:[a-z]\.)?retain_until, (?:[a-z]\.)?id/i)
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
      source.indexOf('async function candidateHints'),
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
    const atomicFamily = source.slice(
      source.indexOf('async function runAtomicFamily'),
      source.indexOf('function emptyCounts'),
    )
    expect(atomicFamily.indexOf('lockShop')).toBeLessThan(
      atomicFamily.indexOf('deleteLockedCandidate'),
    )
    expect(source).toContain('select purge_expired_messaging_deletion_request(')
    expect(source).not.toContain('q.customer_id')
    expect(source.match(/\([a-z]\.retain_until, [a-z]\.id\) >/g)).toHaveLength(8)
    const scheduler = source.slice(
      source.indexOf('async function runFirstProcessableShop'),
      source.indexOf('function emptyCounts'),
    )
    expect(scheduler.indexOf('candidateHints')).toBeLessThan(scheduler.indexOf('runAtomicFamily'))
    expect(purge).toContain('runFirstProcessableShop')
    expect(purge).not.toContain('remaining + 1')
  })
})
