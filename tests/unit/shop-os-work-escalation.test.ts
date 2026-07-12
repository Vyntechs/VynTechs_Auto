import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import {
  customers, profiles, quoteEvents, quoteVersions, shops, ticketJobs, tickets, vehicles,
} from '@/lib/db/schema'
import { createWorkEscalation, type SimpleWorkActor } from '@/lib/shop-os/simple-work'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS found-concern escalation', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  const techId = uuid(1)
  const otherTechId = uuid(2)
  const advisorId = uuid(3)
  const ticketId = uuid(20)
  const sourceJobId = uuid(30)
  const otherSourceJobId = uuid(31)
  const versionId = uuid(50)
  const requestKey = uuid(80)
  let actor: SimpleWorkActor

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop] = await db.insert(shops).values({ name: 'North', laborRateCents: 15_000, taxRateBps: 825 }).returning()
    shopId = shop.id
    actor = { profileId: techId, shopId }
    await db.insert(profiles).values([
      { id: techId, userId: uuid(101), shopId, role: 'tech', skillTier: 2 },
      { id: otherTechId, userId: uuid(102), shopId, role: 'tech', skillTier: 2 },
      { id: advisorId, userId: uuid(103), shopId, role: 'advisor', skillTier: 3 },
    ])
    await db.insert(customers).values({ id: uuid(10), shopId, name: 'Customer', phone: '5550102026' })
    await db.insert(vehicles).values({ id: uuid(11), customerId: uuid(10), year: 2020, make: 'Jeep', model: 'Wrangler' })
    await db.insert(tickets).values({
      id: ticketId, shopId, ticketNumber: 1, source: 'counter', customerId: uuid(10), vehicleId: uuid(11),
      concern: 'Lift kit', createdByProfileId: advisorId,
    })
    await db.insert(ticketJobs).values([
      {
        id: sourceJobId, shopId, ticketId, title: 'Install lift kit', kind: 'repair', requiredSkillTier: 2,
        assignedTechId: techId, workStatus: 'in_progress', approvalState: 'quote_ready',
      },
      {
        id: otherSourceJobId, shopId, ticketId, title: 'Install lights', kind: 'maintenance', requiredSkillTier: 1,
        assignedTechId: otherTechId, workStatus: 'in_progress', approvalState: 'quote_ready',
      },
    ])
    const quotedJob = (id: string, title: string, kind: 'repair' | 'maintenance') => ({
      id, title, kind, customerStory: null, storyMeta: null,
      lines: [{
        id: id === sourceJobId ? uuid(40) : uuid(41), kind: 'fee', description: title, quantity: '1',
        priceCents: 10_000, taxable: false, partNumber: null, brand: null, coreChargeCents: null,
        fitment: null, laborHours: null, laborRateCents: null, source: 'manual', vendorContext: null,
      }],
      attachments: [], totals: { subtotalCents: 10_000, taxableSubtotalCents: 0 },
    })
    await db.insert(quoteVersions).values({
      id: versionId, shopId, ticketId, versionNumber: 1,
      snapshot: {
        schemaVersion: 1,
        ticket: { id: ticketId, number: 1, customerId: uuid(10), vehicleId: uuid(11), laborRateCents: 15_000, taxRateBps: 825 },
        jobs: [quotedJob(sourceJobId, 'Install lift kit', 'repair'), quotedJob(otherSourceJobId, 'Install lights', 'maintenance')],
        totals: { subtotalCents: 20_000, taxableSubtotalCents: 0, taxCents: 0, totalCents: 20_000 },
      },
      createdByProfileId: advisorId,
    })
    await db.update(ticketJobs).set({ approvalState: 'approved', approvedQuoteVersionId: versionId })
      .where(eq(ticketJobs.ticketId, ticketId))
    await db.insert(quoteEvents).values([
      { id: uuid(60), shopId, ticketId, jobId: sourceJobId, quoteVersionId: versionId, kind: 'approved', actorProfileId: advisorId, approvedVia: 'phone', requestKey: uuid(70) },
      { id: uuid(61), shopId, ticketId, jobId: otherSourceJobId, quoteVersionId: versionId, kind: 'approved', actorProfileId: advisorId, approvedVia: 'phone', requestKey: uuid(71) },
    ])
  })

  afterEach(async () => close())

  const body = (overrides: Record<string, unknown> = {}) => ({
    requestKey, concern: '  steering clunk under load  ', requiredSkillTier: 2, ...overrides,
  })

  it('creates one honest unassigned diagnostic and replays the exact request', async () => {
    const sourceBefore = await db.select().from(ticketJobs).where(eq(ticketJobs.id, sourceJobId))
    const first = await createWorkEscalation(db, { actor, ticketId, sourceJobId, body: body() })
    expect(first).toMatchObject({
      ok: true, changed: true,
      job: {
        title: 'Diagnose: steering clunk under load', kind: 'diagnostic', requiredSkillTier: 2,
        assignedTechId: null, workStatus: 'open', approvalState: 'pending_quote', sessionId: null,
      },
    })
    const second = await createWorkEscalation(db, { actor, ticketId, sourceJobId, body: body() })
    expect(second).toMatchObject({ ok: true, changed: false, job: first.ok ? first.job : {} })
    const jobs = await db.select().from(ticketJobs)
    expect(jobs).toHaveLength(3)
    expect(jobs.find((job) => job.id === (first.ok ? first.job.id : ''))).toMatchObject({
      customerStory: null, storyMeta: null, workNotes: null, diagnosticStartState: 'idle',
      diagnosticStartAttemptKey: null, diagnosticStartLeaseUntil: null, diagnosticStartErrorCode: null,
      approvedQuoteVersionId: null,
    })
    expect(await db.select().from(ticketJobs).where(eq(ticketJobs.id, sourceJobId))).toEqual(sourceBefore)
    expect(await db.select().from(quoteVersions)).toHaveLength(1)
    expect(await db.select().from(quoteEvents)).toHaveLength(2)
  })

  it('binds retry identity to source and actor and fails a changed collision closed', async () => {
    const first = await createWorkEscalation(db, { actor, ticketId, sourceJobId, body: body() })
    const second = await createWorkEscalation(db, {
      actor: { profileId: otherTechId, shopId }, ticketId, sourceJobId: otherSourceJobId, body: body(),
    })
    expect(first.ok && second.ok && first.job.id).not.toBe(second.ok ? second.job.id : '')
    if (!first.ok) throw new Error('missing first escalation')
    await db.update(ticketJobs).set({ title: 'Changed collision' }).where(eq(ticketJobs.id, first.job.id))
    await expect(createWorkEscalation(db, { actor, ticketId, sourceJobId, body: body() }))
      .resolves.toEqual({ ok: false, error: 'conflict' })
  })

  it('rejects invalid, reassigned, closed, and stale-approval sources without creating work', async () => {
    await expect(createWorkEscalation(db, { actor, ticketId, sourceJobId, body: body({ concern: 'x' }) }))
      .resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(createWorkEscalation(db, { actor, ticketId, sourceJobId, body: body({ requiredSkillTier: 4 }) }))
      .resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(createWorkEscalation(db, {
      actor: { profileId: techId, shopId: uuid(999) }, ticketId, sourceJobId, body: body(),
    })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ deactivatedAt: new Date() }).where(eq(profiles.id, techId))
    await expect(createWorkEscalation(db, { actor, ticketId, sourceJobId, body: body() }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ deactivatedAt: null }).where(eq(profiles.id, techId))
    await db.update(ticketJobs).set({ assignedTechId: otherTechId }).where(eq(ticketJobs.id, sourceJobId))
    await expect(createWorkEscalation(db, { actor, ticketId, sourceJobId, body: body() }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(ticketJobs).set({ assignedTechId: techId, approvalState: 'pending_quote', approvedQuoteVersionId: null })
      .where(eq(ticketJobs.id, sourceJobId))
    await expect(createWorkEscalation(db, { actor, ticketId, sourceJobId, body: body() }))
      .resolves.toEqual({ ok: false, error: 'not_authorized' })
    await db.update(ticketJobs).set({ approvalState: 'approved', approvedQuoteVersionId: versionId }).where(eq(ticketJobs.id, sourceJobId))
    await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticketId))
    await expect(createWorkEscalation(db, { actor, ticketId, sourceJobId, body: body() }))
      .resolves.toEqual({ ok: false, error: 'not_ready' })
    expect(await db.select().from(ticketJobs)).toHaveLength(2)
  })
})
