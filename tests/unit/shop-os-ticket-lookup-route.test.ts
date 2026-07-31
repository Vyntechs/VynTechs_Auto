import { describe, expect, it, beforeEach, vi } from 'vitest'

vi.mock('@/lib/shop-os/ticket-lookup', () => ({
  lookupTickets: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))
// Stub the paywall check so the test exercises route logic only — the
// route's real paywall path is covered by auth-access.test.ts.
vi.mock('@/lib/auth-access', () => ({
  paywallReject: vi.fn(async () => null),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimitReject: vi.fn(async () => null),
}))

import { POST } from '@/app/api/tickets/lookup/route'
import { lookupTickets } from '@/lib/shop-os/ticket-lookup'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { rateLimitReject } from '@/lib/rate-limit'

const lookupMock = vi.mocked(lookupTickets)
const authMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const rateLimitMock = vi.mocked(rateLimitReject)

function req(body: unknown) {
  return new Request('http://localhost/api/tickets/lookup', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

const techProfile = {
  id: 'p1',
  userId: 'u1',
  shopId: 's1',
  fullName: 'Tech',
  role: 'tech',
  skillTier: 2,
  membershipStatus: 'active' as const,
  membershipActivatedAt: new Date(),
  isComp: false,
  isCurator: false,
  lastSeenWhatsNewAt: null,
  deactivatedAt: null,
  createdAt: new Date(),
}

const closedHit = {
  ticketId: '11111111-1111-4111-8111-111111111111',
  ticketNumber: 412,
  status: 'closed' as const,
  concern: 'engine ticking cold and hot',
  customerName: 'Drew G',
  vehicle: { year: 2021, make: 'RAM', model: '2500' },
  openedAt: new Date('2026-07-01T15:00:00Z'),
  closedAt: new Date('2026-07-02T18:30:00Z'),
}

describe('POST /api/tickets/lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    paywallMock.mockResolvedValue(null)
    rateLimitMock.mockResolvedValue(null)
    authMock.mockResolvedValue({ profile: techProfile, user: { id: 'u1', email: 't@shop.test' } })
  })

  it('returns a closed repair order, which the board can never show', async () => {
    lookupMock.mockResolvedValue([closedHit])

    const res = await POST(req({ q: 'RO 412' }))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tickets).toHaveLength(1)
    expect(body.tickets[0].ticketNumber).toBe(412)
    expect(body.tickets[0].status).toBe('closed')
    expect(typeof body.latencyMs).toBe('number')
  })

  it('passes the actor through so the projection can enforce shop scope', async () => {
    lookupMock.mockResolvedValue([])

    await POST(req({ q: 'smith' }))

    expect(lookupMock).toHaveBeenCalledWith(
      {},
      {
        actor: {
          profileId: 'p1',
          shopId: 's1',
          role: 'tech',
          skillTier: 2,
          membershipStatus: 'active',
          deactivatedAt: null,
        },
        q: 'smith',
      },
    )
  })

  it('carries no money — a technician can find work without seeing a balance', async () => {
    lookupMock.mockResolvedValue([closedHit])

    const body = await (await POST(req({ q: '412' }))).json()

    expect(Object.keys(body.tickets[0]).sort()).toEqual([
      'closedAt',
      'concern',
      'customerName',
      'openedAt',
      'status',
      'ticketId',
      'ticketNumber',
      'vehicle',
    ])
  })

  it('answers an empty query with nothing rather than listing the shop', async () => {
    const res = await POST(req({ q: '   ' }))

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ tickets: [] })
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('returns 401 when unauthenticated, before the body is read', async () => {
    authMock.mockResolvedValue(null)
    const json = vi.fn(async () => {
      throw new Error('body must not be parsed')
    })

    const res = await POST({ json } as unknown as Request)

    expect(res.status).toBe(401)
    expect(json).not.toHaveBeenCalled()
    expect(paywallMock).not.toHaveBeenCalled()
  })

  it('returns the paywall rejection before parsing or looking anything up', async () => {
    const { NextResponse } = await import('next/server')
    paywallMock.mockResolvedValue(
      NextResponse.json({ error: 'paywall', reason: 'past_due' }, { status: 403 }),
    )
    const json = vi.fn(async () => {
      throw new Error('body must not be parsed')
    })

    const res = await POST({ json } as unknown as Request)

    expect(res.status).toBe(403)
    expect(json).not.toHaveBeenCalled()
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('returns 403 when the profile has no shop', async () => {
    authMock.mockResolvedValue({
      profile: { ...techProfile, shopId: null },
      user: { id: 'u1', email: 't@shop.test' },
    })

    const res = await POST(req({ q: '412' }))

    expect(res.status).toBe(403)
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('returns 400 on invalid JSON', async () => {
    const badReq = new Request('http://localhost/api/tickets/lookup', {
      method: 'POST',
      body: 'not json',
      headers: { 'content-type': 'application/json' },
    })

    expect((await POST(badReq)).status).toBe(400)
  })

  it.each([
    ['over 256 characters', 'a'.repeat(257)],
    ['over eight tokens', 'a b c d e f g h i'],
    ['a token over 64 characters', 'a'.repeat(65)],
  ])('rejects a query %s before quota or database work', async (_label, q) => {
    const res = await POST(req({ q }))

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ error: 'query_too_complex' })
    expect(rateLimitMock).not.toHaveBeenCalled()
    expect(lookupMock).not.toHaveBeenCalled()
  })

  it('spends a per-user quota and stops before the database when exhausted', async () => {
    const { NextResponse } = await import('next/server')
    rateLimitMock.mockResolvedValue(NextResponse.json({ error: 'rate_limited' }, { status: 429 }))

    const res = await POST(req({ q: 'smith' }))

    expect(rateLimitMock).toHaveBeenCalledWith({}, 'ticket-lookup:u1', 60)
    expect(res.status).toBe(429)
    expect(lookupMock).not.toHaveBeenCalled()
  })
})
