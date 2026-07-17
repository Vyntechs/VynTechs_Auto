import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createQuoteVersion, getQuoteBuilder, type QuoteActor } from '@/lib/shop-os/quotes'
import {
  customers, jobAttachments, jobLines, profiles, quoteEvents, quoteVersions, shops, ticketJobs, tickets, vehicles,
  vendorAccounts,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) => `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

type LockedRow = Record<string, unknown>

function withLockedVersionRows(
  sourceDb: TestDb,
  targetSource: unknown,
  transform: (rows: readonly LockedRow[]) => readonly LockedRow[],
): TestDb {
  const wrapBuilder = (builder: object, source: unknown): object => new Proxy(builder, {
    get(target, property) {
      const member = Reflect.get(target, property, target)
      if (typeof member !== 'function') return member
      if (property === 'from') {
        return (nextSource: unknown, ...args: unknown[]) => wrapBuilder(
          Reflect.apply(member, target, [nextSource, ...args]) as object,
          nextSource,
        )
      }
      if (property === 'for' && source === targetSource) {
        return async (...args: unknown[]) => {
          const rows = await Reflect.apply(member, target, args) as LockedRow[]
          return transform(rows)
        }
      }
      return (...args: unknown[]) => {
        const result = Reflect.apply(member, target, args) as unknown
        return typeof result === 'object' && result !== null
          ? wrapBuilder(result, source)
          : result
      }
    },
  })

  return new Proxy(sourceDb, {
    get(target, property, receiver) {
      if (property === 'transaction') {
        return async (callback: (tx: TestDb) => Promise<unknown>) =>
          target.transaction(async (rawTx) => {
            const tx = rawTx as TestDb
            const wrappedTx = new Proxy(tx, {
              get(txTarget, txProperty, txReceiver) {
                if (txProperty === 'select') {
                  return (...args: unknown[]) => wrapBuilder(
                    Reflect.apply(
                      Reflect.get(txTarget, txProperty, txReceiver) as
                        (...values: unknown[]) => unknown,
                      txTarget,
                      args,
                    ) as object,
                    null,
                  )
                }
                const value = Reflect.get(txTarget, txProperty, txReceiver)
                return typeof value === 'function' ? value.bind(txTarget) : value
              },
            })
            return callback(wrappedTx)
          })
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

describe('Shop OS immutable quote version creation', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let ticketId: string
  let jobId: string
  let excludedJobId: string
  let canceledJobId: string
  let historyProfileId: string
  let actor: QuoteActor

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North', laborRateCents: 15_000, taxRateBps: 825 },
      { name: 'South', laborRateCents: 20_000, taxRateBps: 700 },
    ]).returning()
    shopId = shop.id
    otherShopId = otherShop.id
    historyProfileId = uuid(4)
    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(101), shopId, role: 'tech' },
      { id: uuid(2), userId: uuid(102), shopId, role: 'founder' },
      { id: uuid(3), userId: uuid(103), shopId: otherShop.id, role: 'owner' },
      { id: historyProfileId, userId: uuid(104), shopId, role: 'advisor' },
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
          howWeKnow: [{ claim: 'Pad thickness is low', sourceEventIds: [uuid(81), uuid(80)], sourceArtifactIds: [] }],
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

  const createWithDb = (
    sourceDb: TestDb,
    overrides: Record<string, unknown> = {},
    dependencies = {},
  ) => createQuoteVersion(sourceDb, { actor, ticketId, ...overrides }, dependencies)

  const mutationState = async () => ({
    ticket: (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0],
    jobs: await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId)).orderBy(ticketJobs.id),
    versions: await db.select().from(quoteVersions).where(eq(quoteVersions.ticketId, ticketId)).orderBy(quoteVersions.id),
    events: await db.select().from(quoteEvents).where(eq(quoteEvents.ticketId, ticketId)).orderBy(quoteEvents.id),
  })

  const seedCompleteDecisionHistory = async () => {
    const first = await create()
    if (!first.ok) throw new Error('missing first version')
    await db.insert(quoteEvents).values([
      {
        id: uuid(82), shopId, ticketId, jobId, quoteVersionId: first.version.id,
        kind: 'approved', approvedVia: 'page', requestKey: 'page-approval-history',
      },
      {
        id: uuid(83), shopId, ticketId, jobId, quoteVersionId: first.version.id,
        kind: 'approved', actorProfileId: historyProfileId, approvedVia: 'in_person',
        requestKey: 'offline-approval-history',
      },
    ])
    await db.update(ticketJobs).set({
      approvalState: 'approved',
      approvedQuoteVersionId: first.version.id,
      approvedApprovalEventId: uuid(83),
    }).where(eq(ticketJobs.id, jobId))
    await db.update(jobLines).set({ priceCents: 13_001 }).where(eq(jobLines.id, uuid(41)))
    return first
  }

  it('uses one bounded profile-first complete-graph mutation and one revision finalizer', () => {
    const source = readFileSync(join(process.cwd(), 'lib/shop-os/quotes.ts'), 'utf8')
    const discoveryStart = source.indexOf('async function discoverQuoteVersionMutation')
    const mutationStart = source.indexOf('export async function createQuoteVersion')
    const nextType = source.indexOf('type DecisionFailure', mutationStart)
    const discovery = source.slice(discoveryStart, mutationStart).replace(/\s+/g, ' ')
    const mutation = source.slice(mutationStart, nextType).replace(/\s+/g, ' ')

    expect(discoveryStart).toBeGreaterThan(-1)
    expect(mutationStart).toBeGreaterThan(discoveryStart)
    expect(nextType).toBeGreaterThan(mutationStart)
    expect(mutation).toContain('runBoundedShopOsMutationV1')
    expect(mutation).toContain('assertLiveLockedMutationScopeV1')
    expect(mutation.match(/finalizeMutationRevisionsV1/g) ?? []).toHaveLength(1)
    expect(mutation).toContain('await seams.afterWrite?.()')
    expect(mutation).toContain('await seams.afterFinalization?.()')
    expect(mutation).not.toContain('db.transaction')
    expect(mutation).not.toMatch(/\.for\(['"]update['"]/)
    expect(mutation).not.toMatch(/revision:\s*sql/)
    expect(mutation).not.toContain('insertMutationReceiptV1')
    expect(discovery).toContain('lockShop: true')
    for (const reference of [
      'customerId', 'vehicleId', 'separateFromTicketId', 'createdByProfileId',
      'assignedTechId', 'statementConfirmedByProfileId', 'approvedApprovalEventId',
      'sessionId', 'techId', 'vendorAccountId', 'orderedByProfileId',
      'receivedByProfileId', 'actorProfileId',
    ]) expect(discovery).toContain(reference)
    expect(source).toContain("approvedVia: z.enum(['phone', 'in_person'])")
    expect(source).not.toMatch(/createQuoteVersion[\s\S]*?from\(['"]@\/app\/api/)
    expect(discovery).not.toContain('jobAttachments')
  })

  it('rejects mutable media provenance while leaving legacy rows and history untouched', async () => {
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const story = job.customerStory as NonNullable<typeof job.customerStory>
    await db.update(ticketJobs).set({
      customerStory: {
        ...story,
        howWeKnow: [{ claim: 'Legacy image evidence.', sourceEventIds: [], sourceArtifactIds: [uuid(51)] }],
      },
    }).where(eq(ticketJobs.id, jobId))

    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(jobAttachments)).toHaveLength(2)
    expect(await db.select().from(quoteVersions)).toHaveLength(0)
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
          howWeKnow: [{ claim: 'Pad thickness is low', sourceArtifactIds: [], sourceEventIds: [uuid(81), uuid(80)] }],
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
        attachments: [],
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
      const [ticketBefore] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
      const [pinnedBefore] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
      const [includedBefore] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, excludedJobId))

      const second = await create()
      expect(second).toMatchObject({ ok: true, changed: true, version: { versionNumber: 2 } })
      if (!second.ok) throw new Error('missing second version')
      const [source] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
      expect(source).toMatchObject({
        workStatus,
        approvalState: 'approved',
        approvedQuoteVersionId: first.version.id,
      })
      const [includedAfter] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, excludedJobId))
      const [ticketAfter] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
      expect(source.revision).toBe(pinnedBefore.revision)
      expect(includedAfter.revision).toBe(includedBefore.revision + 1n)
      expect(ticketAfter.projectionRevision).toBe(ticketBefore.projectionRevision + 1n)
      expect(ticketAfter.continuityRevision).toBe(ticketBefore.continuityRevision + 1n)
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
    const afterFirst = await mutationState()
    const second = await create()
    expect(second).toEqual({ ...first, changed: false })
    expect(await db.select().from(quoteVersions)).toHaveLength(1)
    expect(await mutationState()).toEqual(afterFirst)
  })

  it('finalizes the first version with one job and one parent bump', async () => {
    const [ticketBefore] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [jobBefore] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))

    await expect(create()).resolves.toMatchObject({ ok: true, changed: true })

    const [ticketAfter] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [jobAfter] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(jobAfter.revision).toBe(jobBefore.revision + 1n)
    expect(ticketAfter.projectionRevision).toBe(ticketBefore.projectionRevision + 1n)
    expect(ticketAfter.continuityRevision).toBe(ticketBefore.continuityRevision + 1n)
  })

  it('bumps the deduplicated old/new job union once when a version changes participation', async () => {
    await create()
    await db.delete(jobLines).where(eq(jobLines.jobId, jobId))
    await db.insert(jobLines).values({
      id: uuid(44), shopId, jobId: excludedJobId, kind: 'fee',
      description: 'Alignment check', priceCents: 5_000, taxable: false,
    })
    const before = await mutationState()

    await expect(create()).resolves.toMatchObject({
      ok: true, changed: true, version: { versionNumber: 2 },
    })

    const after = await mutationState()
    const beforeJobs = new Map(before.jobs.map((job) => [job.id, job]))
    const afterJobs = new Map(after.jobs.map((job) => [job.id, job]))
    expect(afterJobs.get(jobId)).toMatchObject({
      approvalState: 'pending_quote',
      revision: beforeJobs.get(jobId)!.revision + 1n,
    })
    expect(afterJobs.get(excludedJobId)).toMatchObject({
      approvalState: 'quote_ready',
      revision: beforeJobs.get(excludedJobId)!.revision + 1n,
    })
    expect(afterJobs.get(canceledJobId)).toEqual(beforeJobs.get(canceledJobId))
    expect(after.ticket.projectionRevision).toBe(before.ticket.projectionRevision + 1n)
    expect(after.ticket.continuityRevision).toBe(before.ticket.continuityRevision + 1n)
  })

  it('revisions a price-only replacement without changing continuity truth', async () => {
    await create()
    await db.update(jobLines).set({ priceCents: 13_001 }).where(eq(jobLines.id, uuid(41)))
    const before = await mutationState()

    await expect(create()).resolves.toMatchObject({
      ok: true, changed: true, version: { versionNumber: 2 },
    })

    const after = await mutationState()
    const beforeJob = before.jobs.find((job) => job.id === jobId)!
    const afterJob = after.jobs.find((job) => job.id === jobId)!
    expect(afterJob.revision).toBe(beforeJob.revision + 1n)
    expect(after.ticket.projectionRevision).toBe(before.ticket.projectionRevision + 1n)
    expect(after.ticket.continuityRevision).toBe(before.ticket.continuityRevision)
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

  it.each([
    ['membership', (row: LockedRow) => ({ ...row, membershipStatus: 'pending' })],
    ['deactivation', (row: LockedRow) => ({ ...row, deactivatedAt: new Date('2026-07-16T13:00:00Z') })],
    ['shop', (row: LockedRow) => ({ ...row, shopId: otherShopId })],
    ['role', (row: LockedRow) => ({ ...row, role: 'founder' })],
    ['tier', (row: LockedRow) => ({ ...row, skillTier: 4 })],
  ] as const)(
    'hides locked actor %s drift behind generic not-found with no writes',
    async (_label, change) => {
      const before = await mutationState()
      const raceDb = withLockedVersionRows(db, profiles, (rows) => rows.map((row) =>
        row.id === actor.profileId ? change(row) : row))

      await expect(createWithDb(raceDb)).resolves.toEqual({ ok: false, error: 'not_found' })
      expect(await mutationState()).toEqual(before)
    },
  )

  it('locks page and offline event history plus its historical actor before versioning', async () => {
    await seedCompleteDecisionHistory()
    await expect(create()).resolves.toMatchObject({
      ok: true, changed: true, version: { versionNumber: 2 },
    })
    await db.update(jobLines).set({ priceCents: 13_002 }).where(eq(jobLines.id, uuid(41)))
    const before = await mutationState()
    const raceDb = withLockedVersionRows(db, profiles, (rows) => rows.map((row) =>
      row.id === historyProfileId ? { ...row, id: uuid(999) } : row))

    await expect(createWithDb(raceDb)).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await mutationState()).toEqual(before)
  })

  it.each([
    {
      label: 'shop rate/tax', source: shops,
      change: (row: LockedRow) => row.id === shopId
        ? { ...row, laborRateCents: 15_001, taxRateBps: 826 }
        : row,
    },
    {
      label: 'ticket ancestry', source: tickets,
      change: (row: LockedRow) => row.id === ticketId
        ? { ...row, separateFromTicketId: uuid(998) }
        : row,
    },
    {
      label: 'customer tenancy', source: customers,
      change: (row: LockedRow) => row.id === uuid(10)
        ? { ...row, shopId: otherShopId }
        : row,
    },
    {
      label: 'vehicle ancestry', source: vehicles,
      change: (row: LockedRow) => {
        const vehicle = row.row as LockedRow | undefined
        return vehicle?.id === uuid(11)
          ? { ...row, row: { ...vehicle, customerId: uuid(999) } }
          : row
      },
    },
    {
      label: 'line parent', source: jobLines,
      change: (row: LockedRow) => row.id === uuid(41)
        ? { ...row, jobId: excludedJobId }
        : row,
    },
    {
      label: 'version parent', source: quoteVersions,
      change: (row: LockedRow) => row.ticketId === ticketId
        ? { ...row, ticketId: uuid(999) }
        : row,
    },
    {
      label: 'event version', source: quoteEvents,
      change: (row: LockedRow) => row.id === uuid(83)
        ? { ...row, quoteVersionId: uuid(999) }
        : row,
    },
    {
      label: 'event actor reference', source: quoteEvents,
      change: (row: LockedRow) => row.id === uuid(83)
        ? { ...row, actorProfileId: uuid(999) }
        : row,
    },
  ])('rejects locked $label drift without partial version writes', async ({ source, change }) => {
    await seedCompleteDecisionHistory()
    const before = await mutationState()
    const raceDb = withLockedVersionRows(db, source, (rows) => rows.map(change))

    await expect(createWithDb(raceDb)).resolves.toEqual({
      ok: false, error: 'conflict', retryable: true,
    })
    expect(await mutationState()).toEqual(before)
  })

  it('fails closed across authorization, tenant, ticket state, reconciliation, tax, and empty boundaries', async () => {
    await expect(create({ actor: { profileId: uuid(2) } })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(create({ actor: { profileId: uuid(3) } })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(create({ ticketId: ticketId.toUpperCase(), actor: { profileId: uuid(1).toUpperCase() } })).resolves.toMatchObject({ ok: true })
    await db.insert(tickets).values({
      id: uuid(23), shopId, ticketNumber: 3, source: 'tech_quick',
      customerId: null, vehicleId: null, concern: 'Provisional', createdByProfileId: uuid(1),
    })
    await expect(create({ ticketId: uuid(23) })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(shops).set({ taxRateBps: null }).where(eq(shops.id, shopId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(shops).set({ taxRateBps: 825 }).where(eq(shops.id, shopId))
    await db.delete(jobLines)
    await expect(create()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    const canceledAt = new Date()
    await db.update(ticketJobs).set({ workStatus: 'canceled' }).where(eq(ticketJobs.ticketId, ticketId))
    await db.update(quoteVersions).set({ supersededAt: canceledAt }).where(and(
      eq(quoteVersions.ticketId, ticketId), isNull(quoteVersions.supersededAt),
    ))
    await db.update(tickets).set({
      status: 'canceled', canceledAt, canceledByProfileId: uuid(1),
      cancelReasonCode: 'administrative_error',
    }).where(eq(tickets.id, ticketId))
    await expect(create()).resolves.toEqual({ ok: false, error: 'not_found' })
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

  it.each(['afterDiscovery', 'afterWrite', 'afterFinalization'] as const)(
    'rolls back supersede, insert, approval, and revisions when %s fails',
    async (seam) => {
      await seedCompleteDecisionHistory()
      const before = await mutationState()
      const marker = new Error(seam)

      await expect(create({}, {
        [seam]: async () => { throw marker },
      })).rejects.toBe(marker)

      expect(await mutationState()).toEqual(before)
    },
  )

  it.each(['55P03', '40001', '40P01'] as const)(
    'retries and exhausts SQLSTATE %s without retaining partial writes',
    async (code) => {
      await seedCompleteDecisionHistory()
      const before = await mutationState()
      let attempts = 0

      const result = await create({}, {
        afterWrite: async () => {
          attempts += 1
          throw Object.assign(new Error(code), { code })
        },
      })

      expect(result).toEqual({ ok: false, error: 'conflict', retryable: true })
      expect(attempts).toBe(2)
      expect(await mutationState()).toEqual(before)
    },
  )

  it('serializes same-ticket add-job and version creation on the ticket lock', () => {
    const source = readFileSync(join(process.cwd(), 'lib/shop-os/quotes.ts'), 'utf8')
    const jobSource = readFileSync(join(process.cwd(), 'lib/tickets.ts'), 'utf8')
    const versionBody = source.slice(
      source.indexOf('async function discoverQuoteVersionMutation'),
      source.indexOf('type DecisionFailure'),
    )
    expect(versionBody).toContain('runBoundedShopOsMutationV1')
    expect(versionBody).toContain('ticketIds:')
    expect(versionBody).toContain('lockShop: true')
    expect(jobSource).toContain('runBoundedShopOsMutationV1')
    expect(source).not.toContain('async function lockVersionContext')
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
