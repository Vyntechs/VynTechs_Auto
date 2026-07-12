import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import {
  customers, jobAttachments, profiles, quoteEvents, quoteVersions, shops,
  ticketJobs, tickets, vehicles,
} from '@/lib/db/schema'
import {
  createJobAttachment,
  getJobAttachmentProof,
  MAX_JOB_ATTACHMENT_BYTES,
  type SimpleWorkActor,
} from '@/lib/shop-os/simple-work'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS simple-work proof attachments', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  const techId = uuid(1)
  const advisorId = uuid(2)
  const ticketId = uuid(20)
  const jobId = uuid(30)
  const versionId = uuid(50)
  const requestKey = uuid(80)
  let actor: SimpleWorkActor
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01])

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop] = await db.insert(shops).values({ name: 'North', laborRateCents: 15_000, taxRateBps: 825 }).returning()
    shopId = shop.id
    actor = { profileId: techId, shopId }
    await db.insert(profiles).values([
      { id: techId, userId: uuid(101), shopId, role: 'tech', skillTier: 2 },
      { id: advisorId, userId: uuid(102), shopId, role: 'advisor', skillTier: 3 },
    ])
    await db.insert(customers).values({ id: uuid(10), shopId, name: 'Customer', phone: '5550102026' })
    await db.insert(vehicles).values({ id: uuid(11), customerId: uuid(10), year: 2020, make: 'Jeep', model: 'Wrangler' })
    await db.insert(tickets).values({
      id: ticketId, shopId, ticketNumber: 1, source: 'counter', customerId: uuid(10), vehicleId: uuid(11),
      concern: 'Lift kit', createdByProfileId: advisorId,
    })
    await db.insert(ticketJobs).values({
      id: jobId, shopId, ticketId, title: 'Install lift kit', kind: 'repair', requiredSkillTier: 2,
      assignedTechId: techId, workStatus: 'in_progress', approvalState: 'quote_ready',
    })
    const snapshot = {
      schemaVersion: 1,
      ticket: { id: ticketId, number: 1, customerId: uuid(10), vehicleId: uuid(11), laborRateCents: 15_000, taxRateBps: 825 },
      jobs: [{
        id: jobId, title: 'Install lift kit', kind: 'repair', customerStory: null, storyMeta: null,
        lines: [{
          id: uuid(40), kind: 'fee', description: 'Install', quantity: '1', priceCents: 50_000,
          taxable: false, partNumber: null, brand: null, coreChargeCents: null, fitment: null,
          laborHours: null, laborRateCents: null, source: 'manual', vendorContext: null,
        }], attachments: [], totals: { subtotalCents: 50_000, taxableSubtotalCents: 0 },
      }],
      totals: { subtotalCents: 50_000, taxableSubtotalCents: 0, taxCents: 0, totalCents: 50_000 },
    }
    await db.insert(quoteVersions).values({
      id: versionId, shopId, ticketId, versionNumber: 1, snapshot, createdByProfileId: advisorId,
    })
    await db.update(ticketJobs).set({ approvalState: 'approved', approvedQuoteVersionId: versionId }).where(eq(ticketJobs.id, jobId))
    await db.insert(quoteEvents).values({
      id: uuid(60), shopId, ticketId, jobId, quoteVersionId: versionId, kind: 'approved',
      actorProfileId: advisorId, approvedVia: 'phone', requestKey: uuid(70),
    })
  })

  afterEach(async () => close())

  function input(overrides: Record<string, unknown> = {}) {
    return {
      actor, ticketId, jobId, requestKey, kind: 'photo',
      file: { bytes: jpeg, mimeType: 'image/jpeg', size: jpeg.byteLength },
      ...overrides,
    }
  }

  it('uploads a content-bound proof once and returns no private storage path', async () => {
    const upload = vi.fn(async () => undefined)
    const remove = vi.fn(async () => undefined)
    const first = await createJobAttachment(db, input(), { upload, remove })
    expect(first).toMatchObject({
      ok: true, changed: true,
      attachment: { kind: 'photo', mimeType: 'image/jpeg', byteSize: jpeg.byteLength },
    })
    expect(JSON.stringify(first)).not.toMatch(/storageKey|jobs\//)
    expect(upload).toHaveBeenCalledTimes(1)
    const second = await createJobAttachment(db, input(), { upload, remove })
    expect(second).toMatchObject({ ok: true, changed: false, attachment: first.ok ? first.attachment : {} })
    expect(upload).toHaveBeenCalledTimes(1)
    const [stored] = await db.select().from(jobAttachments)
    expect(stored.uploadedByProfileId).toBe(techId)
    expect(stored.storageKey).toMatch(new RegExp(`^${shopId}/jobs/${jobId}/proof/.+/[0-9a-f]{64}\\.jpg$`))
  })

  it('rejects mismatched bytes, MIME, size, actor, and request reuse before storage work', async () => {
    const upload = vi.fn(async () => undefined)
    const remove = vi.fn(async () => undefined)
    await expect(createJobAttachment(db, input({
      file: { bytes: new Uint8Array([1, 2, 3]), mimeType: 'image/jpeg', size: 3 },
    }), { upload, remove })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(createJobAttachment(db, input({
      file: { bytes: jpeg, mimeType: 'video/mp4', size: jpeg.byteLength },
    }), { upload, remove })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(createJobAttachment(db, input({
      file: { bytes: jpeg, mimeType: 'image/jpeg', size: MAX_JOB_ATTACHMENT_BYTES + 1 },
    }), { upload, remove })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(createJobAttachment(db, input({
      actor: { profileId: advisorId, shopId },
    }), { upload, remove })).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(upload).not.toHaveBeenCalled()

    const created = await createJobAttachment(db, input(), { upload, remove })
    expect(created.ok).toBe(true)
    const pdf = new TextEncoder().encode('%PDF-1.7')
    await expect(createJobAttachment(db, input({
      kind: 'document', file: { bytes: pdf, mimeType: 'application/pdf', size: pdf.byteLength },
    }), { upload, remove }))
      .resolves.toEqual({ ok: false, error: 'conflict' })
  })

  it('compensates authorization drift and same-byte retry recovers after failed cleanup', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const upload = vi.fn(async () => undefined)
    const remove = vi.fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(undefined)
    const drift = async () => {
      await db.update(ticketJobs).set({ approvalState: 'pending_quote', approvedQuoteVersionId: null })
        .where(eq(ticketJobs.id, jobId))
    }
    await expect(createJobAttachment(db, input(), { upload, remove, beforeFinalize: drift }))
      .resolves.toEqual({ ok: false, error: 'not_authorized' })
    expect(await db.select().from(jobAttachments)).toHaveLength(0)
    expect(remove).toHaveBeenCalledTimes(1)

    await db.update(ticketJobs).set({ approvalState: 'approved', approvedQuoteVersionId: versionId })
      .where(eq(ticketJobs.id, jobId))
    const retried = await createJobAttachment(db, input(), { upload, remove })
    expect(retried).toMatchObject({ ok: true, changed: true })
    expect(upload).toHaveBeenCalledTimes(2)
    expect(warning).toHaveBeenCalledOnce()
  })

  it('proxies only bounded persisted proof after active same-shop authorization', async () => {
    const upload = vi.fn(async () => undefined)
    const remove = vi.fn(async () => undefined)
    const created = await createJobAttachment(db, input(), { upload, remove })
    if (!created.ok) throw new Error('attachment missing')
    const download = vi.fn(async () => jpeg)
    const proof = await getJobAttachmentProof(db, {
      actor, ticketId, jobId, attachmentId: created.attachment.id,
    }, { download })
    expect(proof).toEqual({ ok: true, file: { bytes: jpeg, mimeType: 'image/jpeg' } })
    await db.update(jobAttachments).set({ byteSize: MAX_JOB_ATTACHMENT_BYTES + 1 })
      .where(eq(jobAttachments.id, created.attachment.id))
    await expect(getJobAttachmentProof(db, {
      actor, ticketId, jobId, attachmentId: created.attachment.id,
    }, { download })).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(download).toHaveBeenCalledTimes(1)
  })
})
