import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getPreference, updatePreference, auth, founder, paywall } = vi.hoisted(() => ({
  getPreference: vi.fn(),
  updatePreference: vi.fn(),
  auth: vi.fn(),
  founder: vi.fn(),
  paywall: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: auth, isFounder: founder }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: paywall }))
vi.mock('@/lib/shop-os/job-timer-preference', () => ({
  getJobTimerPreference: getPreference,
  updateJobTimerPreference: updatePreference,
  jobTimerPreferenceStatus: vi.fn((result: { ok: boolean; error?: string }) => result.ok ? 200 : 403),
}))

import { GET, POST } from '@/app/api/team/job-timer/route'

const targetProfileId = '00000000-0000-4000-8000-000000000201'
const profile = {
  id: '00000000-0000-4000-8000-000000000202',
  userId: '00000000-0000-4000-8000-000000000203',
  shopId: '00000000-0000-4000-8000-000000000204',
  fullName: 'Olivia Owner',
  role: 'owner',
  skillTier: null,
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
  user: { id: profile.userId, email: 'owner@shop.test' },
}

function request(body: unknown) {
  return new Request('http://localhost/api/team/job-timer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('team job timer route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue(context)
    founder.mockReturnValue(false)
    paywall.mockResolvedValue(null)
  })

  it('reads one explicit team member with owner authority and no-store', async () => {
    getPreference.mockResolvedValue({
      ok: true,
      preference: { profileId: targetProfileId, enabled: false },
    })

    const response = await GET(new Request(
      `http://localhost/api/team/job-timer?profileId=${targetProfileId}`,
    ))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      preference: { profileId: targetProfileId, enabled: false },
    })
    expect(getPreference).toHaveBeenCalledWith({}, {
      actor: {
        profileId: profile.id,
        shopId: profile.shopId,
        role: profile.role,
        membershipStatus: profile.membershipStatus,
        isFounder: false,
      },
      targetProfileId,
    })
  })

  it('rejects a missing query target and a body with extra authority fields', async () => {
    const missing = await GET(new Request('http://localhost/api/team/job-timer'))
    expect(missing.status).toBe(422)
    expect(missing.headers.get('cache-control')).toBe('no-store')
    expect(getPreference).not.toHaveBeenCalled()

    const forged = await POST(request({
      profileId: targetProfileId,
      enabled: true,
      role: 'owner',
    }))
    expect(forged.status).toBe(422)
    expect(forged.headers.get('cache-control')).toBe('no-store')
    expect(updatePreference).not.toHaveBeenCalled()
  })

  it('writes only the explicit target and exact boolean', async () => {
    founder.mockReturnValue(true)
    updatePreference.mockResolvedValue({
      ok: true,
      preference: { profileId: targetProfileId, enabled: true },
    })

    const response = await POST(request({ profileId: targetProfileId, enabled: true }))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    await expect(response.json()).resolves.toEqual({
      preference: { profileId: targetProfileId, enabled: true },
    })
    expect(updatePreference).toHaveBeenCalledWith({}, {
      actor: expect.objectContaining({ profileId: profile.id, isFounder: true }),
      targetProfileId,
      enabled: true,
    })
  })
})
