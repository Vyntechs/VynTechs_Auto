import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createQuoteVersion, getQuoteBuilder, type QuoteActor } from '@/lib/shop-os/quotes'
import {
  customers, jobAttachments, jobLines, profiles, quoteEvents, quoteVersions, shops, ticketJobs, tickets, vehicles,
  vendorAccounts,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) => `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS immutable quote version creation', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let ticketId: string
  let jobId: string
  let excludedJobId: string
  let canceledJobId: string
  let actor: QuoteActor

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North', laborRateCents: 15_000, taxRateBps: 825 },
      { name: 'South', laborRateCents: 20_000, taxRateBps: 700 },
    ]).returning()
    shopId = shop.id
    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(101), shopId, role: 'tech' },
      { id: uuid(2), userId: uuid(102), shopId, role: 'founder' },
      { id: uuid(3), userId: uuid(103), shopId: otherShop.id, role: 'owner' },
    ])
    await db.insert(vendorAccounts).values({
      id: uuid(90), shopId, vendor: 'manual', displayName: 'Main supplier', mode: 'manual',
    })
    actor = { profileId: uuid(1) }
    await db.insert(customers).values({ id: uuid(10), shopId, name: 'Customer', phone: '5551234567' })
    await db.insert(vehicles).values({
      id: uuid(11), customerId: uuid(10), year: 2020, make: 'Ford', model: 'F-150',
    })
    ticketId = uuid(20)
    await db.insert(tickets).values({
      id: ticketId, shopId, ticketNumber: 7, source: 'counter', customerId: uuid(10),
      vehicleId: uuid(11), concern: 'Brake noise', createdByProfileId: uuid(1),
    })
    jobId = uuid(30)
    excludedJobId = uuid(31)
    canceledJobId = uuid(32)
    await db.insert(ticketJobs).values([
      {
        id: jobId, shopId, ticketId, title: 'Front brakes', kind: 'repair', requiredSkillTier: 1,
        customerStory: {
          whatYouToldUs: 'Brake noise', whatWeFound: 'Pads are worn',
          howWeKnow: [{ claim: 'Pad thickness is low', sourceEventIds: [uuid(81), uuid(80)], sourceArtifactIds: [uuid(82)] }],
          whatItMeansIfWaived: 'Stopping distance may increase', whatWeRecommend: 'Replace front pads',
        },
        storyMeta: {
          source: 'manual', sessionId: uuid(70),
          lastEditedByProfileId: uuid(1), lastEditedAt: '2026-07-11T12:00:00.000Z',
          storyRevision: 1, reviewStatus: 'reviewed', reviewClientKey: uuid(72),
          reviewRequestFingerprint: 'b'.repeat(64), reviewedByProfileId: uuid(1),
          reviewedAt: '2026-07-11T12:01:00.000Z',
        },
      },
      { id: excludedJobId, shopId, ticketId, title: 'No lines', kind: 'maintenance', requiredSkillTier: 1 },
      { id: canceledJobId, shopId, ticketId, title: 'Canceled', kind: 'repair', requiredSkillTier: 1, workStatus: 'canceled' },
    ])
    await db.insert(jobLines).values([
      {
        id: uuid(42), shopId, jobId, kind: 'labor', description: 'Install', sort: 1,
        quantity: 1, priceCents: 18_750, taxable: false, laborHours: 1.25,
        laborRateCents: 15_000, source: 'manual', createdAt: new Date('2026-01-02T00:00:00Z'),
      },
      {
        id: uuid(41), shopId, jobId, kind: 'part', description: 'Pads', sort: 1,
        quantity: 2, priceCents: 12_500, taxable: true, partNumber: 'PAD', brand: 'ACME',
        unitCostCents: 7_000, coreChargeCents: 100, fitment: 'Front', source: 'vendor_offer',
        vendorAccountId: uuid(90), externalOfferId: 'estimate-42',
        vendorSnapshot: {
          schemaVersion: 1, kind: 'manual_offer', vendorAccountId: uuid(90),
          vendorDisplayName: 'Main supplier', externalOfferId: 'estimate-42', currency: 'USD',
          quantity: '2', unitCostCents: 7_000, coreChargeCents: 100,
          availability: 'in_stock', fitment: 'Front',
          fulfillment: { method: 'pickup', locationLabel: 'Main counter' },
          fetchedAt: '2026-07-12T04:10:00.000Z', verifiedByProfileId: uuid(1),
          requestFingerprint: 'a'.repeat(64),
        }, createdAt: new Date('2026-01-02T00:00:00Z'),
      },
      {
        id: uuid(43), shopId, jobId: canceledJobId, kind: 'fee', description: 'Ignore',
        priceCents: 1_000, taxable: true,
      },
    ])
    await db.insert(jobAttachments).values([
      {
        id: uuid(51), shopId, jobId, storageKey: 'secret/a', kind: 'photo', mimeType: 'image/jpeg',
        byteSize: 10, uploadedByProfileId: uuid(1), createdAt: new Date('2026-01-02T00:00:00Z'),
      },
      {
        id: uuid(50), shopId, jobId, storageKey: 'secret/b', kind: 'document', mimeType: 'text/plain',
        byteSize: 20, uploadedByProfileId: uuid(1), createdAt: new Date('2026-01-02T00:00:00Z'),
      },
    ])
  })

  afterEach(async () => close())

  const create = (overrides: Record<string, unknown> = {}, dependencies = {}) =>
    createQuoteVersion(db, { actor, ticketId, ...overrides }, dependencies)

  it('captures ticket-first stable NOWAIT locks through actor reauthorization', () => {
    const source = readFileSync(join(process.cwd(), 'lib/shop-os/quotes.ts'), 'utf8')
    const helper = source.slice(source.indexOf('async function lockVersionContext'), source.indexOf('function buildQuoteSnapshot'))
    expect(helper).toMatch(/\.from\(tickets\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(shops\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(ticketJobs\)[\s\S]*?orderBy\(ticketJobs\.id\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(jobLines\)[\s\S]*?orderBy\(jobLines\.id\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(jobAttachments\)[\s\S]*?orderBy\(jobAttachments\.id\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(quoteVersions\)[\s\S]*?orderBy\(quoteVersions\.id\)[\s\S]*?\.for\('update', \{ noWait: true \}\)[\s\S]*?\.from\(profiles\)[\s\S]*?\.for\('update', \{ noWait: true \}\)/)
    expect(source).not.toMatch(/createQuoteVersion[\s\S]*?from\(['"]@\/app\/api/)
  })

  it('builds the exact content-only canonical snapshot and updates only included jobs', async () => {
    const result = await create()
    expect(result).toMatchObject({ ok: true, changed: true, version: { versionNumber: 1 } })
    if (!result.ok) throw new Error('missing version')
    expect(result.version).not.toHaveProperty('snapshot')
    const [persisted] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, result.version.id))
    expect(persisted.snapshot).toEqual({
      schemaVersion: 1,
      ticket: {
        id: ticketId, number: 7, customerId: uuid(10), vehicleId: uuid(11),
        laborRateCents: 15_000, taxRateBps: 825,
      },
      jobs: [{
        id: jobId, title: 'Front brakes', kind: 'repair',
        customerStory: {
          howWeKnow: [{ claim: 'Pad thickness is low', sourceArtifactIds: [uuid(82)], sourceEventIds: [uuid(81), uuid(80)] }],
          whatItMeansIfWaived: 'Stopping distance may increase',
          whatWeFound: 'Pads are worn', whatWeRecommend: 'Replace front pads', whatYouToldUs: 'Brake noise',
        },
        storyMeta: { source: 'manual', sessionId: uuid(70) },
        lines: [
          {
            id: uuid(41), kind: 'part', description: 'Pads', quantity: '2', priceCents: 12_500,
            taxable: true, partNumber: 'PAD', brand: 'ACME',
            coreChargeCents: null, fitment: 'Front', laborHours: null, laborRateCents: null,
            source: 'vendor_offer', vendorContext: null,
          },
          {
            id: uuid(42), kind: 'labor', description: 'Install', quantity: '1', priceCents: 18_750,
            taxable: false, partNumber: null, brand: null,
            coreChargeCents: null, fitment: null, laborHours: '1.25', laborRateCents: 15_000,
            source: 'manual', vendorContext: null,
          },
        ],
        attachments: [
          { id: uuid(50), jobId, kind: 'document' },
          { id: uuid(51), jobId, kind: 'photo' },
        ],
        totals: { subtotalCents: 31_250, taxableSubtotalCents: 12_500 },
      }],
      totals: { subtotalCents: 31_250, taxableSubtotalCents: 12_500, taxCents: 1_031, totalCents: 32_281 },
    })
    expect(JSON.stringify(persisted.snapshot)).not.toContain('storageKey')
    expect(JSON.stringify(persisted.snapshot)).not.toContain('unitCostCents')
    expect(JSON.stringify(persisted.snapshot)).not.toContain('top-secret')
    expect(JSON.stringify(persisted.snapshot)).not.toContain('generatedAt')
    expect(JSON.stringify(persisted.snapshot)).not.toContain(uuid(1))
    const jobs = await db.select().from(ticketJobs)
    expect(jobs.find((job) => job.id === jobId)?.approvalState).toBe('quote_ready')
    expect(jobs.find((job) => job.id === excludedJobId)?.approvalState).toBe('pending_quote')
    expect(jobs.find((job) => job.id === canceledJobId)?.approvalState).toBe('pending_quote')
  })

  it.each(['in_progress', 'done'] as const)(
    'preserves %s simple-work approval and excludes its totals from a later version',
    async (workStatus) => {
      const first = await create()
      if (!first.ok) throw new Error('missing first version')
      await db.update(ticketJobs).set({
        workStatus,
        approvalState: 'approved',
        approvedQuoteVersionId: first.version.id,
      }).where(eq(ticketJobs.id, jobId))
      await db.insert(quoteEvents).values({
        id: uuid(60), shopId, ticketId, jobId, quoteVersionId: first.version.id,
        kind: 'approved', actorProfileId: uuid(1), approvedVia: 'in_person', requestKey: uuid(61),
      })
      await db.insert(jobLines).values({
        id: uuid(44), shopId, jobId: excludedJobId, kind: 'fee',
        description: 'Alignment check', priceCents: 5_000, taxable: false,
      })

      const second = await create()
      expect(second).toMatchObject({ ok: true, changed: true, version: { versionNumber: 2 } })
      if (!second.ok) throw new Error('missing second version')
      const [source] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
      expect(source).toMatchObject({
        workStatus,
        approvalState: 'approved',
        approvedQuoteVersionId: first.version.id,
      })
      const [version] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, second.version.id))
      const jobs = (version.snapshot as { jobs: Array<{ id: string }>; totals: { subtotalCents: number } }).jobs
      expect(jobs.map((job) => job.id)).toEqual([excludedJobId])
      expect((version.snapshot as { totals: { subtotalCents: number } }).totals.subtotalCents).toBe(5_000)
      if (workStatus === 'in_progress') {
        const builder = await getQuoteBuilder(db, { actor, ticketId })
        expect(builder).toMatchObject({
          ok: true,
          builder: {
            jobs: expect.arrayContaining([expect.objectContaining({
              id: jobId,
              approval: { state: 'approved', quoteVersionId: first.version.id },
              decisionEligible: false,
            })]),
          },
        })
        const [pinned] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, first.version.id))
        const snapshot = pinned.snapshot as { jobs: Array<Record<string, unknown>> }
        await db.execute(sql`alter table quote_versions disable trigger all`)
        await db.update(quoteVersions).set({
          snapshot: { ...snapshot, jobs: snapshot.jobs.map((job) => job.id === jobId ? { ...job, kind: 'maintenance' } : job) },
        }).where(eq(quoteVersions.id, first.version.id))
        await db.execute(sql`alter table quote_versions enable trigger all`)
        await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({
          ok: false, error: 'conflict', retryable: false,
        })
        await db.execute(sql`alter table quote_versions disable trigger all`)
        await db.update(quoteVersions).set({ snapshot: pinned.snapshot }).where(eq(quoteVersions.id, first.version.id))
        await db.execute(sql`alter table quote_versions enable trigger all`)
        await db.insert(quoteEvents).values({
          id: uuid(62), shopId, ticketId, jobId, quoteVersionId: first.version.id,
          kind: 'declined', actorProfileId: uuid(1), requestKey: uuid(63),
          createdAt: new Date('2099-01-01T00:00:00.000Z'),
        })
        await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({
          ok: false, error: 'conflict', retryable: false,
        })
      }
    },
  )

  it('requires explicit human review before an AI story can enter a quote snapshot', async () => {
    const aiMeta = {
      source: 'ai' as const,
      sessionId: uuid(70),
      generatedAt: '2026-07-11T12:00:00.000Z',
      lastEditedByProfileId: uuid(1),
      lastEditedAt: '2026-07-11T12:00:00.000Z',
      generationClientKey: uuid(71),
      generationRequestFingerprint: 'a'.repeat(64),
      generatedByProfileId: uuid(1),
      storyRevision: 1,
    }
    await db.update(ticketJobs).set({ storyMeta: { ...aiMeta, reviewStatus: 'pending' } }).where(eq(ticketJobs.id, jobId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(quoteVersions)).toHaveLength(0)
    await db.update(ticketJobs).set({ storyMeta: aiMeta }).where(eq(ticketJobs.id, jobId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(ticketJobs).set({ storyMeta: {
      ...aiMeta, reviewStatus: 'reviewed', reviewClientKey: uuid(72),
      reviewRequestFingerprint: 'b'.repeat(64), reviewedByProfileId: uuid(1),
      reviewedAt: '2026-07-11T12:01:00.000Z',
    } }).where(eq(ticketJobs.id, jobId))
    const reviewed = await create()
    expect(reviewed).toMatchObject({ ok: true, changed: true })
    if (!reviewed.ok) return
    const [stored] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, reviewed.version.id))
    expect((stored.snapshot as { jobs: Array<{ storyMeta: unknown }> }).jobs[0].storyMeta).toEqual({ source: 'ai', sessionId: uuid(70) })
  })

  it('requires every priced diagnostic job to carry a valid reviewed AI or manual story', async () => {
    await db.update(ticketJobs).set({ kind: 'diagnostic', customerStory: null, storyMeta: null }).where(eq(ticketJobs.id, jobId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(ticketJobs).set({
      customerStory: {
        whatYouToldUs: 'Brake noise', whatWeFound: 'Pads are worn', howWeKnow: [],
        whatItMeansIfWaived: 'Stopping distance may increase', whatWeRecommend: 'Replace pads',
      },
      storyMeta: {
        source: 'manual', sessionId: uuid(70), lastEditedByProfileId: uuid(1),
        lastEditedAt: '2026-07-11T12:00:00.000Z', storyRevision: 1, reviewStatus: 'reviewed',
        reviewClientKey: uuid(72), reviewRequestFingerprint: 'b'.repeat(64),
        reviewedByProfileId: uuid(1), reviewedAt: '2026-07-11T12:01:00.000Z',
      },
    }).where(eq(ticketJobs.id, jobId))
    await expect(create()).resolves.toMatchObject({ ok: true, changed: true })
    await db.update(quoteVersions).set({ supersededAt: new Date() })
    await db.update(ticketJobs).set({ storyMeta: {
      source: 'template', lastEditedByProfileId: uuid(1), lastEditedAt: '2026-07-11T12:00:00.000Z',
    } }).where(eq(ticketJobs.id, jobId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('rejects incomplete reviewed metadata and dishonest manual diagnostic proof', async () => {
    const story = {
      whatYouToldUs: 'Brake noise', whatWeFound: 'Pads are worn', howWeKnow: [],
      whatItMeansIfWaived: 'The diagnosed issue remains unresolved.', whatWeRecommend: 'Replace pads',
    }
    await db.update(ticketJobs).set({ kind: 'diagnostic', customerStory: story }).where(eq(ticketJobs.id, jobId))
    for (const meta of [
      { source: 'ai', sessionId: uuid(70), storyRevision: 1, reviewStatus: 'reviewed' },
      { source: 'manual', sessionId: uuid(70), storyRevision: 1, reviewStatus: 'reviewed' },
    ]) {
      await db.update(ticketJobs).set({ storyMeta: meta as never }).where(eq(ticketJobs.id, jobId))
      await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    }
    const manualMeta = {
      source: 'manual' as const, sessionId: uuid(70), lastEditedByProfileId: uuid(1),
      lastEditedAt: '2026-07-11T12:00:00.000Z', storyRevision: 1, reviewStatus: 'reviewed' as const,
      reviewClientKey: uuid(72), reviewRequestFingerprint: 'b'.repeat(64),
      reviewedByProfileId: uuid(1), reviewedAt: '2026-07-11T12:01:00.000Z',
    }
    await db.update(ticketJobs).set({
      storyMeta: manualMeta,
      customerStory: { ...story, howWeKnow: [{ claim: 'Fabricated proof.', sourceEventIds: [uuid(90)], sourceArtifactIds: [] }] },
    }).where(eq(ticketJobs.id, jobId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(ticketJobs).set({ customerStory: { ...story, whatWeFound: '   ' } }).where(eq(ticketJobs.id, jobId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it.each([
    ['null', null],
    ['malformed object', { source: 'unknown' }],
  ])('rejects a non-null story with %s metadata before writing a version', async (_label, storyMeta) => {
    await db.update(ticketJobs).set({ storyMeta: storyMeta as never }).where(eq(ticketJobs.id, jobId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(quoteVersions)).toHaveLength(0)
  })

  it('leaves manual and template story versioning unchanged', async () => {
    await expect(create()).resolves.toMatchObject({ ok: true })
    await db.update(quoteVersions).set({ supersededAt: new Date() })
    await db.update(ticketJobs).set({ storyMeta: {
      source: 'template', sessionId: 'template-session', generatedAt: 'volatile',
      lastEditedByProfileId: uuid(1), lastEditedAt: 'volatile',
    } }).where(eq(ticketJobs.id, jobId))
    await expect(create()).resolves.toMatchObject({ ok: true })
  })

  it('returns the sole identical active version unchanged', async () => {
    const first = await create()
    const second = await create()
    expect(second).toEqual({ ...first, changed: false })
    expect(await db.select().from(quoteVersions)).toHaveLength(1)
  })

  it('orders persisted job ties by immutable ID', async () => {
    await db.insert(jobLines).values({
      id: uuid(44), shopId, jobId: excludedJobId, kind: 'fee', description: 'Inspection fee',
      priceCents: 500, taxable: false,
    })
    const result = await create()
    if (!result.ok) throw new Error('missing version')
    const [stored] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, result.version.id))
    expect((stored.snapshot as { jobs: Array<{ id: string }> }).jobs.map((job) => job.id)).toEqual([
      jobId,
      excludedJobId,
    ])
  })

  it('deterministically converges same-state calls on one PGlite client and versions later changed state', async () => {
    const [left, right] = await Promise.all([create(), create()])
    expect([left, right].filter((result) => result.ok && result.changed)).toHaveLength(1)
    expect([left, right].filter((result) => result.ok && !result.changed)).toHaveLength(1)
    expect(await db.select().from(quoteVersions)).toHaveLength(1)

    await db.update(jobLines).set({ priceCents: 13_001 }).where(eq(jobLines.id, uuid(41)))
    const changed = await create()
    expect(changed).toMatchObject({ ok: true, changed: true, version: { versionNumber: 2 } })
  })

  it('supersedes changed active content, resets old included jobs, and allocates max plus one', async () => {
    const first = await create()
    if (!first.ok) throw new Error('missing first version')
    await db.update(jobLines).set({ priceCents: 13_000 }).where(eq(jobLines.id, uuid(41)))
    await db.update(ticketJobs).set({ approvalState: 'approved', approvedQuoteVersionId: first.version.id }).where(eq(ticketJobs.id, jobId))
    const second = await create()
    expect(second).toMatchObject({ ok: true, changed: true, version: { versionNumber: 2 } })
    const versions = await db.select().from(quoteVersions)
    expect(versions.find((version) => version.id === first.version.id)?.supersededAt).not.toBeNull()
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(job).toMatchObject({ approvalState: 'quote_ready', approvedQuoteVersionId: null })
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.id, second.ok ? second.version.id : uuid(999)))
    await db.insert(quoteVersions).values({
      shopId, ticketId, versionNumber: 7, snapshot: versions[0].snapshot,
      createdByProfileId: uuid(1), supersededAt: new Date(),
    })
    const third = await create()
    expect(third).toMatchObject({ ok: true, version: { versionNumber: 8 } })
  })

  it('fails closed across authorization, tenant, ticket state, reconciliation, tax, and empty boundaries', async () => {
    await expect(create({ actor: { profileId: uuid(2) } })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(create({ actor: { profileId: uuid(3) } })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(create({ ticketId: ticketId.toUpperCase(), actor: { profileId: uuid(1).toUpperCase() } })).resolves.toMatchObject({ ok: true })
    await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticketId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(tickets).set({ status: 'open', source: 'tech_quick', customerId: null, vehicleId: null }).where(eq(tickets.id, ticketId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(tickets).set({ customerId: uuid(10), vehicleId: uuid(11) }).where(eq(tickets.id, ticketId))
    await db.update(shops).set({ taxRateBps: null }).where(eq(shops.id, shopId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(shops).set({ taxRateBps: 825 }).where(eq(shops.id, shopId))
    await db.delete(jobLines)
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('preserves an explicit stored labor price without a pinned rate and rejects corrupt persisted values', async () => {
    await db.update(shops).set({ laborRateCents: null }).where(eq(shops.id, shopId))
    await db.update(jobLines).set({ laborRateCents: null }).where(eq(jobLines.id, uuid(42)))
    await expect(create()).resolves.toMatchObject({ ok: true })
    await db.execute(sql`alter table job_lines drop constraint job_lines_quantity_positive`)
    await db.execute(sql`update job_lines set quantity = 0 where id = ${uuid(41)}::uuid`)
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it.each([
    ['part fields on labor', sql`update job_lines set part_number = 'smuggled' where id = ${uuid(42)}::uuid`],
    ['labor fields on part', sql`update job_lines set labor_hours = 1 where id = ${uuid(41)}::uuid`],
    ['oversized line text', sql`update job_lines set description = ${'x'.repeat(501)} where id = ${uuid(41)}::uuid`],
    ['invalid customer story', sql`update ticket_jobs set customer_story = '{"whatYouToldUs":"only one field"}'::jsonb where id = ${uuid(30)}::uuid`],
  ])('rejects corrupt persisted snapshot input: %s', async (_name, statement) => {
    await db.execute(statement)
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('rejects a serialized snapshot that exceeds the bounded byte budget', async () => {
    await db.insert(jobLines).values(Array.from({ length: 140 }, (_, index) => ({
      id: uuid(1_000 + index), shopId, jobId, kind: 'fee' as const,
      description: `Fee ${index} ${'x'.repeat(480)}`, priceCents: 1, taxable: false,
    })))
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('rejects oversized stored vendor context even though vendor context is never copied', async () => {
    await db.update(jobLines).set({ vendorSnapshot: { payload: 'x'.repeat(16_385) } }).where(eq(jobLines.id, uuid(41)))
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('fails closed on duplicate active history', async () => {
    const first = await create()
    if (!first.ok) throw new Error('missing first version')
    const [stored] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, first.version.id))
    await db.insert(quoteVersions).values({
      shopId, ticketId, versionNumber: 2, snapshot: stored.snapshot,
      createdByProfileId: uuid(1),
    })
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('rejects an empty active-history snapshot while persisted quote lines remain', async () => {
    const first = await create()
    if (!first.ok) throw new Error('missing first version')
    const [stored] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, first.version.id))
    const emptyHistory = { ...(stored.snapshot as Record<string, unknown>), jobs: [] }
    await db.execute(sql`alter table quote_versions disable trigger quote_versions_immutable_update`)
    await db.update(quoteVersions).set({ snapshot: emptyHistory }).where(eq(quoteVersions.id, first.version.id))
    await db.execute(sql`alter table quote_versions enable trigger quote_versions_immutable_update`)

    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(jobLines)).toHaveLength(3)
    const [unchanged] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, first.version.id))
    expect(unchanged.supersededAt).toBeNull()
  })

  it.each(['wrong-ticket', 'duplicate-job', 'foreign-job'] as const)(
    'rejects semantically corrupt active snapshot history: %s',
    async (corruption) => {
      const first = await create()
      if (!first.ok) throw new Error('missing first version')
      const [stored] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, first.version.id))
      const snapshot = structuredClone(stored.snapshot) as { ticket: { id: string }; jobs: Array<{ id: string }> }
      if (corruption === 'wrong-ticket') snapshot.ticket.id = uuid(999)
      if (corruption === 'duplicate-job') snapshot.jobs.push(structuredClone(snapshot.jobs[0]))
      if (corruption === 'foreign-job') snapshot.jobs[0].id = uuid(998)
      await db.execute(sql`alter table quote_versions disable trigger quote_versions_immutable_update`)
      await db.update(quoteVersions).set({ snapshot }).where(eq(quoteVersions.id, first.version.id))
      await db.execute(sql`alter table quote_versions enable trigger quote_versions_immutable_update`)
      await db.update(jobLines).set({ priceCents: 12_501 }).where(eq(jobLines.id, uuid(41)))
      await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
      const [unchanged] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, first.version.id))
      expect(unchanged.supersededAt).toBeNull()
    },
  )

  it('rejects allocating beyond the PostgreSQL integer version ceiling', async () => {
    const first = await create()
    if (!first.ok) throw new Error('missing first version')
    const [stored] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, first.version.id))
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.id, first.version.id))
    await db.insert(quoteVersions).values({
      shopId, ticketId, versionNumber: 2_147_483_647, snapshot: stored.snapshot,
      createdByProfileId: uuid(1), supersededAt: new Date(),
    })
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(quoteVersions)).toHaveLength(2)
  })

  it('classifies deterministic NOWAIT contention and rolls back all writes', async () => {
    await expect(create({}, { beforeWrite: async () => { throw Object.assign(new Error('held'), { code: '55P03' }) } }))
      .resolves.toEqual({ ok: false, error: 'conflict', retryable: true })
    expect(await db.select().from(quoteVersions)).toHaveLength(0)
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(job.approvalState).toBe('pending_quote')
  })

  it('classifies contention immediately after the ticket lock and before dependent locks', async () => {
    await expect(create({}, {
      afterTicketLock: async () => { throw Object.assign(new Error('diagnostic job held'), { code: '55P03' }) },
    })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })
    expect(await db.select().from(quoteVersions)).toHaveLength(0)
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(job.approvalState).toBe('pending_quote')
  })

  it('serializes same-ticket add-job and version creation on the ticket lock', () => {
    const source = readFileSync(join(process.cwd(), 'lib/shop-os/quotes.ts'), 'utf8')
    const jobSource = readFileSync(join(process.cwd(), 'lib/tickets.ts'), 'utf8')
    expect(source).toMatch(/lockVersionContext[\s\S]*?\.from\(tickets\)[\s\S]*?for\('update'/)
    expect(jobSource).toMatch(/\.from\(tickets\)[\s\S]*?\.for\('update'/)
  })

  it('keeps immutable history enforced and exposes no handler that writes snapshots', async () => {
    const result = await create()
    if (!result.ok) throw new Error('missing version')
    await expect(db.update(quoteVersions).set({ snapshot: { changed: true } }).where(eq(quoteVersions.id, result.version.id))).rejects.toThrow()
    const routeFiles = readFileSync(join(process.cwd(), 'lib/shop-os/quotes.ts'), 'utf8')
    expect(routeFiles.match(/insert\(quoteVersions\)/g)).toHaveLength(1)
    expect(routeFiles).not.toMatch(/export async function [^(]*(?:replace|update|delete)QuoteVersion/)
  })
})
