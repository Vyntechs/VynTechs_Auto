import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, access, redirect, select } = vi.hoisted(() => ({
  auth: vi.fn(),
  access: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`) }),
  select: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect, notFound: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: { select } }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: auth,
  isFounder: () => false,
}))
vi.mock('@/lib/auth-access', () => ({ checkAccess: access }))

import SettingsTeamPage from '@/app/(app)/settings/team/page'

describe('settings team page security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    select.mockImplementation(() => { throw new Error('sensitive-roster-query-reached') })
    auth.mockResolvedValue({
      user: { id: 'user-1', email: 'owner@test.dev' },
      profile: { id: 'profile-1', role: 'owner', shopId: 'shop-1' },
    })
  })

  it.each([
    [{ kind: 'deactivated' }, '/deactivated'],
    [{ kind: 'paywall', reason: 'past_due' }, '/subscribe'],
  ] as const)('redirects before the roster query', async (result, destination) => {
    access.mockResolvedValue(result)
    await expect(SettingsTeamPage()).rejects.toThrow(`redirect:${destination}`)
    expect(select).not.toHaveBeenCalled()
  })
})
