import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitReject: vi.fn() }))
vi.mock('@/lib/shop-os/part-requests', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/part-requests')>()
  return { ...actual, createPartRequest: vi.fn(), resolvePartRequest: vi.fn() }
})

import { POST as CREATE } from '@/app/api/tickets/[id]/jobs/[jobId]/part-requests/route'
import { POST as RESOLVE } from '@/app/api/tickets/[id]/part-requests/[requestId]/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { createPartRequest, resolvePartRequest } from '@/lib/shop-os/part-requests'
import { rateLimitReject } from '@/lib/rate-limit'

const TICKET = '00000000-0000-4000-8000-000000000020'
const JOB = '00000000-0000-4000-8000-000000000030'
const REQ = '00000000-0000-4000-8000-000000000040'
const profile = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: '00000000-0000-4000-8000-000000000101',
  shopId: '00000000-0000-4000-8000-000000000201',
}
const REQUEST = {
  id: REQ, jobId: JOB, description: 'Water pump', preference: 'Motorcraft', quantity: 1,
  status: 'requested' as const, requestedAt: '2026-07-19T12:00:00.000Z', resolvedAt: null,
}

function request(body: string) {
  return new Request('http://localhost/part-requests', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body,
  })
}

describe('Shop OS part request routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(null)
    vi.mocked(rateLimitReject).mockResolvedValue(null)
  })

  it('create authenticates, applies the paywall, and rejects malformed JSON before the domain', async () => {
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    expect((await CREATE(request('{'), { params: Promise.resolve({ id: TICKET, jobId: JOB }) })).status).toBe(401)
    expect(paywallReject).not.toHaveBeenCalled()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    expect((await CREATE(request('{}'), { params: Promise.resolve({ id: TICKET, jobId: JOB }) })).status).toBe(403)
    expect(createPartRequest).not.toHaveBeenCalled()
    vi.mocked(paywallReject).mockResolvedValue(null)
    const bad = await CREATE(request('{'), { params: Promise.resolve({ id: TICKET, jobId: JOB }) })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toEqual({ error: 'invalid_json' })
  })

  it('create passes persisted identity and returns the request at 201', async () => {
    vi.mocked(createPartRequest).mockResolvedValue({ ok: true, request: REQUEST })
    const body = { requestKey: REQ, description: 'Water pump', preference: 'Motorcraft', quantity: 1 }
    const response = await CREATE(request(JSON.stringify(body)), { params: Promise.resolve({ id: TICKET, jobId: JOB }) })
    expect(createPartRequest).toHaveBeenCalledWith({}, {
      actor: { profileId: profile.id, shopId: profile.shopId }, ticketId: TICKET, jobId: JOB, body,
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ request: REQUEST })
    expect(rateLimitReject).toHaveBeenCalledWith(
      {},
      `part-request:${profile.shopId}:${profile.id}`,
      20,
    )
  })

  it('returns the shared quota response before domain work', async () => {
    vi.mocked(rateLimitReject).mockResolvedValue(
      NextResponse.json({ error: 'rate_limited' }, { status: 429 }),
    )
    const response = await CREATE(
      request(JSON.stringify({ requestKey: REQ, description: 'Water pump', quantity: 1 })),
      { params: Promise.resolve({ id: TICKET, jobId: JOB }) },
    )
    expect(response.status).toBe(429)
    expect(createPartRequest).not.toHaveBeenCalled()
  })

  it('meters an exhausted request before touching its body', async () => {
    vi.mocked(rateLimitReject).mockResolvedValue(
      NextResponse.json({ error: 'rate_limited' }, { status: 429 }),
    )
    const incoming = request('{')
    const json = vi.fn(async () => {
      throw new Error('the body must not be read')
    })
    Object.defineProperty(incoming, 'json', { value: json })

    const response = await CREATE(incoming, { params: Promise.resolve({ id: TICKET, jobId: JOB }) })

    expect(response.status).toBe(429)
    expect(json).not.toHaveBeenCalled()
    expect(createPartRequest).not.toHaveBeenCalled()
  })

  it('rejects streamed bodies over 16 KiB before the part-request domain', async () => {
    const response = await CREATE(
      request(JSON.stringify({ requestKey: REQ, description: 'x'.repeat(16 * 1024) })),
      { params: Promise.resolve({ id: TICKET, jobId: JOB }) },
    )

    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'payload_too_large' })
    expect(createPartRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid_input', 400, false],
    ['not_found', 404, false],
    ['not_authorized', 403, false],
    ['conflict', 409, true],
  ] as const)('create maps %s safely', async (error, status, retryable) => {
    vi.mocked(createPartRequest).mockResolvedValue({ ok: false, error, ...(retryable ? { retryable: true } : {}) })
    const response = await CREATE(request('{}'), { params: Promise.resolve({ id: TICKET, jobId: JOB }) })
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error, ...(retryable ? { retryable: true } : {}) })
  })

  it('resolve returns the updated request at 200 and maps failures', async () => {
    vi.mocked(resolvePartRequest).mockResolvedValue({ ok: true, request: { ...REQUEST, status: 'sourced', resolvedAt: '2026-07-19T12:05:00.000Z' } })
    const response = await RESOLVE(request(JSON.stringify({ status: 'sourced' })), { params: Promise.resolve({ id: TICKET, requestId: REQ }) })
    expect(resolvePartRequest).toHaveBeenCalledWith({}, {
      actor: { profileId: profile.id, shopId: profile.shopId }, ticketId: TICKET, requestId: REQ, body: { status: 'sourced' },
    })
    expect(response.status).toBe(200)
    expect((await response.json()).request.status).toBe('sourced')

    vi.mocked(resolvePartRequest).mockResolvedValue({ ok: false, error: 'not_authorized' })
    const denied = await RESOLVE(request(JSON.stringify({ status: 'sourced' })), { params: Promise.resolve({ id: TICKET, requestId: REQ }) })
    expect(denied.status).toBe(403)
  })
})
