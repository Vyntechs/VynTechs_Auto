import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(), rateLimitReject: vi.fn() }))
vi.mock('@/lib/shop-os/customer-approval', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/customer-approval')>()
  return {
    ...actual,
    createCustomerApprovalLink: vi.fn(),
    loadCustomerApproval: vi.fn(),
    recordCustomerApprovalResponse: vi.fn(),
  }
})

import { POST as createLink } from '@/app/api/tickets/[id]/quote/approval-links/route'
import { GET as loadLink, POST as respond } from '@/app/api/public/quote-approval/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { checkRateLimit, rateLimitReject } from '@/lib/rate-limit'
import {
  createCustomerApprovalLink,
  loadCustomerApproval,
  recordCustomerApprovalResponse,
} from '@/lib/shop-os/customer-approval'

const TICKET = '00000000-0000-4000-8000-000000000020'
const VERSION = '00000000-0000-4000-8000-000000000030'
const REQUEST = '00000000-0000-4000-8000-000000000040'
const TOKEN = 'A'.repeat(43)
const profile = {
  id: '00000000-0000-4000-8000-000000000001',
  userId: 'user-1',
  shopId: '00000000-0000-4000-8000-000000000002',
}

function jsonRequest(url: string, body: unknown, token?: string): Request {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

describe('Shop OS customer approval routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SHOP_OS_CUSTOMER_APPROVAL_ENABLED', 'true')
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(null)
    vi.mocked(rateLimitReject).mockResolvedValue(null)
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: true,
      remaining: 9,
      resetAt: new Date('2026-08-02T12:01:00.000Z'),
    })
  })

  afterEach(() => vi.unstubAllEnvs())

  it.each([undefined, 'TRUE'])(
    'keeps link creation and both public methods data-free when the release flag is %s',
    async (flag) => {
      vi.stubEnv('SHOP_OS_CUSTOMER_APPROVAL_ENABLED', flag)
      const decisions = [{ jobId: VERSION, decision: 'declined' as const }]
      vi.mocked(createCustomerApprovalLink).mockResolvedValue({
        ok: true,
        changed: true,
        link: {
          id: REQUEST,
          quoteVersionId: VERSION,
          versionNumber: 1,
          expiresAt: '2026-08-09T12:00:00.000Z',
        },
      })
      vi.mocked(loadCustomerApproval).mockResolvedValue({ ok: true, quote: { jobs: [] } } as never)
      vi.mocked(recordCustomerApprovalResponse).mockResolvedValue({
        ok: true,
        changed: true,
        receipt: { versionNumber: 1, decisions, approvedTotalCents: 0 },
      })
      const createResponse = await createLink(
        jsonRequest(`https://vyntechs.dev/api/tickets/${TICKET}/quote/approval-links`, {
          requestKey: REQUEST,
          quoteVersionId: VERSION,
          tokenHash: 'a'.repeat(64),
        }),
        { params: Promise.resolve({ id: TICKET }) },
      )
      const loadResponse = await loadLink(new Request('https://vyntechs.dev/api/public/quote-approval', {
        headers: { authorization: `Bearer ${TOKEN}` },
      }))
      const submitResponse = await respond(new Request('https://vyntechs.dev/api/public/quote-approval', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ requestKey: REQUEST, decisions }),
      }))

      for (const response of [createResponse, loadResponse, submitResponse]) {
        expect(response.status).toBe(404)
        expect(response.headers.get('cache-control')).toBe('no-store')
        await expect(response.json()).resolves.toEqual({ error: 'unavailable' })
      }
      expect(paywallReject).not.toHaveBeenCalled()
      expect(rateLimitReject).not.toHaveBeenCalled()
      expect(checkRateLimit).not.toHaveBeenCalled()
      expect(createCustomerApprovalLink).not.toHaveBeenCalled()
      expect(loadCustomerApproval).not.toHaveBeenCalled()
      expect(recordCustomerApprovalResponse).not.toHaveBeenCalled()
    },
  )

  it('creates link metadata only after authenticated and paywall-safe domain work', async () => {
    vi.mocked(createCustomerApprovalLink).mockResolvedValue({
      ok: true,
      changed: true,
      link: {
        id: REQUEST,
        quoteVersionId: VERSION,
        versionNumber: 1,
        expiresAt: '2026-08-09T12:00:00.000Z',
      },
    })
    const body = { requestKey: REQUEST, quoteVersionId: VERSION, tokenHash: 'a'.repeat(64) }
    const response = await createLink(
      jsonRequest(`https://vyntechs.dev/api/tickets/${TICKET}/quote/approval-links`, body),
      { params: Promise.resolve({ id: TICKET }) },
    )
    expect(response.status).toBe(201)
    expect(createCustomerApprovalLink).toHaveBeenCalledWith({}, {
      actor: { profileId: profile.id },
      ticketId: TICKET,
      body,
    })
    expect(await response.json()).toEqual({
      changed: true,
      link: {
        id: REQUEST,
        quoteVersionId: VERSION,
        versionNumber: 1,
        expiresAt: '2026-08-09T12:00:00.000Z',
      },
    })
  })

  it('blocks unauthenticated, paywalled, and malformed creation before the domain', async () => {
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    let response = await createLink(jsonRequest('https://vyntechs.dev/x', {}), {
      params: Promise.resolve({ id: TICKET }),
    })
    expect(response.status).toBe(401)
    expect(createCustomerApprovalLink).not.toHaveBeenCalled()

    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    response = await createLink(jsonRequest('https://vyntechs.dev/x', {}), {
      params: Promise.resolve({ id: TICKET }),
    })
    expect(response.status).toBe(403)
    expect(createCustomerApprovalLink).not.toHaveBeenCalled()

    vi.mocked(paywallReject).mockResolvedValue(null)
    response = await createLink(new Request('https://vyntechs.dev/x', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    }), {
      params: Promise.resolve({ id: TICKET }),
    })
    expect(response.status).toBe(400)
    expect(createCustomerApprovalLink).not.toHaveBeenCalled()
  })

  it('requires JSON media types for both mutations while accepting a normal charset parameter', async () => {
    const body = { requestKey: REQUEST, quoteVersionId: VERSION, tokenHash: 'a'.repeat(64) }
    vi.mocked(createCustomerApprovalLink).mockResolvedValue({
      ok: true,
      changed: true,
      link: { id: REQUEST, quoteVersionId: VERSION, versionNumber: 1, expiresAt: '2026-08-09T12:00:00.000Z' },
    })
    vi.mocked(recordCustomerApprovalResponse).mockResolvedValue({
      ok: true,
      changed: true,
      receipt: { versionNumber: 1, decisions: [{ jobId: VERSION, decision: 'declined' }], approvedTotalCents: 0 },
    })

    let response = await createLink(new Request('https://vyntechs.dev/x', {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: TICKET }) })
    expect(response.status).toBe(415)
    expect(createCustomerApprovalLink).not.toHaveBeenCalled()

    response = await respond(new Request('https://vyntechs.dev/api/public/quote-approval', {
      method: 'POST',
      headers: { 'content-type': 'text/plain', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ requestKey: REQUEST, decisions: [{ jobId: VERSION, decision: 'declined' }] }),
    }))
    expect(response.status).toBe(415)
    expect(recordCustomerApprovalResponse).not.toHaveBeenCalled()

    response = await createLink(new Request('https://vyntechs.dev/x', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id: TICKET }) })
    expect(response.status).toBe(201)
    expect(createCustomerApprovalLink).toHaveBeenCalledTimes(1)
  })

  it('loads a bearer-bound quote with privacy headers and a hashed rate-limit key', async () => {
    vi.mocked(loadCustomerApproval).mockResolvedValue({ ok: true, quote: { jobs: [] } } as never)
    const response = await loadLink(new Request('https://vyntechs.dev/api/public/quote-approval', {
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-vercel-forwarded-for': '203.0.113.7',
      },
    }))
    expect(response.status).toBe(200)
    expect(loadCustomerApproval).toHaveBeenCalledWith({}, { token: TOKEN })
    expect(checkRateLimit).toHaveBeenCalledWith({}, expect.stringMatching(/^public-quote-approval-ip:[0-9a-f]{64}$/), 60)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow')
  })

  it('uses one stable public bucket when the same client rotates bearer tokens', async () => {
    vi.mocked(loadCustomerApproval).mockResolvedValue({ ok: false, error: 'unavailable' })
    for (const token of [TOKEN, 'B'.repeat(43)]) {
      await loadLink(new Request('https://vyntechs.dev/api/public/quote-approval', {
        headers: {
          authorization: `Bearer ${token}`,
          'x-vercel-forwarded-for': '203.0.113.7',
        },
      }))
    }
    expect(checkRateLimit).toHaveBeenCalledTimes(2)
    expect(vi.mocked(checkRateLimit).mock.calls[0]?.[1])
      .toBe(vi.mocked(checkRateLimit).mock.calls[1]?.[1])
  })

  it('fails closed when the public rate-limit store is unavailable', async () => {
    vi.mocked(checkRateLimit).mockRejectedValue(new Error('store unavailable'))
    const response = await loadLink(new Request('https://vyntechs.dev/api/public/quote-approval', {
      headers: { authorization: `Bearer ${TOKEN}` },
    }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'unavailable' })
    expect(loadCustomerApproval).not.toHaveBeenCalled()
  })

  it('keeps transient row contention retryable while oversized bodies stop before domain work', async () => {
    vi.mocked(loadCustomerApproval).mockResolvedValue({
      ok: false,
      error: 'conflict',
      retryable: true,
    })
    let response = await loadLink(new Request('https://vyntechs.dev/api/public/quote-approval', {
      headers: { authorization: `Bearer ${TOKEN}` },
    }))
    expect(response.status).toBe(503)
    expect(response.headers.get('retry-after')).toBe('1')
    expect(await response.json()).toEqual({ error: 'unavailable', retryable: true })

    response = await createLink(jsonRequest('https://vyntechs.dev/x', { filler: 'x'.repeat(5_000) }), {
      params: Promise.resolve({ id: TICKET }),
    })
    expect(response.status).toBe(413)
    expect(createCustomerApprovalLink).not.toHaveBeenCalled()
  })

  it('submits strict decisions and maps every invalid link to one indistinguishable response', async () => {
    const body = { requestKey: REQUEST, decisions: [{ jobId: VERSION, decision: 'declined' }] }
    vi.mocked(recordCustomerApprovalResponse).mockResolvedValue({
      ok: true,
      changed: true,
      receipt: { versionNumber: 1, decisions: body.decisions, approvedTotalCents: 0 },
    } as never)
    let response = await respond(jsonRequest('https://vyntechs.dev/api/public/quote-approval', body, TOKEN))
    expect(response.status).toBe(201)
    expect(recordCustomerApprovalResponse).toHaveBeenCalledWith({}, { token: TOKEN, body })

    vi.mocked(recordCustomerApprovalResponse).mockResolvedValue({ ok: false, error: 'unavailable' })
    response = await respond(jsonRequest('https://vyntechs.dev/api/public/quote-approval', body, TOKEN))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'unavailable' })
  })
})
