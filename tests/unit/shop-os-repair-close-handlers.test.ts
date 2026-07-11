import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import { createSession } from '@/lib/db/queries'
import {
  customers,
  profiles,
  quoteEvents,
  quoteVersions,
  sessionEvents,
  sessions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { closeSessionForUser, submitRepairObservationForUser } from '@/lib/sessions'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS ticket-backed repair and close handlers', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let sessionId: string
  let jobId: string
  let ticketId: string
  let versionId: string
  const techId = uuid(1)
  const techUserId = uuid(101)
  const advisorId = uuid(2)

  const performedOutcome = {
    rootCause: 'Fuel supply pressure falls below commanded pressure under load.',
    actionType: 'repair',
    verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
    diagMinutes: 45,
    repairMinutes: 60,
  }

  function snapshot() {
    return {
      schemaVersion: 1,
      ticket: {
        id: ticketId, number: 1, customerId: uuid(10), vehicleId: uuid(11),
        laborRateCents: 12_500, taxRateBps: 825,
      },
      jobs: [{
        id: jobId,
        title: 'Diagnose low rail pressure',
        kind: 'diagnostic',
        customerStory: {
          whatYouToldUs: 'Low rail pressure under load',
          whatWeFound: 'Fuel supply pressure falls under commanded pressure.',
          howWeKnow: [],
          whatItMeansIfWaived: 'The concern remains unresolved.',
          whatWeRecommend: 'Test the low-pressure supply circuit.',
        },
        storyMeta: { source: 'manual', sessionId },
        lines: [{
          id: uuid(40), kind: 'fee', description: 'Diagnostic evaluation', quantity: '1',
          priceCents: 15_000, taxable: true, partNumber: null, brand: null,
          coreChargeCents: null, fitment: null, laborHours: null, laborRateCents: null,
          source: 'manual', vendorContext: null,
        }],
        attachments: [],
        totals: { subtotalCents: 15_000, taxableSubtotalCents: 15_000 },
      }],
      totals: {
        subtotalCents: 15_000, taxableSubtotalCents: 15_000,
        taxCents: 1_238, totalCents: 16_238,
      },
    }
  }

  async function decide(kind: 'approved' | 'declined') {
    await db.update(ticketJobs).set({
      approvalState: kind,
      approvedQuoteVersionId: kind === 'approved' ? versionId : null,
    }).where(eq(ticketJobs.id, jobId))
    await db.insert(quoteEvents).values({
      id: kind === 'approved' ? uuid(60) : uuid(61),
      shopId,
      ticketId,
      jobId,
      quoteVersionId: versionId,
      kind,
      actorProfileId: advisorId,
      approvedVia: kind === 'approved' ? 'phone' : null,
      requestKey: kind === 'approved' ? uuid(70) : uuid(71),
    })
  }

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop] = await db.insert(shops).values({
      name: 'North', laborRateCents: 12_500, taxRateBps: 825,
    }).returning()
    shopId = shop.id
    await db.insert(profiles).values([
      { id: techId, userId: techUserId, shopId, role: 'tech', skillTier: 3 },
      { id: advisorId, userId: uuid(102), shopId, role: 'advisor' },
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
        nodes: [{ id: 'root', label: 'Confirm pressure', status: 'resolved' }],
        currentNodeId: 'root',
        message: 'Diagnosis locked',
        phase: 'repairing',
        done: true,
        diagnosisLockedAt: new Date().toISOString(),
        rootCauseSummary: 'Fuel supply pressure falls below commanded pressure under load.',
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

  it('blocks repair observations before approval without persistence or AI', async () => {
    const getGuidance = vi.fn()
    const result = await submitRepairObservationForUser({
      db,
      userId: techUserId,
      sessionId,
      body: { observation: 'Pressure still drops under load.' },
      getGuidance,
    })

    expect(result).toEqual({ ok: false, status: 409, error: 'repair_not_authorized' })
    expect(getGuidance).not.toHaveBeenCalled()
    expect(await db.select().from(sessionEvents)).toHaveLength(0)
  })

  it('allows an approved repair observation and retains guidance behavior', async () => {
    await decide('approved')
    const getGuidance = vi.fn().mockResolvedValue({ text: 'Verify low-side supply pressure.' })
    const result = await submitRepairObservationForUser({
      db,
      userId: techUserId,
      sessionId,
      body: { observation: 'Pressure still drops under load.' },
      getGuidance,
    })

    expect(result).toEqual({ ok: true, guidance: { text: 'Verify low-side supply pressure.' } })
    expect(getGuidance).toHaveBeenCalledTimes(1)
    expect(await db.select().from(sessionEvents)).toHaveLength(2)
  })

  it('rejects a performed-repair outcome before approval and skips specificity', async () => {
    const validateSpecificity = vi.fn()
    const result = await closeSessionForUser({
      db,
      userId: techUserId,
      sessionId,
      body: performedOutcome,
      validateSpecificity,
    })

    expect(result).toEqual({ ok: false, status: 409, error: 'repair_not_authorized' })
    expect(validateSpecificity).not.toHaveBeenCalled()
    expect((await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0].status).toBe('open')
  })

  it('closes approved performed work and marks its job done', async () => {
    await decide('approved')
    const result = await closeSessionForUser({
      db,
      userId: techUserId,
      sessionId,
      body: performedOutcome,
      validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
    })

    expect(result).toEqual({ ok: true })
    expect((await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0].status).toBe('closed')
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0].workStatus).toBe('done')
  })

  it('closes a declined job only as no repair performed', async () => {
    await decide('declined')
    const validateSpecificity = vi.fn()
    const promoteToCorpus = vi.fn()
    const recordDiagnosticOutcome = vi.fn()
    const result = await closeSessionForUser({
      db,
      userId: techUserId,
      sessionId,
      body: {
        mode: 'declined_no_repair',
        note: 'Customer declined after reviewing the estimate.',
        actionType: 'part_replacement',
        verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
        repairMinutes: 999,
      },
      validateSpecificity,
      promoteToCorpus,
      recordDiagnosticOutcome,
    })

    expect(result).toEqual({ ok: true })
    const session = (await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0]
    expect(session.status).toBe('closed')
    expect(session.outcome).toMatchObject({
      actionType: 'no_fix',
      verification: { codesCleared: false, testDrive: false, symptomsResolved: 'no' },
      repairMinutes: 0,
      closeout: { kind: 'declined_no_repair' },
      notes: 'Customer declined after reviewing the estimate.',
    })
    expect(session.outcome).not.toHaveProperty('partInfo')
    expect(validateSpecificity).not.toHaveBeenCalled()
    expect(promoteToCorpus).not.toHaveBeenCalled()
    expect(recordDiagnosticOutcome).not.toHaveBeenCalled()
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0].workStatus).toBe('canceled')
  })

  it('rejects performed-repair claims after the customer declined', async () => {
    await decide('declined')
    const result = await closeSessionForUser({
      db,
      userId: techUserId,
      sessionId,
      body: performedOutcome,
      validateSpecificity: vi.fn(),
    })
    expect(result).toEqual({ ok: false, status: 409, error: 'repair_not_authorized' })
    expect((await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0].status).toBe('open')
  })
})
