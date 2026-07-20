import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getUser, createPortal, founder } = vi.hoisted(() => ({
  getUser: vi.fn(),
  createPortal: vi.fn(),
  founder: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({ auth: { getUser } })),
}))
vi.mock('@/lib/stripe', () => ({
  createBillingPortalSessionForUser: createPortal,
}))
vi.mock('@/lib/auth', () => ({ isFounder: founder }))

import { POST } from '@/app/api/stripe/portal/route'

describe('POST /api/stripe/portal authority translation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUser.mockResolvedValue({
      data: { user: { id: 'synthetic-user', email: 'founder@vyntechs.test' } },
    })
    founder.mockReturnValue(true)
    createPortal.mockResolvedValue({
      ok: true,
      url: 'https://billing.stripe.com/session/synthetic',
    })
  })

  it('passes only the authenticated founder decision to the sink handler', async () => {
    const response = await POST(new Request('https://vyntechs.dev/api/stripe/portal', {
      method: 'POST',
    }))

    expect(founder).toHaveBeenCalledWith('founder@vyntechs.test')
    expect(createPortal).toHaveBeenCalledWith({
      db: {},
      userId: 'synthetic-user',
      origin: 'https://vyntechs.dev',
      founderOverride: true,
    })
    expect(response.status).toBe(200)
  })
})
