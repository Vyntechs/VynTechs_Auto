import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const { authMock, redirectMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  redirectMock: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`)
  }),
}))

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/sessions/new',
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: authMock }))
vi.mock('@/components/vt/whats-new-badge', () => ({ WhatsNewBadge: () => null }))

import NewSessionPage from '@/app/(app)/sessions/new/page'

const profile = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000002',
  shopId: '00000000-0000-4000-8000-000000000003',
  fullName: 'Avery Wrench',
  role: 'tech',
  skillTier: 2,
  membershipStatus: 'active',
  deactivatedAt: null,
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    user: { id: profile.userId, email: 'avery@shop.test' },
    profile: { ...profile, ...overrides },
  }
}

describe('NewSessionPage Shop OS wrenching access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(context())
  })

  it('preserves the sign-in redirect when authentication is missing', async () => {
    authMock.mockResolvedValue(null)
    await expect(NewSessionPage()).rejects.toThrow('redirect:/sign-in')
  })

  it.each([
    ['missing shop', { shopId: null }],
    ['pending membership', { membershipStatus: 'pending' }],
    ['deactivated membership', { deactivatedAt: new Date('2026-07-10T12:00:00Z') }],
    ['null wrenching tier', { skillTier: null }],
    ['unsupported role', { role: 'curator' }],
  ])('redirects a %s actor directly to Today', async (_label, override) => {
    authMock.mockResolvedValue(context(override))
    await expect(NewSessionPage()).rejects.toThrow('redirect:/today')
  })

  it.each(['tech', 'advisor', 'parts', 'owner'])('renders for an active tiered %s', async (role) => {
    authMock.mockResolvedValue(context({ role }))
    render(await NewSessionPage())
    expect(screen.getByText('New diagnosis')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start diagnosis/i })).toBeInTheDocument()
  })
})
