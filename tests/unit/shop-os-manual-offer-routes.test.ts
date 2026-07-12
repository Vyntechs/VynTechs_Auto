import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/shop-os/parts-offers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/parts-offers')>()
  return { ...actual, captureManualOffer: vi.fn(), removeManualOffer: vi.fn() }
})

import { POST as capture } from '@/app/api/tickets/[id]/quote/jobs/[jobId]/parts/manual-offers/route'
import { DELETE as remove } from '@/app/api/tickets/[id]/quote/jobs/[jobId]/parts/manual-offers/[lineId]/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { captureManualOffer, removeManualOffer } from '@/lib/shop-os/parts-offers'

const TICKET = '00000000-0000-4000-8000-000000000020'
const JOB = '00000000-0000-4000-8000-000000000030'
const LINE = '00000000-0000-4000-8000-000000000040'
const ACCOUNT = '00000000-0000-4000-8000-000000000050'
const profile = { id: '00000000-0000-4000-8000-000000000001', userId: '00000000-0000-4000-8000-000000000101' }
const authContext = { profile, user: { id: profile.userId } }
const offer = { clientKey: LINE, vendorAccountId: ACCOUNT, description: 'Pads' }
const authMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const captureMock = vi.mocked(captureManualOffer)
const removeMock = vi.mocked(removeManualOffer)

const request = (body?: unknown, raw?: string) => new Request('http://localhost/x', {
  method: 'POST', body: raw ?? JSON.stringify(body), headers: { 'content-type': 'application/json' },
})
const params = () => ({ params: Promise.resolve({ id: TICKET, jobId: JOB }) })
const removeParams = () => ({ params: Promise.resolve({ id: TICKET, jobId: JOB, lineId: LINE }) })

describe('Shop OS manual offer routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(authContext as never)
    paywallMock.mockResolvedValue(null)
  })

  it.each([
    ['capture', () => capture(request(offer), params()), captureMock],
    ['remove', () => remove(new Request('http://localhost/x', { method: 'DELETE' }), removeParams()), removeMock],
  ])('authenticates and paywalls before %s domain access', async (_name, invoke, domainMock) => {
    authMock.mockResolvedValue(null)
    let response = await invoke()
    expect(response.status).toBe(401)
    expect(paywallMock).not.toHaveBeenCalled()
    expect(domainMock).not.toHaveBeenCalled()

    authMock.mockResolvedValue(authContext as never)
    paywallMock.mockResolvedValue(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    response = await invoke()
    expect(response.status).toBe(403)
    expect(domainMock).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON and forwards the strict capture body', async () => {
    let response = await capture(request(undefined, 'not-json{'), params())
    expect(response.status).toBe(400)
    expect(captureMock).not.toHaveBeenCalled()
    captureMock.mockResolvedValue({
      ok: true,
      changed: true,
      line: {
        id: LINE, jobId: JOB, kind: 'part', description: 'Pads', quantity: '1',
        priceCents: 500, taxable: true, partNumber: null, brand: null, fitment: null,
        source: 'vendor_offer', mutable: false,
      },
      sourcing: {
        vendorAccountId: ACCOUNT, displayName: 'Local Parts', externalOfferId: null,
        unitCostCents: 200, coreChargeCents: 0, availability: 'in_stock',
        fulfillment: { method: 'pickup', locationLabel: null },
        fetchedAt: '2026-07-12T00:00:00.000Z',
      },
    })
    response = await capture(request(offer), params())
    expect(response.status).toBe(201)
    expect(captureMock).toHaveBeenCalledWith({}, {
      actor: { profileId: profile.id }, ticketId: TICKET, jobId: JOB, body: offer,
    })
  })

  it('returns unavailable, removal, and safe domain errors with exact statuses', async () => {
    captureMock.mockResolvedValue({ ok: true, changed: false, unavailable: true })
    let response = await capture(request(offer), params())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ changed: false, unavailable: true })

    removeMock.mockResolvedValue({ ok: true, changed: false })
    response = await remove(new Request('http://localhost/x', { method: 'DELETE' }), removeParams())
    expect(response.status).toBe(200)
    expect(removeMock).toHaveBeenCalledWith({}, {
      actor: { profileId: profile.id }, ticketId: TICKET, jobId: JOB, lineId: LINE,
    })

    captureMock.mockResolvedValue({ ok: false, error: 'conflict', retryable: true })
    response = await capture(request(offer), params())
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'conflict', retryable: true })
  })
})
