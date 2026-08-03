import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createHash } from 'node:crypto'
import {
  customers,
  profiles,
  quoteEvents,
  quoteSends,
  quoteVersions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import {
  createCustomerApprovalLink,
  loadCustomerApproval,
  recordCustomerApprovalResponse,
} from '@/lib/shop-os/customer-approval'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) => `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`
const TOKEN = 'A'.repeat(43)
const TOKEN_HASH = createHash('sha256').update(TOKEN).digest('hex')
const SECOND_TOKEN = 'B'.repeat(43)
const SECOND_TOKEN_HASH = createHash('sha256').update(SECOND_TOKEN).digest('hex')

describe('Shop OS customer approval handoff', () => {
  let db: TestDb
  let close: () => Promise<void>
  const shopId = uuid(1)
  const actorId = uuid(2)
  const customerId = uuid(3)
  const vehicleId = uuid(4)
  const ticketId = uuid(5)
  const jobId = uuid(6)
  const lineId = uuid(7)
  const versionId = uuid(8)

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({
      id: shopId,
      name: 'Approval Auto',
      phone: '555-0100',
      laborRateCents: 10_000,
      taxRateBps: 0,
    })
    await db.insert(customers).values({
      id: customerId,
      shopId,
      name: 'Casey Customer',
      phone: '555-0199',
    })
    await db.insert(vehicles).values({
      id: vehicleId,
      customerId,
      year: 2020,
      make: 'Ford',
      model: 'F-150',
    })
    await db.insert(profiles).values({
      id: actorId,
      userId: uuid(20),
      shopId,
      role: 'advisor',
    })
    await db.insert(tickets).values({
      id: ticketId,
      shopId,
      ticketNumber: 42,
      source: 'counter',
      customerId,
      vehicleId,
      concern: 'Brake noise',
      createdByProfileId: actorId,
    })
    await db.insert(ticketJobs).values({
      id: jobId,
      shopId,
      ticketId,
      title: 'Front brake repair',
      kind: 'repair',
      requiredSkillTier: 1,
      approvalState: 'quote_ready',
    })
    await db.insert(quoteVersions).values({
      id: versionId,
      shopId,
      ticketId,
      versionNumber: 1,
      createdByProfileId: actorId,
      snapshot: {
        schemaVersion: 1,
        ticket: {
          id: ticketId,
          number: 42,
          customerId,
          vehicleId,
          laborRateCents: 10_000,
          taxRateBps: 0,
        },
        jobs: [{
          id: jobId,
          title: 'Front brake repair',
          kind: 'repair',
          customerStory: {
            whatYouToldUs: 'The brakes grind at low speed.',
            whatWeFound: 'The front pads are below service thickness.',
            howWeKnow: [{
              claim: 'The pad gauge measured below the service limit.',
              sourceEventIds: [uuid(70)],
              sourceArtifactIds: [uuid(71)],
            }],
            whatItMeansIfWaived: 'Stopping distance can increase.',
            whatWeRecommend: 'Replace the front brake pads.',
          },
          storyMeta: {
            source: 'manual',
            sessionId: uuid(72),
          },
          lines: [{
            id: lineId,
            kind: 'labor',
            description: 'Replace front brake pads',
            quantity: '1',
            priceCents: 10_000,
            taxable: false,
            partNumber: null,
            brand: null,
            coreChargeCents: null,
            fitment: null,
            laborHours: '1',
            laborRateCents: 10_000,
            source: 'manual',
            vendorContext: null,
          }],
          attachments: [],
          totals: { subtotalCents: 10_000, taxableSubtotalCents: 0 },
        }],
        totals: {
          subtotalCents: 10_000,
          taxableSubtotalCents: 0,
          taxCents: 0,
          totalCents: 10_000,
        },
      },
    })
  })

  afterEach(async () => close())

  it('creates, views, and atomically resolves one exact-version link without storing the raw token', async () => {
    const created = await createCustomerApprovalLink(db, {
      actor: { profileId: actorId },
      ticketId,
      body: { requestKey: uuid(30), quoteVersionId: versionId, tokenHash: TOKEN_HASH },
    })
    expect(created).toMatchObject({
      ok: true,
      changed: true,
      link: { quoteVersionId: versionId, versionNumber: 1 },
    })
    const sends = await db.select().from(quoteSends)
    expect(sends).toHaveLength(1)
    expect(JSON.stringify(sends)).not.toContain(TOKEN)
    expect(sends[0]).toMatchObject({
      channel: 'link',
      state: 'submitted',
      tokenHash: TOKEN_HASH,
      customerId,
      subjectKey: customerId,
    })

    const loaded = await loadCustomerApproval(db, { token: TOKEN })
    expect(loaded).toEqual({
      ok: true,
      quote: {
        shop: { name: 'Approval Auto', phone: '555-0100' },
        customer: { name: 'Casey Customer' },
        vehicle: { year: 2020, make: 'Ford', model: 'F-150' },
        ticketNumber: 42,
        versionNumber: 1,
        expiresAt: expect.any(String),
        jobs: [{
          id: jobId,
          title: 'Front brake repair',
          story: {
            whatYouToldUs: 'The brakes grind at low speed.',
            whatWeFound: 'The front pads are below service thickness.',
            howWeKnow: [{ claim: 'The pad gauge measured below the service limit.' }],
            whatItMeansIfWaived: 'Stopping distance can increase.',
            whatWeRecommend: 'Replace the front brake pads.',
          },
          lines: [{
            kind: 'labor',
            description: 'Replace front brake pads',
            quantity: '1',
            priceCents: 10_000,
          }],
          subtotalCents: 10_000,
          taxableSubtotalCents: 0,
        }],
        totals: { subtotalCents: 10_000, taxCents: 0, totalCents: 10_000 },
        taxRateBps: 0,
      },
    })
    const serializedQuote = JSON.stringify(loaded)
    for (const forbidden of [
      'sourceEventIds', 'sourceArtifactIds', 'sessionId', 'actorProfileId',
      'lastEditedByProfileId', 'reviewedByProfileId', 'storyMeta', 'metadata',
    ]) expect(serializedQuote).not.toContain(forbidden)
    expect((await db.select().from(ticketJobs))[0]?.approvalState).toBe('sent')
    expect(await db.select().from(quoteEvents)).toEqual([
      expect.objectContaining({
        shopId,
        ticketId,
        quoteVersionId: versionId,
        quoteSendId: sends[0]!.id,
        kind: 'viewed',
        actorProfileId: null,
      }),
    ])

    const response = await recordCustomerApprovalResponse(db, {
      token: TOKEN,
      body: {
        requestKey: uuid(31),
        decisions: [{ jobId, decision: 'approved' }],
      },
    })
    expect(response).toEqual({
      ok: true,
      changed: true,
      receipt: {
        versionNumber: 1,
        decisions: [{ jobId, decision: 'approved' }],
        approvedTotalCents: 10_000,
      },
    })
    expect((await db.select().from(ticketJobs))[0]).toMatchObject({
      approvalState: 'approved',
      approvedQuoteVersionId: versionId,
    })
    expect((await db.select().from(quoteSends))[0]).toMatchObject({
      state: 'responded',
      tokenHash: null,
      tokenExpiresAt: null,
    })
    const events = await db.select().from(quoteEvents)
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({
      kind: 'approved',
      approvedVia: 'page',
      jobId,
      quoteSendId: sends[0]!.id,
    })
    await expect(loadCustomerApproval(db, { token: TOKEN })).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    })
  })

  it('treats same-ticket version drift as a recoverable conflict without creating a link', async () => {
    await expect(createCustomerApprovalLink(db, {
      actor: { profileId: actorId },
      ticketId,
      body: { requestKey: uuid(30), quoteVersionId: uuid(999), tokenHash: TOKEN_HASH },
    })).resolves.toEqual({ ok: false, error: 'conflict' })
    expect(await db.select().from(quoteSends)).toEqual([])
  })

  it('returns a conflict when one actor reuses a request key on another ticket', async () => {
    const secondTicketId = uuid(50)
    const secondJobId = uuid(51)
    const secondVersionId = uuid(52)
    const [storedVersion] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, versionId))
    const secondSnapshot = structuredClone(storedVersion!.snapshot) as {
      ticket: { id: string; number: number }
      jobs: Array<{ id: string }>
    }
    secondSnapshot.ticket.id = secondTicketId
    secondSnapshot.ticket.number = 43
    secondSnapshot.jobs[0]!.id = secondJobId

    await db.insert(tickets).values({
      id: secondTicketId,
      shopId,
      ticketNumber: 43,
      source: 'counter',
      customerId,
      vehicleId,
      concern: 'Second repair order',
      createdByProfileId: actorId,
    })
    await db.insert(ticketJobs).values({
      id: secondJobId,
      shopId,
      ticketId: secondTicketId,
      title: 'Second brake repair',
      kind: 'repair',
      requiredSkillTier: 1,
      approvalState: 'quote_ready',
    })
    await db.insert(quoteVersions).values({
      id: secondVersionId,
      shopId,
      ticketId: secondTicketId,
      versionNumber: 1,
      createdByProfileId: actorId,
      snapshot: secondSnapshot,
    })

    const requestKey = uuid(53)
    await expect(createCustomerApprovalLink(db, {
      actor: { profileId: actorId },
      ticketId,
      body: { requestKey, quoteVersionId: versionId, tokenHash: TOKEN_HASH },
    })).resolves.toMatchObject({ ok: true, changed: true })

    await expect(createCustomerApprovalLink(db, {
      actor: { profileId: actorId },
      ticketId: secondTicketId,
      body: { requestKey, quoteVersionId: secondVersionId, tokenHash: SECOND_TOKEN_HASH },
    })).resolves.toEqual({ ok: false, error: 'conflict' })
    expect(await db.select().from(quoteSends)).toHaveLength(1)
  })

  it('expires a past-TTL creation replay instead of returning a dead link', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'))
      const body = { requestKey: uuid(30), quoteVersionId: versionId, tokenHash: TOKEN_HASH }
      await expect(createCustomerApprovalLink(db, {
        actor: { profileId: actorId }, ticketId, body,
      })).resolves.toMatchObject({ ok: true, changed: true })

      vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'))
      await expect(createCustomerApprovalLink(db, {
        actor: { profileId: actorId }, ticketId, body,
      })).resolves.toEqual({ ok: false, error: 'conflict' })

      expect((await db.select().from(quoteSends))[0]).toMatchObject({
        state: 'expired',
        tokenHash: null,
        tokenExpiresAt: null,
        terminalAt: expect.any(Date),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('revalidates an exact Copy replay and expires it after another channel decides the job', async () => {
    const body = { requestKey: uuid(30), quoteVersionId: versionId, tokenHash: TOKEN_HASH }
    await expect(createCustomerApprovalLink(db, {
      actor: { profileId: actorId }, ticketId, body,
    })).resolves.toMatchObject({ ok: true, changed: true })

    await expect(loadCustomerApproval(db, { token: TOKEN })).resolves.toMatchObject({ ok: true })
    await expect(createCustomerApprovalLink(db, {
      actor: { profileId: actorId }, ticketId, body,
    })).resolves.toMatchObject({ ok: true, changed: false })

    await db.update(ticketJobs).set({
      approvalState: 'approved',
      approvedQuoteVersionId: versionId,
    }).where(eq(ticketJobs.id, jobId))

    await expect(createCustomerApprovalLink(db, {
      actor: { profileId: actorId }, ticketId, body,
    })).resolves.toEqual({ ok: false, error: 'conflict' })
    expect((await db.select().from(quoteSends))[0]).toMatchObject({
      state: 'expired',
      tokenHash: null,
      tokenExpiresAt: null,
    })
  })

  it('replaces a viewed exact-version link while preserving sent state and link history', async () => {
    const first = await createCustomerApprovalLink(db, {
      actor: { profileId: actorId },
      ticketId,
      body: { requestKey: uuid(30), quoteVersionId: versionId, tokenHash: TOKEN_HASH },
    })
    expect(first).toMatchObject({ ok: true, changed: true })

    await expect(loadCustomerApproval(db, { token: TOKEN })).resolves.toMatchObject({ ok: true })
    expect((await db.select().from(ticketJobs))[0]).toMatchObject({
      approvalState: 'sent',
      approvedQuoteVersionId: null,
    })
    const [viewedSend] = await db.select().from(quoteSends)
    expect(viewedSend).toBeDefined()

    const replacement = await createCustomerApprovalLink(db, {
      actor: { profileId: actorId },
      ticketId,
      body: { requestKey: uuid(31), quoteVersionId: versionId, tokenHash: SECOND_TOKEN_HASH },
    })
    expect(replacement).toMatchObject({ ok: true, changed: true })

    await expect(loadCustomerApproval(db, { token: TOKEN })).resolves.toEqual({
      ok: false,
      error: 'unavailable',
    })
    await expect(loadCustomerApproval(db, { token: SECOND_TOKEN })).resolves.toMatchObject({ ok: true })

    const sends = await db.select().from(quoteSends)
    expect(sends).toHaveLength(2)
    expect(sends.find((send) => send.id === viewedSend!.id)).toMatchObject({
      state: 'expired',
      tokenHash: null,
      tokenExpiresAt: null,
      terminalAt: expect.any(Date),
    })
    const activeSend = sends.find((send) => send.tokenHash === SECOND_TOKEN_HASH)
    expect(activeSend).toMatchObject({
      state: 'submitted',
      tokenHash: SECOND_TOKEN_HASH,
      quoteVersionId: versionId,
    })
    expect((await db.select().from(ticketJobs))[0]).toMatchObject({
      approvalState: 'sent',
      approvedQuoteVersionId: null,
    })
    const events = await db.select().from(quoteEvents)
    expect(events).toHaveLength(2)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'viewed', quoteSendId: viewedSend!.id }),
      expect.objectContaining({ kind: 'viewed', quoteSendId: activeSend!.id }),
    ]))
  })

  it('rejects forged creation and incomplete customer decisions without writes', async () => {
    await expect(createCustomerApprovalLink(db, {
      actor: { profileId: actorId },
      ticketId,
      body: { requestKey: uuid(30), quoteVersionId: versionId, tokenHash: 'not-a-hash' },
    })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    expect(await db.select().from(quoteSends)).toEqual([])

    await createCustomerApprovalLink(db, {
      actor: { profileId: actorId },
      ticketId,
      body: { requestKey: uuid(30), quoteVersionId: versionId, tokenHash: TOKEN_HASH },
    })
    await expect(recordCustomerApprovalResponse(db, {
      token: TOKEN,
      body: { requestKey: uuid(31), decisions: [] },
    })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0]?.approvalState)
      .toBe('quote_ready')
    expect(await db.select().from(quoteEvents)).toEqual([])
  })

  it('expires the link instead of overwriting a decision recorded through another channel', async () => {
    await createCustomerApprovalLink(db, {
      actor: { profileId: actorId },
      ticketId,
      body: { requestKey: uuid(30), quoteVersionId: versionId, tokenHash: TOKEN_HASH },
    })
    await db.update(ticketJobs).set({
      approvalState: 'approved',
      approvedQuoteVersionId: versionId,
    }).where(eq(ticketJobs.id, jobId))

    await expect(recordCustomerApprovalResponse(db, {
      token: TOKEN,
      body: { requestKey: uuid(31), decisions: [{ jobId, decision: 'declined' }] },
    })).resolves.toEqual({ ok: false, error: 'unavailable' })

    expect((await db.select().from(ticketJobs))[0]).toMatchObject({
      approvalState: 'approved',
      approvedQuoteVersionId: versionId,
    })
    expect((await db.select().from(quoteSends))[0]).toMatchObject({
      state: 'expired',
      tokenHash: null,
      tokenExpiresAt: null,
    })
    expect(await db.select().from(quoteEvents)).toEqual([])
  })

  it('keeps malformed, unknown, expired, and used public links indistinguishable while replaying the exact response receipt', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'))
      const unavailableResults = [
        await loadCustomerApproval(db, { token: 'malformed' }),
        await loadCustomerApproval(db, { token: 'Z'.repeat(43) }),
      ]
      await createCustomerApprovalLink(db, {
        actor: { profileId: actorId }, ticketId,
        body: { requestKey: uuid(40), quoteVersionId: versionId, tokenHash: TOKEN_HASH },
      })
      vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'))
      unavailableResults.push(await loadCustomerApproval(db, { token: TOKEN }))

      await createCustomerApprovalLink(db, {
        actor: { profileId: actorId }, ticketId,
        body: { requestKey: uuid(41), quoteVersionId: versionId, tokenHash: SECOND_TOKEN_HASH },
      })
      const responseBody = {
        requestKey: uuid(42), decisions: [{ jobId, decision: 'declined' as const }],
      }
      const first = await recordCustomerApprovalResponse(db, { token: SECOND_TOKEN, body: responseBody })
      const replay = await recordCustomerApprovalResponse(db, { token: SECOND_TOKEN, body: responseBody })
      unavailableResults.push(await loadCustomerApproval(db, { token: SECOND_TOKEN }))

      expect(unavailableResults).toEqual(Array.from({ length: 4 }, () => ({
        ok: false, error: 'unavailable',
      })))
      expect(first).toMatchObject({ ok: true, changed: true, receipt: { versionNumber: 1 } })
      expect(replay).toEqual({
        ok: true,
        changed: false,
        receipt: { versionNumber: 1, decisions: responseBody.decisions, approvedTotalCents: 0 },
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
