import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/tickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tickets')>()
  return { ...actual, listTodayTicketJobs: vi.fn() }
})

import { GET } from '@/app/api/today/jobs/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { listTodayTicketJobs } from '@/lib/tickets'

const profile = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000101',
  shopId: '00000000-0000-4000-8000-000000000201',
  role: 'tech',
  skillTier: 2,
  membershipStatus: 'active',
  deactivatedAt: null,
}
const emptyToday = {
  myJobs: [], openJobs: [], createdJobs: [], teamJobs: [], partsJobs: [], linkedSessionIds: [],
}

describe('Today live projection route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserAndProfile).mockResolvedValue({
      user: { id: profile.userId }, profile,
    } as never)
    vi.mocked(paywallReject).mockResolvedValue(null)
    vi.mocked(listTodayTicketJobs).mockResolvedValue(emptyToday)
  })

  it('requires an authenticated, paid profile before it returns the projection', async () => {
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
    expect(listTodayTicketJobs).not.toHaveBeenCalled()

    vi.mocked(requireUserAndProfile).mockResolvedValue({
      user: { id: profile.userId }, profile,
    } as never)
    vi.mocked(paywallReject).mockResolvedValue(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    expect((await GET()).status).toBe(403)
    expect(listTodayTicketJobs).not.toHaveBeenCalled()
  })

  it('returns only the current profile\'s server-authorized Today projection', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ todayJobs: emptyToday })
    expect(listTodayTicketJobs).toHaveBeenCalledWith({}, {
      actor: {
        profileId: profile.id,
        shopId: profile.shopId,
        role: profile.role,
        skillTier: profile.skillTier,
        membershipStatus: profile.membershipStatus,
        deactivatedAt: null,
      },
    })
  })
})
