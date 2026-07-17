import { and, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generateAndSaveCustomerStory,
  getCustomerStoryWorkspace,
  type CustomerStoryActor,
} from '@/lib/shop-os/customer-stories'
import { CustomerStoryProviderError } from '@/lib/ai/customer-story'
import type { CustomerStoryGenerationInput, GenerateCustomerStoryFn } from '@/lib/ai/customer-story'
import {
  artifacts,
  customers,
  profiles,
  quoteVersions,
  sessionEvents,
  sessions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
  type TreeState,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const lockedAt = '2026-07-11T12:00:00.000Z'
const lockedTree = (overrides: Partial<TreeState> = {}): TreeState => ({
  nodes: [{ id: 'root', label: 'Test charging system', status: 'resolved' }],
  currentNodeId: 'root',
  message: 'Diagnosis locked.',
  done: true,
  phase: 'repairing',
  diagnosisLockedAt: lockedAt,
  rootCauseSummary: 'Alternator output falls below specification under electrical load.',
  proposedAction: {
    description: 'Replace the alternator and verify charging voltage under load.',
    confidence: 0.94,
  },
  ...overrides,
})

describe('Shop OS customer story domain', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let ticketId: string
  let jobId: string
  let sessionId: string
  let actor: CustomerStoryActor
  let eventId!: string
  let artifactId!: string
  let ownerId!: string
  let advisorId!: string

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T12:01:00.000Z'))
    ;({ db, close } = await createTestDb())
    const [shop] = await db.insert(shops).values({ id: uuid(1), name: 'North Shop' }).returning()
    shopId = shop.id
    const [tech, owner, advisor] = await db.insert(profiles).values([
      { id: uuid(2), userId: uuid(102), shopId, fullName: 'Taylor Tech', role: 'tech', skillTier: 2 },
      { id: uuid(3), userId: uuid(103), shopId, fullName: 'Owen Owner', role: 'owner', skillTier: 3 },
      { id: uuid(12), userId: uuid(112), shopId, fullName: 'Avery Advisor', role: 'advisor', skillTier: 2 },
    ]).returning()
    ownerId = owner.id
    advisorId = advisor.id
    actor = { profileId: tech.id }
    const [customer] = await db.insert(customers).values({ id: uuid(4), shopId, name: 'Alex', phone: '555-0100' }).returning()
    const [vehicle] = await db.insert(vehicles).values({ id: uuid(5), customerId: customer.id, year: 2020, make: 'Ford', model: 'F-150' }).returning()
    const [ticket] = await db.insert(tickets).values({
      id: uuid(6), shopId, ticketNumber: 1, source: 'counter', customerId: customer.id,
      vehicleId: vehicle.id, concern: 'Battery warning appears while driving with the lights on.',
      createdByProfileId: owner.id,
    }).returning()
    ticketId = ticket.id
    const [session] = await db.insert(sessions).values({
      id: uuid(7), shopId, techId: tech.id, vehicleId: vehicle.id, status: 'open',
      intake: { vehicleYear: 2020, vehicleMake: 'Ford', vehicleModel: 'F-150', customerComplaint: ticket.concern },
      treeState: lockedTree(),
    }).returning()
    sessionId = session.id
    const [job] = await db.insert(ticketJobs).values({
      id: uuid(8), shopId, ticketId, title: 'Charging diagnosis', kind: 'diagnostic',
      requiredSkillTier: 2, assignedTechId: tech.id, sessionId,
    }).returning()
    jobId = job.id
    const [event] = await db.insert(sessionEvents).values({
      id: uuid(9), sessionId, nodeId: 'root', eventType: 'observation',
      observationText: 'Charging voltage dropped to 11.8 volts with headlights and blower operating.',
      aiResponse: { messageText: 'SECRET AI RESPONSE' }, createdAt: new Date('2026-07-11T11:58:00Z'),
    }).returning()
    eventId = event.id
    const [artifact] = await db.insert(artifacts).values({
      id: uuid(10), sessionId, nodeId: 'root', kind: 'scan_screen', storageKey: 'private/raw-key',
      mimeType: 'image/jpeg', bytes: 12, extractionStatus: 'done',
      extraction: { summary: 'Load test measurement', text: 'Measured charging output remained at 11.8 volts under load.' },
      createdAt: new Date('2026-07-11T11:59:00Z'),
    }).returning()
    artifactId = artifact.id
  })

  afterEach(async () => {
    vi.useRealTimers()
    await close()
  })

  const generate = (
    overrides: Partial<Parameters<typeof generateAndSaveCustomerStory>[1]> = {},
    provider: GenerateCustomerStoryFn = vi.fn(async () => ({ selections: [{
      sourceKind: 'event' as const, sourceId: eventId,
      excerpt: 'Charging voltage dropped to 11.8 volts with headlights and blower operating.',
    }] })),
    dependencyOverrides: Record<string, unknown> = {},
  ) => generateAndSaveCustomerStory(db, {
    actor, ticketId, jobId, clientKey: uuid(100), expectedStoryRevision: 0,
    sourceEventIds: [eventId], sourceArtifactIds: [], ...overrides,
  }, { generateCustomerStory: provider, ...dependencyOverrides })

  it('captures generated PGlite SQL in the pinned NOWAIT lock order', async () => {
    const statements: string[] = []
    expect(await generate({}, vi.fn(async () => ({ selections: [] })), {
      captureLockSql: (sqlStatements: string[]) => statements.push(...sqlStatements),
    })).toMatchObject({ ok: true })
    expect(statements).toHaveLength(6)
    expect(statements.map((statement) => statement.replace(/\s+/g, ' '))).toEqual([
      expect.stringMatching(/from "tickets".*where "tickets"\."id" = \$1.*for update nowait/i),
      expect.stringMatching(/from "ticket_jobs".*where "ticket_jobs"\."ticket_id" = \$1.*order by "ticket_jobs"\."id".*for update nowait/i),
      expect.stringMatching(/from "quote_versions".*where "quote_versions"\."ticket_id" = \$1.*order by "quote_versions"\."id".*for update nowait/i),
      expect.stringMatching(/from "sessions".*where "sessions"\."id" = \$1.*for update nowait/i),
      expect.stringMatching(/from "session_events".*where "session_events"\."id" in \(\$1\).*order by "session_events"\."id".*for update nowait/i),
      expect.stringMatching(/from "profiles".*where "profiles"\."id" = \$1.*for update nowait/i),
    ])
  })

  it('assembles canonical fields and sends only bounded selected evidence to the provider', async () => {
    const provider = vi.fn(async (_input: CustomerStoryGenerationInput) => ({ selections: [] }))
    const result = await generate({}, provider)
    expect(result).toMatchObject({ ok: true, changed: true, storyRevision: 1 })
    expect(result.ok && result.story).toEqual({
      whatYouToldUs: 'Battery warning appears while driving with the lights on.',
      whatWeFound: 'Alternator output falls below specification under electrical load.',
      howWeKnow: [],
      whatItMeansIfWaived: 'If you choose not to proceed, the diagnosed issue remains unresolved.',
      whatWeRecommend: 'Replace the alternator and verify charging voltage under load.',
    })
    expect(provider).toHaveBeenCalledWith({ evidence: [
      expect.objectContaining({ sourceKind: 'event', sourceId: eventId }),
    ] })
    const serialized = JSON.stringify(provider.mock.calls[0][0])
    expect(serialized).not.toContain('SECRET AI RESPONSE')
    expect(serialized).not.toContain('private/raw-key')
  })

  it('preserves a contradictory exact excerpt only as a pending mutable draft', async () => {
    const contradiction = 'Charging voltage held at 14.4 volts during the loaded retest.'
    await db.update(sessionEvents).set({ observationText: contradiction }).where(eq(sessionEvents.id, eventId))
    const result = await generate({ sourceArtifactIds: [] }, vi.fn(async () => ({ selections: [{
      sourceKind: 'event' as const, sourceId: eventId, excerpt: contradiction,
    }] })))
    expect(result).toMatchObject({
      ok: true,
      story: { howWeKnow: [{ claim: contradiction }] },
      storyMeta: { reviewStatus: 'pending' },
    })
    const [stored] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(stored.storyMeta).toMatchObject({ reviewStatus: 'pending' })
  })

  it('rejects ordinary incomplete trees and all wizard provenance without invoking the provider', async () => {
    const provider = vi.fn(async () => ({ selections: [] }))
    await db.update(sessions).set({ treeState: lockedTree({ done: false }) }).where(eq(sessions.id, sessionId))
    expect(await generate({}, provider)).toEqual({ ok: false, error: 'state_conflict', retryable: false })
    await db.insert(sessionEvents).values({
      id: uuid(11), sessionId, nodeId: 'wizard', eventType: 'wizard_lock_in',
      aiResponse: { wizardLockIn: { flowVersionId: uuid(400) } }, createdAt: new Date(lockedAt),
    })
    await db.update(sessions).set({ treeState: lockedTree() }).where(eq(sessions.id, sessionId))
    expect(await generate({}, provider)).toEqual({ ok: false, error: 'unsupported_path', retryable: false })
    expect(provider).not.toHaveBeenCalled()
  })

  it('rejects closed, topology, future-lock, confidence, and canonical-field state drift', async () => {
    await db.update(sessions).set({ status: 'closed' }).where(eq(sessions.id, sessionId))
    expect(await generate()).toEqual({ ok: false, error: 'state_conflict', retryable: false })
    await db.update(sessions).set({ status: 'open', treeState: lockedTree({ currentNodeId: '_topology' }) }).where(eq(sessions.id, sessionId))
    expect(await generate()).toEqual({ ok: false, error: 'state_conflict', retryable: false })
    await db.update(sessions).set({ treeState: lockedTree({ diagnosisLockedAt: '2999-01-01T00:00:00.000Z' }) }).where(eq(sessions.id, sessionId))
    expect(await generate()).toEqual({ ok: false, error: 'state_conflict', retryable: false })
    await db.update(sessions).set({ treeState: lockedTree({ proposedAction: { description: 'Replace alternator.', confidence: 1.01 } }) }).where(eq(sessions.id, sessionId))
    expect(await generate()).toEqual({ ok: false, error: 'state_conflict', retryable: false })
    await db.update(sessions).set({ treeState: lockedTree({ rootCauseSummary: 'x'.repeat(5_001) }) }).where(eq(sessions.id, sessionId))
    expect(await generate()).toEqual({ ok: false, error: 'state_conflict', retryable: false })
  })

  it.each([
    [{ clientKey: 'bad' }, 'invalid_input'],
    [{ expectedStoryRevision: -1 }, 'invalid_input'],
    [{ sourceEventIds: [eventId, eventId] }, 'invalid_input'],
    [{ sourceArtifactIds: Array.from({ length: 21 }, (_, index) => uuid(500 + index)) }, 'invalid_input'],
  ])('strictly rejects malformed generation input %#', async (overrides, error) => {
    expect(await generate(overrides as never)).toEqual({ ok: false, error })
  })

  it('privacy-collapses cross-session and post-lock selected evidence to not found', async () => {
    const [other] = await db.insert(sessions).values({
      id: uuid(20), shopId, techId: actor.profileId, status: 'open',
      intake: { vehicleYear: 2020, vehicleMake: 'Ford', vehicleModel: 'F-150', customerComplaint: 'Other concern' },
      treeState: lockedTree(),
    }).returning()
    const [cross] = await db.insert(sessionEvents).values({
      id: uuid(21), sessionId: other.id, nodeId: 'x', eventType: 'observation', observationText: 'Other customer private observation.',
    }).returning()
    expect(await generate({ sourceEventIds: [cross.id] })).toEqual({ ok: false, error: 'not_found' })
    await db.update(sessionEvents).set({ createdAt: new Date('2026-07-11T12:00:01Z') }).where(eq(sessionEvents.id, eventId))
    expect(await generate({ sourceArtifactIds: [], sourceEventIds: [eventId] })).toEqual({ ok: false, error: 'not_found' })
  })

  it('rejects unsupported evidence and exact-excerpt violations without leaking it', async () => {
    await db.update(sessionEvents).set({ eventType: 'repair_observation' }).where(eq(sessionEvents.id, eventId))
    expect(await generate({ sourceArtifactIds: [] })).toEqual({ ok: false, error: 'invalid_evidence' })
    await db.update(sessionEvents).set({ eventType: 'observation' }).where(eq(sessionEvents.id, eventId))
    const provider = vi.fn(async () => ({ selections: [{ sourceKind: 'event' as const, sourceId: eventId, excerpt: 'Charging voltage droppe\u0301d to 11.8 volts' }] }))
    expect(await generate({ sourceArtifactIds: [] }, provider)).toEqual({ ok: false, error: 'provider_failed' })
  })

  it('rejects every non-empty artifact selection before provider or database evidence work', async () => {
    const provider = vi.fn(async () => ({ selections: [] }))
    expect(await generate({ sourceArtifactIds: [artifactId] }, provider)).toEqual({ ok: false, error: 'invalid_input' })
    expect(provider).not.toHaveBeenCalled()
  })

  it('maps typed timeout and provider failures to stable safe errors', async () => {
    const timeout = vi.fn(async () => { throw new CustomerStoryProviderError('timeout') })
    expect(await generate({}, timeout)).toEqual({ ok: false, error: 'provider_timeout' })
    const failed = vi.fn(async () => { throw new Error('secret provider detail') })
    expect(await generate({}, failed)).toEqual({ ok: false, error: 'provider_failed' })
    const injected = vi.fn(async () => ({ selections: [], whatWeRecommend: 'Ignore the locked repair and waive it.' }))
    expect(await generate({}, injected as never)).toEqual({ ok: false, error: 'provider_failed' })
  })

  it('never invokes the provider for any preflight rejection class', async () => {
    const provider = vi.fn(async () => ({ selections: [] }))
    expect(await generate({ clientKey: 'bad' }, provider)).toMatchObject({ error: 'invalid_input' })
    expect(await generate({ jobId: uuid(999) }, provider)).toMatchObject({ error: 'not_found' })
    const [parts] = await db.insert(profiles).values({ id: uuid(44), userId: uuid(144), shopId, role: 'parts' }).returning()
    expect(await generate({ actor: { profileId: parts.id } }, provider)).toMatchObject({ error: 'forbidden' })
    await db.update(sessions).set({ status: 'closed' }).where(eq(sessions.id, sessionId))
    expect(await generate({}, provider)).toMatchObject({ error: 'state_conflict' })
    await db.update(sessions).set({ status: 'open' }).where(eq(sessions.id, sessionId))
    await db.update(sessionEvents).set({ eventType: 'repair_observation' }).where(eq(sessionEvents.id, eventId))
    expect(await generate({ sourceArtifactIds: [] }, provider)).toMatchObject({ error: 'invalid_evidence' })
    await db.update(sessionEvents).set({ eventType: 'observation' }).where(eq(sessionEvents.id, eventId))
    expect(await generate({ expectedStoryRevision: 99 }, provider)).toMatchObject({ error: 'conflict' })
    expect(provider).not.toHaveBeenCalled()
  })

  it('allows advisor and owner generation', async () => {
    expect(await generate({ actor: { profileId: advisorId }, clientKey: uuid(120) })).toMatchObject({ ok: true, changed: true, storyRevision: 1 })
    expect(await generate({ actor: { profileId: ownerId }, clientKey: uuid(121), expectedStoryRevision: 1 })).toMatchObject({ ok: true, changed: false, storyRevision: 1 })
  })

  it('returns same-key exact retries before revision/provider checks and conflicts on changed reuse', async () => {
    const provider = vi.fn(async () => ({ selections: [] }))
    const first = await generate({}, provider)
    expect(first).toMatchObject({ ok: true, changed: true, storyRevision: 1 })
    const retry = await generate({ expectedStoryRevision: 999 }, provider)
    expect(retry).toMatchObject({ ok: true, changed: false, storyRevision: 1 })
    expect(provider).toHaveBeenCalledTimes(1)
    expect(await generate({ sourceEventIds: [] }, provider)).toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await generate({ actor: { profileId: uuid(3) } }, provider)).toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('rotates retry identity for identical public stories and increments only changed stories', async () => {
    const empty = vi.fn(async () => ({ selections: [] }))
    expect(await generate({}, empty)).toMatchObject({ ok: true, storyRevision: 1 })
    expect(await generate({ clientKey: uuid(101), expectedStoryRevision: 1 }, empty)).toMatchObject({ ok: true, changed: false, storyRevision: 1 })
    const changed = vi.fn(async () => ({ selections: [{
      sourceKind: 'event' as const, sourceId: eventId,
      excerpt: 'Charging voltage dropped to 11.8 volts with headlights and blower operating.',
    }] }))
    expect(await generate({ clientKey: uuid(102), expectedStoryRevision: 1 }, changed)).toMatchObject({ ok: true, changed: true, storyRevision: 2 })
    expect(await generate({ clientKey: uuid(103), expectedStoryRevision: 1 }, changed)).toEqual({ ok: false, error: 'conflict', retryable: false })
    const [stored] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(stored.storyMeta).toMatchObject({
      source: 'ai', sessionId, generationClientKey: uuid(102), generatedByProfileId: actor.profileId,
      storyRevision: 2, generationRequestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      lastEditedByProfileId: actor.profileId,
    })
  })

  it('detects provider-time drift and rolls back without a partial story write', async () => {
    const result = await generate({}, vi.fn(async () => ({ selections: [] })), {
      beforeFinalTransaction: async () => {
        await db.update(profiles).set({ deactivatedAt: new Date() }).where(eq(profiles.id, actor.profileId))
      },
    })
    expect(result).toEqual({ ok: false, error: 'conflict', retryable: true })
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(job.customerStory).toBeNull()
  })

  it.each([
    ['role', async () => { await db.update(profiles).set({ role: 'parts' }).where(eq(profiles.id, advisorId)) }],
    ['deactivation', async () => { await db.update(profiles).set({ deactivatedAt: new Date() }).where(eq(profiles.id, advisorId)) }],
    ['shop', async () => {
      const [otherShop] = await db.insert(shops).values({ id: uuid(70), name: 'Drift Shop' }).returning()
      await db.update(profiles).set({ shopId: otherShop.id }).where(eq(profiles.id, advisorId))
    }],
  ])('detects locked actor %s drift during provider work', async (_label, drift) => {
    const result = await generate(
      { actor: { profileId: advisorId }, clientKey: uuid(122) },
      vi.fn(async () => ({ selections: [] })),
      { beforeFinalTransaction: drift },
    )
    expect(result).toEqual({ ok: false, error: 'conflict', retryable: true })
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0].customerStory).toBeNull()
  })

  it('detects selected evidence and quote-version CAS drift after provider work', async () => {
    const evidenceDrift = await generate({}, vi.fn(async () => ({ selections: [] })), {
      beforeFinalTransaction: async () => {
        await db.update(sessionEvents).set({ observationText: 'The measured value changed while generation was running.' }).where(eq(sessionEvents.id, eventId))
      },
    })
    expect(evidenceDrift).toEqual({ ok: false, error: 'conflict', retryable: true })
    await db.update(sessionEvents).set({ observationText: 'Charging voltage dropped to 11.8 volts with headlights and blower operating.' }).where(eq(sessionEvents.id, eventId))
    const versionDrift = await generate({ clientKey: uuid(109) }, vi.fn(async () => ({ selections: [] })), {
      beforeFinalTransaction: async () => {
        await db.insert(quoteVersions).values({
          id: uuid(1090), shopId, ticketId, versionNumber: 1, snapshot: {}, createdByProfileId: uuid(3),
        })
      },
    })
    expect(versionDrift).toEqual({ ok: false, error: 'conflict', retryable: true })
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0].customerStory).toBeNull()
  })

  it('classifies NOWAIT contention as retryable and rolls back', async () => {
    const result = await generate({}, vi.fn(async () => ({ selections: [] })), {
      afterLocks: async () => { throw Object.assign(new Error('held row'), { code: '55P03' }) },
    })
    expect(result).toEqual({ ok: false, error: 'conflict', retryable: true })
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(job.customerStory).toBeNull()
  })

  it('invalidates one active quote atomically and rolls back duplicate-active anomalies', async () => {
    const snapshot = () => ({
      schemaVersion: 1,
      ticket: { id: ticketId, number: 1, customerId: uuid(4), vehicleId: uuid(5), laborRateCents: 10000, taxRateBps: 0 },
      jobs: [{ id: jobId, title: 'Charging diagnosis', kind: 'diagnostic', customerStory: null, storyMeta: null, lines: [], attachments: [], totals: { subtotalCents: 0, taxableSubtotalCents: 0 } }],
      totals: { subtotalCents: 0, taxableSubtotalCents: 0, taxCents: 0, totalCents: 0 },
    })
    const [excludedJob] = await db.insert(ticketJobs).values({
      id: uuid(33), shopId, ticketId, title: 'Excluded maintenance', kind: 'maintenance',
      requiredSkillTier: 1, approvalState: 'quote_ready',
    }).returning()
    const [version] = await db.insert(quoteVersions).values({
      id: uuid(30), shopId, ticketId, versionNumber: 1, snapshot: snapshot(), createdByProfileId: uuid(3),
    }).returning()
    await db.update(ticketJobs).set({ approvalState: 'quote_ready', approvedQuoteVersionId: version.id }).where(eq(ticketJobs.id, jobId))
    expect(await generate()).toMatchObject({ ok: true, changed: true })
    expect((await db.select().from(quoteVersions).where(eq(quoteVersions.id, version.id)))[0].supersededAt).not.toBeNull()
    const projectedJobs = await db.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId))
    expect(projectedJobs.find((job) => job.id === jobId)).toMatchObject({ approvalState: 'pending_quote', approvedQuoteVersionId: null })
    expect(projectedJobs.find((job) => job.id === excludedJob.id)).toMatchObject({ approvalState: 'quote_ready' })

    await db.update(ticketJobs).set({ customerStory: null, storyMeta: null }).where(eq(ticketJobs.id, jobId))
    await db.insert(quoteVersions).values([
      { id: uuid(31), shopId, ticketId, versionNumber: 2, snapshot: snapshot(), createdByProfileId: uuid(3) },
      { id: uuid(32), shopId, ticketId, versionNumber: 3, snapshot: snapshot(), createdByProfileId: uuid(3) },
    ])
    expect(await generate({ clientKey: uuid(105) })).toEqual({ ok: false, error: 'conflict', retryable: false })
    expect((await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0].customerStory).toBeNull()
  })

  it('returns a bounded tenant-safe workspace with independent strict cursors', async () => {
    await db.insert(sessionEvents).values(Array.from({ length: 26 }, (_, index) => ({
      id: uuid(1000 + index), sessionId, nodeId: 'root', eventType: 'observation' as const,
      observationText: `Observation number ${index} contains a useful measured value.`,
      createdAt: new Date('2026-07-11T11:57:00Z'),
    })))
    const first = await getCustomerStoryWorkspace(db, { actor, ticketId, jobId })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.workspace.evidence.events).toHaveLength(25)
    expect(first.workspace.evidence.artifacts).toEqual([])
    expect(first.workspace.evidence.nextArtifactCursor).toBeNull()
    expect(first.workspace.evidence.nextEventCursor).toEqual(expect.any(String))
    expect(JSON.stringify(first)).not.toMatch(/SECRET AI RESPONSE|private\/raw-key|aiResponse|storageKey|outcome/)
    const second = await getCustomerStoryWorkspace(db, {
      actor, ticketId, jobId, eventCursor: first.workspace.evidence.nextEventCursor!,
    })
    expect(second.ok && second.workspace.evidence.events.length).toBeGreaterThan(0)
    expect(await getCustomerStoryWorkspace(db, { actor, ticketId, jobId, eventCursor: 'forged' })).toEqual({ ok: false, error: 'invalid_input' })
  })

  it('scans bounded chunks past invalid event rows while never projecting artifacts', async () => {
    await db.delete(sessionEvents).where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.eventType, 'observation')))
    await db.delete(artifacts).where(eq(artifacts.sessionId, sessionId))
    const tiedAt = new Date('2026-07-11T11:57:00Z')
    await db.insert(sessionEvents).values([
      ...Array.from({ length: 27 }, (_, index) => ({
        id: uuid(2000 + index), sessionId, nodeId: 'root', eventType: 'observation' as const,
        observationText: '', createdAt: new Date('2026-07-11T11:59:00Z'),
      })),
      ...Array.from({ length: 30 }, (_, index) => ({
        id: uuid(2100 + index), sessionId, nodeId: 'root', eventType: 'observation' as const,
        observationText: `Valid tied event ${index} measured twelve point ${index} volts.`, createdAt: tiedAt,
      })),
    ])
    await db.insert(artifacts).values([
      ...Array.from({ length: 27 }, (_, index) => ({
        id: uuid(3000 + index), sessionId, nodeId: 'root', kind: 'scan_screen' as const,
        storageKey: `invalid-${index}`, mimeType: 'image/jpeg', bytes: 1, extractionStatus: 'done' as const,
        extraction: {}, createdAt: new Date('2026-07-11T11:59:00Z'),
      })),
      ...Array.from({ length: 30 }, (_, index) => ({
        id: uuid(3100 + index), sessionId, nodeId: 'root', kind: 'scan_screen' as const,
        storageKey: `valid-${index}`, mimeType: 'image/jpeg', bytes: 1, extractionStatus: 'done' as const,
        extraction: { text: `Valid tied artifact ${index} measured charging voltage.` }, createdAt: tiedAt,
      })),
    ])

    const first = await getCustomerStoryWorkspace(db, { actor, ticketId, jobId })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.workspace.evidence.events.map((row) => row.id)).toEqual(
      Array.from({ length: 25 }, (_, index) => uuid(2129 - index)),
    )
    expect(first.workspace.evidence.artifacts).toEqual([])
    expect(first.workspace.evidence.nextArtifactCursor).toBeNull()
    const eventSecond = await getCustomerStoryWorkspace(db, {
      actor, ticketId, jobId, eventCursor: first.workspace.evidence.nextEventCursor!,
    })
    expect(eventSecond.ok && eventSecond.workspace.evidence.events.map((row) => row.id)).toEqual(Array.from({ length: 5 }, (_, index) => uuid(2104 - index)))
    expect(eventSecond.ok && eventSecond.workspace.evidence.artifacts).toEqual([])
  })

  it('caps each evidence scan at four chunks and returns bound continuations that eventually reach older evidence', async () => {
    await db.delete(sessionEvents).where(and(eq(sessionEvents.sessionId, sessionId), eq(sessionEvents.eventType, 'observation')))
    await db.delete(artifacts).where(eq(artifacts.sessionId, sessionId))
    const invalidAt = new Date('2026-07-11T11:59:00Z')
    const validAt = new Date('2026-07-11T11:57:00Z')
    await db.insert(sessionEvents).values([
      ...Array.from({ length: 205 }, (_, index) => ({
        id: uuid(4000 + index), sessionId, nodeId: 'root', eventType: 'observation' as const,
        observationText: '', createdAt: invalidAt,
      })),
      ...Array.from({ length: 30 }, (_, index) => ({
        id: uuid(4300 + index), sessionId, nodeId: 'root', eventType: 'observation' as const,
        observationText: `Older valid event ${index} measured a stable charging value.`, createdAt: validAt,
      })),
    ])
    await db.insert(artifacts).values([
      ...Array.from({ length: 205 }, (_, index) => ({
        id: uuid(5000 + index), sessionId, nodeId: 'root', kind: 'scan_screen' as const,
        storageKey: `cap-invalid-${index}`, mimeType: 'image/jpeg', bytes: 1,
        extractionStatus: 'done' as const, extraction: {}, createdAt: invalidAt,
      })),
      ...Array.from({ length: 30 }, (_, index) => ({
        id: uuid(5300 + index), sessionId, nodeId: 'root', kind: 'scan_screen' as const,
        storageKey: `cap-valid-${index}`, mimeType: 'image/jpeg', bytes: 1,
        extractionStatus: 'done' as const,
        extraction: { text: `Older valid artifact ${index} measured a stable charging value.` }, createdAt: validAt,
      })),
    ])
    const queryCounts = { event: 0 }
    const first = await getCustomerStoryWorkspace(db, { actor, ticketId, jobId }, {
      onEvidenceQuery: (kind: 'event') => { queryCounts[kind] += 1 },
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(queryCounts).toEqual({ event: 4 })
    expect(first.workspace.evidence.events).toHaveLength(0)
    expect(first.workspace.evidence.artifacts).toHaveLength(0)
    expect(first.workspace.evidence.nextEventCursor).toEqual(expect.any(String))
    expect(first.workspace.evidence.nextArtifactCursor).toBeNull()

    const secondCounts = { event: 0 }
    const second = await getCustomerStoryWorkspace(db, {
      actor, ticketId, jobId,
      eventCursor: first.workspace.evidence.nextEventCursor!,
    }, { onEvidenceQuery: (kind: 'event') => { secondCounts[kind] += 1 } })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(secondCounts).toEqual({ event: 1 })
    expect(second.workspace.evidence.events.map((row) => row.id)).toEqual(Array.from({ length: 25 }, (_, index) => uuid(4329 - index)))
    expect(second.workspace.evidence.artifacts).toEqual([])
  })

  it('binds canonical cursors to evidence kind and linked session', async () => {
    await db.insert(sessionEvents).values(Array.from({ length: 26 }, (_, index) => ({
      id: uuid(6000 + index), sessionId, nodeId: 'root', eventType: 'observation' as const,
      observationText: `Cursor binding observation ${index} contains measured voltage.`,
      createdAt: new Date('2026-07-11T11:57:00Z'),
    })))
    const first = await getCustomerStoryWorkspace(db, { actor, ticketId, jobId })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const eventCursor = first.workspace.evidence.nextEventCursor!
    expect(await getCustomerStoryWorkspace(db, { actor, ticketId, jobId, artifactCursor: eventCursor })).toEqual({ ok: false, error: 'invalid_input' })
    const decoded = JSON.parse(Buffer.from(eventCursor, 'base64url').toString('utf8')) as Record<string, unknown>
    decoded.s = uuid(999)
    const crossSession = Buffer.from(JSON.stringify(decoded)).toString('base64url')
    expect(await getCustomerStoryWorkspace(db, { actor, ticketId, jobId, eventCursor: crossSession })).toEqual({ ok: false, error: 'invalid_input' })
  })

  it('rejects unsafe persisted story and metadata instead of returning raw JSONB', async () => {
    expect(await generate({}, vi.fn(async () => ({ selections: [] })))).toMatchObject({ ok: true })
    const [stored] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    await db.update(ticketJobs).set({
      storyMeta: { ...stored.storyMeta!, aiResponse: 'secret', storageKey: 'private', rawUrl: 'https://private.invalid' } as never,
    }).where(eq(ticketJobs.id, jobId))
    expect(await generate({ expectedStoryRevision: 999 }, vi.fn(async () => ({ selections: [] })))).toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await getCustomerStoryWorkspace(db, { actor, ticketId, jobId })).toEqual({ ok: false, error: 'conflict', retryable: false })

    await db.update(ticketJobs).set({ storyMeta: stored.storyMeta, customerStory: { ...stored.customerStory!, whatWeFound: '' } }).where(eq(ticketJobs.id, jobId))
    expect(await getCustomerStoryWorkspace(db, { actor, ticketId, jobId })).toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(ticketJobs).set({ customerStory: { ...stored.customerStory!, whatWeFound: '😀'.repeat(1_251) } }).where(eq(ticketJobs.id, jobId))
    expect(await getCustomerStoryWorkspace(db, { actor, ticketId, jobId })).toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(ticketJobs).set({ customerStory: { ...stored.customerStory!, howWeKnow: [{ claim: '', sourceEventIds: [eventId], sourceArtifactIds: [] }] } }).where(eq(ticketJobs.id, jobId))
    expect(await getCustomerStoryWorkspace(db, { actor, ticketId, jobId })).toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('denies unsupported same-shop roles and privacy-collapses cross-shop parents', async () => {
    const [parts] = await db.insert(profiles).values({ id: uuid(40), userId: uuid(140), shopId, role: 'parts', fullName: 'Pat Parts' }).returning()
    expect(await getCustomerStoryWorkspace(db, { actor: { profileId: parts.id }, ticketId, jobId })).toEqual({ ok: false, error: 'forbidden' })
    const [otherShop] = await db.insert(shops).values({ id: uuid(41), name: 'Other' }).returning()
    const [other] = await db.insert(profiles).values({ id: uuid(42), userId: uuid(142), shopId: otherShop.id, role: 'tech' }).returning()
    expect(await getCustomerStoryWorkspace(db, { actor: { profileId: other.id }, ticketId, jobId })).toEqual({ ok: false, error: 'not_found' })
  })
})
