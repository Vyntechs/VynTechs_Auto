import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const { getPreference, updatePreference, auth, paywall } = vi.hoisted(() => ({
  getPreference: vi.fn(),
  updatePreference: vi.fn(),
  auth: vi.fn(),
  paywall: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: auth, isFounder: vi.fn(() => false) }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: paywall }))
vi.mock('@/lib/shop-os/job-timer-preference', () => ({
  getJobTimerPreference: getPreference,
  updateJobTimerPreference: updatePreference,
  jobTimerPreferenceStatus: vi.fn((result: { ok: boolean; error?: string }) => result.ok ? 200 : 403),
}))

import { GET, POST } from '@/app/api/account/job-timer/route'

const profile = {
  id: '00000000-0000-4000-8000-000000000101',
  userId: '00000000-0000-4000-8000-000000000102',
  shopId: '00000000-0000-4000-8000-000000000103',
  fullName: 'Taylor Tech',
  role: 'tech',
  skillTier: 2,
  jobTimerEnabled: false,
  membershipStatus: 'active' as const,
  membershipActivatedAt: new Date('2026-08-05T00:00:00Z'),
  isComp: false,
  isCurator: false,
  lastSeenWhatsNewAt: null,
  deactivatedAt: null,
  createdAt: new Date('2026-08-05T00:00:00Z'),
}

const context = {
  profile,
  user: { id: profile.userId, email: 'taylor@shop.test' },
}

function request(body: unknown) {
  return new Request('http://localhost/api/account/job-timer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('account job timer route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue(context)
    paywall.mockResolvedValue(null)
  })

  it('returns only the current person preference with no-store', async () => {
    getPreference.mockResolvedValue({
      ok: true,
      preference: { profileId: profile.id, enabled: false },
    })

    const response = await GET()

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      preference: { profileId: profile.id, enabled: false },
    })
    expect(getPreference).toHaveBeenCalledWith({}, {
      actor: {
        profileId: profile.id,
        shopId: profile.shopId,
        role: profile.role,
        membershipStatus: profile.membershipStatus,
        isFounder: false,
      },
    })
  })

  it('authenticates and paywalls before parsing or domain access', async () => {
    auth.mockResolvedValueOnce(null)
    const unauthenticated = await POST(request('not json{'))
    expect(unauthenticated.status).toBe(401)
    expect(unauthenticated.headers.get('cache-control')).toBe('no-store')
    expect(paywall).not.toHaveBeenCalled()
    expect(updatePreference).not.toHaveBeenCalled()

    auth.mockResolvedValueOnce(context)
    paywall.mockResolvedValueOnce(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    const denied = await POST(request('not json{'))
    expect(denied.status).toBe(403)
    expect(denied.headers.get('cache-control')).toBe('no-store')
    expect(updatePreference).not.toHaveBeenCalled()
  })

  it('accepts only a strict boolean body and returns exact saved truth', async () => {
    updatePreference.mockResolvedValue({
      ok: true,
      preference: { profileId: profile.id, enabled: true },
    })

    const invalid = await POST(request({ enabled: true, profileId: profile.id }))
    expect(invalid.status).toBe(422)
    expect(invalid.headers.get('cache-control')).toBe('no-store')
    expect(updatePreference).not.toHaveBeenCalled()

    const response = await POST(request({ enabled: true }))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      preference: { profileId: profile.id, enabled: true },
    })
    expect(updatePreference).toHaveBeenCalledWith({}, {
      actor: expect.objectContaining({ profileId: profile.id }),
      enabled: true,
    })
  })
})
