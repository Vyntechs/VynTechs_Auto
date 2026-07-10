import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))
// Paywall stubbed to no-op (allowed) by default; one test overrides it.
vi.mock('@/lib/auth-access', () => ({
  paywallReject: vi.fn(async () => null),
}))
vi.mock('@/lib/sessions', () => ({
  lockDiagnosisFromWizard: vi.fn(),
}))

import { POST } from '@/app/api/sessions/[id]/lock-in-diagnosis/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { lockDiagnosisFromWizard } from '@/lib/sessions'
import type { Finding } from '@/lib/flows/types'

const requireUserMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const lockMock = vi.mocked(lockDiagnosisFromWizard)

const SESSION_ID = '00000000-0000-0000-0000-0000000000aa'
const FLOW_VERSION_ID = '00000000-0000-0000-0000-0000000000bb'

const finding: Finding = {
  verdict: 'HPO leak',
  action: 'Air test',
  expectedSignal: 'audible leak',
  severity: 'fixable',
}

function makeReq(body: unknown): Request {
  return new Request(`http://localhost/api/sessions/${SESSION_ID}/lock-in-diagnosis`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const params = Promise.resolve({ id: SESSION_ID })

function validBody(overrides: Record<string, unknown> = {}) {
  return { finding, history: [], flowVersionId: FLOW_VERSION_ID, ...overrides }
}

describe('POST /api/sessions/[id]/lock-in-diagnosis', () => {
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
        isComp: false,
        isCurator: false,
        lastSeenWhatsNewAt: null,
        deactivatedAt: null,
        createdAt: new Date(),
      },
      user: { id: 'u1', email: 'owner@shop.test' },
    })
    paywallMock.mockResolvedValue(null)
    lockMock.mockResolvedValue({ ok: true })
  })

  it('returns 401 when unauthenticated', async () => {
    requireUserMock.mockResolvedValue(null)
    const res = await POST(makeReq(validBody()), { params })
    expect(res.status).toBe(401)
    expect(lockMock).not.toHaveBeenCalled()
  })

  it('returns the paywall 403 and does not lock in when access is denied', async () => {
    paywallMock.mockResolvedValue(
      NextResponse.json({ error: 'deactivated' }, { status: 403 }),
    )
    const res = await POST(makeReq(validBody()), { params })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'deactivated' })
    expect(lockMock).not.toHaveBeenCalled()
  })

  it('returns 400 malformed when finding.verdict is missing', async () => {
    const res = await POST(
      makeReq(validBody({ finding: { action: 'Air test', severity: 'fixable' } })),
      { params },
    )
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'malformed lock-in payload' })
    expect(lockMock).not.toHaveBeenCalled()
  })

  it('returns 400 malformed when finding.action is missing', async () => {
    const res = await POST(
      makeReq(validBody({ finding: { verdict: 'HPO leak', severity: 'fixable' } })),
      { params },
    )
    expect(res.status).toBe(400)
    expect(lockMock).not.toHaveBeenCalled()
  })

  it('returns 400 malformed when flowVersionId is missing', async () => {
    const res = await POST(makeReq(validBody({ flowVersionId: undefined })), { params })
    expect(res.status).toBe(400)
    expect(lockMock).not.toHaveBeenCalled()
  })

  it('returns 400 (not 500) when the request body is not valid JSON', async () => {
    const req = new Request(`http://localhost/api/sessions/${SESSION_ID}/lock-in-diagnosis`, {
      method: 'POST',
      body: 'not json{',
      headers: { 'content-type': 'application/json' },
    })
    const res = await POST(req, { params })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'malformed lock-in payload' })
    expect(lockMock).not.toHaveBeenCalled()
  })

  it('maps helper "not found" to 404', async () => {
    lockMock.mockResolvedValue({ ok: false, status: 404, error: 'not found' })
    const res = await POST(makeReq(validBody()), { params })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not found' })
  })

  it('maps helper "session is not open" to 400', async () => {
    lockMock.mockResolvedValue({ ok: false, status: 400, error: 'session is not open' })
    const res = await POST(makeReq(validBody()), { params })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'session is not open' })
  })

  it('remaps helper "diagnosis already locked" (400) to 409', async () => {
    lockMock.mockResolvedValue({ ok: false, status: 400, error: 'diagnosis already locked' })
    const res = await POST(makeReq(validBody()), { params })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'diagnosis already locked' })
  })

  it('returns 200 with redirectTo and forwards the payload to the helper', async () => {
    const res = await POST(makeReq(validBody()), { params })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, redirectTo: `/sessions/${SESSION_ID}` })
    expect(lockMock).toHaveBeenCalledTimes(1)
    expect(lockMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'u1',
        sessionId: SESSION_ID,
        finding,
        history: [],
        flowVersionId: FLOW_VERSION_ID,
      }),
    )
  })
})
