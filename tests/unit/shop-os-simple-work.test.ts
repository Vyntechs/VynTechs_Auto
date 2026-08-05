import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { readFileSync } from 'node:fs'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import {
  customers,
  jobAttachments,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  sessions,
  shopEntitlements,
  shops,
  ticketJobs,
  ticketActivity,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import {
  getSimpleWorkWorkspace,
  mutateSimpleWork,
  nextSimpleWorkTimestamp,
  type SimpleWorkActor,
} from '@/lib/shop-os/simple-work'
import { mutateJobInterruption } from '@/lib/shop-os/interruption'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS approved simple work', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  const techId = uuid(1)
  const advisorId = uuid(2)
  const ticketId = uuid(20)
  const jobId = uuid(30)
  const versionId = uuid(50)
  let actor: SimpleWorkActor

  function snapshot(kind: 'repair' | 'maintenance' | 'diagnostic' = 'repair') {
    return {
      schemaVersion: 1,
      ticket: {
        id: ticketId, number: 1, customerId: uuid(10), vehicleId: uuid(11),
        laborRateCents: 15_000, taxRateBps: 825,
      },
      jobs: [{
        id: jobId, title: 'Install customer-supplied lift kit', kind,
        customerSuppliedPartsNote: kind === 'diagnostic' ? undefined : 'Customer supplied unopened lift kit.',
        customerStory: null, storyMeta: null,
        lines: [{
          id: uuid(40), kind: 'labor', description: 'Install lift kit', quantity: '1',
          priceCents: 60_000, taxable: false, partNumber: null, brand: null,
          coreChargeCents: null, fitment: null, laborHours: '4', laborRateCents: 15_000,
          source: 'manual', vendorContext: null,
        }],
        attachments: [], totals: { subtotalCents: 60_000, taxableSubtotalCents: 0 },
      }],
      totals: { subtotalCents: 60_000, taxableSubtotalCents: 0, taxCents: 0, totalCents: 60_000 },
    }
  }

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop] = await db.insert(shops).values({
      name: 'North', laborRateCents: 15_000, taxRateBps: 825,
    }).returning()
    shopId = shop.id
    actor = { profileId: techId, shopId }
    await db.insert(profiles).values([
      { id: techId, userId: uuid(101), shopId, role: 'tech', skillTier: 2 },
      { id: advisorId, userId: uuid(102), shopId, role: 'advisor', skillTier: 3 },
    ])
    await db.insert(customers).values({ id: uuid(10), shopId, name: 'QA Customer', phone: '5550102026' })
    await db.insert(vehicles).values({
      id: uuid(11), customerId: uuid(10), year: 2020, make: 'Jeep', model: 'Wrangler',
    })
    await db.insert(tickets).values({
      id: ticketId, shopId, ticketNumber: 1, source: 'counter', customerId: uuid(10),
      vehicleId: uuid(11), concern: 'Install customer-supplied lift kit', createdByProfileId: advisorId,
    })
    await db.insert(ticketJobs).values({
      id: jobId, shopId, ticketId, title: 'Install customer-supplied lift kit',
      kind: 'repair', requiredSkillTier: 2, assignedTechId: techId,
      workStatus: 'open', approvalState: 'quote_ready',
    })
    await db.insert(jobLines).values({
      id: uuid(40), shopId, jobId, kind: 'labor', description: 'Install lift kit',
      priceCents: 60_000, taxable: false, laborHours: 4, laborRateCents: 15_000,
      source: 'manual',
    })
    await db.insert(quoteVersions).values({
      id: versionId, shopId, ticketId, versionNumber: 1, snapshot: snapshot(),
      createdByProfileId: advisorId,
    })
    await db.update(ticketJobs).set({
      approvalState: 'approved', approvedQuoteVersionId: versionId,
    }).where(eq(ticketJobs.id, jobId))
    await db.insert(quoteEvents).values({
      id: uuid(60), shopId, ticketId, jobId, quoteVersionId: versionId,
      kind: 'approved', actorProfileId: advisorId, approvedVia: 'phone', requestKey: uuid(70),
    })
  })

  afterEach(async () => close())

  async function currentWorkspace() {
    const result = await getSimpleWorkWorkspace(db, { actor, ticketId, jobId })
    if (!result.ok) throw new Error(`workspace unavailable: ${result.error}`)
    return result.workspace
  }

  async function startWork() {
    const workspace = await currentWorkspace()
    const result = await mutateSimpleWork(db, {
      actor,
      ticketId,
      jobId,
      body: {
        action: 'start_work',
        expectedUpdatedAt: workspace.updatedAt,
      },
    })
    if (!result.ok) throw new Error(`start failed: ${result.error}`)
    return result
  }

  it('generates monotonic timestamps from the locked database row without runtime Date parameters', () => {
    const query = new PgDialect().sqlToQuery(nextSimpleWorkTimestamp())
    expect(query.sql).toContain('"ticket_jobs"."updated_at"')
    expect(query.sql).toContain("date_trunc('milliseconds'")
    expect(query.sql).toContain("interval '1 millisecond'")
    expect(query.params).toEqual([])
  })

  it('returns only the exact approved technician scope without prices or vendor data', async () => {
    const result = await getSimpleWorkWorkspace(db, { actor, ticketId, jobId })
    expect(result).toMatchObject({
      ok: true,
      workspace: {
        approvedScope: {
          authorizationPurpose: null,
          customerSuppliedPartsNote: 'Customer supplied unopened lift kit.',
          lines: [{ kind: 'labor', description: 'Install lift kit', hours: '4' }],
        },
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/price|cost|vendor/i)
  })

  it('starts exact approved assigned work without a timer by default and replays without starting one later', async () => {
    const workspace = await currentWorkspace()
    const body = { action: 'start_work', expectedUpdatedAt: workspace.updatedAt }

    const first = await mutateSimpleWork(db, { actor, ticketId, jobId, body })
    expect(first).toMatchObject({
      ok: true,
      changed: true,
      work: {
        status: 'in_progress',
        timerEnabled: false,
        clockedOnSince: null,
      },
    })

    await db.update(profiles)
      .set({ jobTimerEnabled: true })
      .where(eq(profiles.id, techId))
    const second = await mutateSimpleWork(db, { actor, ticketId, jobId, body })
    expect(second).toMatchObject({
      ok: true,
      changed: false,
      work: {
        status: 'in_progress',
        timerEnabled: true,
        clockedOnSince: null,
      },
    })
  })

  it('starts the timer atomically only when the persisted preference and wrenching tier are effective', async () => {
    await db.update(profiles)
      .set({ jobTimerEnabled: true })
      .where(eq(profiles.id, techId))
    const started = await startWork()
    expect(started).toMatchObject({
      ok: true,
      changed: true,
      work: {
        status: 'in_progress',
        timerEnabled: true,
      },
    })
    expect(started.work.clockedOnSince).not.toBeNull()
    expect(started.work.startedAt).not.toBeNull()
  })

  it('ignores a stored timer preference for a non-wrenching actor and fails closed for inactive membership', async () => {
    await db.update(profiles)
      .set({ jobTimerEnabled: true, skillTier: null })
      .where(eq(profiles.id, techId))
    const started = await startWork()
    expect(started).toMatchObject({
      ok: true,
      work: { timerEnabled: false, clockedOnSince: null },
    })

    await db.update(ticketJobs).set({
      workStatus: 'open',
      workStartedAt: null,
      clockedOnSince: null,
    }).where(eq(ticketJobs.id, jobId))
    await db.update(profiles)
      .set({
        skillTier: 2,
        membershipStatus: 'pending',
        membershipActivatedAt: null,
      })
      .where(eq(profiles.id, techId))
    await expect(mutateSimpleWork(db, {
      actor,
      ticketId,
      jobId,
      body: {
        action: 'start_work',
        expectedUpdatedAt: (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0].updatedAt.toISOString(),
      },
    })).resolves.toEqual({ ok: false, error: 'not_found' })

    await db.update(profiles)
      .set({
        membershipStatus: 'active',
        membershipActivatedAt: new Date(),
        deactivatedAt: new Date(),
      })
      .where(eq(profiles.id, techId))
    await expect(mutateSimpleWork(db, {
      actor,
      ticketId,
      jobId,
      body: {
        action: 'start_work',
        expectedUpdatedAt: (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0].updatedAt.toISOString(),
      },
    })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('refuses a stale start revision with zero work or timer mutation', async () => {
    await db.update(profiles)
      .set({ jobTimerEnabled: true })
      .where(eq(profiles.id, techId))
    const staleUpdatedAt = (await currentWorkspace()).updatedAt
    await db.update(ticketJobs)
      .set({
        title: 'Install approved lift kit',
        updatedAt: new Date(new Date(staleUpdatedAt).getTime() + 1_000),
      })
      .where(eq(ticketJobs.id, jobId))

    await expect(mutateSimpleWork(db, {
      actor,
      ticketId,
      jobId,
      body: { action: 'start_work', expectedUpdatedAt: staleUpdatedAt },
    })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })
    const [unchanged] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(unchanged).toMatchObject({
      workStatus: 'open',
      workStartedAt: null,
      clockedOnSince: null,
    })
  })

  it('completes work after an interruption restores it without losing the optimistic-lock timestamp', async () => {
    await startWork()

    const interruptionActor = {
      ...actor,
      role: 'tech',
      membershipStatus: 'active',
      deactivatedAt: null,
    }
    const blocked = await mutateJobInterruption(db, {
      actor: interruptionActor,
      ticketId,
      jobId,
      body: {
        action: 'block',
        requestKey: uuid(901),
        holdKind: 'parts',
        holdNote: 'Waiting for the final hardware kit.',
      },
    })
    expect(blocked).toMatchObject({ ok: true, job: { workStatus: 'blocked' } })
    const resumed = await mutateJobInterruption(db, {
      actor: interruptionActor,
      ticketId,
      jobId,
      body: { action: 'resolve_hold', requestKey: uuid(902) },
    })
    expect(resumed).toMatchObject({ ok: true, job: { workStatus: 'in_progress' } })

    const restored = await getSimpleWorkWorkspace(db, { actor, ticketId, jobId })
    if (!restored.ok) throw new Error('restored workspace unavailable')
    await expect(mutateSimpleWork(db, {
      actor,
      ticketId,
      jobId,
      body: {
        action: 'complete',
        expectedUpdatedAt: restored.workspace.updatedAt,
        completion: {
          kind: 'with_details',
          details: 'Installed, torqued, and verified the customer-supplied lift kit.',
        },
      },
    })).resolves.toMatchObject({ ok: true, changed: true, work: { status: 'done' } })
  })

  it('opens and starts an approved sessionless diagnostic only while diagnostics are unavailable', async () => {
    const manualTicketId = uuid(21)
    const manualJobId = uuid(31)
    const manualVersionId = uuid(51)
    await db.insert(tickets).values({
      id: manualTicketId,
      shopId,
      ticketNumber: 2,
      source: 'counter',
      customerId: uuid(10),
      vehicleId: uuid(11),
      concern: 'Intermittent no start',
      createdByProfileId: advisorId,
    })
    await db.insert(ticketJobs).values({
      id: manualJobId,
      shopId,
      ticketId: manualTicketId,
      title: 'Diagnose intermittent no start',
      kind: 'diagnostic',
      requiredSkillTier: 2,
      assignedTechId: techId,
      workStatus: 'open',
      approvalState: 'quote_ready',
      customerStory: {
        whatYouToldUs: 'Intermittent no start',
        whatWeFound: 'Loose battery ground',
        howWeKnow: [],
        whatItMeansIfWaived: 'The concern remains unresolved.',
        whatWeRecommend: 'Clean and secure the ground, then retest.',
      },
      storyMeta: {
        source: 'manual',
        lastEditedByProfileId: techId,
        lastEditedAt: '2026-07-20T12:00:00.000Z',
        storyRevision: 1,
        reviewStatus: 'reviewed',
        reviewClientKey: uuid(73),
        reviewRequestFingerprint: 'a'.repeat(64),
        reviewedByProfileId: techId,
        reviewedAt: '2026-07-20T12:01:00.000Z',
      },
    })
    await db.insert(quoteVersions).values({
      id: manualVersionId,
      shopId,
      ticketId: manualTicketId,
      versionNumber: 1,
      snapshot: {
        schemaVersion: 1,
        ticket: {
          id: manualTicketId,
          number: 2,
          customerId: uuid(10),
          vehicleId: uuid(11),
          laborRateCents: 15_000,
          taxRateBps: 825,
        },
        jobs: [{
          id: manualJobId,
          title: 'Diagnose intermittent no start',
          kind: 'diagnostic',
          customerStory: {
            whatYouToldUs: 'Intermittent no start',
            whatWeFound: 'Loose battery ground',
            howWeKnow: [],
            whatItMeansIfWaived: 'The concern remains unresolved.',
            whatWeRecommend: 'Clean and secure the ground, then retest.',
          },
          storyMeta: { source: 'manual' },
          lines: [{
            id: uuid(41),
            kind: 'labor',
            description: 'Manual inspection and ground repair',
            quantity: '1',
            priceCents: 15_000,
            taxable: false,
            partNumber: null,
            brand: null,
            coreChargeCents: null,
            fitment: null,
            laborHours: '1',
            laborRateCents: 15_000,
            source: 'manual',
            vendorContext: null,
          }],
          attachments: [],
          totals: { subtotalCents: 15_000, taxableSubtotalCents: 0 },
        }],
        totals: {
          subtotalCents: 15_000,
          taxableSubtotalCents: 0,
          taxCents: 0,
          totalCents: 15_000,
        },
      },
      createdByProfileId: advisorId,
    })
    await db.update(ticketJobs).set({
      approvalState: 'approved',
      approvedQuoteVersionId: manualVersionId,
    }).where(eq(ticketJobs.id, manualJobId))
    await db.insert(quoteEvents).values({
      id: uuid(61),
      shopId,
      ticketId: manualTicketId,
      jobId: manualJobId,
      quoteVersionId: manualVersionId,
      kind: 'approved',
      actorProfileId: advisorId,
      approvedVia: 'phone',
      requestKey: uuid(71),
    })
    await db.insert(shopEntitlements).values({ shopId, diagnostics: true })

    const manualActor = { profileId: techId, shopId }
    await expect(getSimpleWorkWorkspace(db, {
      actor: manualActor,
      ticketId: manualTicketId,
      jobId: manualJobId,
    })).resolves.toEqual({ ok: false, error: 'not_found' })

    await db.update(shopEntitlements).set({ diagnostics: false })
      .where(eq(shopEntitlements.shopId, shopId))

    await db.update(profiles).set({ isComp: true }).where(eq(profiles.id, techId))
    await expect(getSimpleWorkWorkspace(db, {
      actor: manualActor,
      ticketId: manualTicketId,
      jobId: manualJobId,
    })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ isComp: false }).where(eq(profiles.id, techId))

    const manualWorkspace = await getSimpleWorkWorkspace(db, {
      actor: manualActor,
      ticketId: manualTicketId,
      jobId: manualJobId,
    })
    expect(manualWorkspace).toMatchObject({
      ok: true,
      workspace: { kind: 'diagnostic', authorization: 'approved', workStatus: 'open' },
    })
    if (!manualWorkspace.ok) throw new Error('manual workspace unavailable')
    await expect(mutateSimpleWork(db, {
      actor: manualActor,
      ticketId: manualTicketId,
      jobId: manualJobId,
      body: {
        action: 'start_work',
        expectedUpdatedAt: manualWorkspace.workspace.updatedAt,
      },
    })).resolves.toMatchObject({
      ok: true,
      changed: true,
      work: { status: 'in_progress', timerEnabled: false, clockedOnSince: null },
    })
  })

  it('fails closed for stale assignment, inactive actor, missing event, or snapshot kind drift', async () => {
    const expectedUpdatedAt = (await currentWorkspace()).updatedAt
    const startBody = { action: 'start_work', expectedUpdatedAt }
    await db.update(ticketJobs).set({ assignedTechId: advisorId }).where(eq(ticketJobs.id, jobId))
    await expect(mutateSimpleWork(db, { actor, ticketId, jobId, body: startBody }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(ticketJobs).set({ assignedTechId: techId }).where(eq(ticketJobs.id, jobId))
    await db.update(profiles).set({ deactivatedAt: new Date() }).where(eq(profiles.id, techId))
    await expect(mutateSimpleWork(db, { actor, ticketId, jobId, body: startBody }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ deactivatedAt: null }).where(eq(profiles.id, techId))
    await db.insert(quoteEvents).values({
      id: uuid(61), shopId, ticketId, jobId, quoteVersionId: versionId,
      kind: 'declined', actorProfileId: advisorId, approvedVia: null, requestKey: uuid(71),
    })
    await expect(mutateSimpleWork(db, { actor, ticketId, jobId, body: startBody }))
      .resolves.toEqual({ ok: false, error: 'not_authorized' })
    await db.insert(quoteEvents).values({
      id: uuid(62), shopId, ticketId, jobId, quoteVersionId: versionId,
      kind: 'approved', actorProfileId: advisorId, approvedVia: 'phone', requestKey: uuid(72),
    })
    await db.update(ticketJobs).set({ kind: 'maintenance' }).where(eq(ticketJobs.id, jobId))
    await expect(mutateSimpleWork(db, { actor, ticketId, jobId, body: startBody }))
      .resolves.toEqual({ ok: false, error: 'not_authorized' })
  })

  it('rejects legacy note writes and malformed completion bodies before any mutation', async () => {
    const updatedAt = (await currentWorkspace()).updatedAt
    const invalidBodies = [
      { action: 'start_work', expectedUpdatedAt: updatedAt, startTimer: true },
      { action: 'clock_on', expectedUpdatedAt: updatedAt },
      { action: 'clock_off', extra: true },
      { action: 'save_note', note: 'Legacy write', expectedUpdatedAt: updatedAt },
      { action: 'complete', expectedUpdatedAt: updatedAt },
      {
        action: 'complete',
        expectedUpdatedAt: updatedAt,
        completion: { kind: 'as_approved', details: 'unexpected' },
      },
      {
        action: 'complete',
        expectedUpdatedAt: updatedAt,
        completion: { kind: 'with_details', details: '   ' },
      },
      {
        action: 'complete',
        expectedUpdatedAt: updatedAt,
        completion: { kind: 'with_details', details: 'x'.repeat(2_001) },
      },
    ]

    for (const body of invalidBodies) {
      await expect(mutateSimpleWork(db, { actor, ticketId, jobId, body }))
        .resolves.toEqual({ ok: false, error: 'invalid_input' })
    }
    expect(await currentWorkspace()).toMatchObject({
      workStatus: 'open',
      workNotes: null,
      startedAt: null,
      completedAt: null,
    })
  })

  it('completes as approved without typing, stores canonical truth, and replays the exact receipt', async () => {
    const started = await startWork()
    const body = {
      action: 'complete',
      expectedUpdatedAt: started.work.updatedAt,
      completion: { kind: 'as_approved' },
    }
    const completed = await mutateSimpleWork(db, { actor, ticketId, jobId, body })
    expect(completed).toMatchObject({
      ok: true,
      changed: true,
      work: {
        status: 'done',
        workNotes: 'Completed as approved.',
        clockedOnSince: null,
      },
    })
    if (!completed.ok) throw new Error('completion failed')

    expect(await db.select().from(ticketActivity)).toEqual([
      expect.objectContaining({
        kind: 'work_completed',
        ticketId,
        jobId,
        actorProfileId: techId,
        payload: {
          from: 'in_progress',
          to: 'done',
          completion: 'as_approved',
        },
      }),
    ])

    await db.update(quoteVersions)
      .set({ supersededAt: new Date() })
      .where(eq(quoteVersions.id, versionId))
    const replay = await mutateSimpleWork(db, { actor, ticketId, jobId, body })
    expect(replay).toEqual({
      ok: true,
      changed: false,
      work: completed.work,
    })
    expect(await db.select().from(ticketActivity)).toHaveLength(1)
  })

  it('preserves an older saved internal detail when completing as approved', async () => {
    await startWork()
    await db.update(ticketJobs)
      .set({ workNotes: 'Installed, torqued, and road checked.' })
      .where(eq(ticketJobs.id, jobId))
    const workspace = await currentWorkspace()

    const completed = await mutateSimpleWork(db, {
      actor,
      ticketId,
      jobId,
      body: {
        action: 'complete',
        expectedUpdatedAt: workspace.updatedAt,
        completion: { kind: 'as_approved' },
      },
    })
    expect(completed).toMatchObject({
      ok: true,
      changed: true,
      work: {
        status: 'done',
        workNotes: 'Installed, torqued, and road checked.',
      },
    })
  })

  it('writes normalized details and completion atomically while stale completion changes nothing', async () => {
    await db.update(profiles)
      .set({ jobTimerEnabled: true })
      .where(eq(profiles.id, techId))
    const started = await startWork()
    await db.update(ticketJobs)
      .set({
        workNotes: 'Saved elsewhere.',
        clockedOnSince: sql`clock_timestamp() - interval '30 seconds'`,
        updatedAt: new Date(new Date(started.work.updatedAt).getTime() + 1_000),
      })
      .where(eq(ticketJobs.id, jobId))

    const stale = await mutateSimpleWork(db, {
      actor,
      ticketId,
      jobId,
      body: {
        action: 'complete',
        expectedUpdatedAt: started.work.updatedAt,
        completion: { kind: 'with_details', details: '  Installed   and verified.  ' },
      },
    })
    expect(stale).toEqual({ ok: false, error: 'conflict', retryable: true })
    const [unchanged] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(unchanged).toMatchObject({
      workStatus: 'in_progress',
      workNotes: 'Saved elsewhere.',
      workCompletedAt: null,
    })
    expect(unchanged.clockedOnSince).not.toBeNull()

    const current = await currentWorkspace()
    const completed = await mutateSimpleWork(db, {
      actor,
      ticketId,
      jobId,
      body: {
        action: 'complete',
        expectedUpdatedAt: current.updatedAt,
        completion: { kind: 'with_details', details: '  Installed   and verified.  ' },
      },
    })
    expect(completed).toMatchObject({
      ok: true,
      changed: true,
      work: {
        status: 'done',
        workNotes: 'Installed   and verified.',
        clockedOnSince: null,
      },
    })
    if (!completed.ok) throw new Error('completion failed')
    expect(completed.work.completedAt).not.toBeNull()
    expect(completed.work.activeSeconds).toBeGreaterThanOrEqual(29)
  })

  it('banks actual time across clock on, off, resume, and complete', async () => {
    await expect(mutateSimpleWork(db, {
      actor,
      ticketId,
      jobId,
      body: { action: 'clock_on' },
    })).resolves.toEqual({ ok: false, error: 'not_ready' })

    await db.update(profiles)
      .set({ jobTimerEnabled: true })
      .where(eq(profiles.id, techId))
    const on1 = await startWork()
    expect(on1.work.clockedOnSince).not.toBeNull()
    expect(on1.work.activeSeconds).toBe(0)
    expect(on1.work.startedAt).not.toBeNull()

    // Pretend the tech was clocked on for 90s, then clock off — that interval banks.
    await db.update(ticketJobs)
      .set({ clockedOnSince: sql`clock_timestamp() - interval '90 seconds'` })
      .where(eq(ticketJobs.id, jobId))
    await db.update(profiles)
      .set({ jobTimerEnabled: false, skillTier: null })
      .where(eq(profiles.id, techId))
    const off = await mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'clock_off' } })
    if (!off.ok) throw new Error('clock_off failed')
    expect(off.work.clockedOnSince).toBeNull()
    expect(off.work.activeSeconds).toBeGreaterThanOrEqual(89)
    expect(off.work.activeSeconds).toBeLessThanOrEqual(100)
    expect(await db.select().from(ticketActivity)).toContainEqual(expect.objectContaining({
      kind: 'work_paused',
      ticketId,
      jobId,
      actorProfileId: techId,
      payload: { from: 'in_progress', clock: 'paused' },
    }))

    // Clocking off again with nothing running is a harmless no-op.
    const offAgain = await mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'clock_off' } })
    expect(offAgain).toMatchObject({ ok: true, changed: false })

    // Resume, pretend another 30s, then complete — the final interval banks too.
    await expect(mutateSimpleWork(db, {
      actor,
      ticketId,
      jobId,
      body: { action: 'clock_on' },
    })).resolves.toEqual({ ok: false, error: 'not_ready' })
    await db.update(profiles)
      .set({ jobTimerEnabled: true, skillTier: 2 })
      .where(eq(profiles.id, techId))
    const on2 = await mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'clock_on' } })
    if (!on2.ok) throw new Error('resume failed')
    expect(on2.work.clockedOnSince).not.toBeNull()
    await db.update(ticketJobs)
      .set({ clockedOnSince: sql`clock_timestamp() - interval '30 seconds'` })
      .where(eq(ticketJobs.id, jobId))
    const done = await mutateSimpleWork(db, {
      actor,
      ticketId,
      jobId,
      body: {
        action: 'complete',
        expectedUpdatedAt: on2.work.updatedAt,
        completion: { kind: 'as_approved' },
      },
    })
    if (!done.ok) throw new Error('complete failed')
    expect(done.work.status).toBe('done')
    expect(done.work.clockedOnSince).toBeNull()
    expect(done.work.completedAt).not.toBeNull()
    expect(done.work.startedAt).toBe(on1.work.startedAt)
    expect(done.work.activeSeconds).toBeGreaterThanOrEqual(118)
    expect(done.work.activeSeconds).toBeLessThanOrEqual(140)
  })

  it('returns a bounded assigned workspace without internal quote or storage truth', async () => {
    const result = await getSimpleWorkWorkspace(db, { actor, ticketId, jobId })
    expect(result).toMatchObject({
      ok: true,
      workspace: {
        id: jobId,
        title: 'Install customer-supplied lift kit',
        kind: 'repair',
        workStatus: 'open',
        timerEnabled: false,
        authorization: 'approved',
      },
    })
    expect(result.ok && result.workspace).not.toHaveProperty('hasCompletionProof')
    expect(result.ok && result.workspace).not.toHaveProperty('attachments')
    expect(JSON.stringify(result)).not.toMatch(/shopId|storageKey|quoteVersion|actorProfile|customerId|vehicleId|attachment/i)
  })

  it('does not query or project legacy attachment rows', async () => {
    const proofId = uuid(80)
    await db.insert(jobAttachments).values({
      id: proofId, shopId, jobId,
      storageKey: `${shopId}/jobs/${jobId}/proof/${proofId}/${'a'.repeat(64)}.jpg`,
      kind: 'photo', mimeType: 'image/jpeg', byteSize: 4, uploadedByProfileId: advisorId,
    })
    const result = await getSimpleWorkWorkspace(db, { actor, ticketId, jobId })
    expect(result.ok && result.workspace).not.toHaveProperty('attachments')
    expect(result.ok && result.workspace).not.toHaveProperty('hasCompletionProof')
    const source = readFileSync('lib/shop-os/simple-work.ts', 'utf8')
    expect(source).not.toContain('from(jobAttachments)')
  })

  it('uses real ticket/session truth while preserving completed closed history', async () => {
    await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticketId))
    await expect(getSimpleWorkWorkspace(db, { actor, ticketId, jobId }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(ticketJobs).set({ workStatus: 'done' }).where(eq(ticketJobs.id, jobId))
    await expect(getSimpleWorkWorkspace(db, { actor, ticketId, jobId })).resolves.toMatchObject({
      ok: true, workspace: { workStatus: 'done' },
    })
    await db.update(ticketJobs).set({ workStatus: 'open' }).where(eq(ticketJobs.id, jobId))
    await db.update(tickets).set({ status: 'canceled' }).where(eq(tickets.id, ticketId))
    await expect(getSimpleWorkWorkspace(db, { actor, ticketId, jobId }))
      .resolves.toEqual({ ok: false, error: 'not_found' })

    await db.update(tickets).set({ status: 'open' }).where(eq(tickets.id, ticketId))
    const [session] = await db.insert(sessions).values({
      id: uuid(90), shopId, techId,
      intake: { vehicleYear: 2020, vehicleMake: 'Jeep', vehicleModel: 'Wrangler', customerComplaint: 'Test' },
      treeState: { nodes: [], currentNodeId: 'root', message: 'Test' },
    }).returning()
    await db.execute(sql`alter table ticket_jobs drop constraint ticket_jobs_session_only_for_diagnostic`)
    await db.update(ticketJobs).set({ sessionId: session.id }).where(eq(ticketJobs.id, jobId))
    await expect(getSimpleWorkWorkspace(db, { actor, ticketId, jobId }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
  })
})
