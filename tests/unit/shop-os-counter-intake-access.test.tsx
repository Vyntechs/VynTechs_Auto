import { beforeEach, describe, expect, it, vi } from 'vitest'

const { notFoundError, redirectError, notFoundMock, redirectMock } = vi.hoisted(() => ({
  notFoundError: new Error('NEXT_NOT_FOUND'),
  redirectError: new Error('NEXT_REDIRECT'),
  notFoundMock: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirectMock: vi.fn(() => { throw new Error('NEXT_REDIRECT') }),
}))

vi.mock('next/navigation', () => ({
  notFound: notFoundMock,
  redirect: redirectMock,
}))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/feature-flags', () => ({ isDesktopIntakeEnabled: vi.fn(() => true) }))

import IntakeLayout from '@/app/(app)/intake/layout'
import { requireUserAndProfile } from '@/lib/auth'
import { isDesktopIntakeEnabled } from '@/lib/feature-flags'

const authMock = vi.mocked(requireUserAndProfile)
const featureFlagMock = vi.mocked(isDesktopIntakeEnabled)

const profile = {
  id: 'profile-1',
  userId: 'user-1',
  shopId: 'shop-1',
  fullName: 'Avery Advisor',
  role: 'advisor',
  skillTier: null,
  membershipStatus: 'active' as const,
  membershipActivatedAt: new Date('2026-07-20T12:00:00Z'),
  isComp: false,
  isCurator: false,
  lastSeenWhatsNewAt: null,
  deactivatedAt: null,
  createdAt: new Date('2026-07-20T12:00:00Z'),
}

describe('counter intake page access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    featureFlagMock.mockReturnValue(true)
    authMock.mockResolvedValue({
      profile,
      user: { id: profile.userId, email: 'avery@shop.test' },
    })
  })

  it.each(['advisor', 'owner'] as const)('renders the existing intake for %s', async (role) => {
    authMock.mockResolvedValue({
      profile: { ...profile, role },
      user: { id: profile.userId, email: 'avery@shop.test' },
    })

    const result = await IntakeLayout({ children: <span>Counter intake</span> })

    expect(result.props.children).toEqual(<span>Counter intake</span>)
    expect(notFoundMock).not.toHaveBeenCalled()
  })

  it.each(['tech', 'parts'] as const)('fails closed for %s', async (role) => {
    authMock.mockResolvedValue({
      profile: { ...profile, role },
      user: { id: profile.userId, email: 'avery@shop.test' },
    })

    await expect(IntakeLayout({ children: <span>Hidden</span> })).rejects.toThrow(
      notFoundError.message,
    )
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })

  it('fails closed before authentication while the feature is disabled', async () => {
    featureFlagMock.mockReturnValue(false)

    await expect(IntakeLayout({ children: <span>Hidden</span> })).rejects.toThrow(
      notFoundError.message,
    )
    expect(authMock).not.toHaveBeenCalled()
  })

  it('redirects an unauthenticated user', async () => {
    authMock.mockResolvedValue(null)

    await expect(IntakeLayout({ children: <span>Hidden</span> })).rejects.toThrow(
      redirectError.message,
    )
    expect(redirectMock).toHaveBeenCalledTimes(1)
  })
})
