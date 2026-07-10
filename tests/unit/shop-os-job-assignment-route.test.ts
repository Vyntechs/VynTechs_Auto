import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({})),
}))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/tickets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tickets')>()
  return { ...actual, mutateTicketJobAssignment: vi.fn() }
})

import { POST } from '@/app/api/tickets/[id]/jobs/[jobId]/assignment/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import {
  mutateTicketJobAssignment,
  type TicketDomainError,
} from '@/lib/tickets'

const authMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const mutationMock = vi.mocked(mutateTicketJobAssignment)

const TICKET_ID = '00000000-0000-0000-0000-000000000101'
const JOB_ID = '00000000-0000-0000-0000-000000000102'
const profile = {
  id: '00000000-0000-0000-0000-000000000201',
  userId: '00000000-0000-0000-0000-000000000301',
  shopId: '00000000-0000-0000-0000-000000000401',
  fullName: 'Taylor Tech',
  role: 'tech',
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
  user: { id: profile.userId, email: 'taylor@shop.test' },
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

function request(body: unknown): Request {
  return new Request(
    `http://localhost/api/tickets/${TICKET_ID}/jobs/${JOB_ID}/assignment`,
    {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    },
  )
}

function invalidJsonRequest(): Request {
  return new Request(
    `http://localhost/api/tickets/${TICKET_ID}/jobs/${JOB_ID}/assignment`,
    {
      method: 'POST',
      body: 'not json{',
      headers: { 'content-type': 'application/json' },
    },
  )
}

const params = () => ({
  params: Promise.resolve({ id: TICKET_ID, jobId: JOB_ID }),
})

describe('job assignment route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(authContext)
    paywallMock.mockResolvedValue(null)
  })

  it('authenticates before paywall, parsing, or domain access', async () => {
    authMock.mockResolvedValue(null)

    const response = await POST(invalidJsonRequest(), params())

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(paywallMock).not.toHaveBeenCalled()
    expect(mutationMock).not.toHaveBeenCalled()
  })

  it('returns the paywall response before parsing or domain access', async () => {
    paywallMock.mockResolvedValue(
      NextResponse.json({ error: 'paywall', reason: 'past_due' }, { status: 403 }),
    )

    const response = await POST(invalidJsonRequest(), params())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'paywall', reason: 'past_due' })
    expect(paywallMock).toHaveBeenCalledWith({}, profile.userId)
    expect(mutationMock).not.toHaveBeenCalled()
  })

  it('returns invalid_json without calling the domain', async () => {
    const response = await POST(invalidJsonRequest(), params())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' })
    expect(mutationMock).not.toHaveBeenCalled()
  })

  it.each([
    { action: 'claim' as const },
    { action: 'unclaim' as const },
    {
      action: 'reassign' as const,
      assignedTechId: '00000000-0000-0000-0000-000000000501',
      confirmBelowTier: true,
    },
  ])('forwards $action with the translated actor and returns the updated safe ticket', async (body) => {
    mutationMock.mockResolvedValue({ ok: true, ticket } as never)

    const response = await POST(request(body), params())

    expect(mutationMock).toHaveBeenCalledWith({}, {
      actor,
      ticketId: TICKET_ID,
      jobId: JOB_ID,
      body,
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ticket })
  })

  it('returns only the safe current assignee with a losing claim conflict', async () => {
    const currentAssignee = {
      id: '00000000-0000-0000-0000-000000000501',
      fullName: 'Winner Tech',
      role: 'tech',
      skillTier: 3,
    }
    mutationMock.mockResolvedValue({
      ok: false,
      error: 'assignment_conflict',
      currentAssignee,
    })

    const response = await POST(request({ action: 'claim' }), params())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'assignment_conflict',
      currentAssignee,
    })
  })

  it('never includes a current assignee outside an assignment conflict', async () => {
    mutationMock.mockResolvedValue({
      ok: false,
      error: 'forbidden',
      currentAssignee: {
        id: '00000000-0000-0000-0000-000000000501',
        fullName: 'Hidden Tech',
        role: 'tech',
        skillTier: 3,
      },
    })

    const response = await POST(request({ action: 'claim' }), params())

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' })
  })

  it('returns the structured tier warning without the domain discriminator', async () => {
    const warning = {
      code: 'below_required_tier' as const,
      assignedTechId: '00000000-0000-0000-0000-000000000501',
      assignedSkillTier: 1 as const,
      requiredSkillTier: 2 as const,
    }
    mutationMock.mockResolvedValue({
      ok: false,
      error: 'tier_confirmation_required',
      warning,
    })

    const response = await POST(request({
      action: 'reassign',
      assignedTechId: warning.assignedTechId,
    }), params())

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'tier_confirmation_required',
      warning,
    })
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
    ['job_not_open', 409],
    ['assignment_conflict', 409],
  ])('maps %s to HTTP %i without adding optional fields', async (error, status) => {
    mutationMock.mockResolvedValue({ ok: false, error })

    const response = await POST(request({ action: 'claim' }), params())

    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual({ error })
  })

  it('contains no assignment policy or action branching in the route shim', () => {
    const source = readFileSync(
      join(
        process.cwd(),
        'app/api/tickets/[id]/jobs/[jobId]/assignment/route.ts',
      ),
      'utf8',
    )

    expect(source).not.toMatch(/canAssignWork|canCreateTickets|skillTier|requiredSkillTier/)
    expect(source).not.toMatch(/body\.action|action\s*===|switch\s*\(/)
  })
})
