import { eq } from 'drizzle-orm'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import * as customerStories from '@/lib/shop-os/customer-stories'
import {
  customers,
  profiles,
  quoteVersions,
  sessionEvents,
  sessions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
  type CustomerStory,
  type CustomerStoryMeta,
  type TreeState,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

type ReviewFn = (
  db: TestDb,
  input: unknown,
  dependencies?: {
    afterLocks?: () => Promise<void>
    afterWrite?: () => Promise<void>
    afterFinalization?: () => Promise<void>
  },
) => Promise<{
  ok: boolean
  error?: string
  retryable?: boolean
  changed?: boolean
  story?: CustomerStory
  storyMeta?: CustomerStoryMeta
  storyRevision?: number
}>

function reviewFn(): ReviewFn {
  const candidate = (customerStories as unknown as { saveReviewedCustomerStory?: ReviewFn })
    .saveReviewedCustomerStory
  expect(candidate).toBeTypeOf('function')
  return candidate!
}

const lockedAt = '2026-07-11T12:00:00.000Z'
const lockedTree = (overrides: Partial<TreeState> = {}): TreeState => ({
  nodes: [{ id: 'root', label: 'Test charging system', status: 'resolved' }],
  currentNodeId: 'root',
  message: 'Diagnosis locked.',
  done: true,
  phase: 'repairing',
  diagnosisLockedAt: lockedAt,
  rootCauseSummary: 'Alternator output is below specification.',
  proposedAction: { description: 'Replace the alternator.', confidence: 0.94 },
  ...overrides,
})

const topologyTree = (): TreeState => ({
  nodes: [{ id: '_topology', label: 'topology', status: 'active' }],
  currentNodeId: '_topology',
  message: '',
  done: true,
})

describe('Shop OS reviewed customer stories', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let ticketId: string
  let jobId: string
  let sessionId: string
  let techId: string
  let advisorId: string
  let ownerId: string
  let partsId: string
  let story: CustomerStory
  let meta: CustomerStoryMeta

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T12:03:00.000Z'))
    ;({ db, close } = await createTestDb())
    const [shop] = await db.insert(shops).values({ id: uuid(1), name: 'North Shop' }).returning()
    shopId = shop.id
    const [tech, advisor, owner, parts] = await db.insert(profiles).values([
      { id: uuid(2), userId: uuid(102), shopId, fullName: 'Taylor Tech', role: 'tech', skillTier: 2 },
      { id: uuid(3), userId: uuid(103), shopId, fullName: 'Avery Advisor', role: 'advisor' },
      { id: uuid(4), userId: uuid(104), shopId, fullName: 'Owen Owner', role: 'owner', skillTier: 3 },
      { id: uuid(5), userId: uuid(105), shopId, fullName: 'Pat Parts', role: 'parts' },
    ]).returning()
    techId = tech.id
    advisorId = advisor.id
    ownerId = owner.id
    partsId = parts.id
    const [customer] = await db.insert(customers).values({ id: uuid(6), shopId, name: 'Alex', phone: '555-0100' }).returning()
    const [vehicle] = await db.insert(vehicles).values({ id: uuid(7), customerId: customer.id, year: 2020, make: 'Ford', model: 'F-150' }).returning()
    const [ticket] = await db.insert(tickets).values({
      id: uuid(8), shopId, ticketNumber: 1, source: 'counter', customerId: customer.id,
      vehicleId: vehicle.id, concern: 'Battery warning appears while driving with the lights on.',
      createdByProfileId: ownerId,
    }).returning()
    ticketId = ticket.id
    const [session] = await db.insert(sessions).values({
      id: uuid(9), shopId, techId, vehicleId: vehicle.id, status: 'open',
      intake: { vehicleYear: 2020, vehicleMake: 'Ford', vehicleModel: 'F-150', customerComplaint: ticket.concern },
      treeState: lockedTree(),
    }).returning()
    sessionId = session.id
    story = {
      whatYouToldUs: ticket.concern,
      whatWeFound: 'Alternator output is below specification.',
      howWeKnow: [{
        claim: 'Charging voltage dropped to 11.8 volts under load.',
        sourceEventIds: [uuid(11)],
        sourceArtifactIds: [],
      }],
      whatItMeansIfWaived: 'If you choose not to proceed, the diagnosed issue remains unresolved.',
      whatWeRecommend: 'Replace the alternator.',
    }
    meta = {
      source: 'ai', sessionId, generatedAt: '2026-07-11T12:01:00.000Z',
      lastEditedByProfileId: techId, lastEditedAt: '2026-07-11T12:01:00.000Z',
      generationClientKey: uuid(12), generationRequestFingerprint: 'a'.repeat(64),
      generatedByProfileId: techId, storyRevision: 1, reviewStatus: 'pending',
    }
    const [job] = await db.insert(ticketJobs).values({
      id: uuid(10), shopId, ticketId, title: 'Charging diagnosis', kind: 'diagnostic',
      requiredSkillTier: 2, assignedTechId: techId, sessionId, workStatus: 'in_progress',
      customerStory: story, storyMeta: meta,
    }).returning()
    jobId = job.id
    await db.insert(sessionEvents).values({
      id: uuid(11),
      sessionId,
      nodeId: 'root',
      eventType: 'observation',
      observationText: 'Charging voltage dropped to 11.8 volts under load.',
      createdAt: new Date('2026-07-11T11:59:00.000Z'),
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    await close()
  })

  const save = (overrides: Record<string, unknown> = {}, dependencies?: Parameters<ReviewFn>[2]) =>
    reviewFn()(db, {
      actor: { profileId: techId }, ticketId, jobId, clientKey: uuid(20),
      expectedStoryRevision: 1,
      whatWeFound: 'The alternator cannot maintain charging voltage under load.',
      whatWeRecommend: 'Replace the alternator and verify charging output.',
      ...overrides,
    }, dependencies)

  it('routes reviewed and manual saves through one coordinator and finalizer', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'lib/shop-os/customer-stories.ts'),
      'utf8',
    )
    const reviewed = source.slice(source.indexOf('export async function saveReviewedCustomerStory'))

    expect(reviewed).toContain('runBoundedShopOsMutationV1')
    expect(reviewed).toContain('finalizeMutationRevisionsV1')
    expect(reviewed).toContain('invalidateActiveQuoteVersionDeltaV1')
    expect(reviewed.match(/finalizeMutationRevisionsV1/g)).toHaveLength(1)
    expect(reviewed).not.toContain('invalidateActiveQuoteVersion(')
    expect(reviewed).not.toContain('.transaction(')
    expect(reviewed).not.toContain(".for('update'")
  })

  it('reviews an AI story while preserving server-owned concern, waiver, and sourced proof', async () => {
    const result = await save({
      whatYouToldUs: 'forged concern',
      howWeKnow: [],
      whatItMeansIfWaived: 'forged waiver',
      reviewedByProfileId: ownerId,
    })
    expect(result).toEqual({ ok: false, error: 'invalid_input' })

    const reviewed = await save()
    expect(reviewed).toMatchObject({
      ok: true,
      changed: true,
      storyRevision: 2,
      story: {
        whatYouToldUs: story.whatYouToldUs,
        howWeKnow: story.howWeKnow,
        whatItMeansIfWaived: story.whatItMeansIfWaived,
        whatWeFound: 'The alternator cannot maintain charging voltage under load.',
        whatWeRecommend: 'Replace the alternator and verify charging output.',
      },
      storyMeta: {
        source: 'ai',
        generationClientKey: meta.generationClientKey,
        generationRequestFingerprint: meta.generationRequestFingerprint,
        generatedByProfileId: techId,
        reviewStatus: 'reviewed',
        reviewClientKey: uuid(20),
        reviewRequestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        reviewedByProfileId: techId,
        reviewedAt: '2026-07-11T12:03:00.000Z',
        lastEditedByProfileId: techId,
        lastEditedAt: '2026-07-11T12:03:00.000Z',
        storyRevision: 2,
      },
    })
  })

  it('bumps job and projection once for a physical review and never on replay', async () => {
    const beforeJob = (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0]
    const beforeTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]

    expect(await save()).toMatchObject({ ok: true, changed: true })
    const afterSaveJob = (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0]
    const afterSaveTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    expect(afterSaveJob.revision).toBe(beforeJob.revision + 1n)
    expect(afterSaveTicket.projectionRevision).toBe(beforeTicket.projectionRevision + 1n)
    expect(afterSaveTicket.continuityRevision).toBe(beforeTicket.continuityRevision)

    expect(await save()).toMatchObject({ ok: true, changed: false })
    const afterReplayJob = (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0]
    const afterReplayTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    expect(afterReplayJob.revision).toBe(afterSaveJob.revision)
    expect(afterReplayTicket.projectionRevision).toBe(afterSaveTicket.projectionRevision)
    expect(afterReplayTicket.continuityRevision).toBe(afterSaveTicket.continuityRevision)
  })

  it('replaces legacy media-backed proof with a quoteable text-only reviewed story', async () => {
    const eventOnlyClaim = {
      claim: 'Charging voltage dropped to 11.8 volts under load.',
      sourceEventIds: [uuid(11)],
      sourceArtifactIds: [],
    }
    await db.update(ticketJobs).set({
      customerStory: {
        ...story,
        howWeKnow: [
          eventOnlyClaim,
          {
            claim: 'Legacy scan-screen proof showed low output.',
            sourceEventIds: [],
            sourceArtifactIds: [uuid(99)],
          },
        ],
      },
    }).where(eq(ticketJobs.id, jobId))

    const reviewed = await save()
    expect(reviewed).toMatchObject({
      ok: true,
      changed: true,
      storyRevision: 2,
      story: { howWeKnow: [eventOnlyClaim] },
      storyMeta: { source: 'ai', reviewStatus: 'reviewed' },
    })
    if (!reviewed.ok) return
    expect(JSON.stringify(reviewed.story)).not.toContain(uuid(99))

    const [persisted] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(persisted.customerStory?.howWeKnow).toEqual([eventOnlyClaim])
    expect(await save()).toMatchObject({ ok: true, changed: false, storyRevision: 2 })
  })

  it('returns a canonical same-key retry before stale revision and rejects changed or cross-actor reuse', async () => {
    expect(await save()).toMatchObject({ ok: true, changed: true, storyRevision: 2 })
    expect(await save()).toMatchObject({ ok: true, changed: false, storyRevision: 2 })
    expect(await save({ expectedStoryRevision: 999 }))
      .toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await save({ expectedStoryRevision: 2, whatWeFound: 'Different reuse.' }))
      .toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await save({ actor: { profileId: advisorId }, expectedStoryRevision: 2 }))
      .toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('revalidates the supported path and persisted story before canonical replay', async () => {
    expect(await save()).toMatchObject({ ok: true, storyRevision: 2 })
    await db.insert(sessionEvents).values({
      id: uuid(50), sessionId, nodeId: 'wizard', eventType: 'wizard_lock_in',
      aiResponse: { wizardLockIn: { flowVersionId: uuid(51) } },
    })
    expect(await save()).toEqual({ ok: false, error: 'unsupported_path', retryable: false })
    await db.delete(sessionEvents).where(eq(sessionEvents.id, uuid(50)))

    await db.update(sessions).set({ treeState: topologyTree() }).where(eq(sessions.id, sessionId))
    expect(await save()).toEqual({ ok: false, error: 'unsupported_path', retryable: false })
    await db.update(sessions).set({ treeState: lockedTree() }).where(eq(sessions.id, sessionId))

    const [stored] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    await db.update(ticketJobs).set({
      customerStory: { ...stored.customerStory!, howWeKnow: [{ claim: 'Corrupt proof.', sourceEventIds: [uuid(52)], sourceArtifactIds: [] }] },
    }).where(eq(ticketJobs.id, jobId))
    expect(await save()).toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(ticketJobs).set({ customerStory: stored.customerStory, storyMeta: { ...stored.storyMeta!, generationRequestFingerprint: 'bad' } as never })
      .where(eq(ticketJobs.id, jobId))
    expect(await save()).toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('normalizes visible review text and rejects invisible or control-only narratives', async () => {
    const result = await save({
      whatWeFound: '  The alternator output is low.\r\n\u200b  ',
      whatWeRecommend: '\u200b Replace the alternator.  ',
    })
    expect(result).toMatchObject({
      ok: true,
      story: {
        whatWeFound: 'The alternator output is low.',
        whatWeRecommend: 'Replace the alternator.',
      },
    })
    for (const invisible of ['   \n\t', '\u200b\u200c\u2060', '\u0000\u0007']) {
      expect(await save({ clientKey: uuid(60), expectedStoryRevision: 2, whatWeFound: invisible }))
        .toEqual({ ok: false, error: 'invalid_input' })
      expect(await save({ clientKey: uuid(61), expectedStoryRevision: 2, whatWeRecommend: invisible }))
        .toEqual({ ok: false, error: 'invalid_input' })
    }
  })

  it('creates an honest reviewed manual story only for a topology session', async () => {
    await db.update(sessions).set({ treeState: topologyTree() }).where(eq(sessions.id, sessionId))
    await db.update(ticketJobs).set({ customerStory: null, storyMeta: null }).where(eq(ticketJobs.id, jobId))
    const result = await save({ expectedStoryRevision: 0 })
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      storyRevision: 1,
      story: {
        whatYouToldUs: 'Battery warning appears while driving with the lights on.',
        howWeKnow: [],
        whatItMeansIfWaived: 'If you choose not to proceed, the diagnosed issue remains unresolved.',
      },
      storyMeta: { source: 'manual', sessionId, reviewStatus: 'reviewed', reviewedByProfileId: techId },
    })

    await db.update(ticketJobs).set({ customerStory: null, storyMeta: null }).where(eq(ticketJobs.id, jobId))
    await db.update(sessions).set({ treeState: lockedTree() }).where(eq(sessions.id, sessionId))
    expect(await save({ clientKey: uuid(21), expectedStoryRevision: 0 }))
      .toEqual({ ok: false, error: 'unsupported_path', retryable: false })

    await db.insert(sessionEvents).values({
      id: uuid(22), sessionId, nodeId: 'wizard', eventType: 'wizard_lock_in',
      aiResponse: { wizardLockIn: { flowVersionId: uuid(23) } },
    })
    expect(await save({ clientKey: uuid(22), expectedStoryRevision: 0 }))
      .toEqual({ ok: false, error: 'unsupported_path', retryable: false })
  })

  it('requires exact row-21 session, revision, and review audit on existing manual metadata', async () => {
    await db.update(sessions).set({ treeState: topologyTree() }).where(eq(sessions.id, sessionId))
    await db.update(ticketJobs).set({ customerStory: null, storyMeta: null }).where(eq(ticketJobs.id, jobId))
    expect(await save({ expectedStoryRevision: 0 })).toMatchObject({ ok: true, storyRevision: 1 })
    const [stored] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const manualMeta = stored.storyMeta!
    for (const corrupt of [
      { ...manualMeta, sessionId: undefined },
      { ...manualMeta, sessionId: uuid(999) },
      { ...manualMeta, storyRevision: undefined },
      { ...manualMeta, reviewClientKey: undefined },
      { ...manualMeta, reviewedByProfileId: undefined },
    ]) {
      await db.update(ticketJobs).set({ storyMeta: corrupt as never }).where(eq(ticketJobs.id, jobId))
      expect(await save()).toEqual({ ok: false, error: 'conflict', retryable: false })
    }
  })

  it('allows active advisor and owner reviewers', async () => {
    expect(await save({ actor: { profileId: advisorId }, clientKey: uuid(70) }))
      .toMatchObject({ ok: true, storyMeta: { reviewedByProfileId: advisorId }, storyRevision: 2 })
    expect(await save({ actor: { profileId: ownerId }, clientKey: uuid(71), expectedStoryRevision: 2 }))
      .toMatchObject({ ok: true, storyMeta: { reviewedByProfileId: ownerId }, storyRevision: 3 })
  })

  it('requires an assigned, sufficiently skilled technician while preserving advisor and owner authority', async () => {
    await db.update(ticketJobs).set({ assignedTechId: advisorId }).where(eq(ticketJobs.id, jobId))
    expect(await save()).toEqual({ ok: false, error: 'forbidden' })

    await db.update(ticketJobs).set({ assignedTechId: techId, requiredSkillTier: 3 })
      .where(eq(ticketJobs.id, jobId))
    expect(await save()).toEqual({ ok: false, error: 'forbidden' })
    expect(await save({ actor: { profileId: advisorId } })).toMatchObject({ ok: true })
  })

  it('allows an active advisor to review history created by a now-inactive technician', async () => {
    await db.update(profiles).set({
      deactivatedAt: new Date('2026-07-11T12:02:00.000Z'),
    }).where(eq(profiles.id, techId))

    expect(await save({ actor: { profileId: advisorId } })).toMatchObject({
      ok: true,
      storyMeta: { reviewedByProfileId: advisorId },
    })
  })

  it('rejects text proof whose event reference is outside the locked target-session closure', async () => {
    await db.update(ticketJobs).set({
      customerStory: {
        ...story,
        howWeKnow: [{
          claim: 'Unbound measurement.',
          sourceEventIds: [uuid(99)],
          sourceArtifactIds: [],
        }],
      },
    }).where(eq(ticketJobs.id, jobId))

    expect(await save()).toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it.each(['afterWrite', 'afterFinalization'] as const)(
    'rolls back reviewed story and revisions when %s fails',
    async (seam) => {
      const beforeJob = (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0]
      const beforeTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]

      await expect(save({}, {
        [seam]: async () => { throw new Error(`forced review ${seam} rollback`) },
      })).rejects.toThrow(`forced review ${seam} rollback`)

      const afterJob = (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0]
      const afterTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
      expect(afterJob.customerStory).toEqual(beforeJob.customerStory)
      expect(afterJob.storyMeta).toEqual(beforeJob.storyMeta)
      expect(afterJob.revision).toBe(beforeJob.revision)
      expect(afterTicket.projectionRevision).toBe(beforeTicket.projectionRevision)
      expect(afterTicket.continuityRevision).toBe(beforeTicket.continuityRevision)
    },
  )

  it('invalidates an active version only when public story content changes', async () => {
    const reviewedMeta: CustomerStoryMeta = {
      ...meta,
      reviewStatus: 'reviewed',
      reviewClientKey: uuid(29),
      reviewRequestFingerprint: 'b'.repeat(64),
      reviewedByProfileId: techId,
      reviewedAt: '2026-07-11T12:02:00.000Z',
    }
    await db.update(ticketJobs).set({ storyMeta: reviewedMeta }).where(eq(ticketJobs.id, jobId))
    const snapshot = {
      schemaVersion: 1,
      ticket: { id: ticketId, number: 1, customerId: uuid(6), vehicleId: uuid(7), laborRateCents: 10000, taxRateBps: 0 },
      jobs: [{ id: jobId, title: 'Charging diagnosis', kind: 'diagnostic', customerStory: story, storyMeta: { source: 'ai', sessionId }, lines: [], attachments: [], totals: { subtotalCents: 0, taxableSubtotalCents: 0 } }],
      totals: { subtotalCents: 0, taxableSubtotalCents: 0, taxCents: 0, totalCents: 0 },
    }
    const [version] = await db.insert(quoteVersions).values({
      id: uuid(30), shopId, ticketId, versionNumber: 1, snapshot, createdByProfileId: ownerId,
    }).returning()
    await db.update(ticketJobs).set({
      approvalState: 'quote_ready',
      approvedQuoteVersionId: version.id,
    }).where(eq(ticketJobs.id, jobId))
    const beforeJob = (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0]
    const beforeTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    const first = await save()
    expect(first).toMatchObject({ ok: true, changed: true })
    expect((await db.select().from(quoteVersions).where(eq(quoteVersions.id, version.id)))[0].supersededAt).not.toBeNull()
    const afterFirstJob = (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0]
    const afterFirstTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    expect(afterFirstJob.revision).toBe(beforeJob.revision + 1n)
    expect(afterFirstTicket.projectionRevision).toBe(beforeTicket.projectionRevision + 1n)
    expect(afterFirstTicket.continuityRevision).toBe(beforeTicket.continuityRevision + 1n)

    if (!first.ok) return
    const [version2] = await db.insert(quoteVersions).values({
      id: uuid(31), shopId, ticketId, versionNumber: 2,
      snapshot: {
        ...snapshot,
        jobs: [{ ...snapshot.jobs[0], customerStory: first.story, storyMeta: { source: 'ai', sessionId } }],
      },
      createdByProfileId: ownerId,
    }).returning()
    expect(await save({ clientKey: uuid(32), expectedStoryRevision: 2 })).toMatchObject({ ok: true, changed: false, storyRevision: 3 })
    expect((await db.select().from(quoteVersions).where(eq(quoteVersions.id, version2.id)))[0].supersededAt).toBeNull()
    const afterEqualJob = (await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0]
    const afterEqualTicket = (await db.select().from(tickets).where(eq(tickets.id, ticketId)))[0]
    expect(afterEqualJob.revision).toBe(afterFirstJob.revision + 1n)
    expect(afterEqualTicket.projectionRevision).toBe(afterFirstTicket.projectionRevision + 1n)
    expect(afterEqualTicket.continuityRevision).toBe(afterFirstTicket.continuityRevision)
  })

  it('fails closed for state, role, tenant, corrupt metadata, and contention', async () => {
    expect(await save({ actor: { profileId: partsId } })).toEqual({ ok: false, error: 'forbidden' })
    const [otherShop] = await db.insert(shops).values({ id: uuid(40), name: 'Other Shop' }).returning()
    const [otherActor] = await db.insert(profiles).values({
      id: uuid(41), userId: uuid(141), shopId: otherShop.id, role: 'tech', skillTier: 2,
    }).returning()
    expect(await save({ actor: { profileId: otherActor.id } })).toEqual({ ok: false, error: 'not_found' })
    await db.update(ticketJobs).set({ workStatus: 'done' }).where(eq(ticketJobs.id, jobId))
    expect(await save()).toEqual({ ok: false, error: 'state_conflict', retryable: false })
    await db.update(ticketJobs).set({ workStatus: 'in_progress' }).where(eq(ticketJobs.id, jobId))
    await db.update(sessions).set({ status: 'closed' }).where(eq(sessions.id, sessionId))
    expect(await save()).toEqual({ ok: false, error: 'state_conflict', retryable: false })
    await db.update(sessions).set({ status: 'open' }).where(eq(sessions.id, sessionId))
    await db.update(profiles).set({ deactivatedAt: new Date() }).where(eq(profiles.id, ownerId))
    expect(await save({ actor: { profileId: ownerId } })).toEqual({ ok: false, error: 'forbidden' })
    await db.update(ticketJobs).set({ storyMeta: { source: 'ai' } as never }).where(eq(ticketJobs.id, jobId))
    expect(await save()).toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(ticketJobs).set({ storyMeta: meta }).where(eq(ticketJobs.id, jobId))
    await db.update(ticketJobs).set({ customerStory: { ...story, whatYouToldUs: 'Changed outside server truth.' } }).where(eq(ticketJobs.id, jobId))
    expect(await save()).toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(ticketJobs).set({ customerStory: story }).where(eq(ticketJobs.id, jobId))
    expect(await save({}, { afterLocks: async () => { throw Object.assign(new Error('held'), { code: '55P03' }) } }))
      .toEqual({ ok: false, error: 'conflict', retryable: true })
    await db.update(tickets).set({
      status: 'closed',
      closedAt: new Date('2026-07-11T12:05:00.000Z'),
      closedByProfileId: ownerId,
      closeDisposition: 'no_repair',
      closeNote: 'Fixture terminal-state proof.',
    }).where(eq(tickets.id, ticketId))
    expect(await save()).toEqual({ ok: false, error: 'state_conflict', retryable: false })
  })

})
