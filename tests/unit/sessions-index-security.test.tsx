import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, listForTech, listForShop } = vi.hoisted(() => ({
  auth: vi.fn(),
  listForTech: vi.fn(),
  listForShop: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`) }),
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: auth }))
vi.mock('@/lib/db/queries', () => ({
  listSessionsForTech: listForTech,
  listSessionsForShop: listForShop,
}))

import SessionsPage from '@/app/(app)/sessions/page'

describe('sessions index object boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue({
      user: { id: 'user-1', email: 'tech@synthetic.invalid' },
      profile: {
        id: 'tech-1',
        shopId: 'shop-1',
        fullName: 'Synthetic Tech',
      },
    })
    listForTech.mockResolvedValue([])
    listForShop.mockResolvedValue([])
  })

  it('queries only the authenticated technician scope', async () => {
    await SessionsPage()
    expect(listForTech).toHaveBeenCalledWith({}, 'shop-1', 'tech-1')
    expect(listForShop).not.toHaveBeenCalled()
  })
})
