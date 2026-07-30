import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/shop-os/quotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/quotes')>()
  return { ...actual, createAdHocJob: vi.fn() }
})

import { POST } from '@/app/api/tickets/[id]/quote/jobs/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { createAdHocJob } from '@/lib/shop-os/quotes'

const PROFILE_ID = '00000000-0000-4000-8000-000000000001'
const USER_ID = '00000000-0000-4000-8000-000000000101'
const TICKET_ID = '00000000-0000-4000-8000-000000000401'
const JOB_ID = '00000000-0000-4000-8000-000000000501'
const CLIENT_KEY = '00000000-0000-4000-8000-000000000301'
const profile = { id: PROFILE_ID, userId: USER_ID, role: 'advisor', shopId: '00000000-0000-4000-8000-000000000601' }
const authContext = { profile, user: { id: USER_ID, email: 'advisor@shop.test' } }
const job = { id: JOB_ID, title: 'Replace alternator', kind: 'repair', requiredSkillTier: 2 }

const authMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const createMock = vi.mocked(createAdHocJob)

function request(body?: unknown, raw?: string) {
  return new Request(`http://localhost/api/tickets/${TICKET_ID}/quote/jobs`, {
    method: 'POST',
    ...(body !== undefined || raw !== undefined ? {
      body: raw ?? JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    } : {}),
  })
}
const params = () => ({ params: Promise.resolve({ id: TICKET_ID }) })
const validBody = { clientKey: CLIENT_KEY, job: { title: 'Replace alternator', kind: 'repair' } }

describe('POST /api/tickets/[id]/quote/jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(authContext as never)
    paywallMock.mockResolvedValue(null)
  })

  it('authenticates and checks the paywall before touching the domain', async () => {
    authMock.mockResolvedValue(null)
    let response = await POST(request(validBody), params())
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'unauthenticated' })
    expect(createMock).not.toHaveBeenCalled()

    authMock.mockResolvedValue(authContext as never)
    paywallMock.mockResolvedValue(NextResponse.json({ error: 'payment_required' }, { status: 402 }))
    response = await POST(request(validBody), params())
    expect(response.status).toBe(402)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('creates the job and reports the tenant-scoped actor and ticket it used', async () => {
    createMock.mockResolvedValue({ ok: true, changed: true, job } as never)
    const response = await POST(request(validBody), params())
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ changed: true, job })
    expect(createMock).toHaveBeenCalledWith({}, {
      actor: { profileId: PROFILE_ID },
      ticketId: TICKET_ID,
      clientKey: CLIENT_KEY,
      body: { title: 'Replace alternator', kind: 'repair' },
    })
  })

  it('answers a same-key replay with 200 and no new job', async () => {
    createMock.mockResolvedValue({ ok: true, changed: false, job } as never)
    const response = await POST(request(validBody), params())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ changed: false, job })
  })

  it('maps every domain refusal, including a full repair order', async () => {
    createMock.mockResolvedValue({ ok: false, error: 'job_limit_reached', retryable: false } as never)
    let response = await POST(request(validBody), params())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'job_limit_reached' })

    createMock.mockResolvedValue({ ok: false, error: 'not_found' } as never)
    response = await POST(request(validBody), params())
    expect(response.status).toBe(404)

    createMock.mockResolvedValue({ ok: false, error: 'invalid_input' } as never)
    response = await POST(request(validBody), params())
    expect(response.status).toBe(422)

    createMock.mockResolvedValue({ ok: false, error: 'conflict', retryable: true } as never)
    response = await POST(request(validBody), params())
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'conflict', retryable: true })
  })

  it('rejects unusable envelopes before the domain runs', async () => {
    let response = await POST(request(undefined, '{'), params())
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'invalid_json' })

    response = await POST(request({ clientKey: CLIENT_KEY, job: {}, extra: 1 }), params())
    expect(response.status).toBe(422)
    expect(createMock).not.toHaveBeenCalled()
  })
})
