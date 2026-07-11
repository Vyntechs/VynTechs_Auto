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

  it('locks ticket then stable jobs, exact version, request event, and actor with NOWAIT', () => {
    const source = readFileSync(join(process.cwd(), 'lib/shop-os/quotes.ts'), 'utf8')
    const helper = source.slice(source.indexOf('export async function recordQuoteDecision'), source.indexOf('type NormalizedLine'))
    expect(helper).toMatch(/\.from\(tickets\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(ticketJobs\)[\s\S]*?orderBy\(ticketJobs\.id\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(quoteVersions\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(quoteEvents\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(profiles\)[\s\S]*?\.for\('update', \{ noWait: true \}\)/)
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
    const retry = await decide(approvedBody(uuid(120)))
    expect(first).toMatchObject({ ok: true, changed: true, projection: { approvalState: 'approved' } })
    expect(retry).toMatchObject({
      ok: true, changed: false, event: { kind: 'approved' },
      projection: { approvalState: 'pending_quote', approvedQuoteVersionId: null },
    })
  })

  it('conflicts on changed or cross-actor request-key reuse', async () => {
    await decide(approvedBody(uuid(130)))
    await expect(decide(approvedBody(uuid(130), { approvedVia: 'in_person' }))).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await expect(decide(declinedBody(uuid(130)))).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await expect(decide(approvedBody(uuid(130)), { actor: { profileId: uuid(2) } })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('requires an open reconciled ticket and the current exact same-ticket version/job', async () => {
    await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticketId))
    await expect(decide(approvedBody(uuid(140)))).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(tickets).set({ status: 'open' }).where(eq(tickets.id, ticketId))
    await expect(decide(approvedBody(uuid(145)), { ticketId: uuid(22) })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.execute(sql`update tickets set source = 'tech_quick', customer_id = null, vehicle_id = null where id = ${ticketId}`)
    await expect(decide(approvedBody(uuid(141)))).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.execute(sql`update tickets set source = 'counter', customer_id = ${uuid(10)}, vehicle_id = ${uuid(11)} where id = ${ticketId}`)
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.id, versionId))
    await expect(decide(approvedBody(uuid(142)))).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(decide(approvedBody(uuid(143), { quoteVersionId: uuid(999) }))).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(decide(approvedBody(uuid(144), { jobId: uuid(999) }))).resolves.toEqual({ ok: false, error: 'not_found' })
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

  it('rolls back an inserted event when projection update fails', async () => {
    await expect(decide(approvedBody(uuid(180)), {}, {
      afterEventInsert: async () => { throw new Error('projection failed') },
    })).rejects.toThrow('projection failed')
    expect(await db.select().from(quoteEvents)).toHaveLength(0)
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(job.approvalState).toBe('quote_ready')
    expect(job.approvedQuoteVersionId).toBeNull()
  })

  it('classifies a post-ticket query-level 55P03 as retryable and rolls back', async () => {
    await expect(decide(approvedBody(uuid(190)), {}, {
      afterTicketLock: async () => { throw Object.assign(new Error('held diagnostic job'), { code: '55P03' }) },
    })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })
    expect(await db.select().from(quoteEvents)).toHaveLength(0)
  })

  it('keeps quote events append-only and exposes no direct projection mutation handler', async () => {
    await decide(approvedBody(uuid(200)))
    await expect(db.update(quoteEvents).set({ body: 'changed' })).rejects.toThrow()
    await expect(db.delete(quoteEvents)).rejects.toThrow()
    const source = readFileSync(join(process.cwd(), 'lib/shop-os/quotes.ts'), 'utf8')
    expect(source).not.toMatch(/export async function (?:repoint|clear|set)QuoteApproval/i)
  })
})
