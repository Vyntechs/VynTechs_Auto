import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/shop-os/interruption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/interruption')>()
  return { ...actual, mutateTicketLifecycle: vi.fn() }
})

import { POST } from '@/app/api/tickets/[id]/lifecycle/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { mutateTicketLifecycle } from '@/lib/shop-os/interruption'

const TICKET_ID = '00000000-0000-4000-8000-000000000020'
const profile = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000101',
  shopId: '00000000-0000-4000-8000-000000000201',
  role: 'advisor',
  membershipStatus: 'active',
  deactivatedAt: null,
}
const params = { params: Promise.resolve({ id: TICKET_ID }) }

describe('ShopOS ticket lifecycle route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(null)
  })

  it('maps a safe lifecycle projection without passing browser identity to the domain', async () => {
    const body = {
      action: 'cancel',
      requestKey: '00000000-0000-4000-8000-000000000040',
      reason: 'Customer rescheduled.',
    }
    vi.mocked(mutateTicketLifecycle).mockResolvedValue({
      ok: true, changed: true, ticket: { id: TICKET_ID, status: 'canceled' },
    })

    const response = await POST(new Request(`http://localhost/api/tickets/${TICKET_ID}/lifecycle`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }), params)

    expect(mutateTicketLifecycle).toHaveBeenCalledWith({}, {
      actor: {
        profileId: profile.id, shopId: profile.shopId, role: 'advisor',
        membershipStatus: 'active', deactivatedAt: null,
      },
      ticketId: TICKET_ID,
      body,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      changed: true,
      ticket: { id: TICKET_ID, status: 'canceled' },
    })
  })

  it('rejects invalid JSON before calling the domain', async () => {
    const response = await POST(new Request(`http://localhost/api/tickets/${TICKET_ID}/lifecycle`, {
      method: 'POST', body: '{', headers: { 'content-type': 'application/json' },
    }), params)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' })
    expect(mutateTicketLifecycle).not.toHaveBeenCalled()
  })
})
