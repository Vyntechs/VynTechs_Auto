import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  adaptiveMutationDependencies,
  authorizeAdaptiveMutation,
  type AdaptiveMutationActor,
} from '@/lib/diagnostics/adaptive/actor'
import type { AdaptiveCoverage, AdaptiveDiagnosticState } from '@/lib/diagnostics/adaptive/contracts'
import { updateAdaptiveModeForUser } from '@/lib/diagnostics/adaptive/state'
import {
  profiles,
  sessionEvents,
  sessions,
  shops,
  stripeCustomers,
  ticketJobs,
  tickets,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/auth-access', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth-access')>(),
  paywallReject: vi.fn(async () => null),
}))

import { POST } from '@/app/api/sessions/[id]/adaptive/mode/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const requestBody = (overrides: Record<string, unknown> = {}) => ({
  requestKey: uuid(90),
  expectedRevision: 0,
  mode: 'guided',
  ...overrides,
})

const proofClosedCoverage: AdaptiveCoverage = {
  state: 'exact',
  system: 'fuel',
  symptomSlug: 'p0087',
  reasons: ['Field-verified.'],
  technicianInstructionsAvailable: true,
  instructionProof: {
    componentIds: [uuid(70)],
    testActionIds: [uuid(71)],
    branchLogicIds: [],
    verifiedAxes: ['exact:fuel-system'],
  },
}

const proofOpenCoverage: AdaptiveCoverage = {
  state: 'partial',
  system: 'fuel',
  symptomSlug: 'p0087',
  reasons: ['Applicability remains open.'],
  technicianInstructionsAvailable: false,
  instructionProof: null,
}

function state(coverage: AdaptiveCoverage, mode: 'guided' | 'manual'): AdaptiveDiagnosticState {
  return {
    schemaVersion: 1,
    mode,
    coverage,
    currentTestActionId: null,
    finding: null,
  }
}

describe('updateAdaptiveModeForUser', () => {
  let db: TestDb
  let close: () => Promise<void>
  let actor: AdaptiveMutationActor
  let otherActor: AdaptiveMutationActor
  let otherShopId: string
  let sessionId: string
  let jobId: string

  beforeEach(async () => {
    vi.stubEnv('SHOP_OS_ADAPTIVE_CANVAS_ENABLED', 'true')
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { id: uuid(1), name: 'North Shop' },
      { id: uuid(2), name: 'South Shop' },
    ]).returning()
    otherShopId = otherShop.id
    const [tech, otherTech] = await db.insert(profiles).values([
      { id: uuid(10), userId: uuid(20), shopId: shop.id, fullName: 'Taylor', role: 'tech' },
      { id: uuid(11), userId: uuid(21), shopId: shop.id, fullName: 'Terry', role: 'tech' },
    ]).returning()
    actor = { userId: tech.userId, profileId: tech.id, shopId: shop.id }
    otherActor = { userId: otherTech.userId, profileId: otherTech.id, shopId: shop.id }
    await db.insert(stripeCustomers).values([
      { shopId: shop.id, stripeCustomerId: 'cus_north', subscriptionStatus: 'active' },
      { shopId: otherShop.id, stripeCustomerId: 'cus_south', subscriptionStatus: 'active' },
    ])
    const [session] = await db.insert(sessions).values({
      id: uuid(30),
      shopId: shop.id,
      techId: tech.id,
      intake: {
        vehicleYear: 2018,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'P0087 low fuel pressure',
      },
      treeState: {
        nodes: [{ id: 'root', label: 'Verify concern', status: 'active' }],
        currentNodeId: 'root',
        message: 'Begin.',
      },
      adaptiveDiagnosticState: state(proofClosedCoverage, 'manual'),
    }).returning()
    sessionId = session.id
    const [ticket] = await db.insert(tickets).values({
      id: uuid(40),
      shopId: shop.id,
      ticketNumber: 1,
      source: 'tech_quick',
      concern: 'Low fuel pressure',
      createdByProfileId: tech.id,
    }).returning()
    const [job] = await db.insert(ticketJobs).values({
      id: uuid(50),
      shopId: shop.id,
      ticketId: ticket.id,
      title: 'Diagnose low fuel pressure',
      kind: 'diagnostic',
      requiredSkillTier: 1,
      assignedTechId: tech.id,
      sessionId: session.id,
      workStatus: 'in_progress',
      diagnosticStartState: 'ready',
    }).returning()
    jobId = job.id
  })

  afterEach(async () => {
    vi.unstubAllEnvs()
    await close()
  })

  it('strictly rejects malformed and extra body fields', async () => {
    for (const body of [
      requestBody({ extra: true }),
      requestBody({ requestKey: 'not-a-uuid' }),
      requestBody({ expectedRevision: -1 }),
      requestBody({ mode: 'automatic' }),
    ]) {
      await expect(updateAdaptiveModeForUser({ db, actor, sessionId, requestKey: uuid(90), expectedRevision: 0, body }))
        .resolves.toEqual({ ok: false, status: 400, error: 'invalid_input' })
    }
  })

  it.each(['exact', 'verified_equivalent', 'partial', 'draft', 'unsupported'] as const)(
    'rejects guided mode for %s coverage without changing state',
    async (coverageState) => {
      const coverage = { ...proofOpenCoverage, state: coverageState }
      await db.update(sessions).set({ adaptiveDiagnosticState: state(coverage, 'manual') })
        .where(eq(sessions.id, sessionId))

      await expect(updateAdaptiveModeForUser({
        db, actor, sessionId, requestKey: uuid(90), expectedRevision: 0, body: requestBody(),
      })).resolves.toEqual({ ok: false, status: 409, error: 'not_eligible' })

      const [stored] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
      expect(stored.adaptiveDiagnosticState).toEqual(state(coverage, 'manual'))
      expect(stored.adaptiveRevision).toBe(0)
    },
  )

  it('initializes unresolved coverage as manual when stored state is null', async () => {
    await db.update(sessions).set({ adaptiveDiagnosticState: null })
      .where(eq(sessions.id, sessionId))
    const body = requestBody({ mode: 'manual' })

    const result = await updateAdaptiveModeForUser({
      db,
      actor,
      sessionId,
      requestKey: uuid(90),
      expectedRevision: 0,
      body,
    })

    expect(result).toMatchObject({
      ok: true,
      revision: 1,
      state: { mode: 'manual', coverage: { state: 'unsupported' } },
    })
  })

  it('persists guided and manual changes with an actor-bound event and revision CAS', async () => {
    const guided = await updateAdaptiveModeForUser({
      db, actor, sessionId, requestKey: uuid(90), expectedRevision: 0, body: requestBody(),
    })
    expect(guided).toMatchObject({ ok: true, revision: 1, state: { mode: 'guided' } })

    const manual = await updateAdaptiveModeForUser({
      db,
      actor,
      sessionId,
      requestKey: uuid(91),
      expectedRevision: 1,
      body: requestBody({ requestKey: uuid(91), expectedRevision: 1, mode: 'manual' }),
    })
    expect(manual).toMatchObject({ ok: true, revision: 2, state: { mode: 'manual' } })

    const events = await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId))
    expect(events).toHaveLength(2)
    expect(events.map((event) => event.requestActorProfileId)).toEqual([actor.profileId, actor.profileId])
    expect(events.map((event) => event.aiResponse?.adaptiveModeChange)).toMatchObject([
      { schemaVersion: 1, from: 'manual', to: 'guided', revision: 1, state: { mode: 'guided' } },
      { schemaVersion: 1, from: 'guided', to: 'manual', revision: 2, state: { mode: 'manual' } },
    ])
  })

  it('returns the canonical result for the same actor, request key, and fingerprint', async () => {
    const input = { db, actor, sessionId, requestKey: uuid(90), expectedRevision: 0, body: requestBody() }
    const first = await updateAdaptiveModeForUser(input)
    const replay = await updateAdaptiveModeForUser(input)

    expect(replay).toEqual(first)
    expect(await db.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId))).toHaveLength(1)
  })

  it('returns the immutable original response when replayed after a later mutation', async () => {
    const originalInput = {
      db,
      actor,
      sessionId,
      requestKey: uuid(90),
      expectedRevision: 0,
      body: requestBody(),
    }
    const original = await updateAdaptiveModeForUser(originalInput)
    await updateAdaptiveModeForUser({
      db,
      actor,
      sessionId,
      requestKey: uuid(91),
      expectedRevision: 1,
      body: requestBody({ requestKey: uuid(91), expectedRevision: 1, mode: 'manual' }),
    })

    const replay = await updateAdaptiveModeForUser(originalInput)

    expect(replay).toEqual(original)
    const [current] = await db.select().from(sessions).where(eq(sessions.id, sessionId))
    expect(current.adaptiveRevision).toBe(2)
    expect(current.adaptiveDiagnosticState?.mode).toBe('manual')
  })

  it('reauthorizes current actor eligibility before returning a replay snapshot', async () => {
    const input = {
      db,
      actor,
      sessionId,
      requestKey: uuid(90),
      expectedRevision: 0,
      body: requestBody(),
    }
    await updateAdaptiveModeForUser(input)
    await db.update(profiles).set({ deactivatedAt: new Date() })
      .where(eq(profiles.id, actor.profileId))

    await expect(updateAdaptiveModeForUser(input)).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'not_eligible',
    })
  })

  it('locks the session and authorizes the current actor before replay lookup', async () => {
    const input = {
      db,
      actor,
      sessionId,
      requestKey: uuid(90),
      expectedRevision: 0,
      body: requestBody(),
    }
    const original = await updateAdaptiveModeForUser(input)
    const queries: string[] = []
    const session = (db as unknown as {
      _: { session: { options: { logger?: { logQuery(query: string): void } } } }
    })._.session
    const previousLogger = session.options.logger
    session.options.logger = { logQuery: (query) => queries.push(query) }

    try {
      await expect(updateAdaptiveModeForUser(input)).resolves.toEqual(original)
    } finally {
      session.options.logger = previousLogger
    }

    const authorizationIndex = queries.findIndex((query) => (
      query.includes('inner join "ticket_jobs"')
      && query.includes('inner join "profiles"')
    ))
    const replayIndex = queries.findIndex((query) => query.includes('from "session_events"'))

    expect(queries[0]).toMatch(/from "sessions".*for update/i)
    expect(authorizationIndex).toBeGreaterThan(0)
    expect(replayIndex).toBeGreaterThan(authorizationIndex)
  })

  it('rejects an authorized new actor reusing the prior actor request key', async () => {
    const input = {
      db,
      actor,
      sessionId,
      requestKey: uuid(90),
      expectedRevision: 0,
      body: requestBody(),
    }
    await updateAdaptiveModeForUser(input)
    await db.update(sessions).set({ techId: otherActor.profileId })
      .where(eq(sessions.id, sessionId))
    await db.update(ticketJobs).set({ assignedTechId: otherActor.profileId })
      .where(eq(ticketJobs.id, jobId))
    await expect(authorizeAdaptiveMutation(db, {
      actor: otherActor,
      sessionId,
      expectedRevision: 1,
    }, adaptiveMutationDependencies)).resolves.toMatchObject({ sessionId, revision: 1 })

    await expect(updateAdaptiveModeForUser({ ...input, actor: otherActor })).resolves.toEqual({
      ok: false,
      status: 409,
      error: 'not_eligible',
    })
  })

  it('rejects changed mode, changed revision, and cross-actor reuse of a request key', async () => {
    await updateAdaptiveModeForUser({ db, actor, sessionId, requestKey: uuid(90), expectedRevision: 0, body: requestBody() })

    for (const input of [
      { actor, expectedRevision: 0, body: requestBody({ mode: 'manual' }) },
      { actor, expectedRevision: 1, body: requestBody({ expectedRevision: 1 }) },
      { actor: otherActor, expectedRevision: 1, body: requestBody({ expectedRevision: 1 }) },
    ]) {
      await expect(updateAdaptiveModeForUser({
        db, sessionId, requestKey: uuid(90), ...input,
      })).resolves.toEqual({ ok: false, status: 409, error: 'not_eligible' })
    }
  })

  it.each([
    ['feature disabled', async () => vi.stubEnv('SHOP_OS_ADAPTIVE_CANVAS_ENABLED', 'false')],
    ['unpaid actor', async () => db.update(stripeCustomers).set({ subscriptionStatus: 'unpaid' })],
    ['other technician', async () => undefined],
    ['other shop', async () => undefined],
    ['deactivated actor', async () => db.update(profiles).set({ deactivatedAt: new Date() }).where(eq(profiles.id, actor.profileId))],
    ['reassigned job', async () => db.update(ticketJobs).set({ assignedTechId: otherActor.profileId }).where(eq(ticketJobs.id, jobId))],
  ])('uniformly rejects %s', async (kind, mutate) => {
    await mutate()
    const inputActor = kind === 'other technician'
      ? otherActor
      : kind === 'other shop'
        ? { ...actor, shopId: otherShopId }
        : actor
    await expect(updateAdaptiveModeForUser({
      db, actor: inputActor, sessionId, requestKey: uuid(90), expectedRevision: 0, body: requestBody(),
    })).resolves.toEqual({ ok: false, status: 409, error: 'not_eligible' })
  })

  it('rejects stale revisions without writing an event', async () => {
    await db.update(sessions).set({ adaptiveRevision: 1 }).where(eq(sessions.id, sessionId))
    await expect(updateAdaptiveModeForUser({
      db, actor, sessionId, requestKey: uuid(90), expectedRevision: 0, body: requestBody(),
    })).resolves.toEqual({ ok: false, status: 409, error: 'not_eligible' })
    expect(await db.select().from(sessionEvents)).toHaveLength(0)
  })
})

describe('POST adaptive mode route gates', () => {
  const authMock = vi.mocked(requireUserAndProfile)
  const paywallMock = vi.mocked(paywallReject)
  const params = Promise.resolve({ id: uuid(30) })
  const request = () => new Request(`http://localhost/api/sessions/${uuid(30)}/adaptive/mode`, {
    method: 'POST',
    body: JSON.stringify(requestBody()),
    headers: { 'content-type': 'application/json' },
  })

  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(null)
    paywallMock.mockResolvedValue(null)
  })

  it('returns 401 before the paywall when unauthenticated', async () => {
    const response = await POST(request(), { params })
    expect(response.status).toBe(401)
    expect(paywallMock).not.toHaveBeenCalled()
  })

  it('returns the paywall denial before parsing or mutation', async () => {
    authMock.mockResolvedValue({
      user: { id: uuid(20), email: 'tech@example.com' },
      profile: { id: uuid(10), userId: uuid(20), shopId: uuid(1) } as never,
    })
    paywallMock.mockResolvedValue(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    const response = await POST(request(), { params })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'paywall' })
  })
})
