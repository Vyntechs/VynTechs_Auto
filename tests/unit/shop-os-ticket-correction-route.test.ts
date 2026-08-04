import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }))
vi.mock('@/lib/shop-os/ticket-corrections', () => ({ correctTicket: vi.fn() }))

import { POST } from '@/app/api/tickets/[id]/corrections/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { checkRateLimit } from '@/lib/rate-limit'
import { correctTicket } from '@/lib/shop-os/ticket-corrections'
import { getServerSupabase } from '@/lib/supabase-server'

const PROFILE_ID = '00000000-0000-4000-8000-000000000001'
const USER_ID = '00000000-0000-4000-8000-000000000002'
const SHOP_ID = '00000000-0000-4000-8000-000000000003'
const TICKET_ID = 'abcdef12-3456-4abc-8def-abcdef123456'
const UPPERCASE_TICKET_ID = TICKET_ID.toUpperCase()
const ROTATED_TICKET_ID = 'fedcba98-7654-4cba-8fed-fedcba987654'
const REQUEST_KEY = '00000000-0000-4000-8000-000000000004'

const profile = {
  id: PROFILE_ID,
  userId: USER_ID,
  shopId: SHOP_ID,
  fullName: 'Avery Advisor',
  role: 'advisor',
  skillTier: 2,
  membershipStatus: 'active' as const,
  membershipActivatedAt: new Date('2026-07-10T12:00:00.000Z'),
  isComp: false,
  isCurator: false,
  lastSeenWhatsNewAt: null,
  deactivatedAt: null,
  createdAt: new Date('2026-07-10T12:00:00.000Z'),
}

const authContext = {
  user: { id: USER_ID, email: 'avery@shop.test' },
  profile,
}

const actor = {
  profileId: PROFILE_ID,
  shopId: SHOP_ID,
  role: 'advisor',
  skillTier: 2,
  membershipStatus: 'active',
  deactivatedAt: null,
}

const validBody = {
  action: 'concern',
  requestKey: REQUEST_KEY,
  expectedTicketUpdatedAt: '2026-08-03T12:00:00.000Z',
  expectedActiveVersionId: null,
  concern: 'Brake pedal feels soft',
}

const ticket = {
  id: TICKET_ID,
  ticketNumber: 1042,
  status: 'open',
  concern: validBody.concern,
  jobs: [],
}

const authMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const rateLimitMock = vi.mocked(checkRateLimit)
const correctionMock = vi.mocked(correctTicket)
const supabaseMock = vi.mocked(getServerSupabase)

function params(id = TICKET_ID) {
  return { params: Promise.resolve({ id }) }
}

function jsonRequest(
  body: unknown = validBody,
  options: { contentType?: string | null; contentLength?: string } = {},
): Request {
  const headers = new Headers()
  if (options.contentType !== null) {
    headers.set('content-type', options.contentType ?? 'application/json')
  }
  if (options.contentLength !== undefined) {
    headers.set('content-length', options.contentLength)
  }
  return new Request(`http://localhost/api/tickets/${TICKET_ID}/corrections`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function jsonOfExactly(bytes: number): string {
  const empty = JSON.stringify({ value: '' })
  const overhead = new TextEncoder().encode(empty).byteLength
  return JSON.stringify({ value: 'x'.repeat(bytes - overhead) })
}

async function expectJson(
  response: Response,
  status: number,
  body: unknown,
): Promise<void> {
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('no-store')
  await expect(response.json()).resolves.toEqual(body)
}

describe('Shop OS ticket-correction route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    authMock.mockResolvedValue(authContext as never)
    paywallMock.mockResolvedValue(null)
    rateLimitMock.mockResolvedValue({
      allowed: true,
      remaining: 19,
      resetAt: new Date('2026-08-03T12:01:00.000Z'),
    })
    correctionMock.mockResolvedValue({
      ok: true,
      outcome: 'changed',
      changed: true,
      scope: 'concern',
      invalidatedVersionNumber: null,
      ticket,
    } as never)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it.each([undefined, 'false', 'TRUE'])(
    'returns the shared unavailable response before auth, params, quota, media, body, or domain when the flag is %s',
    async (flag) => {
      vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', flag)
      let paramsRead = false
      const headersGet = vi.fn(() => {
        throw new Error('headers must remain unread')
      })
      const getReader = vi.fn(() => {
        throw new Error('body must remain unread')
      })
      const request = {
        headers: { get: headersGet },
        body: { getReader },
      } as unknown as Request

      const response = await POST(request, {
        params: {
          then() {
            paramsRead = true
            return Promise.resolve({ id: TICKET_ID })
          },
        } as Promise<{ id: string }>,
      })

      await expectJson(response, 404, { error: 'unavailable' })
      expect(paramsRead).toBe(false)
      expect(headersGet).not.toHaveBeenCalled()
      expect(getReader).not.toHaveBeenCalled()
      expect(supabaseMock).not.toHaveBeenCalled()
      expect(authMock).not.toHaveBeenCalled()
      expect(paywallMock).not.toHaveBeenCalled()
      expect(rateLimitMock).not.toHaveBeenCalled()
      expect(correctionMock).not.toHaveBeenCalled()
    },
  )

  it('authenticates before params, paywall, quota, media, body, or domain work', async () => {
    authMock.mockResolvedValue(null)
    let paramsRead = false
    const request = jsonRequest()
    const getReader = vi.spyOn(request.body!, 'getReader')

    const response = await POST(request, {
      params: {
        then() {
          paramsRead = true
          return Promise.resolve({ id: TICKET_ID })
        },
      } as Promise<{ id: string }>,
    })

    await expectJson(response, 401, { error: 'unauthenticated' })
    expect(paramsRead).toBe(false)
    expect(paywallMock).not.toHaveBeenCalled()
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(getReader).not.toHaveBeenCalled()
    expect(correctionMock).not.toHaveBeenCalled()
  })

  it.each([
    ['deactivated', { error: 'deactivated' }],
    ['paywall', { error: 'paywall', reason: 'past_due' }],
  ] as const)('normalizes the shared %s response to no-store before downstream work', async (
    _label,
    body,
  ) => {
    paywallMock.mockResolvedValue(NextResponse.json(body, { status: 403 }))
    const request = jsonRequest()
    const getReader = vi.spyOn(request.body!, 'getReader')

    const response = await POST(request, params())

    await expectJson(response, 403, body)
    expect(paywallMock).toHaveBeenCalledWith({}, USER_ID)
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(getReader).not.toHaveBeenCalled()
    expect(correctionMock).not.toHaveBeenCalled()
  })

  it('hides a profile without a shop after paywall and before quota or domain work', async () => {
    authMock.mockResolvedValue({
      ...authContext,
      profile: { ...profile, shopId: null },
    } as never)
    const request = jsonRequest()
    const getReader = vi.spyOn(request.body!, 'getReader')

    const response = await POST(request, params())

    await expectJson(response, 404, { error: 'not_found' })
    expect(paywallMock).toHaveBeenCalledWith({}, USER_ID)
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(getReader).not.toHaveBeenCalled()
    expect(correctionMock).not.toHaveBeenCalled()
  })

  it('validates and lowercases each route UUID before using one actor-scoped quota bucket', async () => {
    await POST(jsonRequest(), params(UPPERCASE_TICKET_ID))
    await POST(jsonRequest(), params(ROTATED_TICKET_ID.toUpperCase()))

    expect(rateLimitMock).toHaveBeenCalledTimes(2)
    for (const call of rateLimitMock.mock.calls) {
      expect(call).toEqual([
        {},
        `ticket-correction:${SHOP_ID}:${PROFILE_ID}`,
        20,
      ])
    }
    expect(correctionMock.mock.calls).toEqual([
      [{}, { actor, ticketId: TICKET_ID, body: validBody }],
      [{}, { actor, ticketId: ROTATED_TICKET_ID, body: validBody }],
    ])
  })

  it('rejects a malformed route UUID before quota, media, body, or domain work', async () => {
    const request = jsonRequest()
    const getReader = vi.spyOn(request.body!, 'getReader')

    const response = await POST(request, params('not-a-ticket-uuid'))

    await expectJson(response, 400, { error: 'invalid_input' })
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(getReader).not.toHaveBeenCalled()
    expect(correctionMock).not.toHaveBeenCalled()
  })

  it('preserves the canonical quota denial body and Retry-After before reading the request', async () => {
    const resetAt = new Date('2026-08-03T12:00:30.000Z')
    const now = vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-08-03T12:00:00.000Z').getTime())
    rateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, resetAt })
    const request = jsonRequest()
    const getReader = vi.spyOn(request.body!, 'getReader')

    const response = await POST(request, params())

    await expectJson(response, 429, {
      error: 'rate_limited',
      resetAt: resetAt.toISOString(),
    })
    expect(response.headers.get('retry-after')).toBe('30')
    expect(getReader).not.toHaveBeenCalled()
    expect(correctionMock).not.toHaveBeenCalled()
    now.mockRestore()
  })

  it('fails closed with 503 when the canonical quota store throws', async () => {
    rateLimitMock.mockRejectedValue(new Error('limiter store unavailable'))
    const request = jsonRequest()
    const getReader = vi.spyOn(request.body!, 'getReader')

    const response = await POST(request, params())

    await expectJson(response, 503, { error: 'unavailable' })
    expect(getReader).not.toHaveBeenCalled()
    expect(correctionMock).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', null],
    ['form', 'application/x-www-form-urlencoded'],
    ['multipart', 'multipart/form-data; boundary=abc'],
    ['plain text', 'text/plain'],
    ['JSON suffix', 'application/ld+json'],
  ])('rejects %s media with exact 415 before stream or domain work', async (_label, contentType) => {
    const request = jsonRequest(validBody, { contentType })
    const getReader = vi.spyOn(request.body!, 'getReader')

    const response = await POST(request, params())

    await expectJson(response, 415, { error: 'unsupported_media_type' })
    expect(rateLimitMock).toHaveBeenCalledTimes(1)
    expect(getReader).not.toHaveBeenCalled()
    expect(correctionMock).not.toHaveBeenCalled()
  })

  it('accepts only the normalized application/json media type', async () => {
    const response = await POST(
      jsonRequest(validBody, { contentType: ' Application/JSON ; charset=UTF-8 ' }),
      params(),
    )

    await expectJson(response, 200, {
      outcome: 'changed',
      changed: true,
      scope: 'concern',
      invalidatedVersionNumber: null,
      ticket,
    })
    expect(correctionMock).toHaveBeenCalledTimes(1)
  })

  it('accepts exactly 8 KiB of actual JSON bytes', async () => {
    const raw = jsonOfExactly(8 * 1024)

    const response = await POST(jsonRequest(raw), params())

    expect(new TextEncoder().encode(raw)).toHaveLength(8 * 1024)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(correctionMock).toHaveBeenCalledWith({}, {
      actor,
      ticketId: TICKET_ID,
      body: { value: 'x'.repeat(8 * 1024 - 12) },
    })
  })

  it.each([
    ['without Content-Length', undefined],
    ['with an understated Content-Length', '1'],
  ])('rejects actual UTF-8 bytes over 8 KiB %s', async (_label, contentLength) => {
    const raw = JSON.stringify({ value: 'é'.repeat(4_100) })
    const response = await POST(jsonRequest(raw, { contentLength }), params())

    expect(new TextEncoder().encode(raw).byteLength).toBeGreaterThan(8 * 1024)
    await expectJson(response, 413, { error: 'payload_too_large' })
    expect(correctionMock).not.toHaveBeenCalled()
  })

  it('honors an oversized Content-Length as an early refusal hint without consuming the stream', async () => {
    const body = new ReadableStream<Uint8Array>({})
    const getReader = vi.spyOn(body, 'getReader')
    const request = {
      headers: new Headers({
        'content-type': 'application/json',
        'content-length': String(8 * 1024 + 1),
      }),
      body,
    } as Request

    const response = await POST(request, params())

    await expectJson(response, 413, { error: 'payload_too_large' })
    expect(getReader).not.toHaveBeenCalled()
    expect(correctionMock).not.toHaveBeenCalled()
  })

  it('maps malformed JSON to 400 before domain work', async () => {
    const response = await POST(jsonRequest('{'), params())

    await expectJson(response, 400, { error: 'invalid_json' })
    expect(correctionMock).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid_input', 400],
    ['unavailable', 404],
    ['not_found', 404],
    ['forbidden', 403],
    ['conflict', 409],
    ['ticket_not_open', 409],
    ['job_not_open', 409],
    ['last_job', 409],
  ] as const)('maps domain %s to exact status %d without leaking ticket data', async (error, status) => {
    correctionMock.mockResolvedValue({
      ok: false,
      error,
      ticket: { id: 'cross-shop-ticket', concern: 'must not leak' },
    } as never)

    const response = await POST(jsonRequest(), params())

    await expectJson(response, status, { error })
  })

  it('preserves retryable conflict truth and strips every unrelated domain field', async () => {
    correctionMock.mockResolvedValue({
      ok: false,
      error: 'conflict',
      retryable: true,
      ticket: { id: 'cross-shop-ticket' },
      reason: 'internal lock detail',
    } as never)

    const response = await POST(jsonRequest(), params())

    await expectJson(response, 409, { error: 'conflict', retryable: true })
  })

  it.each([
    ['changed', true, 'identity', 7],
    ['replayed', false, 'job', 4],
    ['unchanged', false, 'job_removed', null],
  ] as const)('returns the exact 200 %s success shape with no-store', async (
    outcome,
    changed,
    scope,
    invalidatedVersionNumber,
  ) => {
    correctionMock.mockResolvedValue({
      ok: true,
      outcome,
      changed,
      scope,
      invalidatedVersionNumber,
      ticket,
      internalReceipt: { secret: true },
    } as never)

    const response = await POST(jsonRequest(), params())

    await expectJson(response, 200, {
      outcome,
      changed,
      scope,
      invalidatedVersionNumber,
      ticket,
    })
  })
})
