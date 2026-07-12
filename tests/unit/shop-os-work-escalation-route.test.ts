import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/shop-os/simple-work', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/simple-work')>()
  return { ...actual, createWorkEscalation: vi.fn() }
})

import { POST } from '@/app/api/tickets/[id]/jobs/[jobId]/escalations/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import { createWorkEscalation } from '@/lib/shop-os/simple-work'

const TICKET = '00000000-0000-4000-8000-000000000020'
const JOB = '00000000-0000-4000-8000-000000000030'
const NEW_JOB = '00000000-0000-4000-8000-000000000090'
const profile = { id: '00000000-0000-4000-8000-000000000001', userId: '00000000-0000-4000-8000-000000000101', shopId: '00000000-0000-4000-8000-000000000201' }
const params = { params: Promise.resolve({ id: TICKET, jobId: JOB }) }

function request(body: string) {
  return new Request('http://localhost/escalations', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
}

describe('Shop OS work escalation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    vi.mocked(paywallReject).mockResolvedValue(null)
  })

  it('authenticates before parsing and rejects malformed JSON', async () => {
    vi.mocked(requireUserAndProfile).mockResolvedValue(null)
    expect((await POST(request('{'), params)).status).toBe(401)
    expect(createWorkEscalation).not.toHaveBeenCalled()
    vi.mocked(requireUserAndProfile).mockResolvedValue({ user: { id: profile.userId }, profile } as never)
    expect((await POST(request('{'), params)).status).toBe(400)
  })

  it('passes persisted actor identity and returns the bounded job projection', async () => {
    const body = { requestKey: NEW_JOB, concern: 'Found a clunk', requiredSkillTier: 2 }
    vi.mocked(createWorkEscalation).mockResolvedValue({
      ok: true, changed: true,
      job: { id: NEW_JOB, title: 'Diagnose: Found a clunk', kind: 'diagnostic', requiredSkillTier: 2, assignedTechId: null, workStatus: 'open', approvalState: 'pending_quote', sessionId: null },
    })
    const response = await POST(request(JSON.stringify(body)), params)
    expect(response.status).toBe(201)
    expect(createWorkEscalation).toHaveBeenCalledWith({}, {
      actor: { profileId: profile.id, shopId: profile.shopId }, ticketId: TICKET, sourceJobId: JOB, body,
    })
    expect(await response.json()).toMatchObject({ changed: true, job: { id: NEW_JOB, assignedTechId: null } })
  })

  it.each([
    ['invalid_input', 400, false], ['not_found', 404, false], ['not_authorized', 409, false],
    ['not_ready', 409, false], ['conflict', 409, true],
  ] as const)('maps %s safely', async (error, status, retryable) => {
    vi.mocked(createWorkEscalation).mockResolvedValue({ ok: false, error, ...(retryable ? { retryable: true } : {}) })
    const response = await POST(request('{}'), params)
    expect(response.status).toBe(status)
    expect(await response.json()).toEqual({ error, ...(retryable ? { retryable: true } : {}) })
  })
})
