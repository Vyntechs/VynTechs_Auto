import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))
// The route's persistence runs `db.update(...).set(...).where(...)`. Default the
// db mock to a chainable no-op so the non-persistence cases don't throw; the
// happy-path test swaps in a spy to assert what we persisted.
const setSpy = vi.fn(() => ({ where: vi.fn(async () => undefined) }))
const updateSpy = vi.fn()
vi.mock('@/lib/db/client', () => ({
  db: { update: vi.fn(() => {
    updateSpy()
    return { set: setSpy }
  }) },
}))
// Paywall runs against a real DB in production; with the stubbed db here it
// would throw, so we stub it. Default = allowed (null). One test overrides it.
vi.mock('@/lib/auth-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth-access')>()),
  entitlementReject: vi.fn(async () => null),
}))
vi.mock('@/lib/sessions', () => ({
  getSessionForUser: vi.fn(),
}))
vi.mock('@/lib/flows/lookup', () => ({
  getFlowVersionById: vi.fn(),
}))

import { POST } from '@/app/api/sessions/[id]/wizard-state/route'
import { requireUserAndProfile } from '@/lib/auth'
import { entitlementReject } from '@/lib/auth-access'
import { getSessionForUser } from '@/lib/sessions'
import { getFlowVersionById } from '@/lib/flows/lookup'
import { isDiagnosticsGatedRoute } from '@/lib/auth-access'
import type { WizardState } from '@/lib/flows/types'

const requireUserMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(entitlementReject)
const getSessionMock = vi.mocked(getSessionForUser)
const getFlowMock = vi.mocked(getFlowVersionById)

const SESSION_ID = '00000000-0000-0000-0000-0000000000aa'
const FLOW_VERSION_ID = '00000000-0000-0000-0000-0000000000bb'

function makeReq(body: unknown): Request {
  return new Request(`http://localhost/api/sessions/${SESSION_ID}/wizard-state`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const params = Promise.resolve({ id: SESSION_ID })

function postedState(overrides: Partial<WizardState> = {}): WizardState {
  return {
    flowVersionId: FLOW_VERSION_ID,
    stepId: 'q1',
    history: [],
    finding: null,
    ...overrides,
  }
}

// A minimal but type-correct getSessionForUser ok-result. Only treeState matters
// to the route; the rest of the session row is irrelevant to the assertions.
function okSession(treeStateOverrides: Record<string, unknown> = {}) {
  return {
    ok: true as const,
    session: {
      treeState: {
        nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
        currentNodeId: 'root',
        message: 'go',
        phase: 'diagnosing',
        ...treeStateOverrides,
      },
    },
  } as unknown as Awaited<ReturnType<typeof getSessionForUser>>
}

function flowWithStep(stepId: string) {
  return {
    flowId: 'f1',
    flowVersionId: FLOW_VERSION_ID,
    versionNumber: 1,
    bodySchemaVersion: '6.0',
    body: { startStepId: stepId, steps: { [stepId]: { kind: 'question' } } },
  } as unknown as Awaited<ReturnType<typeof getFlowVersionById>>
}

describe('POST /api/sessions/[id]/wizard-state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue({
      profile: {
        id: 'p1',
        userId: 'u1',
        shopId: 's1',
        fullName: 'Owner',
        role: 'owner',
        skillTier: null,
        membershipStatus: 'active',
        membershipActivatedAt: new Date(),
        isComp: false,
        isCurator: false,
        lastSeenWhatsNewAt: null,
        deactivatedAt: null,
        createdAt: new Date(),
      },
      user: { id: 'u1', email: 'owner@shop.test' },
    })
    paywallMock.mockResolvedValue(null)
    getSessionMock.mockResolvedValue(okSession())
    getFlowMock.mockResolvedValue(flowWithStep('q1'))
  })

  it('returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValue(null)
    const res = await POST(makeReq(postedState()), { params })
    expect(res.status).toBe(401)
  })

  it('returns the paywall 403 and does not proceed when access is denied', async () => {
    expect(
      isDiagnosticsGatedRoute(`/api/sessions/${SESSION_ID}/wizard-state`),
    ).toBe(true)
    paywallMock.mockResolvedValue(
      NextResponse.json({ error: 'deactivated' }, { status: 403 }),
    )
    const res = await POST(makeReq(postedState()), { params })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'deactivated' })
    // A deactivated user must not be able to drive the wizard.
    expect(getSessionMock).not.toHaveBeenCalled()
    expect(getFlowMock).not.toHaveBeenCalled()
    expect(updateSpy).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('returns 400 malformed when the body lacks flowVersionId/stepId', async () => {
    const res = await POST(makeReq({ history: [], finding: null }), { params })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'malformed wizard state' })
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('returns 400 (not 500) when the request body is not valid JSON', async () => {
    const req = new Request(`http://localhost/api/sessions/${SESSION_ID}/wizard-state`, {
      method: 'POST',
      body: 'not json{',
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'malformed wizard state' })
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('passes through getSessionForUser failure status (404)', async () => {
    getSessionMock.mockResolvedValue({ ok: false, status: 404, error: 'not found' })
    const res = await POST(makeReq(postedState()), { params })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('returns 409 when the session is already in the repairing phase', async () => {
    getSessionMock.mockResolvedValue(okSession({ phase: 'repairing' }))
    const res = await POST(makeReq(postedState()), { params })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'session already locked' })
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('returns 409 with version pin mismatch when the posted flowVersionId differs from the session-pinned one', async () => {
    // Session already has a pinned version ('pinned-A'); client posts a different one ('different-B').
    // The route must reject before reaching getFlowVersionById or db.update (spec §3.2).
    const PINNED_VERSION = 'pinned-A'
    const DIFFERENT_VERSION = 'different-B'
    getSessionMock.mockResolvedValue({
      ok: true as const,
      session: {
        treeState: {
          nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
          currentNodeId: 'root',
          message: 'go',
          phase: 'diagnosing',
          diagnosisLockedAt: null,
        },
        wizardState: {
          flowVersionId: PINNED_VERSION,
          stepId: 's1',
          history: [],
          finding: null,
        },
      },
    } as unknown as Awaited<ReturnType<typeof getSessionForUser>>)
    const body = postedState({ flowVersionId: DIFFERENT_VERSION, stepId: 'q1' })
    const res = await POST(makeReq(body), { params })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'version pin mismatch' })
    // The guard must short-circuit before the flow lookup and the db write.
    expect(getFlowMock).not.toHaveBeenCalled()
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('returns 200 on the happy path when the posted flowVersionId matches the session-pinned one', async () => {
    // Matching version: not a mismatch, must pass through normally.
    getSessionMock.mockResolvedValue({
      ok: true as const,
      session: {
        treeState: {
          nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
          currentNodeId: 'root',
          message: 'go',
          phase: 'diagnosing',
          diagnosisLockedAt: null,
        },
        wizardState: {
          flowVersionId: FLOW_VERSION_ID,
          stepId: 'q1',
          history: [],
          finding: null,
        },
      },
    } as unknown as Awaited<ReturnType<typeof getSessionForUser>>)
    const body = postedState({ stepId: 'q1' })
    const res = await POST(makeReq(body), { params })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenCalledWith({ wizardState: body })
    expect(paywallMock.mock.invocationCallOrder[0]).toBeLessThan(
      updateSpy.mock.invocationCallOrder[0],
    )
  })

  it('returns 200 on first save when the session has no prior wizardState (null)', async () => {
    // wizardState is null: no pinned version yet, so no mismatch check applies.
    getSessionMock.mockResolvedValue({
      ok: true as const,
      session: {
        treeState: {
          nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' }],
          currentNodeId: 'root',
          message: 'go',
          phase: 'diagnosing',
          diagnosisLockedAt: null,
        },
        wizardState: null,
      },
    } as unknown as Awaited<ReturnType<typeof getSessionForUser>>)
    const body = postedState({ stepId: 'q1' })
    const res = await POST(makeReq(body), { params })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(setSpy).toHaveBeenCalledTimes(1)
  })

  it('returns 400 unknown flow version when the pinned version is missing', async () => {
    getFlowMock.mockResolvedValue(null)
    const res = await POST(makeReq(postedState()), { params })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'unknown flow version' })
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('returns 400 stepId not in flow when the pinned body has no such step', async () => {
    getFlowMock.mockResolvedValue(flowWithStep('some-other-step'))
    const res = await POST(makeReq(postedState({ stepId: 'q1' })), { params })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'stepId not in flow' })
    expect(setSpy).not.toHaveBeenCalled()
  })

  it('persists the posted state and returns 200 on the happy path', async () => {
    const body = postedState({ stepId: 'q1' })
    const res = await POST(makeReq(body), { params })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(setSpy).toHaveBeenCalledWith({ wizardState: body })
  })
})
