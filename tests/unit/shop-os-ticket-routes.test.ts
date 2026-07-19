import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({
  requireUserAndProfile: vi.fn(),
}))
vi.mock('@/lib/auth-access', () => ({
  paywallReject: vi.fn(),
}))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/tickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tickets')>()
  return {
    ...actual,
    createTicket: vi.fn(),
    getTicketDetail: vi.fn(),
    addTicketJob: vi.fn(),
  }
})

import { POST as createTicketRoute } from '@/app/api/tickets/route'
import { GET as getTicketRoute } from '@/app/api/tickets/[id]/route'
import { POST as addTicketJobRoute } from '@/app/api/tickets/[id]/jobs/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import {
  addTicketJob,
  createTicket,
  getTicketDetail,
  ticketActorFromProfile,
  ticketDomainStatus,
  type TicketDomainError,
} from '@/lib/tickets'

const requireUserMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const createTicketMock = vi.mocked(createTicket)
const getTicketMock = vi.mocked(getTicketDetail)
const addTicketJobMock = vi.mocked(addTicketJob)

const TICKET_ID = '00000000-0000-0000-0000-000000000101'
const profile = {
  id: '00000000-0000-0000-0000-000000000201',
  userId: '00000000-0000-0000-0000-000000000301',
  shopId: '00000000-0000-0000-0000-000000000401',
  fullName: 'Avery Advisor',
  role: 'advisor',
  skillTier: 2,
  membershipStatus: 'active' as const,
  membershipActivatedAt: new Date('2026-07-10T12:00:00Z'),
  isComp: false,
  isCurator: false,
  lastSeenWhatsNewAt: null,
  deactivatedAt: null,
  createdAt: new Date('2026-07-10T12:00:00Z'),
}
const authContext = {
  profile,
  user: { id: profile.userId, email: 'avery@shop.test' },
}
const actor = {
  profileId: profile.id,
  shopId: profile.shopId,
  role: profile.role,
  skillTier: profile.skillTier,
  membershipStatus: profile.membershipStatus,
  deactivatedAt: profile.deactivatedAt,
}
const ticket = { id: TICKET_ID, ticketNumber: 101, status: 'open' }

function invalidJsonRequest(path: string): Request {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    body: 'not json{',
    headers: { 'content-type': 'application/json' },
  })
}

const params = () => ({ params: Promise.resolve({ id: TICKET_ID }) })

describe('ticket route helpers', () => {
  it('translates only the profile fields used by the ticket domain actor', () => {
    expect(ticketActorFromProfile(profile)).toEqual(actor)
  })

  it.each<[TicketDomainError, number]>([
    ['invalid_input', 422],
    ['invalid_assignee', 422],
    ['forbidden', 403],
    ['no_shop', 403],
    ['inactive_profile', 403],
    ['not_found', 404],
    ['tier_confirmation_required', 409],
    ['ticket_not_open', 409],
  ])('maps %s to HTTP %i', (error, status) => {
    expect(ticketDomainStatus({ ok: false, error }, 201)).toBe(status)
  })

  it('preserves the caller supplied success status', () => {
    expect(ticketDomainStatus({ ok: true }, 201)).toBe(201)
    expect(ticketDomainStatus({ ok: true }, 200)).toBe(200)
  })
})

describe('ticket HTTP access and contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireUserMock.mockResolvedValue(authContext)
    paywallMock.mockResolvedValue(null)
  })

  it.each([
    {
      name: 'GET /api/tickets/:id',
      invoke: () =>
        getTicketRoute(new Request(`http://localhost/api/tickets/${TICKET_ID}`), params()),
    },
  ])('$name authenticates first and returns the exact unauthenticated contract', async ({ invoke }) => {
    requireUserMock.mockResolvedValue(null)

    const response = await invoke()

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(paywallMock).not.toHaveBeenCalled()
    expect(createTicketMock).not.toHaveBeenCalled()
    expect(getTicketMock).not.toHaveBeenCalled()
    expect(addTicketJobMock).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'GET /api/tickets/:id',
      invoke: () =>
        getTicketRoute(new Request(`http://localhost/api/tickets/${TICKET_ID}`), params()),
    },
  ])('$name returns the paywall response before parsing or domain access', async ({ invoke }) => {
    paywallMock.mockResolvedValue(
      NextResponse.json({ error: 'paywall', reason: 'past_due' }, { status: 403 }),
    )

    const response = await invoke()

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'paywall', reason: 'past_due' })
    expect(paywallMock).toHaveBeenCalledWith({}, profile.userId)
    expect(createTicketMock).not.toHaveBeenCalled()
    expect(getTicketMock).not.toHaveBeenCalled()
    expect(addTicketJobMock).not.toHaveBeenCalled()
  })

  it('retires generic ticket creation before auth, parsing, or domain work', async () => {
    const response = await createTicketRoute(invalidJsonRequest('/api/tickets'))

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
    expect(requireUserMock).not.toHaveBeenCalled()
    expect(paywallMock).not.toHaveBeenCalled()
    expect(createTicketMock).not.toHaveBeenCalled()
  })

  it('retires public add-job before auth, parsing, route parameters, or domain work', async () => {
    let paramsRead = false
    const response = await addTicketJobRoute(
      invalidJsonRequest(`/api/tickets/${TICKET_ID}/jobs`),
      {
        params: {
          then() {
            paramsRead = true
            return Promise.resolve({ id: TICKET_ID })
          },
        } as Promise<{ id: string }>,
      },
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
    expect(paramsRead).toBe(false)
    expect(requireUserMock).not.toHaveBeenCalled()
    expect(paywallMock).not.toHaveBeenCalled()
    expect(addTicketJobMock).not.toHaveBeenCalled()
  })

  it('forwards the route parameter and returns ticket detail JSON', async () => {
    getTicketMock.mockResolvedValue({ ok: true, ticket } as never)

    const response = await getTicketRoute(
      new Request(`http://localhost/api/tickets/${TICKET_ID}`),
      params(),
    )

    expect(getTicketMock).toHaveBeenCalledWith({}, { actor, ticketId: TICKET_ID })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ticket })
  })

  it('maps a missing ticket to the exact 404 error JSON', async () => {
    getTicketMock.mockResolvedValue({ ok: false, error: 'not_found' })

    const response = await getTicketRoute(
      new Request(`http://localhost/api/tickets/${TICKET_ID}`),
      params(),
    )

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
  })

})
