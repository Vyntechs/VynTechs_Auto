import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUserAndProfile: vi.fn(),
  checkAccess: vi.fn(),
  getCustomerCopy: vi.fn(),
  ticketActorFromProfile: vi.fn(() => ({ profileId: 'actor', shopId: 'shop', role: 'advisor' })),
}))

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: mocks.requireUserAndProfile }))
vi.mock('@/lib/auth-access', () => ({ checkAccess: mocks.checkAccess }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/shop-os/customer-copy', () => ({ getCustomerCopy: mocks.getCustomerCopy }))
vi.mock('@/lib/tickets', () => ({ ticketActorFromProfile: mocks.ticketActorFromProfile }))

import { refreshCustomerCopy } from '@/app/(app)/tickets/[id]/customer-copy-actions'

describe('refreshCustomerCopy server action', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fails closed before financial reads without an authenticated active subscription', async () => {
    mocks.requireUserAndProfile.mockResolvedValueOnce(null)
    expect(await refreshCustomerCopy('ticket-1')).toEqual({ ok: false, error: 'forbidden' })
    expect(mocks.checkAccess).not.toHaveBeenCalled()
    expect(mocks.getCustomerCopy).not.toHaveBeenCalled()

    mocks.requireUserAndProfile.mockResolvedValueOnce({ profile: {}, user: { id: 'user-1' } })
    mocks.checkAccess.mockResolvedValueOnce({ kind: 'paywall', reason: 'past_due' })
    expect(await refreshCustomerCopy('ticket-1')).toEqual({ ok: false, error: 'forbidden' })
    expect(mocks.getCustomerCopy).not.toHaveBeenCalled()
  })

  it('reuses the authenticated actor and gated transactional projection', async () => {
    const ctx = { profile: { id: 'profile-1' }, user: { id: 'user-1' } }
    const result = { ok: false as const, error: 'not_found' as const }
    mocks.requireUserAndProfile.mockResolvedValue(ctx)
    mocks.checkAccess.mockResolvedValue({ kind: 'allow', entitlements: { diagnostics: false } })
    mocks.getCustomerCopy.mockResolvedValue(result)

    expect(await refreshCustomerCopy('ticket-1')).toEqual(result)
    expect(mocks.ticketActorFromProfile).toHaveBeenCalledWith(ctx.profile)
    expect(mocks.getCustomerCopy).toHaveBeenCalledWith({}, {
      actor: { profileId: 'actor', shopId: 'shop', role: 'advisor' },
      ticketId: 'ticket-1',
    })
  })
})
