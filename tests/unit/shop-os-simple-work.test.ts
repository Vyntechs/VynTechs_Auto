import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
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
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import { getSimpleWorkWorkspace, mutateSimpleWork, type SimpleWorkActor } from '@/lib/shop-os/simple-work'

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

  it('routes start, note, and complete through the shared coordinator and one finalizer', () => {
    const source = readFileSync('lib/shop-os/simple-work.ts', 'utf8')
    const mutation = source.slice(
      source.indexOf('export async function mutateSimpleWork'),
      source.indexOf('export async function getSimpleWorkWorkspace'),
    )
    expect(mutation).toContain('runBoundedShopOsMutationV1')
    expect(mutation).toContain('finalizeMutationRevisionsV1')
    expect(mutation.match(/finalizeMutationRevisionsV1/g)).toHaveLength(1)
    expect(mutation).not.toContain('.transaction(')
    expect(mutation).not.toContain(".for('update'")
  })

  it('binds the monotonic timestamp through the PostgreSQL column encoder', () => {
    const source = readFileSync('lib/shop-os/simple-work.ts', 'utf8')
    const timestampHelper = source.slice(
      source.indexOf('function nextTimestamp'),
      source.indexOf('export async function mutateSimpleWork'),
    )

    expect(timestampHelper).toContain('sql.param(previous, ticketJobs.updatedAt)')
    expect(timestampHelper).not.toContain('${previous}::timestamptz')
  })

  it('starts exact approved assigned simple work and replays without another write', async () => {
    const first = await mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } })
    expect(first).toMatchObject({ ok: true, changed: true, work: { status: 'in_progress' } })
    const second = await mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } })
    expect(second).toMatchObject({ ok: true, changed: false, work: { status: 'in_progress' } })
  })

  it('applies the exact revision classification for start, note, complete, and replay', async () => {
    const readState = async () => ({
      job: (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0],
      ticket: (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0],
    })
    const initial = await readState()

    const started = await mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } })
    expect(started).toMatchObject({ ok: true, changed: true })
    if (!started.ok) throw new Error('start failed')
    const afterStart = await readState()
    expect(afterStart.job.revision).toBe(initial.job.revision + 1n)
    expect(afterStart.ticket.projectionRevision).toBe(initial.ticket.projectionRevision + 1n)
    expect(afterStart.ticket.continuityRevision).toBe(initial.ticket.continuityRevision + 1n)

    const noted = await mutateSimpleWork(db, {
      actor, ticketId, jobId,
      body: { action: 'save_note', note: 'Installed and torqued.', expectedUpdatedAt: started.work.updatedAt },
    })
    expect(noted).toMatchObject({ ok: true, changed: true })
    if (!noted.ok) throw new Error('note failed')
    const afterNote = await readState()
    expect(afterNote.job.revision).toBe(afterStart.job.revision + 1n)
    expect(afterNote.ticket.projectionRevision).toBe(afterStart.ticket.projectionRevision + 1n)
    expect(afterNote.ticket.continuityRevision).toBe(afterStart.ticket.continuityRevision)

    const completed = await mutateSimpleWork(db, {
      actor, ticketId, jobId,
      body: { action: 'complete', expectedUpdatedAt: noted.work.updatedAt },
    })
    expect(completed).toMatchObject({ ok: true, changed: true })
    const afterComplete = await readState()
    expect(afterComplete.job.revision).toBe(afterNote.job.revision + 1n)
    expect(afterComplete.ticket.projectionRevision).toBe(afterNote.ticket.projectionRevision + 1n)
    expect(afterComplete.ticket.continuityRevision).toBe(afterNote.ticket.continuityRevision + 1n)

    expect(await mutateSimpleWork(db, {
      actor, ticketId, jobId,
      body: { action: 'complete', expectedUpdatedAt: noted.work.updatedAt },
    })).toMatchObject({ ok: true, changed: false })
    const afterReplay = await readState()
    expect(afterReplay.job.revision).toBe(afterComplete.job.revision)
    expect(afterReplay.ticket.projectionRevision).toBe(afterComplete.ticket.projectionRevision)
    expect(afterReplay.ticket.continuityRevision).toBe(afterComplete.ticket.continuityRevision)
  })

  it('fails closed for stale assignment, inactive actor, missing event, or snapshot kind drift', async () => {
    await db.update(ticketJobs).set({ assignedTechId: advisorId }).where(eq(ticketJobs.id, jobId))
    await expect(mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(ticketJobs).set({ assignedTechId: techId }).where(eq(ticketJobs.id, jobId))
    await db.update(profiles).set({ deactivatedAt: new Date() }).where(eq(profiles.id, techId))
    await expect(mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ deactivatedAt: null }).where(eq(profiles.id, techId))
    await db.update(ticketJobs).set({ requiredSkillTier: 3 }).where(eq(ticketJobs.id, jobId))
    await expect(mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(ticketJobs).set({ requiredSkillTier: 2 }).where(eq(ticketJobs.id, jobId))
    await db.insert(quoteEvents).values({
      id: uuid(61), shopId, ticketId, jobId, quoteVersionId: versionId,
      kind: 'declined', actorProfileId: advisorId, approvedVia: null, requestKey: uuid(71),
    })
    await expect(mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } }))
      .resolves.toEqual({ ok: false, error: 'not_authorized' })
    await db.insert(quoteEvents).values({
      id: uuid(62), shopId, ticketId, jobId, quoteVersionId: versionId,
      kind: 'approved', actorProfileId: advisorId, approvedVia: 'phone', requestKey: uuid(72),
    })
    await db.update(ticketJobs).set({ kind: 'maintenance' }).where(eq(ticketJobs.id, jobId))
    await expect(mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } }))
      .resolves.toEqual({ ok: false, error: 'not_authorized' })
  })

  it.each(['afterWrite', 'afterFinalization'] as const)(
    'rolls back domain state and revisions when %s fails',
    async (seam) => {
      const beforeJob = (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0]
      const beforeTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]

      await expect(mutateSimpleWork(
        db,
        { actor, ticketId, jobId, body: { action: 'start' } },
        { [seam]: async () => { throw new Error(`forced simple-work ${seam} rollback`) } },
      )).rejects.toThrow(`forced simple-work ${seam} rollback`)

      const afterJob = (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0]
      const afterTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
      expect(afterJob.workStatus).toBe(beforeJob.workStatus)
      expect(afterJob.revision).toBe(beforeJob.revision)
      expect(afterTicket.projectionRevision).toBe(beforeTicket.projectionRevision)
      expect(afterTicket.continuityRevision).toBe(beforeTicket.continuityRevision)
    },
  )

  it('uses optimistic note writes and treats an exact delayed replay as a no-op', async () => {
    const started = await mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } })
    if (!started.ok) throw new Error('start failed')
    const saved = await mutateSimpleWork(db, {
      actor, ticketId, jobId,
      body: { action: 'save_note', note: '  Lift kit installed and torqued to specification.  ', expectedUpdatedAt: started.work.updatedAt },
    })
    expect(saved).toMatchObject({ ok: true, changed: true, work: { workNotes: 'Lift kit installed and torqued to specification.' } })
    const staleDifferent = await mutateSimpleWork(db, {
      actor, ticketId, jobId,
      body: { action: 'save_note', note: 'Delayed old note', expectedUpdatedAt: started.work.updatedAt },
    })
    expect(staleDifferent).toEqual({ ok: false, error: 'conflict', retryable: true })
    const replay = await mutateSimpleWork(db, {
      actor, ticketId, jobId,
      body: { action: 'save_note', note: 'Lift kit installed and torqued to specification.', expectedUpdatedAt: started.work.updatedAt },
    })
    expect(replay).toMatchObject({ ok: true, changed: false })
  })

  it('requires only an authorized saved note and replays completion from done', async () => {
    const started = await mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } })
    if (!started.ok) throw new Error('start failed')
    await expect(mutateSimpleWork(db, {
      actor, ticketId, jobId, body: { action: 'complete', expectedUpdatedAt: started.work.updatedAt },
    })).resolves.toEqual({ ok: false, error: 'not_ready' })
    const noted = await mutateSimpleWork(db, {
      actor, ticketId, jobId,
      body: { action: 'save_note', note: 'Installed, torqued, and road checked.', expectedUpdatedAt: started.work.updatedAt },
    })
    if (!noted.ok) throw new Error('note failed')
    const completed = await mutateSimpleWork(db, {
      actor, ticketId, jobId, body: { action: 'complete', expectedUpdatedAt: noted.work.updatedAt },
    })
    expect(completed).toMatchObject({ ok: true, changed: true, work: { status: 'done' } })
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.id, versionId))
    const replay = await mutateSimpleWork(db, {
      actor, ticketId, jobId, body: { action: 'complete', expectedUpdatedAt: noted.work.updatedAt },
    })
    expect(replay).toMatchObject({ ok: true, changed: false, work: { status: 'done' } })
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
    const [session] = await db.insert(sessions).values({
      id: uuid(90), shopId, techId,
      intake: { vehicleYear: 2020, vehicleMake: 'Jeep', vehicleModel: 'Wrangler', customerComplaint: 'Test' },
      treeState: { nodes: [], currentNodeId: 'root', message: 'Test' },
    }).returning()
    await db.execute(sql`alter table ticket_jobs drop constraint ticket_jobs_session_only_for_diagnostic`)
    await db.update(ticketJobs).set({ sessionId: session.id }).where(eq(ticketJobs.id, jobId))
    await expect(getSimpleWorkWorkspace(db, { actor, ticketId, jobId }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(ticketJobs).set({ sessionId: null }).where(eq(ticketJobs.id, jobId))

    await db.update(tickets).set({
      status: 'closed',
      closedAt: new Date('2026-07-11T12:05:00.000Z'),
      closedByProfileId: advisorId,
      closeDisposition: 'no_repair',
      closeNote: 'Fixture terminal-state proof.',
    }).where(eq(tickets.id, ticketId))
    await expect(getSimpleWorkWorkspace(db, { actor, ticketId, jobId }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(ticketJobs).set({ workStatus: 'done' }).where(eq(ticketJobs.id, jobId))
    await expect(getSimpleWorkWorkspace(db, { actor, ticketId, jobId })).resolves.toMatchObject({
      ok: true, workspace: { workStatus: 'done' },
    })

    const canceledTicketId = uuid(21)
    const canceledJobId = uuid(31)
    await db.insert(tickets).values({
      id: canceledTicketId,
      shopId,
      ticketNumber: 2,
      source: 'counter',
      customerId: uuid(10),
      vehicleId: uuid(11),
      concern: 'Canceled fixture',
      createdByProfileId: advisorId,
      status: 'canceled',
      canceledAt: new Date('2026-07-11T12:06:00.000Z'),
      canceledByProfileId: advisorId,
      cancelReasonCode: 'customer_canceled_before_authorization',
    })
    await db.insert(ticketJobs).values({
      id: canceledJobId,
      shopId,
      ticketId: canceledTicketId,
      title: 'Canceled simple work',
      kind: 'maintenance',
      requiredSkillTier: 2,
      assignedTechId: techId,
      workStatus: 'open',
    })
    await expect(getSimpleWorkWorkspace(db, {
      actor, ticketId: canceledTicketId, jobId: canceledJobId,
    }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
  })
})
