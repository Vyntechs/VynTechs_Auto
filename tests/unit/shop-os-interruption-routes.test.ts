import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/shop-os/interruption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/interruption')>()
  return { ...actual, mutateJobInterruption: vi.fn() }
})

import { POST } from '@/app/api/tickets/[id]/jobs/[jobId]/interruption/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { mutateJobInterruption } from '@/lib/shop-os/interruption'

const TICKET_ID = '00000000-0000-4000-8000-000000000020'
const JOB_ID = '00000000-0000-4000-8000-000000000030'
const profile = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000101',
  shopId: '00000000-0000-4000-8000-000000000201',
  role: 'tech',
  membershipStatus: 'active',
  deactivatedAt: null,
}
const params = { params: Promise.resolve({ id: TICKET_ID, jobId: JOB_ID }) }

function request(body: string) {
  return new Request(`http://localhost/api/tickets/${TICKET_ID}/jobs/${JOB_ID}/interruption`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  })
}

describe('ShopOS interruption route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(null)
  })

  it('authenticates and applies the paywall before parsing or mutation', async () => {
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    expect((await POST(request('{'), params)).status).toBe(401)
    expect(paywallReject).not.toHaveBeenCalled()

    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    expect((await POST(request('{'), params)).status).toBe(403)
    expect(mutateJobInterruption).not.toHaveBeenCalled()
  })

  it('forwards only persisted actor identity and safe interruption truth', async () => {
    const body = {
      action: 'block',
      requestKey: '00000000-0000-4000-8000-000000000040',
      holdKind: 'parts',
      holdNote: 'Awaiting pads.',
    }
    const job = {
      id: JOB_ID,
      assignedTechId: profile.id,
      workStatus: 'blocked', holdKind: 'parts', holdNote: 'Awaiting pads.',
      holdResumeStatus: 'in_progress', heldAt: '2026-07-21T15:00:00.000Z',
      heldByProfileId: profile.id, clockedOnSince: null, activeSeconds: 90,
      updatedAt: '2026-07-21T15:00:00.000Z',
    } as const
    vi.mocked(mutateJobInterruption).mockResolvedValue({ ok: true, changed: true, job })

    const response = await POST(request(JSON.stringify(body)), params)

    expect(mutateJobInterruption).toHaveBeenCalledWith({}, {
      actor: {
        profileId: profile.id,
        shopId: profile.shopId,
        role: profile.role,
        membershipStatus: profile.membershipStatus,
        deactivatedAt: null,
      },
      ticketId: TICKET_ID,
      jobId: JOB_ID,
      body,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ changed: true, job })
  })

  it.each([
    ['invalid_input', 400],
    ['not_found', 404],
    ['inactive_profile', 409],
    ['forbidden', 409],
    ['not_ready', 409],
    ['conflict', 409],
  ] as const)('maps %s to the bounded HTTP response', async (error, status) => {
    vi.mocked(mutateJobInterruption).mockResolvedValue({ ok: false, error } as never)
    const response = await POST(request(JSON.stringify({ action: 'block' })), params)
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ error })
  })
})
