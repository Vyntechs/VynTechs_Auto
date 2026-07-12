import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, paywall, founder, list, create, update } = vi.hoisted(() => ({
  auth: vi.fn(),
  paywall: vi.fn(),
  founder: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: auth, isFounder: founder }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: paywall }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/shop-os/parts', async (original) => ({
  ...(await original<typeof import('@/lib/shop-os/parts')>()),
  listVendorAccounts: list,
  createManualVendorAccount: create,
  updateManualVendorAccount: update,
}))

import { GET, POST } from '@/app/api/shop/vendor-accounts/route'
import { PATCH } from '@/app/api/shop/vendor-accounts/[accountId]/route'

const PROFILE_ID = '00000000-0000-4000-8000-000000000001'
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000050'
const CLIENT_KEY = '00000000-0000-4000-8000-000000000051'
const UPDATED_AT = '2026-07-11T12:00:00.000Z'
const authContext = {
  user: { id: 'user-1', email: 'owner@test.dev' },
  profile: { id: PROFILE_ID, role: 'owner' },
}
const account = { id: ACCOUNT_ID, displayName: 'Main Street Parts', mode: 'manual', enabled: true, updatedAt: UPDATED_AT }
const request = (url: string, method: string, body?: unknown, raw?: string) => new Request(url, {
  method,
  headers: { 'content-type': 'application/json' },
  ...(method === 'GET' ? {} : { body: raw ?? JSON.stringify(body) }),
})
const params = (accountId = ACCOUNT_ID) => ({ params: Promise.resolve({ accountId }) })

describe('Shop OS vendor account routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.mockResolvedValue(authContext)
    paywall.mockResolvedValue(null)
    founder.mockReturnValue(false)
  })

  const calls = () => [
    { invoke: () => GET(request('http://test/api/shop/vendor-accounts', 'GET')), mock: list },
    { invoke: () => POST(request('http://test/api/shop/vendor-accounts', 'POST', { clientKey: CLIENT_KEY, displayName: 'Main Street Parts' })), mock: create },
    { invoke: () => PATCH(request(`http://test/api/shop/vendor-accounts/${ACCOUNT_ID}`, 'PATCH', { displayName: 'Renamed', enabled: false, expectedUpdatedAt: UPDATED_AT }), params()), mock: update },
  ]

  it.each(calls())('authenticates and checks paywall before domain access', async ({ invoke, mock }) => {
    auth.mockResolvedValue(null)
    let response = await invoke()
    expect(response.status).toBe(401)
    expect(mock).not.toHaveBeenCalled()
    auth.mockResolvedValue(authContext)
    paywall.mockResolvedValue(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    response = await invoke()
    expect(response.status).toBe(403)
    expect(mock).not.toHaveBeenCalled()
  })

  it('strictly validates query and mutation envelopes before domain access', async () => {
    expect((await GET(request('http://test/api/shop/vendor-accounts?extra=true', 'GET'))).status).toBe(422)
    expect((await GET(request('http://test/api/shop/vendor-accounts?scope=all&scope=all', 'GET'))).status).toBe(422)
    expect((await GET(request('http://test/api/shop/vendor-accounts?scope=enabled', 'GET'))).status).toBe(422)
    expect((await POST(request('http://test/x', 'POST', { clientKey: CLIENT_KEY, displayName: 'Supplier', vendor: 'manual' }))).status).toBe(422)
    expect((await PATCH(request('http://test/x', 'PATCH', { displayName: 'Renamed', enabled: true, expectedUpdatedAt: UPDATED_AT, config: {} }), params())).status).toBe(422)
    expect((await POST(request('http://test/x', 'POST', undefined, 'bad{'))).status).toBe(400)
    expect((await PATCH(request('http://test/x', 'PATCH', undefined, 'bad{'), params())).status).toBe(400)
    expect(list).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('forwards route-derived founder authority and exact inputs with honest success codes', async () => {
    founder.mockReturnValue(true)
    list.mockResolvedValue({ ok: true, vendorAccounts: [account] })
    create.mockResolvedValue({ ok: true, changed: true, vendorAccount: account })
    update.mockResolvedValue({ ok: true, changed: false, vendorAccount: account })

    const listed = await GET(request('http://test/api/shop/vendor-accounts?scope=all', 'GET'))
    expect(listed.status).toBe(200)
    expect(list).toHaveBeenCalledWith({}, { actor: { profileId: PROFILE_ID, founderOverride: true }, scope: 'all' })
    const created = await POST(request('http://test/api/shop/vendor-accounts', 'POST', { clientKey: CLIENT_KEY, displayName: 'Main Street Parts' }))
    expect(created.status).toBe(201)
    expect(create).toHaveBeenCalledWith({}, {
      actor: { profileId: PROFILE_ID, founderOverride: true }, clientKey: CLIENT_KEY, body: { displayName: 'Main Street Parts' },
    })
    const patched = await PATCH(request('http://test/x', 'PATCH', { displayName: 'Renamed', enabled: false, expectedUpdatedAt: UPDATED_AT }), params())
    expect(patched.status).toBe(200)
    expect(update).toHaveBeenCalledWith({}, {
      actor: { profileId: PROFILE_ID, founderOverride: true }, vendorAccountId: ACCOUNT_ID,
      body: { displayName: 'Renamed', enabled: false, expectedUpdatedAt: UPDATED_AT },
    })
  })

  it('serializes only the strict public account projection', async () => {
    const unsafe = { ...account, shopId: 'SECRET_SHOP', nonSecretConfig: { token: 'SECRET' }, secretRef: 'SECRET_REF' }
    list.mockResolvedValue({ ok: true, vendorAccounts: [unsafe] })
    create.mockResolvedValue({ ok: true, changed: false, vendorAccount: unsafe })
    update.mockResolvedValue({ ok: true, changed: true, vendorAccount: unsafe })
    for (const response of [
      await GET(request('http://test/api/shop/vendor-accounts', 'GET')),
      await POST(request('http://test/x', 'POST', { clientKey: CLIENT_KEY, displayName: 'Main Street Parts' })),
      await PATCH(request('http://test/x', 'PATCH', { displayName: 'Renamed', enabled: false, expectedUpdatedAt: UPDATED_AT }), params()),
    ]) {
      const serialized = JSON.stringify(await response.json())
      expect(serialized).toContain('Main Street Parts')
      expect(serialized).not.toMatch(/SECRET|shopId|nonSecretConfig|secretRef|token/)
    }
  })

  it.each([
    [{ ok: false, error: 'invalid_input' }, 422],
    [{ ok: false, error: 'not_found' }, 404],
    [{ ok: false, error: 'conflict', retryable: false }, 409],
  ])('maps privacy-safe domain failures', async (result, status) => {
    list.mockResolvedValue(result)
    const response = await GET(request('http://test/api/shop/vendor-accounts', 'GET'))
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error: result.error })
  })
})
