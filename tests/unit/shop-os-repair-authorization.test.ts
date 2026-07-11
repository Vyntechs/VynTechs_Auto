import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { createSession } from '@/lib/db/queries'
import {
  customers,
  profiles,
  quoteEvents,
  quoteVersions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import {
  lockDiagnosticRepairAccess,
  resolveDiagnosticRepairAccess,
} from '@/lib/shop-os/repair-authorization'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS diagnostic repair authorization', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let ticketId: string
  let sessionId: string
  let jobId: string
  let versionId: string
  const techId = uuid(1)
  const techUserId = uuid(101)
  const advisorId = uuid(2)

  const customerStory = {
    whatYouToldUs: 'Low rail pressure under load',
    whatWeFound: 'Fuel supply pressure falls under commanded pressure.',
    howWeKnow: [],
    whatItMeansIfWaived: 'The concern remains unresolved.',
    whatWeRecommend: 'Test the low-pressure supply circuit.',
  }

  function snapshot(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      ticket: {
        id: ticketId,
        number: 1,
        customerId: uuid(10),
        vehicleId: uuid(11),
        laborRateCents: 12_500,
        taxRateBps: 825,
      },
      jobs: [{
        id: jobId,
        title: 'Diagnose low rail pressure',
        kind: 'diagnostic',
        customerStory,
        storyMeta: { source: 'manual', sessionId },
        lines: [{
          id: uuid(40),
          kind: 'fee',
          description: 'Diagnostic evaluation',
          quantity: '1',
          priceCents: 15_000,
          taxable: true,
          partNumber: null,
          brand: null,
          coreChargeCents: null,
          fitment: null,
          laborHours: null,
          laborRateCents: null,
          source: 'manual',
          vendorContext: null,
        }],
        attachments: [],
        totals: { subtotalCents: 15_000, taxableSubtotalCents: 15_000 },
      }],
      totals: {
        subtotalCents: 15_000,
        taxableSubtotalCents: 15_000,
        taxCents: 1_238,
        totalCents: 16_238,
      },
      ...overrides,
    }
  }

  async function setApproved(options: { event?: boolean } = {}) {
    await db.update(ticketJobs).set({
      approvalState: 'approved',
      approvedQuoteVersionId: versionId,
    }).where(eq(ticketJobs.id, jobId))
    if (options.event !== false) {
      await db.insert(quoteEvents).values({
        id: uuid(60),
        shopId,
        ticketId,
        jobId,
        quoteVersionId: versionId,
        kind: 'approved',
        actorProfileId: advisorId,
        approvedVia: 'phone',
        requestKey: uuid(70),
      })
    }
  }

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North', laborRateCents: 12_500, taxRateBps: 825 },
      { name: 'South', laborRateCents: 14_000, taxRateBps: 700 },
    ]).returning()
    shopId = shop.id
    otherShopId = otherShop.id
    await db.insert(profiles).values([
      { id: techId, userId: techUserId, shopId, role: 'tech', skillTier: 3 },
      { id: advisorId, userId: uuid(102), shopId, role: 'advisor' },
      { id: uuid(3), userId: uuid(103), shopId: otherShopId, role: 'tech', skillTier: 3 },
    ])
    await db.insert(customers).values({
      id: uuid(10), shopId, name: 'Customer', phone: '5550102026',
    })
    await db.insert(vehicles).values({
      id: uuid(11), customerId: uuid(10), year: 2018, make: 'Ford', model: 'F-250',
    })
    ticketId = uuid(20)
    await db.insert(tickets).values({
      id: ticketId,
      shopId,
      ticketNumber: 1,
      source: 'counter',
      customerId: uuid(10),
      vehicleId: uuid(11),
      concern: 'Low rail pressure under load',
      createdByProfileId: advisorId,
    })
    const session = await createSession(db, {
      id: uuid(30),
      shopId,
      techId,
      vehicleId: uuid(11),
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-250',
        customerComplaint: 'Low rail pressure under load',
      },
      treeState: {
        nodes: [{ id: 'root', label: 'Confirm pressure', status: 'complete' }],
        currentNodeId: 'root',
        message: 'Diagnosis locked',
        phase: 'repairing',
        done: true,
        diagnosisLockedAt: new Date().toISOString(),
        rootCauseSummary: 'Fuel supply pressure falls under commanded pressure.',
      },
    })
    sessionId = session.id
    jobId = uuid(31)
    await db.insert(ticketJobs).values({
      id: jobId,
      shopId,
      ticketId,
      title: 'Diagnose low rail pressure',
      kind: 'diagnostic',
      requiredSkillTier: 3,
      assignedTechId: techId,
      sessionId,
      workStatus: 'in_progress',
      approvalState: 'quote_ready',
    })
    versionId = uuid(50)
    await db.insert(quoteVersions).values({
      id: versionId,
      shopId,
      ticketId,
      versionNumber: 1,
      snapshot: snapshot(),
      createdByProfileId: advisorId,
    })
  })

  afterEach(async () => close())

  it('preserves ticketless sessions as legacy', async () => {
    await db.delete(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(await resolveDiagnosticRepairAccess(db, { shopId, sessionId }))
      .toEqual({ state: 'legacy' })
  })

  it('returns approved only for the exact active version and approval event', async () => {
    await setApproved()
    expect(await resolveDiagnosticRepairAccess(db, { shopId, sessionId })).toEqual({
      state: 'approved', ticketId, jobId, quoteVersionId: versionId,
    })
    expect(await db.transaction((tx) => lockDiagnosticRepairAccess(tx as TestDb, {
      shopId, sessionId, actorProfileId: techId,
    }))).toEqual({ state: 'approved', ticketId, jobId, quoteVersionId: versionId })
  })

  it('distinguishes declined from approval still required', async () => {
    expect(await resolveDiagnosticRepairAccess(db, { shopId, sessionId })).toEqual({
      state: 'awaiting_approval', ticketId, jobId,
    })
    await db.update(ticketJobs).set({
      approvalState: 'declined', approvedQuoteVersionId: null,
    }).where(eq(ticketJobs.id, jobId))
    await db.insert(quoteEvents).values({
      id: uuid(61),
      shopId,
      ticketId,
      jobId,
      quoteVersionId: versionId,
      kind: 'declined',
      actorProfileId: advisorId,
      approvedVia: null,
      requestKey: uuid(71),
    })
    expect(await resolveDiagnosticRepairAccess(db, { shopId, sessionId })).toEqual({
      state: 'declined', ticketId, jobId,
    })
  })

  it('fails closed when the approval event is missing', async () => {
    await setApproved({ event: false })
    expect(await resolveDiagnosticRepairAccess(db, { shopId, sessionId }))
      .toEqual({ state: 'unavailable' })
  })

  it('fails closed when the approved version is superseded or omits the job', async () => {
    await setApproved()
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.id, versionId))
    expect(await resolveDiagnosticRepairAccess(db, { shopId, sessionId }))
      .toEqual({ state: 'unavailable' })

    const omittedJobVersionId = uuid(51)
    await db.insert(quoteVersions).values({
      id: omittedJobVersionId,
      shopId,
      ticketId,
      versionNumber: 2,
      snapshot: snapshot({ jobs: [] }),
      createdByProfileId: advisorId,
    })
    await db.update(ticketJobs).set({
      approvedQuoteVersionId: omittedJobVersionId,
    }).where(eq(ticketJobs.id, jobId))
    await db.insert(quoteEvents).values({
      id: uuid(62),
      shopId,
      ticketId,
      jobId,
      quoteVersionId: omittedJobVersionId,
      kind: 'approved',
      actorProfileId: advisorId,
      approvedVia: 'phone',
      requestKey: uuid(72),
    })
    expect(await resolveDiagnosticRepairAccess(db, { shopId, sessionId }))
      .toEqual({ state: 'unavailable' })
  })

  it('fails closed for non-actionable job and actor truth', async () => {
    await setApproved()
    await db.update(ticketJobs).set({ workStatus: 'canceled' }).where(eq(ticketJobs.id, jobId))
    expect(await resolveDiagnosticRepairAccess(db, { shopId, sessionId }))
      .toEqual({ state: 'unavailable' })

    await db.update(ticketJobs).set({ workStatus: 'in_progress' }).where(eq(ticketJobs.id, jobId))
    await db.update(profiles).set({ deactivatedAt: new Date() }).where(eq(profiles.id, techId))
    expect(await db.transaction((tx) => lockDiagnosticRepairAccess(tx as TestDb, {
      shopId, sessionId, actorProfileId: techId,
    }))).toEqual({ state: 'unavailable' })
  })
})
