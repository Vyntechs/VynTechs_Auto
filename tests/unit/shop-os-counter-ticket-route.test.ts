import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/intake/counter-ticket', () => ({ createCounterTicket: vi.fn() }))
vi.mock('@/lib/feature-flags', () => ({ isDesktopIntakeEnabled: vi.fn() }))

import { POST } from '@/app/api/tickets/counter/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { rateLimitReject } from '@/lib/rate-limit'
import { createCounterTicket } from '@/lib/intake/counter-ticket'
import { isDesktopIntakeEnabled } from '@/lib/feature-flags'

const profile = {
  id: '00000000-0000-0000-0000-000000000201',
  userId: '00000000-0000-0000-0000-000000000301',
  shopId: '00000000-0000-0000-0000-000000000401',
  fullName: 'Avery Advisor',
  role: 'owner',
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
  vehicleMode: 'existing',
  existingVehicleId: '00000000-0000-0000-0000-000000000501',
  concern: 'Brake vibration',
  assignedTechId: null,
}

const authMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const rateLimitMock = vi.mocked(rateLimitReject)
const handlerMock = vi.mocked(createCounterTicket)
const featureFlagMock = vi.mocked(isDesktopIntakeEnabled)

function request(payload: unknown): Request {
  return new Request('http://localhost/api/tickets/counter', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

describe('POST /api/tickets/counter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    featureFlagMock.mockReturnValue(true)
    authMock.mockResolvedValue(authContext)
    paywallMock.mockResolvedValue(null)
    rateLimitMock.mockResolvedValue(null)
  })

  it('fails closed while counter intake is disabled without authenticating or consuming quota', async () => {
    featureFlagMock.mockReturnValue(false)

    const response = await POST(request(body))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
    expect(authMock).not.toHaveBeenCalled()
    expect(paywallMock).not.toHaveBeenCalled()
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(handlerMock).not.toHaveBeenCalled()
  })

  it('fails closed for a non-owner before paywall, parsing, quota, or mutation', async () => {
    authMock.mockResolvedValue({
      ...authContext,
      profile: { ...profile, role: 'advisor' },
    })

    const response = await POST(request('not json{'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
    expect(paywallMock).not.toHaveBeenCalled()
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(handlerMock).not.toHaveBeenCalled()
  })

  it('authenticates before parsing JSON and returns the exact 401 envelope', async () => {
    authMock.mockResolvedValue(null)

    const response = await POST(request('not json{'))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(paywallMock).not.toHaveBeenCalled()
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(handlerMock).not.toHaveBeenCalled()
  })

  it('checks the paywall before parsing JSON', async () => {
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

  it('returns invalid_json before consuming the creation rate limit', async () => {
    const response = await POST(request('not json{'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' })
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(handlerMock).not.toHaveBeenCalled()
  })

  it('shares the legacy intake rate-limit key and returns its envelope', async () => {
    rateLimitMock.mockResolvedValue(
      NextResponse.json(
        { error: 'rate_limited', resetAt: '2026-07-10T12:01:00.000Z' },
        { status: 429 },
      ),
    )

    const response = await POST(request(body))

    expect(rateLimitMock).toHaveBeenCalledWith({}, `intake:${profile.userId}`, 10)
    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({
      error: 'rate_limited',
      resetAt: '2026-07-10T12:01:00.000Z',
    })
    expect(handlerMock).not.toHaveBeenCalled()
  })

  it('translates the actor and returns the exact success envelope', async () => {
    const ticket = { id: '00000000-0000-0000-0000-000000000601', ticketNumber: 1 }
    handlerMock.mockResolvedValue({ ok: true, ticket } as never)

    const response = await POST(request(body))

    expect(handlerMock).toHaveBeenCalledWith({}, { actor, body })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ ticket })
  })

  it.each([
    ['invalid_input', 422],
    ['not_found', 404],
    ['forbidden', 403],
  ] as const)('maps %s to status %i and its exact error envelope', async (error, status) => {
    handlerMock.mockResolvedValue({ ok: false, error })

    const response = await POST(request(body))

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ error })
  })

  it('preserves the row-8 warning envelope and conflict status', async () => {
    const warning = {
      code: 'below_required_tier' as const,
      assignedTechId: profile.id,
      assignedSkillTier: 2 as const,
      requiredSkillTier: 3 as const,
    }
    handlerMock.mockResolvedValue({
      ok: false,
      error: 'tier_confirmation_required',
      warning,
    })

    const response = await POST(request(body))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'tier_confirmation_required',
      warning,
    })
  })
})
