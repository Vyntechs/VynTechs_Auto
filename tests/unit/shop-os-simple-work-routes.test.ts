import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/shop-os/simple-work', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/simple-work')>()
  return { ...actual, getSimpleWorkWorkspace: vi.fn(), mutateSimpleWork: vi.fn() }
})

import { GET, POST } from '@/app/api/tickets/[id]/jobs/[jobId]/work/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { getSimpleWorkWorkspace, mutateSimpleWork } from '@/lib/shop-os/simple-work'

const TICKET_ID = '00000000-0000-4000-8000-000000000020'
const JOB_ID = '00000000-0000-4000-8000-000000000030'
const profile = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000101',
  shopId: '00000000-0000-4000-8000-000000000201',
}
const params = { params: Promise.resolve({ id: TICKET_ID, jobId: JOB_ID }) }

function request(body: string) {
  return new Request(`http://localhost/api/tickets/${TICKET_ID}/jobs/${JOB_ID}/work`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  })
}

describe('Shop OS simple work routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(null)
  })

  it('authenticates and applies the paywall before domain work', async () => {
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    expect((await POST(request('{'), params)).status).toBe(401)
    expect(paywallReject).not.toHaveBeenCalled()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    expect((await GET(new Request('http://localhost'), params)).status).toBe(403)
    expect(getSimpleWorkWorkspace).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON before the domain', async () => {
    const response = await POST(request('{'), params)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_json' })
    expect(mutateSimpleWork).not.toHaveBeenCalled()
  })

  it('passes only persisted identity and maps safe success', async () => {
    vi.mocked(mutateSimpleWork).mockResolvedValue({
      ok: true, changed: true,
      work: { status: 'in_progress', workNotes: null, updatedAt: '2026-07-11T12:00:00.000Z' },
    })
    const body = { action: 'start' }
    const response = await POST(request(JSON.stringify(body)), params)
    expect(mutateSimpleWork).toHaveBeenCalledWith({}, {
      actor: { profileId: profile.id, shopId: profile.shopId },
      ticketId: TICKET_ID, jobId: JOB_ID, body,
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      changed: true,
      work: { status: 'in_progress', workNotes: null, updatedAt: '2026-07-11T12:00:00.000Z' },
    })
  })

  it.each([
    ['invalid_input', 400, false],
    ['not_found', 404, false],
    ['not_authorized', 409, false],
    ['not_ready', 409, false],
    ['conflict', 409, true],
  ] as const)('maps %s to a bounded response', async (error, status, retryable) => {
    vi.mocked(mutateSimpleWork).mockResolvedValue({
      ok: false, error, ...(retryable ? { retryable: true } : {}),
    })
    const response = await POST(request(JSON.stringify({ action: 'start' })), params)
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error, ...(retryable ? { retryable: true } : {}) })
  })
})
