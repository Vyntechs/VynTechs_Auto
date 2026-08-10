import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitReject: vi.fn(async () => null) }))
vi.mock('@/lib/shop-os/parts-arrival', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/parts-arrival')>()
  return { ...actual, getPartsArrivalForTicket: vi.fn(), advancePartArrival: vi.fn() }
})

import { GET } from '@/app/api/tickets/[id]/jobs/[jobId]/parts-arrival/route'
import { POST } from '@/app/api/tickets/[id]/jobs/[jobId]/parts-arrival/[lineId]/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { advancePartArrival, getPartsArrivalForTicket } from '@/lib/shop-os/parts-arrival'
import { rateLimitReject } from '@/lib/rate-limit'

const TICKET = '00000000-0000-4000-8000-000000000020'
const JOB = '00000000-0000-4000-8000-000000000030'
const LINE = '00000000-0000-4000-8000-000000000050'
const PROFILE = '00000000-0000-4000-8000-000000000001'
const SHOP = '00000000-0000-4000-8000-000000000201'
const USER = '00000000-0000-4000-8000-000000000101'
const profile = { id: PROFILE, shopId: SHOP, userId: USER, role: 'parts' }
const job = {
  jobId: JOB,
  approvedQuoteVersionId: '00000000-0000-4000-8000-000000000040',
  title: 'Front brake service',
  readOnly: false,
  receivedCount: 0,
  totalCount: 1,
  allHere: false,
  lines: [{
    id: LINE,
    description: 'Front brake pads',
    quantity: '1',
    partNumber: 'PAD-1',
    brand: 'ACME',
    state: 'needs_order' as const,
    nextAction: 'mark_ordered' as const,
    ordered: null,
    received: null,
  }],
}

const getContext = { params: Promise.resolve({ id: TICKET, jobId: JOB }) }
const postContext = { params: Promise.resolve({ id: TICKET, jobId: JOB, lineId: LINE }) }

function postRequest(body: string, contentType = 'application/json') {
  return new Request('http://localhost/parts-arrival', {
    method: 'POST', headers: { 'content-type': contentType }, body,
  })
}

describe('Shop OS parts arrival routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: USER }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(null)
    vi.mocked(rateLimitReject).mockResolvedValue(null)
  })

  it('authenticates and applies the paywall before reading or mutating', async () => {
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    expect((await GET(new Request('http://localhost'), getContext)).status).toBe(401)
    expect((await POST(postRequest('{'), postContext)).status).toBe(401)
    expect(paywallReject).not.toHaveBeenCalled()
    expect(advancePartArrival).not.toHaveBeenCalled()

    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: USER }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    expect((await GET(new Request('http://localhost'), getContext)).status).toBe(403)
    expect((await POST(postRequest('{}'), postContext)).status).toBe(403)
    expect(getPartsArrivalForTicket).not.toHaveBeenCalled()
    expect(advancePartArrival).not.toHaveBeenCalled()
  })

  it('returns a no-store safe read projection using persisted identity', async () => {
    vi.mocked(getPartsArrivalForTicket).mockResolvedValue({ ok: true, jobs: [job] })
    const response = await GET(new Request('http://localhost'), getContext)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(getPartsArrivalForTicket).toHaveBeenCalledWith({}, {
      actor: { profileId: PROFILE }, ticketId: TICKET,
    })
    const serialized = JSON.stringify(await response.json())
    expect(serialized).toContain('Front brake pads')
    expect(serialized).not.toMatch(/shopId|unitCost|coreCharge|vendor|externalOffer|fitment|priceCents/)
  })

  it('meters before body access and rejects malformed, oversized, or wrong-media bodies', async () => {
    vi.mocked(rateLimitReject).mockResolvedValue(NextResponse.json({ error: 'rate_limited' }, { status: 429 }))
    expect((await POST(postRequest('{'), postContext)).status).toBe(429)
    expect(advancePartArrival).not.toHaveBeenCalled()
    vi.mocked(rateLimitReject).mockResolvedValue(null)
    expect((await POST(postRequest('{'), postContext)).status).toBe(400)
    expect((await POST(postRequest('{}', 'text/plain'), postContext)).status).toBe(415)
    expect((await POST(postRequest(JSON.stringify({ action: 'mark_ordered', note: 'x'.repeat(5_000) })), postContext)).status).toBe(413)
  })

  it('passes the strict action envelope and returns only domain truth', async () => {
    vi.mocked(advancePartArrival).mockResolvedValue({ ok: true, changed: true, job: {
      ...job,
      lines: [{ ...job.lines[0], state: 'ordered', nextAction: 'mark_received', ordered: { actorName: 'Pat Parts', at: '2026-08-09T20:00:00.000Z' } }],
    } })
    const response = await POST(postRequest(JSON.stringify({ action: 'mark_ordered' })), postContext)
    expect(response.status).toBe(201)
    expect(advancePartArrival).toHaveBeenCalledWith({}, {
      actor: { profileId: PROFILE }, ticketId: TICKET, jobId: JOB, lineId: LINE,
      body: { action: 'mark_ordered' },
    })
    expect(rateLimitReject).toHaveBeenCalledWith({}, `parts-arrival:${SHOP}:${PROFILE}`, 60)
    expect((await response.json()).changed).toBe(true)
  })

  it.each([
    ['invalid_input', 400, false],
    ['not_found', 404, false],
    ['conflict', 409, false],
    ['conflict', 409, true],
  ] as const)('maps %s safely at %s', async (error, status, retryable) => {
    vi.mocked(advancePartArrival).mockResolvedValue({
      ok: false, error, ...(retryable ? { retryable: true } : {}),
    })
    const response = await POST(postRequest(JSON.stringify({ action: 'mark_ordered' })), postContext)
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error, ...(retryable ? { retryable: true } : {}) })
  })
})
