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

describe('suppression-first messaging deletion', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let customerId: string
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
    ;[{ id: customerId }, { id: otherCustomerId }] = await db.insert(customers).values([
      { id: uuid(10), shopId, name: 'Primary Customer', phone: destination },
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
  ) => {
    const createdAt = new Date('2026-07-12T10:00:00.000Z')
    const submittingAt = ['submitting', 'submitted', 'delivered'].includes(state)
      ? new Date('2026-07-12T10:01:00.000Z') : null
    const submittedAt = ['submitted', 'delivered'].includes(state)
      ? new Date('2026-07-12T10:02:00.000Z') : null
    const current = fingerprintDestination(destination, 'key_v2', keyRing.keys.key_v2!)
    await db.insert(quoteSends).values({
      id, shopId, ticketId, quoteVersionId: versionId, customerId,
      destinationFingerprint: current, fingerprintKeyVersion: 'key_v2', channel: 'sms',
      tokenHash: 'd'.repeat(64), tokenExpiresAt: new Date('2026-07-13T10:00:00.000Z'),
      requestingActorProfileId: owner.profileId, requestKey: uuid(500 + Number(id.slice(-3))),
      requestFingerprint: 'e'.repeat(64), state, submittingAt, submittedAt, createdAt, updatedAt: createdAt,
    })
  }

  const activeHold = (overrides: Partial<typeof messagingRetentionHolds.$inferInsert>) => {
    const startsAt = new Date(Date.now() - 60_000)
    const expiresAt = new Date(Date.now() + 86_400_000)
    return db.insert(messagingRetentionHolds).values({
      shopId, reasonCode: 'legal_request', authorizingActorProfileId: owner.profileId,
      startsAt, reviewAt: new Date(Date.now() + 3_600_000), expiresAt,
      retainUntil: new Date(expiresAt.getTime() + 365 * 86_400_000), ...overrides,
    })
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

  it('preserves stronger suppression rows byte-for-byte and never weakens the deletion barrier', async () => {
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
    expect(after).toEqual(before)
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
      .toMatchObject({ ok: true, counts: { consentEventsDeleted: 2 } })
    expect(await db.select().from(messagingConsentEvents)).toHaveLength(0)
    expect(await db.select().from(messagingConsentState)).toHaveLength(0)
    expect((await db.select().from(smsSuppressions)).every(({ liftedAt }) => liftedAt === null)).toBe(true)
    expect((await db.select().from(messagingDeletionRequests))[0]).toMatchObject({
      state: 'completed', proofSummary: { deletedBarrier: 1, suppressionActive: 1 },
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
    expect(await db.select().from(notifications)).toHaveLength(0)
    expect((await db.select().from(quoteEvents))[0]).toEqual(eventBefore)
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
  })

  it('honors an active subject hold but ignores unmatched and expired holds', async () => {
    const sendId = uuid(53)
    await insertSend(sendId, 'submitted')
    await activeHold({ subjectKey: customerId })
    await activeHold({ resourceType: 'quote_send', resourceId: uuid(999) })
    const expiredStart = new Date(Date.now() - 3 * 86_400_000)
    await activeHold({
      resourceType: 'quote_send', resourceId: sendId, startsAt: expiredStart,
      reviewAt: new Date(expiredStart.getTime() + 1000), expiresAt: new Date(Date.now() - 1000),
    })
    const pending = await request()
    if (!pending.ok) throw new Error('request failed')
    const result = await completeMessagingDeletion({ db, actor: owner, requestId: pending.requestId, now })
    expect(result).toMatchObject({ ok: true, counts: { heldRecords: 1, quoteSendsRetained: 1 } })
    expect((await db.select().from(quoteSends))[0]).toMatchObject({ customerId: null, tokenHash: null })
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

  it('documents the exact cleanup state, hold, and lock contract in executable source', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) =>
      readFile('lib/shop-os/messaging-deletion.ts', 'utf8'))
    expect(source).toContain("new Set(['queued', 'claimed'])")
    expect(source).toContain("new Set(['submitting', 'submitted'])")
    expect(source).toMatch(/for update/i)
    expect(source).toContain('compact_messaging_consent_events')
    expect(source).toContain("resource_type = 'sms_log'")
    expect(source).toContain("hold.resourceType === 'quote_send'")
    expect(source).toContain("hold.resourceType === 'notification'")
    expect(source).toContain("'deleted', clock_timestamp()")
    const phaseTwo = source.slice(source.indexOf('export async function completeMessagingDeletion'))
    const positions = [
      'select id from shops', 'select id from messaging_deletion_requests',
      'select id from customers', 'select id, state', 'select id from messaging_consent_state',
      'select id from sms_log', 'select id from notifications', 'from messaging_retention_holds',
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
})
