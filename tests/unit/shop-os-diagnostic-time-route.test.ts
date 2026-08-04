import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/tickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tickets')>()
  return { ...actual, addSupplementalDiagnosticTime: vi.fn() }
})

import { POST } from '@/app/api/tickets/[id]/quote/diagnostic-time/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { addSupplementalDiagnosticTime } from '@/lib/tickets'

const PROFILE_ID = '00000000-0000-4000-8000-000000000001'
const USER_ID = '00000000-0000-4000-8000-000000000101'
const TICKET_ID = '00000000-0000-4000-8000-000000000401'
const TECH_ID = '00000000-0000-4000-8000-000000000012'
const CLIENT_KEY = '00000000-0000-4000-8000-000000000701'
const JOB_ID = '00000000-0000-8000-8000-000000000801'

const profile = { id: PROFILE_ID, userId: USER_ID, role: 'advisor' }
const authContext = { profile, user: { id: USER_ID, email: 'advisor@shop.test' } }
const validBody = {
  clientKey: CLIENT_KEY,
  description: 'Additional diagnostic time',
  laborHours: 1.5,
  priceCents: 28_125,
}

const authMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const domainMock = vi.mocked(addSupplementalDiagnosticTime)

function request(body?: unknown, raw?: string) {
  return new Request(`http://localhost/api/tickets/${TICKET_ID}/quote/diagnostic-time`, {
    method: 'POST',
    ...(body !== undefined || raw !== undefined
      ? { body: raw ?? JSON.stringify(body), headers: { 'content-type': 'application/json' } }
      : {}),
  })
}
const params = () => ({ params: Promise.resolve({ id: TICKET_ID }) })

describe('Shop OS supplemental diagnostic-time route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(authContext as never)
    paywallMock.mockResolvedValue(null)
  })

  it('rejects an unauthenticated caller before any domain access', async () => {
    authMock.mockResolvedValue(null)
    const response = await POST(request(validBody), params())
    expect(response.status).toBe(401)
    expect(domainMock).not.toHaveBeenCalled()
  })

  it('hides the entrance from callers who cannot assign work', async () => {
    authMock.mockResolvedValue({ ...authContext, profile: { ...profile, role: 'tech' } } as never)
    const response = await POST(request(validBody), params())
    expect(response.status).toBe(404)
    expect(domainMock).not.toHaveBeenCalled()
  })

  it('honours the paywall before any domain access', async () => {
    paywallMock.mockResolvedValue(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    const response = await POST(request(validBody), params())
    expect(response.status).toBe(403)
    expect(domainMock).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON before any mutation', async () => {
    const response = await POST(request(undefined, 'bad{'), params())
    expect(response.status).toBe(400)
    expect(domainMock).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', { description: 'Additional diagnostic time', laborHours: 1, priceCents: 12_000 }],
    ['malformed', { ...validBody, clientKey: 'not-a-uuid' }],
  ])('refuses a %s client key before domain access', async (_label, body) => {
    const response = await POST(request(body), params())
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'invalid_input' })
    expect(domainMock).not.toHaveBeenCalled()
  })

  it('forwards the ticket id and raw body and returns the created ticket', async () => {
    const confirmation = {
      clientKey: CLIENT_KEY,
      jobId: JOB_ID,
      title: 'Additional diagnostic time',
      laborHours: 1.5,
      priceCents: 28_125,
    }
    domainMock.mockResolvedValue({
      ok: true,
      confirmation,
      ticket: { id: TICKET_ID, ticketNumber: 7, jobs: [] },
    } as never)
    const response = await POST(request(validBody), params())
    expect(response.status).toBe(201)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(domainMock).toHaveBeenCalledWith({}, expect.objectContaining({
      ticketId: TICKET_ID,
      body: validBody,
    }))
    expect((domainMock.mock.calls[0][1].body as typeof validBody).clientKey).toBe(CLIENT_KEY)
    const body = await response.json()
    expect(body).toEqual({ confirmation, ticket: { id: TICKET_ID, ticketNumber: 7, jobs: [] } })
  })

  it('passes the below-tier warning through with a 409', async () => {
    domainMock.mockResolvedValue({
      ok: false,
      error: 'tier_confirmation_required',
      warning: { code: 'below_required_tier', assignedTechId: TECH_ID, assignedSkillTier: 1, requiredSkillTier: 2 },
    } as never)
    const response = await POST(request(validBody), params())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'tier_confirmation_required',
      warning: { code: 'below_required_tier', assignedTechId: TECH_ID, assignedSkillTier: 1, requiredSkillTier: 2 },
    })
  })

  it('preserves retryable lock contention in the 409 response', async () => {
    domainMock.mockResolvedValue({
      ok: false,
      error: 'conflict',
      retryable: true,
    } as never)
    const response = await POST(request(validBody), params())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'conflict', retryable: true })
  })

  it.each([
    ['invalid_input', 422],
    ['not_found', 404],
    ['ticket_not_open', 409],
    ['job_limit_reached', 409],
  ] as const)('maps the %s domain failure to %d', async (error, status) => {
    domainMock.mockResolvedValue({ ok: false, error } as never)
    const response = await POST(request(validBody), params())
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error })
  })
})
