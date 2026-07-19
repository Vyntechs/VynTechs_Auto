import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, access, release, redirect } = vi.hoisted(() => ({
  auth: vi.fn(),
  access: vi.fn(),
  release: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`) }),
}))

vi.mock('next/navigation', () => ({ redirect }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: auth }))
vi.mock('@/lib/auth-access', () => ({ checkAccess: access }))
vi.mock('@/lib/release-policy', () => ({ isDiagnosticsReleaseEnabled: release }))

import SessionsLayout from '@/app/(app)/sessions/layout'

describe('sessions segment security', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({ user: { id: 'user-1' }, profile: { id: 'tech-1' } })
    access.mockResolvedValue({ kind: 'allow', entitlements: { diagnostics: true } })
    release.mockReturnValue(true)
  })

  it.each([
    [{ kind: 'deactivated' }, '/deactivated'],
    [{ kind: 'paywall', reason: 'canceled' }, '/subscribe'],
  ] as const)('enforces account state without middleware', async (result, destination) => {
    access.mockResolvedValue(result)
    await expect(SessionsLayout({ children: <span>secret</span> })).rejects.toThrow(
      `redirect:${destination}`,
    )
  })

  it.each([
    [false, true],
    [true, false],
  ])('keeps diagnostics unreachable when release=%s entitlement=%s', async (enabled, entitled) => {
    release.mockReturnValue(enabled)
    access.mockResolvedValue({ kind: 'allow', entitlements: { diagnostics: entitled } })
    await expect(SessionsLayout({ children: <span>secret</span> })).rejects.toThrow(
      'redirect:/today',
    )
  })

  it('preserves the authorized development path', async () => {
    await expect(SessionsLayout({ children: <span>allowed</span> })).resolves.toEqual(
      <span>allowed</span>,
    )
  })
})
