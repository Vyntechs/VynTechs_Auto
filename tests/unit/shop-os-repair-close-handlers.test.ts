import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { readFileSync } from 'node:fs'
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
import type { RepairGuidancePromptInput } from '@/lib/ai/repair-guidance'

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

  async function revisions() {
    const [ticket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    return {
      job: job.revision,
      projection: ticket.projectionRevision,
      continuity: ticket.continuityRevision,
    }
  }

  async function closeTicketed(
    body: unknown,
    validateSpecificity = vi.fn().mockResolvedValue({ ok: true }),
    seams: Record<string, unknown> = {},
  ) {
    return closeSessionForUser({
      db,
      userId: techUserId,
      sessionId,
      body,
      validateSpecificity,
      ...seams,
    } as Parameters<typeof closeSessionForUser>[0])
  }

  async function observe(
    getGuidance: Parameters<typeof submitRepairObservationForUser>[0]['getGuidance'],
    seams: Record<string, unknown> = {},
  ) {
    return submitRepairObservationForUser({
      db,
      userId: techUserId,
      sessionId,
      body: { observation: 'Pressure still drops under load.' },
      getGuidance,
      ...seams,
    } as Parameters<typeof submitRepairObservationForUser>[0])
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
    expect(await revisions()).toEqual({ job: 1n, projection: 1n, continuity: 1n })
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
    expect(await revisions()).toEqual({ job: 1n, projection: 1n, continuity: 1n })
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

  it('strips a client-forged no-repair marker from an approved performed outcome', async () => {
    await decide('approved')
    const result = await closeSessionForUser({
      db,
      userId: techUserId,
      sessionId,
      body: { ...performedOutcome, closeout: { kind: 'declined_no_repair' } },
      validateSpecificity: vi.fn().mockResolvedValue({ ok: true }),
    })
    expect(result).toEqual({ ok: true })
    const stored = (await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0]
    expect(stored.outcome?.closeout).toBeUndefined()
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0].workStatus).toBe('done')
  })

  it('uses locked diagnosis truth for declined closeout', async () => {
    await decide('declined')
    const freshRootCause = 'Locked fresh root cause after concurrent state refresh.'
    const result = await closeSessionForUser({
      db,
      userId: techUserId,
      sessionId,
      body: { mode: 'declined_no_repair' },
      validateSpecificity: vi.fn(),
      beforeTicketedCloseLock: async () => {
        const [current] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
        await db.update(sessions).set({
          treeState: { ...current.treeState, rootCauseSummary: freshRootCause },
        }).where(eq(sessions.id, sessionId))
      },
    })
    expect(result).toEqual({ ok: true })
    expect((await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0].outcome?.rootCause)
      .toBe(freshRootCause)
  })

  it('runs a locked approval preflight before specificity AI', async () => {
    await decide('approved')
    const validateSpecificity = vi.fn().mockResolvedValue({ ok: true })
    const result = await closeSessionForUser({
      db,
      userId: techUserId,
      sessionId,
      body: performedOutcome,
      validateSpecificity,
      beforeAuthorizationPreflight: async () => {
        await db.update(ticketJobs).set({
          approvalState: 'declined', approvedQuoteVersionId: null,
        }).where(eq(ticketJobs.id, jobId))
        await db.insert(quoteEvents).values({
          id: uuid(62), shopId, ticketId, jobId, quoteVersionId: versionId,
          kind: 'declined', actorProfileId: advisorId, approvedVia: null, requestKey: uuid(72),
        })
      },
    })
    expect(result).toEqual({ ok: false, status: 409, error: 'repair_not_authorized' })
    expect(validateSpecificity).not.toHaveBeenCalled()
  })

  it.each(['afterTicketedWrite', 'afterTicketedFinalization'] as const)(
    'rolls back declined close, event, cancel, and revisions at %s', async (seam) => {
    await decide('declined')
    const marker = new Error('declined rollback marker')

    await expect(closeTicketed(
      { mode: 'declined_no_repair' },
      vi.fn(),
      { [seam]: async () => { throw marker } },
    )).rejects.toBe(marker)

    expect((await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0].status).toBe('open')
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0].workStatus)
      .toBe('in_progress')
    expect(await db.select().from(sessionEvents)).toHaveLength(0)
    expect(await revisions()).toEqual({ job: 0n, projection: 0n, continuity: 0n })
    },
  )

  it.each([
    ['actor activity', async () => db.update(profiles).set({ deactivatedAt: new Date() })
      .where(eq(profiles.id, techId))],
    ['actor role', async () => db.update(profiles).set({ role: 'advisor' })
      .where(eq(profiles.id, techId))],
    ['actor tier', async () => db.update(profiles).set({ skillTier: 2 })
      .where(eq(profiles.id, techId))],
    ['assignment', async () => db.update(ticketJobs).set({ assignedTechId: null })
      .where(eq(ticketJobs.id, jobId))],
    ['job lifecycle', async () => db.update(ticketJobs).set({ workStatus: 'done' })
      .where(eq(ticketJobs.id, jobId))],
    ['ticket lifecycle', async () => db.update(tickets).set({
      status: 'closed',
      deliveredAt: new Date(),
      deliveredByProfileId: advisorId,
      closedAt: new Date(),
      closedByProfileId: advisorId,
      closeDisposition: 'delivered',
    }).where(eq(tickets.id, ticketId))],
    ['session lifecycle', async () => db.update(sessions).set({ status: 'closed', closedAt: new Date() })
      .where(eq(sessions.id, sessionId))],
    ['approval', async () => db.update(ticketJobs).set({ approvalState: 'quote_ready' })
      .where(eq(ticketJobs.id, jobId))],
    ['approved version', async () => db.update(quoteVersions).set({ supersededAt: new Date() })
      .where(eq(quoteVersions.id, versionId))],
    ['approval event', async () => db.insert(quoteEvents).values({
      id: uuid(63), shopId, ticketId, jobId, quoteVersionId: versionId,
      kind: 'approved', actorProfileId: advisorId, approvedVia: 'phone', requestKey: uuid(73),
    })],
  ] as const)('refuses declined close when locked %s drifts', async (_name, drift) => {
    await decide('declined')
    const result = await closeTicketed(
      { mode: 'declined_no_repair' },
      vi.fn(),
      { beforeTicketedCloseLock: drift },
    )

    expect(result).toEqual({ ok: false, status: 409, error: 'repair_not_authorized' })
    expect(await db.select().from(sessionEvents)).toHaveLength(0)
    expect(await revisions()).toEqual({ job: 0n, projection: 0n, continuity: 0n })
  })

  it.each(['afterTicketedWrite', 'afterTicketedFinalization'] as const)(
    'rolls back approved close, event, completion, and revisions at %s', async (seam) => {
    await decide('approved')
    const marker = new Error('approved rollback marker')

    await expect(closeTicketed(performedOutcome, undefined, {
      [seam]: async () => { throw marker },
    })).rejects.toBe(marker)

    expect((await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0].status).toBe('open')
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0].workStatus)
      .toBe('in_progress')
    expect(await db.select().from(sessionEvents)).toHaveLength(0)
    expect(await revisions()).toEqual({ job: 0n, projection: 0n, continuity: 0n })
    },
  )

  it('reauthorizes approved close after the specificity provider pauses', async () => {
    await decide('approved')
    const validateSpecificity = vi.fn(async () => {
      await db.update(profiles).set({
        membershipStatus: 'pending', membershipActivatedAt: null,
      }).where(eq(profiles.id, techId))
      return { ok: true as const }
    })

    expect(await closeTicketed(performedOutcome, validateSpecificity)).toEqual({
      ok: false, status: 409, error: 'repair_not_authorized',
    })
    expect((await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0].status).toBe('open')
    expect(await db.select().from(sessionEvents)).toHaveLength(0)
    expect(await revisions()).toEqual({ job: 0n, projection: 0n, continuity: 0n })
  })

  it.each([
    ['actor role', async () => db.update(profiles).set({ role: 'advisor' }).where(eq(profiles.id, techId))],
    ['actor tier', async () => db.update(profiles).set({ skillTier: 2 }).where(eq(profiles.id, techId))],
    ['assignment', async () => db.update(ticketJobs).set({ assignedTechId: null }).where(eq(ticketJobs.id, jobId))],
    ['job lifecycle', async () => db.update(ticketJobs).set({ workStatus: 'done' }).where(eq(ticketJobs.id, jobId))],
    ['ticket lifecycle', async () => db.update(tickets).set({
      status: 'closed',
      deliveredAt: new Date(),
      deliveredByProfileId: advisorId,
      closedAt: new Date(),
      closedByProfileId: advisorId,
      closeDisposition: 'delivered',
    }).where(eq(tickets.id, ticketId))],
    ['approval', async () => {
      await db.update(ticketJobs).set({
        approvalState: 'declined', approvedQuoteVersionId: null,
      }).where(eq(ticketJobs.id, jobId))
      await db.insert(quoteEvents).values({
        id: uuid(62), shopId, ticketId, jobId, quoteVersionId: versionId,
        kind: 'declined', actorProfileId: advisorId, approvedVia: null, requestKey: uuid(72),
      })
    }],
    ['approved version', async () => db.update(quoteVersions).set({ supersededAt: new Date() })
      .where(eq(quoteVersions.id, versionId))],
    ['session lifecycle', async () => db.update(sessions).set({ status: 'closed', closedAt: new Date() })
      .where(eq(sessions.id, sessionId))],
  ] as const)('refuses approved close when %s drifts during the provider pause', async (_name, drift) => {
    await decide('approved')
    const result = await closeTicketed(performedOutcome, vi.fn(async () => {
      await drift()
      return { ok: true as const }
    }))

    expect(result).toEqual({ ok: false, status: 409, error: 'repair_not_authorized' })
    expect(await db.select().from(sessionEvents)).toHaveLength(0)
    expect(await revisions()).toEqual({ job: 0n, projection: 0n, continuity: 0n })
  })

  it('keeps terminal close replay as the existing no-op response with no second revision bump', async () => {
    await decide('approved')
    expect(await closeTicketed(performedOutcome)).toEqual({ ok: true })
    const afterFirst = await revisions()

    expect(await closeTicketed(performedOutcome)).toEqual({
      ok: false, status: 400, error: 'session is not open',
    })
    expect(await revisions()).toEqual(afterFirst)
    expect((await db.select().from(sessionEvents)).filter(({ eventType }) => eventType === 'close'))
      .toHaveLength(1)
  })

  it('gives the guidance provider a complete immutable owned snapshot in tied event order', async () => {
    await decide('approved')
    const tiedAt = new Date('2026-07-17T12:00:00.000Z')
    await db.insert(sessionEvents).values([
      {
        id: uuid(82), sessionId, nodeId: 'root', eventType: 'repair_guidance',
        aiResponse: { repairGuidance: { text: 'second' } }, createdAt: tiedAt,
      },
      {
        id: uuid(81), sessionId, nodeId: 'root', eventType: 'repair_observation',
        observationText: 'first', aiResponse: { treeUpdate: { nested: ['owned'] } }, createdAt: tiedAt,
      },
    ])
    const getGuidance = vi.fn(async (input: RepairGuidancePromptInput) => {
      expect(Object.isFrozen(input)).toBe(true)
      expect(Object.isFrozen(input.tree)).toBe(true)
      expect(Object.isFrozen(input.tree.nodes)).toBe(true)
      expect(Object.isFrozen(input.recentEvents)).toBe(true)
      expect(input.recentEvents.map(({ id }) => id)).toEqual([uuid(81), uuid(82)])
      expect(input.recentEvents).toHaveLength(2)
      expect(() => { input.tree.nodes[0].label = 'mutated' }).toThrow()
      expect(() => {
        ;(input.recentEvents[0].aiResponse as { treeUpdate: { nested: string[] } })
          .treeUpdate.nested.push('mutated')
      }).toThrow()
      expect(() => { input.recentEvents[0].createdAt.setTime(0) }).toThrow()
      return { text: 'Verify low-side supply pressure.' }
    })

    expect(await observe(getGuidance)).toEqual({
      ok: true, guidance: { text: 'Verify low-side supply pressure.' },
    })
    expect(getGuidance).toHaveBeenCalledTimes(1)
    expect(await revisions()).toEqual({ job: 0n, projection: 0n, continuity: 0n })
  })

  it.each([
    ['intervening event', async () => {
      await db.insert(sessionEvents).values({
        id: uuid(90), sessionId, nodeId: 'root', eventType: 'repair_observation',
        observationText: 'A newer event.', createdAt: new Date('2099-01-01T00:00:00.000Z'),
      })
    }],
    ['observation deletion', async () => {
      const events = await db.select().from(sessionEvents)
      const observation = events.find(({ eventType }) => eventType === 'repair_observation')!
      await db.delete(sessionEvents).where(eq(sessionEvents.id, observation.id))
    }],
    ['observation timestamp', async () => {
      const events = await db.select().from(sessionEvents)
      const observation = events.find(({ eventType }) => eventType === 'repair_observation')!
      await db.update(sessionEvents).set({ createdAt: new Date(0) })
        .where(eq(sessionEvents.id, observation.id))
    }],
  ] as const)('retains observation but refuses guidance on %s anchor drift', async (_name, drift) => {
    await decide('approved')
    const result = await observe(vi.fn(async () => {
      await drift()
      return { text: 'must not persist' }
    }))

    expect(result).toEqual({ ok: false, status: 409, error: 'conflict', retryable: true })
    expect((await db.select().from(sessionEvents)).filter(({ eventType }) =>
      eventType === 'repair_guidance')).toHaveLength(0)
  })

  it.each([
    ['actor authority', async () => db.update(profiles).set({ deactivatedAt: new Date() })
      .where(eq(profiles.id, techId))],
    ['actor role', async () => db.update(profiles).set({ role: 'advisor' })
      .where(eq(profiles.id, techId))],
    ['actor tier', async () => db.update(profiles).set({ skillTier: 2 })
      .where(eq(profiles.id, techId))],
    ['assignment', async () => db.update(ticketJobs).set({ assignedTechId: null })
      .where(eq(ticketJobs.id, jobId))],
    ['job lifecycle', async () => db.update(ticketJobs).set({ workStatus: 'done' })
      .where(eq(ticketJobs.id, jobId))],
    ['ticket lifecycle', async () => db.update(tickets).set({
      status: 'closed',
      deliveredAt: new Date(),
      deliveredByProfileId: advisorId,
      closedAt: new Date(),
      closedByProfileId: advisorId,
      closeDisposition: 'delivered',
    }).where(eq(tickets.id, ticketId))],
    ['approval', async () => {
      await db.update(ticketJobs).set({
        approvalState: 'declined', approvedQuoteVersionId: null,
      }).where(eq(ticketJobs.id, jobId))
      await db.insert(quoteEvents).values({
        id: uuid(64), shopId, ticketId, jobId, quoteVersionId: versionId,
        kind: 'declined', actorProfileId: advisorId, approvedVia: null, requestKey: uuid(74),
      })
    }],
    ['approved version', async () => db.update(quoteVersions).set({ supersededAt: new Date() })
      .where(eq(quoteVersions.id, versionId))],
    ['session lifecycle', async () => db.update(sessions).set({ status: 'closed', closedAt: new Date() })
      .where(eq(sessions.id, sessionId))],
  ] as const)('retains observation but refuses guidance when %s drifts during provider pause', async (_name, drift) => {
    await decide('approved')
    const result = await observe(vi.fn(async () => {
      await drift()
      return { text: 'must not persist' }
    }))

    expect(result).toEqual({ ok: false, status: 409, error: 'repair_not_authorized' })
    expect((await db.select().from(sessionEvents)).filter(({ eventType }) =>
      eventType === 'repair_observation')).toHaveLength(1)
    expect((await db.select().from(sessionEvents)).filter(({ eventType }) =>
      eventType === 'repair_guidance')).toHaveLength(0)
  })

  it('returns a stable redacted provider failure while retaining only the observation', async () => {
    await decide('approved')
    const secret = 'provider secret prompt and user content'
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(await observe(vi.fn(async () => { throw new Error(secret) }))).toEqual({
      ok: false, status: 502, error: 'repair_guidance_unavailable',
    })
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(secret)
    expect((await db.select().from(sessionEvents)).filter(({ eventType }) =>
      eventType === 'repair_observation')).toHaveLength(1)
    expect((await db.select().from(sessionEvents)).filter(({ eventType }) =>
      eventType === 'repair_guidance')).toHaveLength(0)
  })

  it('rolls back a failed observation Stage 1 before calling the provider', async () => {
    await decide('approved')
    const marker = new Error('stage one marker')
    const getGuidance = vi.fn()

    await expect(observe(getGuidance, {
      afterObservationWrite: async () => { throw marker },
    })).rejects.toBe(marker)
    expect(getGuidance).not.toHaveBeenCalled()
    expect(await db.select().from(sessionEvents)).toHaveLength(0)
  })

  it('rolls back only failed guidance Stage 2 and retains the committed observation', async () => {
    await decide('approved')
    const marker = new Error('stage two marker')

    await expect(observe(vi.fn().mockResolvedValue({ text: 'guidance' }), {
      afterGuidanceWrite: async () => { throw marker },
    })).rejects.toBe(marker)
    expect((await db.select().from(sessionEvents)).filter(({ eventType }) =>
      eventType === 'repair_observation')).toHaveLength(1)
    expect((await db.select().from(sessionEvents)).filter(({ eventType }) =>
      eventType === 'repair_guidance')).toHaveLength(0)
  })

  it('keeps legacy ticketless close outside continuity', async () => {
    await db.delete(ticketJobs).where(eq(ticketJobs.id, jobId))
    const result = await closeTicketed(performedOutcome)

    expect(result).toEqual({ ok: true })
    expect((await db.select().from(sessions).where(eq(sessions.id, sessionId)))[0].status).toBe('closed')
    expect((await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toMatchObject({ projectionRevision: 0n, continuityRevision: 0n })
  })

  it('uses the shared runner and one top-level finalizer without private ticketed transactions', () => {
    const source = readFileSync(`${process.cwd()}/lib/sessions.ts`, 'utf8')
    const writer = source.slice(
      source.indexOf('type TicketedSessionMutationDiscovery'),
      source.indexOf('type CaptureKind'),
    )
    expect(writer).toContain('runBoundedShopOsMutationV1')
    expect(writer).toContain('finalizeMutationRevisionsV1')
    expect(writer).not.toContain('.for(\'update\'')
  })
})
