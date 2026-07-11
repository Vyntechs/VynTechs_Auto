import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/db/queries', () => ({
  countOpenSessionsForTech: vi.fn(),
  getOpenSessionForTech: vi.fn(),
}))
vi.mock('@/lib/diagnostics/initial-tree-bootstrap', () => ({
  generateInitialDiagnosticTree: vi.fn(),
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimitReject: vi.fn() }))
vi.mock('@/lib/shop-os/diagnostic-start', () => ({
  acquireDiagnosticStart: vi.fn(),
  finalizeDiagnosticStart: vi.fn(),
  recordDiagnosticStartFailure: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))

import { POST, maxDuration } from '@/app/api/tickets/[id]/jobs/[jobId]/diagnostic/start/route'
import { paywallReject } from '@/lib/auth-access'
import { requireUserAndProfile } from '@/lib/auth'
import {
  countOpenSessionsForTech,
  getOpenSessionForTech,
} from '@/lib/db/queries'
import { generateInitialDiagnosticTree } from '@/lib/diagnostics/initial-tree-bootstrap'
import { rateLimitReject } from '@/lib/rate-limit'
import {
  acquireDiagnosticStart,
  finalizeDiagnosticStart,
  recordDiagnosticStartFailure,
} from '@/lib/shop-os/diagnostic-start'

const USER_ID = '00000000-0000-4000-8000-000000000001'
const PROFILE_ID = '00000000-0000-4000-8000-000000000002'
const SHOP_ID = '00000000-0000-4000-8000-000000000003'
const TICKET_ID = '00000000-0000-4000-8000-000000000004'
const JOB_ID = '00000000-0000-4000-8000-000000000005'
const ATTEMPT_KEY = '00000000-0000-4000-8000-000000000006'
const SESSION_ID = '00000000-0000-4000-8000-000000000007'

const profile = {
  id: PROFILE_ID,
  userId: USER_ID,
  shopId: SHOP_ID,
  fullName: 'Taylor Tech',
  role: 'tech',
  skillTier: 2,
  membershipStatus: 'active',
  membershipActivatedAt: new Date('2026-07-10T12:00:00Z'),
  isComp: false,
  isCurator: false,
  lastSeenWhatsNewAt: null,
  deactivatedAt: null,
  createdAt: new Date('2026-07-10T12:00:00Z'),
}
const authContext = {
  profile,
  user: { id: USER_ID, email: 'taylor@shop.test' },
}
const actor = { profileId: PROFILE_ID, shopId: SHOP_ID }
const intake = {
  vehicleYear: 2018,
  vehicleMake: 'Ford',
  vehicleModel: 'F-150',
  vehicleEngine: '3.5L EcoBoost',
  mileage: 85_210,
  customerComplaint: 'Loss of power under load',
}
const acquired = {
  ok: true as const,
  state: 'initializing' as const,
  leaseAcquired: true as const,
  attemptKey: ATTEMPT_KEY,
  leaseUntil: new Date('2026-07-10T12:02:00Z'),
  context: { vehicleId: '00000000-0000-4000-8000-000000000008', intake },
}
const treeState = {
  nodes: [{ id: 'root', label: 'Inspect concern', status: 'active' as const }],
  currentNodeId: 'root',
  message: 'Begin inspection',
  done: false,
}

const authMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const acquireMock = vi.mocked(acquireDiagnosticStart)
const quotaMock = vi.mocked(rateLimitReject)
const countMock = vi.mocked(countOpenSessionsForTech)
const openMock = vi.mocked(getOpenSessionForTech)
const initializerMock = vi.mocked(generateInitialDiagnosticTree)
const finalizeMock = vi.mocked(finalizeDiagnosticStart)
const settleMock = vi.mocked(recordDiagnosticStartFailure)

function request(payload: unknown): Request {
  return new Request(
    `http://localhost/api/tickets/${TICKET_ID}/jobs/${JOB_ID}/diagnostic/start`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof payload === 'string' ? payload : JSON.stringify(payload),
    },
  )
}

const params = () => ({ params: Promise.resolve({ id: TICKET_ID, jobId: JOB_ID }) })

describe('POST ticket job diagnostic start', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(authContext as never)
    paywallMock.mockResolvedValue(null)
    acquireMock.mockResolvedValue(acquired)
    quotaMock.mockResolvedValue(null)
    countMock.mockResolvedValue(0)
    initializerMock.mockResolvedValue(treeState)
    finalizeMock.mockResolvedValue({ ok: true, state: 'ready', sessionId: ATTEMPT_KEY })
    settleMock.mockResolvedValue({ ok: true, state: 'failed' })
  })

  it('keeps the full diagnostic route inside the existing 60-second envelope', () => {
    expect(maxDuration).toBe(60)
  })

  it('authenticates before paywall, parsing, acquire, or paid work', async () => {
    authMock.mockResolvedValue(null)

    const response = await POST(request('not json{'), params())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(paywallMock).not.toHaveBeenCalled()
    expect(acquireMock).not.toHaveBeenCalled()
    expect(initializerMock).not.toHaveBeenCalled()
  })

  it('returns the paywall response before parsing, acquire, or paid work', async () => {
    paywallMock.mockResolvedValue(
      NextResponse.json({ error: 'paywall', reason: 'past_due' }, { status: 403 }),
    )

    const response = await POST(request('not json{'), params())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'paywall', reason: 'past_due' })
    expect(paywallMock).toHaveBeenCalledWith({}, USER_ID)
    expect(acquireMock).not.toHaveBeenCalled()
    expect(initializerMock).not.toHaveBeenCalled()
  })

  it('returns uniform not_found for an authenticated null-shop profile before domain access', async () => {
    authMock.mockResolvedValue({
      ...authContext,
      profile: { ...profile, shopId: null },
    } as never)

    const response = await POST(request({ attemptKey: ATTEMPT_KEY }), params())

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
    expect(acquireMock).not.toHaveBeenCalled()
    expect(quotaMock).not.toHaveBeenCalled()
    expect(initializerMock).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid JSON', 'not json{'],
    ['non-UUID attempt key', { attemptKey: 'not-a-uuid' }],
    ['unknown field', { attemptKey: ATTEMPT_KEY, extra: true }],
    ['non-boolean confirmation', { attemptKey: ATTEMPT_KEY, confirmAmbiguousRetry: 'yes' }],
  ])('strictly rejects %s before acquire or any guard/provider work', async (_label, body) => {
    const response = await POST(request(body), params())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' })
    expect(acquireMock).not.toHaveBeenCalled()
    expect(quotaMock).not.toHaveBeenCalled()
    expect(initializerMock).not.toHaveBeenCalled()
  })

  it('acquires with the authenticated actor and explicit retry confirmation before quota or cap', async () => {
    await POST(request({ attemptKey: ATTEMPT_KEY, confirmAmbiguousRetry: true }), params())

    expect(acquireMock).toHaveBeenCalledWith({}, {
      actor,
      ticketId: TICKET_ID,
      jobId: JOB_ID,
      attemptKey: ATTEMPT_KEY,
      confirmAmbiguousRetry: true,
    })
    expect(acquireMock.mock.invocationCallOrder[0]).toBeLessThan(quotaMock.mock.invocationCallOrder[0])
    expect(quotaMock.mock.invocationCallOrder[0]).toBeLessThan(countMock.mock.invocationCallOrder[0])
  })

  it('returns an owned ready session before quota, cap, or initializer work', async () => {
    acquireMock.mockResolvedValue({ ok: true, state: 'ready', sessionId: SESSION_ID })

    const response = await POST(request({ attemptKey: ATTEMPT_KEY }), params())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ state: 'ready', sessionId: SESSION_ID })
    expect(quotaMock).not.toHaveBeenCalled()
    expect(countMock).not.toHaveBeenCalled()
    expect(initializerMock).not.toHaveBeenCalled()
  })

  it('returns live initialization guidance before quota, cap, or initializer work', async () => {
    acquireMock.mockResolvedValue({ ok: true, state: 'initializing', leaseAcquired: false })

    const response = await POST(request({ attemptKey: ATTEMPT_KEY }), params())

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      state: 'initializing',
      retryAfterSeconds: 5,
    })
    expect(quotaMock).not.toHaveBeenCalled()
    expect(countMock).not.toHaveBeenCalled()
    expect(initializerMock).not.toHaveBeenCalled()
  })

  it('returns the possible-duplicate-cost warning before quota, cap, or initializer work', async () => {
    acquireMock.mockResolvedValue({ ok: true, state: 'ambiguous' })

    const response = await POST(request({ attemptKey: ATTEMPT_KEY }), params())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      state: 'ambiguous',
      warning: 'possible_duplicate_cost',
    })
    expect(quotaMock).not.toHaveBeenCalled()
    expect(countMock).not.toHaveBeenCalled()
    expect(initializerMock).not.toHaveBeenCalled()
  })

  it.each([
    [{ ok: false as const, status: 404 as const, error: 'not found' as const }, 404, 'not_found'],
    [{ ok: false as const, status: 409 as const, error: 'start unavailable' as const }, 409, 'start_unavailable'],
  ])('maps a safe acquire rejection without provider work', async (result, status, error) => {
    acquireMock.mockResolvedValue(result)

    const response = await POST(request({ attemptKey: ATTEMPT_KEY }), params())

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ error })
    expect(quotaMock).not.toHaveBeenCalled()
    expect(countMock).not.toHaveBeenCalled()
    expect(initializerMock).not.toHaveBeenCalled()
  })

  it('uses the exact shared intake quota only for a lease winner and records a certain rejection', async () => {
    quotaMock.mockResolvedValue(
      NextResponse.json({ error: 'rate_limited', resetAt: '2026-07-10T12:01:00.000Z' }, { status: 429 }),
    )

    const response = await POST(request({ attemptKey: ATTEMPT_KEY }), params())

    expect(quotaMock).toHaveBeenCalledWith({}, `intake:${USER_ID}`, 10)
    expect(countMock).not.toHaveBeenCalled()
    expect(initializerMock).not.toHaveBeenCalled()
    expect(settleMock).toHaveBeenCalledWith({}, {
      actor,
      ticketId: TICKET_ID,
      jobId: JOB_ID,
      attemptKey: ATTEMPT_KEY,
      certainty: 'certain',
      errorCode: 'rate_limited',
    })
    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'rate_limited',
      resetAt: '2026-07-10T12:01:00.000Z',
    })
  })

  it('enforces the existing five-open-session cap before initializer work and records certain failure', async () => {
    countMock.mockResolvedValue(5)
    openMock.mockResolvedValue({ id: SESSION_ID } as never)

    const response = await POST(request({ attemptKey: ATTEMPT_KEY }), params())

    expect(countMock).toHaveBeenCalledWith({}, PROFILE_ID)
    expect(openMock).toHaveBeenCalledWith({}, PROFILE_ID)
    expect(initializerMock).not.toHaveBeenCalled()
    expect(settleMock).toHaveBeenCalledWith({}, {
      actor,
      ticketId: TICKET_ID,
      jobId: JOB_ID,
      attemptKey: ATTEMPT_KEY,
      certainty: 'certain',
      errorCode: 'open_session_limit',
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'open_session_limit',
      openSessionId: SESSION_ID,
      limit: 5,
    })
  })

  it('delegates the full initialization topology unchanged and finalizes with the attempt key as session ID', async () => {
    const response = await POST(request({ attemptKey: ATTEMPT_KEY }), params())

    expect(initializerMock).toHaveBeenCalledWith({}, intake)
    expect(finalizeMock).toHaveBeenCalledWith({}, {
      actor,
      ticketId: TICKET_ID,
      jobId: JOB_ID,
      attemptKey: ATTEMPT_KEY,
      sessionId: ATTEMPT_KEY,
      context: acquired.context,
      treeState,
    })
    expect(initializerMock.mock.invocationCallOrder[0]).toBeLessThan(finalizeMock.mock.invocationCallOrder[0])
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ state: 'ready', sessionId: ATTEMPT_KEY })
  })

  it('records every initializer throw as uncertain and returns the ambiguous warning', async () => {
    initializerMock.mockRejectedValue(new Error('provider transport uncertainty'))
    settleMock.mockResolvedValue({ ok: true, state: 'ambiguous' })

    const response = await POST(request({ attemptKey: ATTEMPT_KEY }), params())

    expect(finalizeMock).not.toHaveBeenCalled()
    expect(settleMock).toHaveBeenCalledWith({}, {
      actor,
      ticketId: TICKET_ID,
      jobId: JOB_ID,
      attemptKey: ATTEMPT_KEY,
      certainty: 'uncertain',
      errorCode: 'initializer_outcome_uncertain',
    })
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      state: 'ambiguous',
      warning: 'possible_duplicate_cost',
    })
  })

  it.each([
    [{ ok: true as const, state: 'ready' as const, sessionId: SESSION_ID }, 200, { state: 'ready', sessionId: SESSION_ID }],
    [{ ok: true as const, state: 'initializing' as const, leaseAcquired: false as const }, 202, { state: 'initializing', retryAfterSeconds: 5 }],
    [{ ok: true as const, state: 'ambiguous' as const }, 409, { state: 'ambiguous', warning: 'possible_duplicate_cost' }],
    [{ ok: false as const, status: 404 as const, error: 'not found' as const }, 404, { error: 'not_found' }],
    [{ ok: false as const, status: 409 as const, error: 'start unavailable' as const }, 409, { error: 'start_unavailable' }],
  ])('maps a stale finalize result safely', async (result, status, envelope) => {
    finalizeMock.mockResolvedValue(result as never)

    const response = await POST(request({ attemptKey: ATTEMPT_KEY }), params())

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual(envelope)
  })

  it('uses a canonical stale settlement instead of leaking a superseded guard response', async () => {
    quotaMock.mockResolvedValue(NextResponse.json({ error: 'rate_limited' }, { status: 429 }))
    settleMock.mockResolvedValue({ ok: true, state: 'ready', sessionId: SESSION_ID })

    const response = await POST(request({ attemptKey: ATTEMPT_KEY }), params())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ state: 'ready', sessionId: SESSION_ID })
    expect(initializerMock).not.toHaveBeenCalled()
  })

  it.each([
    ['rate-limit guard', async () => {
      quotaMock.mockResolvedValue(NextResponse.json({ error: 'rate_limited' }, { status: 429 }))
    }],
    ['open-session guard', async () => {
      countMock.mockResolvedValue(5)
    }],
    ['initializer uncertainty', async () => {
      initializerMock.mockRejectedValue(new Error('provider transport uncertainty'))
    }],
    ['finalize uncertainty', async () => {
      finalizeMock.mockRejectedValue(new Error('database transport uncertainty'))
    }],
  ])('contains a rejected %s settlement behind one generic safe response', async (_label, arrange) => {
    await arrange()
    settleMock.mockRejectedValue(new Error('internal database details'))

    const response = await POST(request({ attemptKey: ATTEMPT_KEY }), params())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'start_unavailable' })
  })

  it('imports no provider, retrieval, topology, or cold-case implementation in the route', () => {
    const source = readFileSync(
      join(process.cwd(), 'app/api/tickets/[id]/jobs/[jobId]/diagnostic/start/route.ts'),
      'utf8',
    )

    expect(source).not.toMatch(/tree-engine|retrieval\/|resolve-platform|symptom-resolver|cold-case/)
    expect(source).toContain("@/lib/diagnostics/initial-tree-bootstrap")
  })
})
