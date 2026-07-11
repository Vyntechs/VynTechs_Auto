import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/intake/quick-ticket', () => ({ createQuickTicket: vi.fn() }))

import { POST } from '@/app/api/tickets/quick/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { createQuickTicket } from '@/lib/intake/quick-ticket'
import { rateLimitReject } from '@/lib/rate-limit'

const profile = {
  id: '00000000-0000-0000-0000-000000000201',
  userId: '00000000-0000-0000-0000-000000000301',
  shopId: '00000000-0000-0000-0000-000000000401',
  fullName: 'Avery Advisor',
  role: 'advisor',
  skillTier: 2,
  membershipStatus: 'active' as const,
  membershipActivatedAt: new Date('2026-07-10T12:00:00Z'),
  isComp: false,
  isCurator: false,
  lastSeenWhatsNewAt: null,
  deactivatedAt: null,
  createdAt: new Date('2026-07-10T12:00:00Z'),
}
const authContext = {
  profile,
  user: { id: profile.userId, email: 'avery@shop.test' },
}
const actor = {
  profileId: profile.id,
  shopId: profile.shopId,
  role: profile.role,
  skillTier: profile.skillTier,
  membershipStatus: profile.membershipStatus,
  deactivatedAt: profile.deactivatedAt,
}
const body = {
  clientKey: '00000000-0000-4000-8000-000000000701',
  vehicleMode: 'existing',
  existingVehicleId: '00000000-0000-0000-0000-000000000501',
  quote: { mode: 'manual', kind: 'repair', description: 'Brake vibration' },
}

const authMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const rateLimitMock = vi.mocked(rateLimitReject)
const handlerMock = vi.mocked(createQuickTicket)

function request(payload: unknown): Request {
  return new Request('http://localhost/api/tickets/quick', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

describe('POST /api/tickets/quick', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(authContext)
    paywallMock.mockResolvedValue(null)
    rateLimitMock.mockResolvedValue(null)
  })

  it('authenticates before parsing or consuming quota', async () => {
    authMock.mockResolvedValue(null)
    const response = await POST(request('not json{'))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(paywallMock).not.toHaveBeenCalled()
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(handlerMock).not.toHaveBeenCalled()
  })

  it('checks the paywall before parsing or consuming quota', async () => {
    paywallMock.mockResolvedValue(
      NextResponse.json({ error: 'paywall', reason: 'past_due' }, { status: 403 }),
    )
    const response = await POST(request('not json{'))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'paywall', reason: 'past_due' })
    expect(paywallMock).toHaveBeenCalledWith({}, profile.userId)
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(handlerMock).not.toHaveBeenCalled()
  })

  it('returns invalid_json before consuming quota', async () => {
    const response = await POST(request('not json{'))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' })
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(handlerMock).not.toHaveBeenCalled()
  })

  it('uses the shared intake quota after parsing', async () => {
    rateLimitMock.mockResolvedValue(
      NextResponse.json(
        { error: 'rate_limited', resetAt: '2026-07-10T12:01:00.000Z' },
        { status: 429 },
      ),
    )
    const response = await POST(request(body))
    expect(rateLimitMock).toHaveBeenCalledWith({}, `intake:${profile.userId}`, 10)
    expect(response.status).toBe(429)
    expect(handlerMock).not.toHaveBeenCalled()
  })

  it.each(['tech', 'advisor', 'parts', 'owner'])('translates an active %s actor to the handler', async (role) => {
    authMock.mockResolvedValue({ ...authContext, profile: { ...profile, role } })
    const ticket = { id: '00000000-0000-0000-0000-000000000601', ticketNumber: 1 }
    handlerMock.mockResolvedValue({ ok: true, ticket } as never)

    const response = await POST(request(body))

    expect(handlerMock).toHaveBeenCalledWith({}, { actor: { ...actor, role }, body })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ ticket: { id: ticket.id } })
  })

  it.each([
    ['invalid_input', 422],
    ['not_found', 404],
    ['forbidden', 403],
    ['no_shop', 403],
    ['inactive_profile', 403],
  ] as const)('maps %s to status %i and its exact envelope', async (error, status) => {
    handlerMock.mockResolvedValue({ ok: false, error })
    const response = await POST(request(body))
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ error })
  })

  it('preserves definitive stale context as an exact non-retryable conflict', async () => {
    handlerMock.mockResolvedValue({ ok: false, error: 'conflict', retryable: false })
    const response = await POST(request(body))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'conflict', retryable: false })
  })
})
