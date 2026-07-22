import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getQuoteBuilder, type QuoteActor } from '@/lib/shop-os/quotes'
import {
  customers, jobLines, profiles, quoteVersions, sessionEvents, sessions, shops, ticketJobs, tickets,
  vehicles, vendorAccounts,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const manualOfferSnapshot = () => ({
  schemaVersion: 1, kind: 'manual_offer', vendorAccountId: uuid(90),
  vendorDisplayName: 'Test supplier', externalOfferId: 'estimate-42', currency: 'USD',
  quantity: '2', unitCostCents: 7_000, coreChargeCents: 100,
  availability: 'in_stock', fitment: 'Front',
  fulfillment: { method: 'pickup', locationLabel: 'Main counter' },
  fetchedAt: '2026-07-12T04:10:00.000Z', verifiedByProfileId: uuid(1),
  requestFingerprint: 'a'.repeat(64),
})

describe('Shop OS quote builder read model', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let ticketId: string
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
      { id: uuid(2), userId: uuid(102), shopId: otherShop.id, role: 'owner' },
      { id: uuid(3), userId: uuid(103), shopId, role: 'founder' },
      { id: uuid(4), userId: uuid(104), shopId, role: 'advisor' },
      { id: uuid(5), userId: uuid(105), shopId, role: 'parts' },
    ])
    await db.insert(customers).values({ id: uuid(10), shopId, name: 'Customer', phone: '5551234567' })
    await db.insert(vehicles).values({
      id: uuid(11), customerId: uuid(10), year: 2020, make: 'Ford', model: 'F-150',
    })
    actor = { profileId: uuid(1) }
    ticketId = uuid(20)
    await db.insert(tickets).values([
      { id: ticketId, shopId, ticketNumber: 7, source: 'tech_quick', customerId: null,
        vehicleId: null, concern: 'Brake noise', createdByProfileId: uuid(1) },
      { id: uuid(21), shopId: otherShop.id, ticketNumber: 1, source: 'tech_quick',
        customerId: null, vehicleId: null, concern: 'Other', createdByProfileId: uuid(2) },
    ])
    await db.insert(ticketJobs).values([
      { id: uuid(30), shopId, ticketId, title: 'Front brakes', kind: 'repair', requiredSkillTier: 1 },
      { id: uuid(31), shopId, ticketId, title: 'Canceled', kind: 'maintenance', requiredSkillTier: 1,
        workStatus: 'canceled' },
    ])
    await db.insert(vendorAccounts).values({
      id: uuid(90),
      shopId,
      vendor: 'test_vendor',
      displayName: 'Test vendor',
      mode: 'manual',
    })
    await db.insert(jobLines).values([
      { id: uuid(40), shopId, jobId: uuid(30), kind: 'part', description: 'Pads', quantity: 2,
        priceCents: 12_500, taxable: true, partNumber: 'PAD', brand: 'ACME', unitCostCents: 7_000,
        coreChargeCents: 100, fitment: 'Front', source: 'manual' },
      { id: uuid(41), shopId, jobId: uuid(30), kind: 'part', description: 'Vendor pads', quantity: 2,
        priceCents: 14_000, taxable: true, source: 'vendor_offer', vendorAccountId: uuid(90),
        partNumber: 'PAD-V', brand: 'ACME', unitCostCents: 7_000, coreChargeCents: 100,
        fitment: 'Front', externalOfferId: 'estimate-42', vendorSnapshot: manualOfferSnapshot() },
    ])
  })

  afterEach(async () => close())

  it('reauthorizes the persisted actor inside a consistent read-only snapshot', () => {
    const source = readFileSync(join(process.cwd(), 'lib/shop-os/quotes.ts'), 'utf8')
    const handler = source.slice(
      source.indexOf('export async function getQuoteBuilder'),
      source.indexOf('function isLockUnavailable'),
    )
    expect(handler).toMatch(/db\.transaction[\s\S]*loadActiveActor\(transactionDb/)
    expect(handler).toMatch(/isolationLevel: 'repeatable read', accessMode: 'read only'/)
    expect(handler).toMatch(/\.from\(tickets\)[\s\S]*?\.limit\(1\)[\s\S]*?\.from\(ticketJobs\)[\s\S]*?\.from\(jobLines\)[\s\S]*?\.from\(quoteVersions\)/)
    expect(handler).not.toMatch(/\.from\(tickets\)[\s\S]*?\.for\('update'/)
  })

  it('classifies an injected read failure without masking unexpected errors', async () => {
    const lockError = Object.assign(new Error('held ticket'), { code: '55P03' })
    await expect(getQuoteBuilder(db, { actor, ticketId }, {
      afterTicketLock: async () => { throw lockError },
    })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })

    await expect(getQuoteBuilder(db, { actor, ticketId }, {
      afterTicketLock: async () => { throw new TypeError('programmer error') },
    })).rejects.toThrow('programmer error')
  })

  it('returns only row-18-safe configuration, eligible jobs, and manual line fields', async () => {
    const result = await getQuoteBuilder(db, { actor, ticketId })
    expect(result).toEqual({
      ok: true,
      builder: {
        ticket: { id: ticketId, status: 'open', reconciled: false },
        configuration: {
          laborRateCents: 15_000, taxRateBps: 825, partsMarkupBps: null,
          laborRateConfigured: true, taxRateConfigured: true,
        },
        jobs: [{
          id: uuid(30), title: 'Front brakes', kind: 'repair', workStatus: 'open',
          story: { content: null, source: null, reviewStatus: null, revision: 0 },
          storyMode: null,
          decisionEligible: false,
          approval: { state: 'pending_quote', quoteVersionId: null },
          lines: [{
            id: uuid(40), kind: 'part', description: 'Pads', sort: 0, quantity: '2',
            priceCents: 12_500, taxable: true, partNumber: 'PAD', brand: 'ACME',
            coreChargeCents: 100, fitment: 'Front', laborHours: null, laborRateCents: null,
            source: 'manual', mutable: true,
          }, {
            id: uuid(41), kind: 'part', description: 'Vendor pads', sort: 0, quantity: '2',
            priceCents: 14_000, taxable: true, partNumber: 'PAD-V', brand: 'ACME',
            coreChargeCents: null, fitment: 'Front', laborHours: null, laborRateCents: null,
            source: 'vendor_offer', mutable: false,
          }],
        }],
        capabilities: { canRecordCustomerApproval: false },
        activeVersion: null,
      },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain(shopId)
    expect(serialized).not.toContain('unitCost')
    expect(serialized).not.toContain('vendorAccountId')
    expect(serialized).not.toContain('Test supplier')
    expect(serialized).not.toContain('unitCost')
    expect(serialized).not.toContain('estimate-42')
    expect(serialized).not.toContain('lastEditedByProfileId')
    expect(serialized).not.toContain('customerId')
  })

  it('fails closed instead of hiding malformed sourced truth', async () => {
    await db.update(jobLines).set({ vendorSnapshot: { token: 'secret' } })
      .where(eq(jobLines.id, uuid(41)))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({
      ok: false, error: 'conflict', retryable: false,
    })
  })

  it.each([
    { laborHours: 1 },
    { laborRateCents: 15_000 },
  ])('fails closed when sourced part truth contains labor fields %#', async (corruption) => {
    await db.update(jobLines).set(corruption).where(eq(jobLines.id, uuid(41)))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({
      ok: false, error: 'conflict', retryable: false,
    })
  })

  it('returns validated immutable version totals and fails closed on corrupt or duplicate active versions', async () => {
    await db.update(tickets).set({ customerId: uuid(10), vehicleId: uuid(11) }).where(eq(tickets.id, ticketId))
    const snapshot = {
      schemaVersion: 1,
      ticket: {
        id: ticketId, number: 7, customerId: uuid(10), vehicleId: uuid(11),
        laborRateCents: 15_000, taxRateBps: 825,
      },
      jobs: [{
        id: uuid(30), title: 'Front brakes', kind: 'repair', customerStory: null, storyMeta: null,
        lines: [{
          id: uuid(40), kind: 'part', description: 'Pads', quantity: '2', priceCents: 12_500,
          taxable: true, partNumber: 'PAD', brand: 'ACME', coreChargeCents: 100,
          fitment: 'Front', laborHours: null, laborRateCents: null, source: 'manual', vendorContext: null,
        }],
        attachments: [], totals: { subtotalCents: 12_500, taxableSubtotalCents: 12_500 },
      }],
      totals: { subtotalCents: 12_500, taxableSubtotalCents: 12_500, taxCents: 1_031, totalCents: 13_531 },
    }
    await db.insert(quoteVersions).values({
      id: uuid(50), shopId, ticketId, versionNumber: 3, snapshot, createdByProfileId: uuid(1),
    })
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toMatchObject({
      ok: true, builder: { activeVersion: {
        id: uuid(50), versionNumber: 3, totalCents: 13_531,
        jobs: [{ jobId: uuid(30), subtotalCents: 12_500 }],
      }, jobs: [{ decisionEligible: true }] },
    })
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.id, uuid(50)))
    await db.insert(quoteVersions).values({
      id: uuid(52), shopId, ticketId, versionNumber: 4, snapshot: {}, createdByProfileId: uuid(1),
    })
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({
      ok: false, error: 'conflict', retryable: false,
    })
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.id, uuid(52)))
    await db.insert(quoteVersions).values({
      id: uuid(53), shopId, ticketId, versionNumber: 5, snapshot, createdByProfileId: uuid(1),
    })
    await db.insert(quoteVersions).values({
      id: uuid(51), shopId, ticketId, versionNumber: 6, snapshot, createdByProfileId: uuid(1),
    })
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({
      ok: false, error: 'conflict', retryable: false,
    })
  })

  it.each([
    { kind: 'part' as const, coreChargeCents: 100, laborHours: null, laborRateCents: null },
    { kind: 'fee' as const, coreChargeCents: null, laborHours: null, laborRateCents: null },
  ])('rejects unsafe sourced truth in an active immutable snapshot %#', async (lineShape) => {
    await db.update(tickets).set({ customerId: uuid(10), vehicleId: uuid(11) })
      .where(eq(tickets.id, ticketId))
    await db.insert(quoteVersions).values({
      id: uuid(60), shopId, ticketId, versionNumber: 1, createdByProfileId: uuid(1),
      snapshot: {
        schemaVersion: 1,
        ticket: { id: ticketId, number: 7, customerId: uuid(10), vehicleId: uuid(11), laborRateCents: 15_000, taxRateBps: 825 },
        jobs: [{
          id: uuid(30), title: 'Front brakes', kind: 'repair', customerStory: null, storyMeta: null,
          lines: [{
            id: uuid(41), description: 'Sourced pads', quantity: '2', priceCents: 14_000,
            taxable: true, partNumber: null, brand: null, fitment: null,
            source: 'vendor_offer', vendorContext: null, ...lineShape,
          }],
          attachments: [], totals: { subtotalCents: 14_000, taxableSubtotalCents: 14_000 },
        }],
        totals: { subtotalCents: 14_000, taxableSubtotalCents: 14_000, taxCents: 1_155, totalCents: 15_155 },
      },
    })
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({
      ok: false, error: 'conflict', retryable: false,
    })
  })

  it.each(['in_progress', 'blocked'] as const)(
    'projects an active-snapshot %s job as decision-ineligible',
    async (workStatus) => {
      await db.update(tickets).set({ customerId: uuid(10), vehicleId: uuid(11) }).where(eq(tickets.id, ticketId))
      const snapshot = {
        schemaVersion: 1,
        ticket: { id: ticketId, number: 7, customerId: uuid(10), vehicleId: uuid(11), laborRateCents: 15_000, taxRateBps: 825 },
        jobs: [{
          id: uuid(30), title: 'Front brakes', kind: 'repair', customerStory: null, storyMeta: null,
          lines: [{ id: uuid(40), kind: 'part', description: 'Pads', quantity: '2', priceCents: 12_500,
            taxable: true, partNumber: 'PAD', brand: 'ACME', coreChargeCents: 100, fitment: 'Front',
            laborHours: null, laborRateCents: null, source: 'manual', vendorContext: null }],
          attachments: [], totals: { subtotalCents: 12_500, taxableSubtotalCents: 12_500 },
        }],
        totals: { subtotalCents: 12_500, taxableSubtotalCents: 12_500, taxCents: 1_031, totalCents: 13_531 },
      }
      await db.insert(quoteVersions).values({
        id: uuid(50), shopId, ticketId, versionNumber: 1, snapshot, createdByProfileId: uuid(1),
      })
      await db.update(ticketJobs).set({ workStatus }).where(eq(ticketJobs.id, uuid(30)))
      await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toMatchObject({
        ok: true, builder: { jobs: [{ decisionEligible: false }] },
      })
    },
  )

  it.each(['done', 'canceled'] as const)(
    'fails closed when an active snapshot contains a hidden %s job',
    async (workStatus) => {
      await db.update(tickets).set({ customerId: uuid(10), vehicleId: uuid(11) }).where(eq(tickets.id, ticketId))
      const snapshot = {
        schemaVersion: 1,
        ticket: { id: ticketId, number: 7, customerId: uuid(10), vehicleId: uuid(11), laborRateCents: 15_000, taxRateBps: 825 },
        jobs: [{
          id: uuid(30), title: 'Front brakes', kind: 'repair', customerStory: null, storyMeta: null,
          lines: [{ id: uuid(40), kind: 'part', description: 'Pads', quantity: '2', priceCents: 12_500,
            taxable: true, partNumber: 'PAD', brand: 'ACME', coreChargeCents: 100, fitment: 'Front',
            laborHours: null, laborRateCents: null, source: 'manual', vendorContext: null }],
          attachments: [], totals: { subtotalCents: 12_500, taxableSubtotalCents: 12_500 },
        }],
        totals: { subtotalCents: 12_500, taxableSubtotalCents: 12_500, taxCents: 1_031, totalCents: 13_531 },
      }
      await db.insert(quoteVersions).values({
        id: uuid(50), shopId, ticketId, versionNumber: 1, snapshot, createdByProfileId: uuid(1),
      })
      await db.update(ticketJobs).set({ workStatus }).where(eq(ticketJobs.id, uuid(30)))
      await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({
        ok: false, error: 'conflict', retryable: false,
      })
    },
  )

  it('projects bounded story/review/approval facts and derives approval capability from the fresh actor', async () => {
    await db.update(ticketJobs).set({
      customerStory: {
        whatYouToldUs: 'Brake noise', whatWeFound: 'Pads are worn', howWeKnow: [],
        whatItMeansIfWaived: 'Stopping distance may increase', whatWeRecommend: 'Replace pads',
      },
      storyMeta: {
        source: 'ai', sessionId: uuid(70), generatedAt: '2026-07-11T12:00:00.000Z',
        lastEditedByProfileId: uuid(1), lastEditedAt: '2026-07-11T12:00:00.000Z',
        generationClientKey: uuid(71), generationRequestFingerprint: 'a'.repeat(64),
        generatedByProfileId: uuid(1), storyRevision: 2, reviewStatus: 'reviewed',
        reviewClientKey: uuid(72), reviewRequestFingerprint: 'b'.repeat(64),
        reviewedByProfileId: uuid(1), reviewedAt: '2026-07-11T12:01:00.000Z',
      },
      approvalState: 'quote_ready',
    }).where(eq(ticketJobs.id, uuid(30)))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toMatchObject({
      ok: true,
      builder: {
        jobs: [{
          story: {
            content: { whatWeFound: 'Pads are worn', whatWeRecommend: 'Replace pads' },
            source: 'ai', reviewStatus: 'reviewed', revision: 2,
          },
          approval: { state: 'quote_ready', quoteVersionId: null },
        }],
        capabilities: { canRecordCustomerApproval: false },
      },
    })
    await expect(getQuoteBuilder(db, { actor: { profileId: uuid(4) }, ticketId })).resolves.toMatchObject({
      ok: true, builder: { capabilities: { canRecordCustomerApproval: true } },
    })
    await expect(getQuoteBuilder(db, { actor: { profileId: uuid(5) }, ticketId })).resolves.toMatchObject({
      ok: true, builder: { capabilities: { canRecordCustomerApproval: false } },
    })
    await db.update(ticketJobs).set({ storyMeta: { source: 'ai' } as never }).where(eq(ticketJobs.id, uuid(30)))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({
      ok: false, error: 'conflict', retryable: false,
    })
  })

  it('derives a bounded diagnostic story mode without exposing raw engine state', async () => {
    await db.update(ticketJobs).set({ kind: 'diagnostic' }).where(eq(ticketJobs.id, uuid(30)))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toMatchObject({
      ok: true, builder: { jobs: [{ storyMode: 'authorization_only' }] },
    })
    await db.insert(sessions).values({
      id: uuid(60), shopId, techId: uuid(1), vehicleId: uuid(11),
      intake: { vehicleYear: 2020, vehicleMake: 'Ford', vehicleModel: 'F-150', customerComplaint: 'Brake noise' },
      treeState: {
        done: true, phase: 'repairing', currentNodeId: 'root',
        diagnosisLockedAt: '2026-07-11T12:00:00.000Z',
        rootCauseSummary: 'Pads are below specification.',
        proposedAction: { description: 'Replace front brake pads.', confidence: 0.94 },
        secretEngineState: 'never-project',
      } as never,
    })
    await db.update(ticketJobs).set({ kind: 'diagnostic', sessionId: uuid(60) }).where(eq(ticketJobs.id, uuid(30)))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toMatchObject({
      ok: true, builder: { jobs: [{ storyMode: 'ordinary_locked_tree' }] },
    })
    expect(JSON.stringify(await getQuoteBuilder(db, { actor, ticketId }))).not.toContain('secretEngineState')

    await db.update(sessions).set({ treeState: { done: false, phase: 'diagnosing', currentNodeId: 'root' } as never })
      .where(eq(sessions.id, uuid(60)))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toMatchObject({
      ok: true, builder: { jobs: [{ storyMode: 'unavailable' }] },
    })

    await db.update(sessions).set({
      treeState: { done: true, currentNodeId: '_topology' } as never,
    }).where(eq(sessions.id, uuid(60)))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toMatchObject({
      ok: true, builder: { jobs: [{ storyMode: 'topology_manual' }] },
    })

    await db.insert(sessionEvents).values({
      id: uuid(61), sessionId: uuid(60), nodeId: 'wizard', eventType: 'wizard_lock_in',
      aiResponse: { wizardLockIn: { flowVersionId: uuid(62) } },
    })
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toMatchObject({
      ok: true, builder: { jobs: [{ storyMode: 'published_wizard_unsupported' }] },
    })
  })

  it('fails closed when approved projection does not match the sole active version containing that job', async () => {
    await db.update(tickets).set({ customerId: uuid(10), vehicleId: uuid(11) }).where(eq(tickets.id, ticketId))
    const snapshot = {
      schemaVersion: 1,
      ticket: { id: ticketId, number: 7, customerId: uuid(10), vehicleId: uuid(11), laborRateCents: 15_000, taxRateBps: 825 },
      jobs: [{
        id: uuid(30), title: 'Front brakes', kind: 'repair', customerStory: null, storyMeta: null,
        lines: [{ id: uuid(40), kind: 'part', description: 'Pads', quantity: '2', priceCents: 12_500,
          taxable: true, partNumber: 'PAD', brand: 'ACME', coreChargeCents: 100, fitment: 'Front',
          laborHours: null, laborRateCents: null, source: 'manual', vendorContext: null }],
        attachments: [], totals: { subtotalCents: 12_500, taxableSubtotalCents: 12_500 },
      }],
      totals: { subtotalCents: 12_500, taxableSubtotalCents: 12_500, taxCents: 1_031, totalCents: 13_531 },
    }
    await db.insert(quoteVersions).values([
      { id: uuid(50), shopId, ticketId, versionNumber: 1, snapshot, createdByProfileId: uuid(1) },
      { id: uuid(51), shopId, ticketId, versionNumber: 2, snapshot, createdByProfileId: uuid(1), supersededAt: new Date() },
    ])
    await db.update(ticketJobs).set({ approvalState: 'approved', approvedQuoteVersionId: uuid(50) }).where(eq(ticketJobs.id, uuid(30)))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toMatchObject({
      ok: true, builder: { jobs: [{ approval: { state: 'approved', quoteVersionId: uuid(50) } }] },
    })
    await db.update(ticketJobs).set({ approvedQuoteVersionId: uuid(51) }).where(eq(ticketJobs.id, uuid(30)))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({
      ok: false, error: 'conflict', retryable: false,
    })
    await db.update(ticketJobs).set({ approvedQuoteVersionId: uuid(50) }).where(eq(ticketJobs.id, uuid(30)))
    await db.execute(sql`alter table quote_versions disable trigger all`)
    await db.update(quoteVersions).set({
      snapshot: { ...snapshot, jobs: [{ ...snapshot.jobs[0], id: uuid(31), lines: [{ ...snapshot.jobs[0].lines[0], id: uuid(41) }] }] },
    }).where(eq(quoteVersions.id, uuid(50)))
    await db.execute(sql`alter table quote_versions enable trigger all`)
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({
      ok: false, error: 'conflict', retryable: false,
    })
  })

  it('exposes configured-null state without inventing rates', async () => {
    await db.update(shops).set({ laborRateCents: null, taxRateBps: null }).where(eq(shops.id, shopId))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toMatchObject({
      ok: true,
      builder: { configuration: {
        laborRateCents: null, taxRateBps: null,
        laborRateConfigured: false, taxRateConfigured: false,
      } },
    })
  })

  it('derives the tenant from a current persisted builder role and canonicalizes UUIDs', async () => {
    await expect(getQuoteBuilder(db, {
      actor: { profileId: uuid(1).toUpperCase() }, ticketId: ticketId.toUpperCase(),
    })).resolves.toMatchObject({ ok: true })
    await expect(getQuoteBuilder(db, { actor: { profileId: uuid(2) }, ticketId })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(getQuoteBuilder(db, { actor: { profileId: uuid(3) }, ticketId })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null }).where(eq(profiles.id, uuid(1)))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('uses privacy-safe not-found for malformed, missing, cross-shop, and non-open tickets', async () => {
    await expect(getQuoteBuilder(db, { actor, ticketId: 'bad' })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(getQuoteBuilder(db, { actor, ticketId: uuid(999) })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(getQuoteBuilder(db, { actor, ticketId: uuid(21) })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticketId))
    await expect(getQuoteBuilder(db, { actor, ticketId })).resolves.toEqual({ ok: false, error: 'not_found' })
  })
})
