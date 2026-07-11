import { eq } from 'drizzle-orm'
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
    captureLockSql?: (statements: string[]) => void
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

  it('returns a canonical same-key retry before stale revision and rejects changed or cross-actor reuse', async () => {
    expect(await save()).toMatchObject({ ok: true, changed: true, storyRevision: 2 })
    expect(await save({ expectedStoryRevision: 999 })).toMatchObject({ ok: true, changed: false, storyRevision: 2 })
    expect(await save({ expectedStoryRevision: 2, whatWeFound: 'Different reuse.' }))
      .toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await save({ actor: { profileId: advisorId }, expectedStoryRevision: 2 }))
      .toEqual({ ok: false, error: 'conflict', retryable: false })
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
    const first = await save()
    expect(first).toMatchObject({ ok: true, changed: true })
    expect((await db.select().from(quoteVersions).where(eq(quoteVersions.id, version.id)))[0].supersededAt).not.toBeNull()

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
  })

  it('fails closed for state, role, tenant, corrupt metadata, and contention', async () => {
    expect(await save({ actor: { profileId: partsId } })).toEqual({ ok: false, error: 'forbidden' })
    const [otherShop] = await db.insert(shops).values({ id: uuid(40), name: 'Other Shop' }).returning()
    const [otherActor] = await db.insert(profiles).values({
      id: uuid(41), userId: uuid(141), shopId: otherShop.id, role: 'tech', skillTier: 2,
    }).returning()
    expect(await save({ actor: { profileId: otherActor.id } })).toEqual({ ok: false, error: 'not_found' })
    await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticketId))
    expect(await save()).toEqual({ ok: false, error: 'state_conflict', retryable: false })
    await db.update(tickets).set({ status: 'open' }).where(eq(tickets.id, ticketId))
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
  })

  it('uses ticket, stable jobs, stable versions, session, actor NOWAIT lock order', async () => {
    const statements: string[] = []
    expect(await save({}, { captureLockSql: (rows) => statements.push(...rows) })).toMatchObject({ ok: true })
    expect(statements.map((statement) => statement.replace(/\s+/g, ' '))).toEqual([
      expect.stringMatching(/from "tickets".*where "tickets"\."id" = \$1.*for update nowait/i),
      expect.stringMatching(/from "ticket_jobs".*where "ticket_jobs"\."ticket_id" = \$1.*order by "ticket_jobs"\."id".*for update nowait/i),
      expect.stringMatching(/from "quote_versions".*where "quote_versions"\."ticket_id" = \$1.*order by "quote_versions"\."id".*for update nowait/i),
      expect.stringMatching(/from "sessions".*where "sessions"\."id" = \$1.*for update nowait/i),
      expect.stringMatching(/from "profiles".*where "profiles"\."id" = \$1.*for update nowait/i),
    ])
  })
})
