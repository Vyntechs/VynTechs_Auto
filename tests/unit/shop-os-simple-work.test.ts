import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import {
  customers,
  jobAttachments,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
} from '@/lib/db/schema'
import {
  createJobAttachment,
  getSimpleWorkWorkspace,
  mutateSimpleWork,
  type SimpleWorkActor,
} from '@/lib/shop-os/simple-work'

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

  it('starts exact approved assigned simple work and replays without another write', async () => {
    const first = await mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } })
    expect(first).toMatchObject({ ok: true, changed: true, work: { status: 'in_progress' } })
    const second = await mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } })
    expect(second).toMatchObject({ ok: true, changed: false, work: { status: 'in_progress' } })
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

  it('requires a Row-23 actor photo and replays completion from done', async () => {
    const started = await mutateSimpleWork(db, { actor, ticketId, jobId, body: { action: 'start' } })
    if (!started.ok) throw new Error('start failed')
    const noted = await mutateSimpleWork(db, {
      actor, ticketId, jobId,
      body: { action: 'save_note', note: 'Installed, torqued, and road checked.', expectedUpdatedAt: started.work.updatedAt },
    })
    if (!noted.ok) throw new Error('note failed')
    await expect(mutateSimpleWork(db, {
      actor, ticketId, jobId, body: { action: 'complete', expectedUpdatedAt: noted.work.updatedAt },
    })).resolves.toEqual({ ok: false, error: 'not_ready' })
    await db.insert(jobAttachments).values({
      id: uuid(80), shopId, jobId,
      storageKey: `${shopId}/jobs/${jobId}/proof/${uuid(80)}/digest.jpg`,
      kind: 'photo', mimeType: 'image/jpeg', byteSize: 3, uploadedByProfileId: techId,
    })
    await expect(mutateSimpleWork(db, {
      actor, ticketId, jobId, body: { action: 'complete', expectedUpdatedAt: noted.work.updatedAt },
    })).resolves.toEqual({ ok: false, error: 'not_ready' })
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    await expect(createJobAttachment(db, {
      actor, ticketId, jobId, requestKey: uuid(81), kind: 'photo',
      file: { bytes: jpeg, mimeType: 'image/jpeg', size: jpeg.byteLength },
    }, {
      upload: async () => undefined,
      remove: async () => undefined,
    })).resolves.toMatchObject({ ok: true, changed: true })
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
        attachments: [],
      },
    })
    expect(JSON.stringify(result)).not.toMatch(/shopId|storageKey|quoteVersion|actorProfile|customerId|vehicleId/)
  })
})
