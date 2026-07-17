import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recordQuoteDecision, type QuoteActor } from '@/lib/shop-os/quotes'
import {
  customers, profiles, quoteEvents, quoteVersions, shops, ticketJobs, tickets, vehicles,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS exact-version phone/in-person decisions', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let ticketId: string
  let jobId: string
  let versionId: string
  let actor: QuoteActor

  const snapshot = (overrides: Record<string, unknown> = {}) => ({
    schemaVersion: 1,
    ticket: {
      id: ticketId, number: 1, customerId: uuid(10), vehicleId: uuid(11),
      laborRateCents: 15_000, taxRateBps: 825,
    },
    jobs: [{
      id: jobId, title: 'Front brakes', kind: 'repair', customerStory: null, storyMeta: null,
      lines: [{
        id: uuid(40), kind: 'fee', description: 'Inspection', quantity: '1', priceCents: 500,
        taxable: true, partNumber: null, brand: null, coreChargeCents: null, fitment: null,
        laborHours: null, laborRateCents: null, source: 'manual', vendorContext: null,
      }],
      attachments: [], totals: { subtotalCents: 500, taxableSubtotalCents: 500 },
    }],
    totals: { subtotalCents: 500, taxableSubtotalCents: 500, taxCents: 41, totalCents: 541 },
    ...overrides,
  })

  const diagnosticStory = {
    whatYouToldUs: 'Brake noise', whatWeFound: 'Pads are worn', howWeKnow: [],
    whatItMeansIfWaived: 'Stopping distance may increase', whatWeRecommend: 'Replace pads',
  }

  const approvedBody = (requestKey = uuid(100), overrides: Record<string, unknown> = {}) => ({
    requestKey, jobId, quoteVersionId: versionId, decision: 'approved', approvedVia: 'phone',
    ...overrides,
  })
  const declinedBody = (requestKey = uuid(101), overrides: Record<string, unknown> = {}) => ({
    requestKey, jobId, quoteVersionId: versionId, decision: 'declined', ...overrides,
  })
  const decide = (body: unknown = approvedBody(), overrides: Record<string, unknown> = {}, dependencies = {}) =>
    recordQuoteDecision(db, { actor, ticketId, body, ...overrides }, dependencies)
  const overwriteSnapshot = async (value: unknown) => {
    await db.execute(sql`alter table quote_versions disable trigger all`)
    await db.execute(sql`update quote_versions set snapshot = ${JSON.stringify(value)}::jsonb where id = ${versionId}`)
    await db.execute(sql`alter table quote_versions enable trigger all`)
  }
  const decisionState = async () => ({
    ticket: (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0],
    job: (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0],
    events: await db.select().from(quoteEvents),
  })

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North', laborRateCents: 15_000, taxRateBps: 825 },
      { name: 'South', laborRateCents: 20_000, taxRateBps: 700 },
    ]).returning()
    shopId = shop.id
    otherShopId = otherShop.id
    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(201), shopId, role: 'advisor' },
      { id: uuid(2), userId: uuid(202), shopId, role: 'owner' },
      { id: uuid(3), userId: uuid(203), shopId, role: 'tech' },
      { id: uuid(4), userId: uuid(204), shopId, role: 'parts' },
      { id: uuid(5), userId: uuid(205), shopId, role: 'founder' },
      { id: uuid(6), userId: uuid(206), shopId: otherShopId, role: 'owner' },
    ])
    actor = { profileId: uuid(1) }
    await db.insert(customers).values([
      { id: uuid(10), shopId, name: 'Customer', phone: '5551234567' },
      { id: uuid(12), shopId: otherShopId, name: 'Other', phone: '5552222222' },
    ])
    await db.insert(vehicles).values([
      { id: uuid(11), customerId: uuid(10), year: 2020, make: 'Ford', model: 'F-150' },
      { id: uuid(13), customerId: uuid(12), year: 2021, make: 'Honda', model: 'Civic' },
    ])
    ticketId = uuid(20)
    await db.insert(tickets).values([
      {
        id: ticketId, shopId, ticketNumber: 1, source: 'counter', customerId: uuid(10),
        vehicleId: uuid(11), concern: 'Brake noise', createdByProfileId: uuid(1),
      },
      {
        id: uuid(21), shopId: otherShopId, ticketNumber: 1, source: 'counter', customerId: uuid(12),
        vehicleId: uuid(13), concern: 'Other', createdByProfileId: uuid(6),
      },
      {
        id: uuid(22), shopId, ticketNumber: 2, source: 'counter', customerId: uuid(10),
        vehicleId: uuid(11), concern: 'Same-shop other ticket', createdByProfileId: uuid(1),
      },
    ])
    jobId = uuid(30)
    await db.insert(ticketJobs).values([
      { id: jobId, shopId, ticketId, title: 'Front brakes', kind: 'repair', requiredSkillTier: 1, approvalState: 'quote_ready' },
      { id: uuid(31), shopId: otherShopId, ticketId: uuid(21), title: 'Other', kind: 'repair', requiredSkillTier: 1 },
    ])
    const [version] = await db.insert(quoteVersions).values({
      id: uuid(50), shopId, ticketId, versionNumber: 1, snapshot: snapshot(), createdByProfileId: uuid(1),
    }).returning()
    versionId = version.id
  })

  afterEach(async () => close())

  it('uses the bounded profile-first coordinator, shop serialization, and one revision finalizer', () => {
    const source = readFileSync(join(process.cwd(), 'lib/shop-os/quotes.ts'), 'utf8')
    const helper = source.slice(source.indexOf('function decisionNotFound'), source.indexOf('type NormalizedLine'))
    expect(helper).toContain('runBoundedShopOsMutationV1')
    expect(helper).toContain('lockShop: true')
    expect(helper).toContain('includeAllQuoteVersionsForTickets: true')
    expect(helper).toContain('includeAllQuoteEventsForTickets: true')
    expect(helper.match(/finalizeMutationRevisionsV1/g)).toHaveLength(1)
    expect(helper).toContain('afterDiscovery')
    expect(helper).toContain('afterWrite')
    expect(helper).toContain('afterFinalization')
    expect(helper).not.toContain('db.transaction')
    expect(helper).not.toMatch(/\.for\('update'/)
    expect(helper).not.toMatch(/revision:\s*sql/)
    expect(helper).not.toContain('ticketMutationReceipts')
    expect(helper).not.toMatch(/approvedQuoteVersionId:\s*z\.|approvalState:\s*z\./)
  })

  it('accepts only the strict decision union and canonicalizes uppercase UUIDs', async () => {
    await expect(decide({ ...approvedBody(), approvedVia: 'page' })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(decide({ ...approvedBody(), extra: true })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(decide({ ...declinedBody(), approvedVia: 'phone' })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(decide({ ...declinedBody(), decision: 'sent' })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    const upper = approvedBody('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'.toUpperCase())
    const first = await decide({ ...upper, jobId: jobId.toUpperCase(), quoteVersionId: versionId.toUpperCase() })
    const retry = await decide(upper)
    expect(first).toMatchObject({ ok: true, changed: true })
    expect(retry).toMatchObject({ ok: true, changed: false })
    expect(await db.select().from(quoteEvents)).toHaveLength(1)
  })

  it('reauthorizes advisor/owner and hides role, membership, founder, and tenant boundaries', async () => {
    for (const profileId of [uuid(3), uuid(4), uuid(5), uuid(6)]) {
      await expect(decide(approvedBody(uuid(110)), { actor: { profileId } })).resolves.toEqual({ ok: false, error: 'not_found' })
    }
    await expect(decide(approvedBody(uuid(111)), { actor: { profileId: uuid(2) } })).resolves.toMatchObject({ ok: true })
    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null }).where(eq(profiles.id, uuid(1)))
    await expect(decide(approvedBody(uuid(112)))).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ membershipStatus: 'active', membershipActivatedAt: new Date(), deactivatedAt: new Date() }).where(eq(profiles.id, uuid(1)))
    await expect(decide(approvedBody(uuid(113)))).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('returns only a safe event and current projection', async () => {
    const result = await decide()
    expect(result).toMatchObject({
      ok: true, changed: true,
      event: { kind: 'approved', jobId, quoteVersionId: versionId, approvedVia: 'phone' },
      projection: { approvalState: 'approved', approvedQuoteVersionId: versionId },
    })
    expect(JSON.stringify(result)).not.toContain(shopId)
    expect(result).not.toHaveProperty('event.actorProfileId')
    expect(result).not.toHaveProperty('event.body')
    expect(result).not.toHaveProperty('event.userAgent')
  })

  it('returns an actor-bound exact retry before stale-version rejection and includes the latest projection', async () => {
    const first = await decide(approvedBody(uuid(120)))
    await expect(decide(declinedBody(uuid(121)))).resolves.toMatchObject({ ok: true, changed: true })
    await overwriteSnapshot(snapshot({ totals: { subtotalCents: 999, taxableSubtotalCents: 500, taxCents: 41, totalCents: 1_040 } }))
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.id, versionId))
    await db.update(ticketJobs).set({ approvalState: 'pending_quote', approvedQuoteVersionId: null }).where(eq(ticketJobs.id, jobId))
    const beforeReplay = await decisionState()
    const retry = await decide(approvedBody(uuid(120)))
    expect(first).toMatchObject({ ok: true, changed: true, projection: { approvalState: 'approved' } })
    expect(retry).toMatchObject({
      ok: true, changed: false, event: { kind: 'approved' },
      projection: { approvalState: 'pending_quote', approvedQuoteVersionId: null },
    })
    expect(await decisionState()).toEqual(beforeReplay)
    const beforeDeniedReplay = await decisionState()
    await db.update(profiles).set({ role: 'tech' }).where(eq(profiles.id, uuid(1)))
    await expect(decide(approvedBody(uuid(120)))).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await decisionState()).toEqual(beforeDeniedReplay)
  })

  it('classifies first decisions, reversals, and new-key same-state events at bigint-safe revisions', async () => {
    const hugeJobRevision = 9_007_199_254_740_993n
    const hugeProjectionRevision = 9_007_199_254_741_993n
    const hugeContinuityRevision = 9_007_199_254_742_993n
    await db.update(ticketJobs).set({ revision: hugeJobRevision }).where(eq(ticketJobs.id, jobId))
    await db.update(tickets).set({
      projectionRevision: hugeProjectionRevision,
      continuityRevision: hugeContinuityRevision,
    }).where(eq(tickets.id, ticketId))

    for (const [body, expected] of [
      [approvedBody(uuid(122)), { job: 1n, projection: 1n, continuity: 1n }],
      [declinedBody(uuid(123)), { job: 2n, projection: 2n, continuity: 2n }],
      [declinedBody(uuid(124)), { job: 3n, projection: 3n, continuity: 2n }],
    ] as const) {
      await expect(decide(body)).resolves.toMatchObject({ ok: true, changed: true })
      const state = await decisionState()
      expect(state.job.revision).toBe(hugeJobRevision + expected.job)
      expect(state.ticket.projectionRevision).toBe(hugeProjectionRevision + expected.projection)
      expect(state.ticket.continuityRevision).toBe(hugeContinuityRevision + expected.continuity)
    }

    const beforeReplay = await decisionState()
    await expect(decide(declinedBody(uuid(124)))).resolves.toMatchObject({ ok: true, changed: false })
    expect(await decisionState()).toEqual(beforeReplay)
  })

  it('conflicts on changed or cross-actor request-key reuse', async () => {
    await decide(approvedBody(uuid(130)))
    await expect(decide(approvedBody(uuid(130), { approvedVia: 'in_person' }))).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await expect(decide(declinedBody(uuid(130)))).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await expect(decide(approvedBody(uuid(130)), { actor: { profileId: uuid(2) } })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('serializes request keys within a shop without coupling independent shops', async () => {
    const sameShopTicketId = uuid(22)
    const sameShopJobId = uuid(32)
    const sameShopVersionId = uuid(52)
    const otherShopTicketId = uuid(21)
    const otherShopJobId = uuid(31)
    const otherShopVersionId = uuid(53)
    const requestKey = uuid(131)
    const sameShopSnapshot = snapshot({
      ticket: { ...snapshot().ticket, id: sameShopTicketId, number: 2 },
      jobs: [{
        ...snapshot().jobs[0], id: sameShopJobId,
        lines: [{ ...snapshot().jobs[0].lines[0], id: uuid(42) }],
      }],
    })
    const otherShopSnapshot = snapshot({
      ticket: {
        id: otherShopTicketId, number: 1, customerId: uuid(12), vehicleId: uuid(13),
        laborRateCents: 20_000, taxRateBps: 700,
      },
      jobs: [{
        ...snapshot().jobs[0], id: otherShopJobId,
        lines: [{ ...snapshot().jobs[0].lines[0], id: uuid(43) }],
      }],
      totals: { subtotalCents: 500, taxableSubtotalCents: 500, taxCents: 35, totalCents: 535 },
    })
    await db.insert(ticketJobs).values({
      id: sameShopJobId, shopId, ticketId: sameShopTicketId, title: 'Same-shop job',
      kind: 'repair', requiredSkillTier: 1, approvalState: 'quote_ready',
    })
    await db.insert(quoteVersions).values([
      {
        id: sameShopVersionId, shopId, ticketId: sameShopTicketId, versionNumber: 1,
        snapshot: sameShopSnapshot, createdByProfileId: uuid(1),
      },
      {
        id: otherShopVersionId, shopId: otherShopId, ticketId: otherShopTicketId,
        versionNumber: 1, snapshot: otherShopSnapshot, createdByProfileId: uuid(6),
      },
    ])

    await expect(decide(approvedBody(requestKey))).resolves.toMatchObject({ ok: true, changed: true })
    const beforeCollision = {
      ticket: (await db.select().from(tickets).where(eq(tickets.id, sameShopTicketId)))[0],
      job: (await db.select().from(ticketJobs).where(eq(ticketJobs.id, sameShopJobId)))[0],
      events: await db.select().from(quoteEvents),
    }
    await expect(decide({
      ...approvedBody(requestKey), jobId: sameShopJobId, quoteVersionId: sameShopVersionId,
    }, { ticketId: sameShopTicketId })).resolves.toEqual({
      ok: false, error: 'conflict', retryable: false,
    })
    expect({
      ticket: (await db.select().from(tickets).where(eq(tickets.id, sameShopTicketId)))[0],
      job: (await db.select().from(ticketJobs).where(eq(ticketJobs.id, sameShopJobId)))[0],
      events: await db.select().from(quoteEvents),
    }).toEqual(beforeCollision)

    await expect(decide({
      ...approvedBody(requestKey), jobId: otherShopJobId, quoteVersionId: otherShopVersionId,
    }, {
      actor: { profileId: uuid(6) }, ticketId: otherShopTicketId,
    })).resolves.toMatchObject({ ok: true, changed: true })
    const [otherShopTicket] = await db.select().from(tickets).where(eq(tickets.id, otherShopTicketId))
    const [otherShopJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, otherShopJobId))
    expect(otherShopTicket).toMatchObject({ projectionRevision: 1n, continuityRevision: 1n })
    expect(otherShopJob).toMatchObject({ revision: 1n, approvalState: 'approved' })
    expect(await db.select().from(quoteEvents)).toHaveLength(2)
  })

  it('requires an open reconciled ticket and the current exact same-ticket version/job', async () => {
    await expect(decide(approvedBody(uuid(145)), { ticketId: uuid(22) })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.insert(tickets).values({
      id: uuid(23), shopId, ticketNumber: 3, source: 'tech_quick',
      customerId: null, vehicleId: null, concern: 'Provisional', createdByProfileId: uuid(1),
    })
    await expect(decide(approvedBody(uuid(141)), { ticketId: uuid(23) })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.id, versionId))
    await expect(decide(approvedBody(uuid(142)))).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(decide(approvedBody(uuid(143), { quoteVersionId: uuid(999) }))).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(decide(approvedBody(uuid(144), { jobId: uuid(999) }))).resolves.toEqual({ ok: false, error: 'not_found' })
    const canceledAt = new Date()
    await db.update(ticketJobs).set({ workStatus: 'canceled' }).where(eq(ticketJobs.id, jobId))
    await db.update(tickets).set({
      status: 'canceled', canceledAt, canceledByProfileId: uuid(1),
      cancelReasonCode: 'administrative_error',
    }).where(eq(tickets.id, ticketId))
    await expect(decide(approvedBody(uuid(140)))).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('locks complete page and offline history without broadening the private input contract', async () => {
    await db.insert(quoteEvents).values([
      {
        id: uuid(60), shopId, ticketId, quoteVersionId: versionId,
        kind: 'sent', requestKey: uuid(330),
      },
      {
        id: uuid(61), shopId, ticketId, quoteVersionId: versionId,
        kind: 'viewed', requestKey: uuid(331),
      },
      {
        id: uuid(62), shopId, ticketId, jobId, quoteVersionId: versionId,
        kind: 'approved', approvedVia: 'page', requestKey: uuid(332),
      },
    ])
    await db.update(ticketJobs).set({
      approvalState: 'approved', approvedQuoteVersionId: versionId,
    }).where(eq(ticketJobs.id, jobId))

    const beforeInvalidPage = await decisionState()
    await expect(decide(approvedBody(uuid(333), { approvedVia: 'page' }))).resolves.toEqual({
      ok: false, error: 'invalid_input',
    })
    expect(await decisionState()).toEqual(beforeInvalidPage)

    await expect(decide(declinedBody(uuid(334)))).resolves.toMatchObject({
      ok: true, changed: true, event: { kind: 'declined', approvedVia: null },
    })
    const after = await decisionState()
    expect(after.events).toHaveLength(4)
    expect(after.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: uuid(60), kind: 'sent' }),
      expect.objectContaining({ id: uuid(61), kind: 'viewed' }),
      expect.objectContaining({ id: uuid(62), kind: 'approved', approvedVia: 'page' }),
      expect.objectContaining({ kind: 'declined', approvedVia: null }),
    ]))
    expect(after.ticket).toMatchObject({ projectionRevision: 1n, continuityRevision: 1n })
    expect(after.job).toMatchObject({ revision: 1n, approvalState: 'declined' })
  })

  it.each(['membership', 'deactivation', 'shop', 'role'] as const)(
    'hides locked actor %s drift and preserves the complete decision state',
    async (drift) => {
      actor = { profileId: uuid(2) }
      const before = await decisionState()
      if (drift === 'membership') {
        await db.update(profiles).set({
          membershipStatus: 'pending', membershipActivatedAt: null,
        }).where(eq(profiles.id, actor.profileId))
      } else if (drift === 'deactivation') {
        await db.update(profiles).set({ deactivatedAt: new Date() })
          .where(eq(profiles.id, actor.profileId))
      } else if (drift === 'shop') {
        await db.update(profiles).set({ shopId: otherShopId })
          .where(eq(profiles.id, actor.profileId))
      } else {
        await db.update(profiles).set({ role: 'tech', skillTier: 3 })
          .where(eq(profiles.id, actor.profileId))
      }

      const result = await decide(approvedBody(uuid(340)))

      expect(result).toEqual({ ok: false, error: 'not_found' })
      expect(result).not.toHaveProperty('event')
      expect(await decisionState()).toEqual(before)
    },
  )

  it('fails closed without disclosure when locked customer and vehicle ancestry drifts', async () => {
    await db.insert(customers).values({
      id: uuid(14), shopId, name: 'Same-shop other customer', phone: '5553333333',
    })
    await db.execute(sql`alter table vehicles disable trigger all`)
    await db.update(vehicles).set({ customerId: uuid(14) }).where(eq(vehicles.id, uuid(11)))
    await db.execute(sql`alter table vehicles enable trigger all`)
    const before = await decisionState()

    const result = await decide(approvedBody(uuid(350)))

    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(result).not.toHaveProperty('event')
    expect(await decisionState()).toEqual(before)
  })

  it('fails closed when a historical graph profile reference becomes inactive', async () => {
    actor = { profileId: uuid(2) }
    await db.update(profiles).set({ deactivatedAt: new Date() })
      .where(eq(profiles.id, uuid(1)))
    const before = await decisionState()

    const result = await decide(approvedBody(uuid(351)))

    expect(result).toEqual({ ok: false, error: 'not_found' })
    expect(result).not.toHaveProperty('event')
    expect(await decisionState()).toEqual(before)
  })

  it('fails closed when more than one ticket version is current', async () => {
    await db.insert(quoteVersions).values({
      id: uuid(51), shopId, ticketId, versionNumber: 2, snapshot: snapshot(), createdByProfileId: uuid(1),
    })
    await expect(decide(approvedBody(uuid(146)))).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(quoteEvents)).toHaveLength(0)
  })

  it('rejects wrong-ticket and malformed snapshots plus canceled/in-progress jobs', async () => {
    await overwriteSnapshot(snapshot({ ticket: { ...snapshot().ticket, id: uuid(999) } }))
    await expect(decide(approvedBody(uuid(150)))).resolves.toEqual({ ok: false, error: 'not_found' })
    await overwriteSnapshot(snapshot())
    const forbiddenJobStates = [
      { kind: 'repair' as const, workStatus: 'canceled' as const },
      { kind: 'repair' as const, workStatus: 'in_progress' as const },
    ]
    for (const [index, update] of forbiddenJobStates.entries()) {
      await db.update(ticketJobs).set(update).where(eq(ticketJobs.id, jobId))
      await expect(decide(approvedBody(uuid(151 + index)))).resolves.toEqual({ ok: false, error: 'not_found' })
    }
  })

  it('permits diagnostic decisions only when the exact active snapshot contains a valid reviewed/manual story', async () => {
    await db.update(ticketJobs).set({ kind: 'diagnostic' }).where(eq(ticketJobs.id, jobId))
    const diagnosticSnapshot = (storyMeta: unknown, customerStory: unknown = diagnosticStory) => snapshot({
      jobs: [{ ...snapshot().jobs[0], kind: 'diagnostic', customerStory, storyMeta }],
    })
    for (const [index, invalid] of [
      diagnosticSnapshot(null, null),
      diagnosticSnapshot(null),
      diagnosticSnapshot({ source: 'template' }),
      diagnosticSnapshot({ source: 'manual', sessionId: uuid(70) }, {
        ...diagnosticStory,
        howWeKnow: [{ claim: 'Fabricated proof.', sourceEventIds: [uuid(71)], sourceArtifactIds: [] }],
      }),
    ].entries()) {
      await overwriteSnapshot(invalid)
      await expect(decide(approvedBody(uuid(300 + index)))).resolves.toEqual({ ok: false, error: 'not_found' })
    }
    await overwriteSnapshot(diagnosticSnapshot({ source: 'manual', sessionId: uuid(70) }))
    await expect(decide(approvedBody(uuid(310)))).resolves.toMatchObject({
      ok: true, event: { kind: 'approved', approvedVia: 'phone' },
    })
    await overwriteSnapshot(diagnosticSnapshot({ source: 'ai', sessionId: uuid(70) }))
    await expect(decide(declinedBody(uuid(311)))).resolves.toMatchObject({
      ok: true, event: { kind: 'declined' },
    })
  })

  it('rejects semantically forged active snapshots before a new decision', async () => {
    const base = snapshot()
    const targetJob = base.jobs[0]
    const secondJob = {
      ...targetJob,
      id: uuid(32),
      lines: [{ ...targetJob.lines[0], id: uuid(41) }],
      attachments: [],
    }
    const oversizedStory = {
      whatYouToldUs: 'x'.repeat(5_000),
      whatWeFound: 'x'.repeat(5_000),
      howWeKnow: [],
      whatItMeansIfWaived: 'x'.repeat(5_000),
      whatWeRecommend: 'x'.repeat(5_000),
    }
    const oversizedJobs = [0, 1, 2, 3].map((index) => ({
      ...targetJob,
      id: index === 0 ? jobId : uuid(60 + index),
      customerStory: oversizedStory,
      lines: [{ ...targetJob.lines[0], id: uuid(70 + index) }],
      attachments: [],
    }))
    const invalidSnapshots = [
      snapshot({ jobs: [{ ...targetJob, lines: [] }] }),
      snapshot({ jobs: [targetJob, secondJob], totals: { subtotalCents: 1_000, taxableSubtotalCents: 1_000, taxCents: 83, totalCents: 1_083 } }),
      snapshot({ jobs: [{ ...targetJob, attachments: [{ id: uuid(80), jobId: uuid(999), kind: 'photo' }] }] }),
      snapshot({ jobs: [{ ...targetJob, totals: { subtotalCents: 501, taxableSubtotalCents: 500 } }] }),
      snapshot({ jobs: [targetJob, { ...secondJob, lines: [{ ...secondJob.lines[0], id: targetJob.lines[0].id }] }], totals: { subtotalCents: 1_000, taxableSubtotalCents: 1_000, taxCents: 83, totalCents: 1_083 } }),
      snapshot({ jobs: [
        { ...targetJob, attachments: [{ id: uuid(81), jobId, kind: 'photo' }] },
        { ...secondJob, attachments: [{ id: uuid(81), jobId: secondJob.id, kind: 'photo' }] },
      ], totals: { subtotalCents: 1_000, taxableSubtotalCents: 1_000, taxCents: 83, totalCents: 1_083 } }),
      snapshot({ ticket: { ...base.ticket, number: 999 } }),
      snapshot({
        jobs: oversizedJobs,
        totals: { subtotalCents: 2_000, taxableSubtotalCents: 2_000, taxCents: 165, totalCents: 2_165 },
      }),
    ]
    for (const [index, invalidSnapshot] of invalidSnapshots.entries()) {
      await overwriteSnapshot(invalidSnapshot)
      await expect(decide(approvedBody(uuid(210 + index)))).resolves.toEqual({ ok: false, error: 'not_found' })
    }
  })

  it('atomically approves, declines, and allows new-key reversals on the current version', async () => {
    await expect(decide(approvedBody(uuid(160), { approvedVia: 'in_person' }))).resolves.toMatchObject({
      ok: true, event: { kind: 'approved', approvedVia: 'in_person' },
      projection: { approvalState: 'approved', approvedQuoteVersionId: versionId },
    })
    await expect(decide(declinedBody(uuid(161)))).resolves.toMatchObject({
      ok: true, event: { kind: 'declined', approvedVia: null },
      projection: { approvalState: 'declined', approvedQuoteVersionId: null },
    })
    await expect(decide(approvedBody(uuid(162)))).resolves.toMatchObject({
      ok: true, projection: { approvalState: 'approved', approvedQuoteVersionId: versionId },
    })
    expect(await db.select().from(quoteEvents)).toHaveLength(3)
  })

  it('deterministically converges same-client Promise.all calls and serializes different keys', async () => {
    const [left, right] = await Promise.all([
      decide(approvedBody(uuid(170))), decide(approvedBody(uuid(170))),
    ])
    expect([left, right].filter((result) => result.ok && result.changed)).toHaveLength(1)
    expect(await db.select().from(quoteEvents)).toHaveLength(1)
    await Promise.all([decide(declinedBody(uuid(171))), decide(approvedBody(uuid(172)))])
    expect(await db.select().from(quoteEvents)).toHaveLength(3)
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(['approved', 'declined']).toContain(job.approvalState)
    expect(job.approvalState === 'approved' ? job.approvedQuoteVersionId : null).toBe(job.approvedQuoteVersionId)
  })

  it('rolls back the event and projection when the post-write seam fails', async () => {
    const marker = new Error('after write')
    const before = await decisionState()

    await expect(decide(approvedBody(uuid(180)), {}, {
      afterWrite: async () => { throw marker },
    })).rejects.toBe(marker)

    expect(await decisionState()).toEqual(before)
  })

  it('rolls back the event, projection, and both revision layers after finalization', async () => {
    const marker = new Error('after finalization')
    const before = await decisionState()

    await expect(decide(approvedBody(uuid(181)), {}, {
      afterFinalization: async () => { throw marker },
    })).rejects.toBe(marker)

    expect(await decisionState()).toEqual(before)
  })

  it.each(['55P03', '40001', '40P01'] as const)(
    'exhausts two bounded attempts for SQLSTATE %s without leaking a partial decision',
    async (code) => {
      let attempts = 0
      const before = await decisionState()

      const result = await decide(approvedBody(uuid(191)), {}, {
        afterDiscovery: async () => {
          attempts += 1
          throw Object.assign(new Error(code), { code })
        },
      })

      expect(result).toEqual({ ok: false, error: 'conflict', retryable: true })
      expect(attempts).toBe(2)
      expect(await decisionState()).toEqual(before)
    },
  )

  it('keeps quote events append-only and exposes no direct projection mutation handler', async () => {
    await decide(approvedBody(uuid(200)))
    await expect(db.update(quoteEvents).set({ body: 'changed' })).rejects.toThrow()
    await expect(db.delete(quoteEvents)).rejects.toThrow()
    const source = readFileSync(join(process.cwd(), 'lib/shop-os/quotes.ts'), 'utf8')
    expect(source).not.toMatch(/export async function (?:repoint|clear|set)QuoteApproval/i)
  })
})
