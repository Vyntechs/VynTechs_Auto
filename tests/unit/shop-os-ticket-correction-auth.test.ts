import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/curator/role-gate', () => ({ guardCuratorRoute: vi.fn() }))
vi.mock('@/lib/auth-access', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth-access')>()
  return {
    ...actual,
    checkAccess: vi.fn(),
    isTicketCorrectionRoute: (actual as typeof actual & {
      isTicketCorrectionRoute?: (path: string) => boolean
    }).isTicketCorrectionRoute,
  }
})

import { createServerClient } from '@supabase/ssr'
import * as authAccess from '@/lib/auth-access'
import { config, middleware } from '@/middleware'

const TICKET_ID = 'abcdef12-3456-4abc-8def-abcdef123456'
const CORRECTION_PATH = `/api/tickets/${TICKET_ID}/corrections`
const USER_ID = '00000000-0000-4000-8000-000000000001'

const createServerClientMock = vi.mocked(createServerClient)
const checkAccessMock = vi.mocked(authAccess.checkAccess)
const getUser = vi.fn()

function request(pathname: string, method = 'POST'): NextRequest {
  return new NextRequest(`https://vyntechs.dev${pathname}`, { method })
}

function exactCorrectionMatcher(pathname: string): boolean {
  const matcher = (authAccess as typeof authAccess & {
    isTicketCorrectionRoute?: (path: string) => boolean
  }).isTicketCorrectionRoute
  expect(matcher).toBeTypeOf('function')
  return matcher!(pathname)
}

async function expectJson(response: Response, status: number, body: unknown): Promise<void> {
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('no-store')
  await expect(response.json()).resolves.toEqual(body)
}

describe('Shop OS ticket-correction middleware boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', 'true')
    getUser.mockResolvedValue({ data: { user: null } })
    createServerClientMock.mockReturnValue({ auth: { getUser } } as never)
    checkAccessMock.mockResolvedValue({
      kind: 'allow',
      entitlements: { diagnostics: false },
    } as never)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('matches only the exact ticket-correction endpoint', () => {
    expect(exactCorrectionMatcher(CORRECTION_PATH)).toBe(true)
    expect(exactCorrectionMatcher('/api/tickets/one/corrections')).toBe(true)
    expect(exactCorrectionMatcher(`/api/tickets/${TICKET_ID.toUpperCase()}/corrections`)).toBe(true)

    expect(exactCorrectionMatcher('/api/tickets/corrections')).toBe(false)
    expect(exactCorrectionMatcher(`/api/tickets/${TICKET_ID}/correction`)).toBe(false)
    expect(exactCorrectionMatcher(`${CORRECTION_PATH}/`)).toBe(false)
    expect(exactCorrectionMatcher(`${CORRECTION_PATH}/history`)).toBe(false)
    expect(exactCorrectionMatcher(`/api/tickets/${TICKET_ID}/quote/corrections`)).toBe(false)
    expect(exactCorrectionMatcher(`/tickets/${TICKET_ID}/corrections`)).toBe(false)
  })

  it('keeps the exact endpoint non-exempt and classified as an API route', () => {
    expect(authAccess.isPaywallExempt(CORRECTION_PATH)).toBe(false)
    expect(authAccess.isApiRoute(CORRECTION_PATH)).toBe(true)
  })

  it('keeps the endpoint inside the global middleware matcher', () => {
    const configured = config.matcher[0]
    expect(configured).toBeTypeOf('string')
    const matcher = new RegExp(`^${configured!}$`)

    expect(matcher.test(CORRECTION_PATH)).toBe(true)
    expect(matcher.test(`/_next/static/${TICKET_ID}/corrections.js`)).toBe(false)
  })

  it('places the exact disabled gate before session refresh in middleware source', () => {
    const source = readFileSync(resolve(process.cwd(), 'middleware.ts'), 'utf8')
    const releaseGate = source.indexOf('isTicketCorrectionRoute(pathname)')
    const sessionRefresh = source.indexOf('await refreshSession(req)')

    expect(releaseGate).toBeGreaterThan(-1)
    expect(sessionRefresh).toBeGreaterThan(releaseGate)
  })

  it.each([undefined, 'false', 'TRUE'])(
    'returns the shared no-store 404 without creating a session client when the flag is %s',
    async (flag) => {
      vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', flag)

      const response = await middleware(request(CORRECTION_PATH))

      await expectJson(response, 404, { error: 'unavailable' })
      expect(createServerClientMock).not.toHaveBeenCalled()
      expect(getUser).not.toHaveBeenCalled()
      expect(checkAccessMock).not.toHaveBeenCalled()
    },
  )

  it('leaves neighboring ticket routes on the normal authenticated middleware path while disabled', async () => {
    vi.stubEnv('SHOP_OS_TICKET_CORRECTION_ENABLED', undefined)

    const response = await middleware(request(`/api/tickets/${TICKET_ID}`))

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(createServerClientMock).toHaveBeenCalledTimes(1)
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it('returns an enabled unauthenticated correction denial with no-store', async () => {
    const response = await middleware(request(CORRECTION_PATH))

    await expectJson(response, 401, { error: 'unauthenticated' })
    expect(checkAccessMock).not.toHaveBeenCalled()
  })

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    'marks the authenticated enabled %s pass-through no-store for the generated 405 boundary',
    async (method) => {
      getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })

      const response = await middleware(request(CORRECTION_PATH, method))

      expect(response.headers.get('x-middleware-next')).toBe('1')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(checkAccessMock).toHaveBeenCalledWith({}, USER_ID)

      const neighbor = await middleware(request(`/api/tickets/${TICKET_ID}`, method))
      expect(neighbor.headers.get('cache-control')).toBeNull()
    },
  )

  it.each([
    ['deactivated', { kind: 'deactivated' }, { error: 'deactivated' }],
    [
      'paywall',
      { kind: 'paywall', reason: 'past_due' },
      { error: 'paywall', reason: 'past_due' },
    ],
  ] as const)('returns the enabled %s correction denial with no-store', async (
    _label,
    access,
    body,
  ) => {
    getUser.mockResolvedValue({ data: { user: { id: USER_ID } } })
    checkAccessMock.mockResolvedValue(access as never)

    const response = await middleware(request(CORRECTION_PATH))

    await expectJson(response, 403, body)
    expect(checkAccessMock).toHaveBeenCalledWith({}, USER_ID)
  })
})
