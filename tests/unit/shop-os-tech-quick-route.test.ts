import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const { generateTreeMock, getUserMock } = vi.hoisted(() => ({
  generateTreeMock: vi.fn(),
  getUserMock: vi.fn(),
}))

vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn(async () => ({ auth: { getUser: getUserMock } })),
}))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitReject: vi.fn() }))
vi.mock('@/lib/db/queries', () => ({
  getProfileByUserId: vi.fn(),
  countOpenSessionsForTech: vi.fn(),
  getOpenSessionForTech: vi.fn(),
}))
vi.mock('@/lib/sessions', () => ({
  createSessionForUser: vi.fn(),
  findCompletedTechQuickSessionForUser: vi.fn(),
}))
vi.mock('@/lib/retrieval/wire-into-tree', () => ({
  buildGenerateInitialTreeWithRetrieval: vi.fn(() => generateTreeMock),
}))
vi.mock('@/lib/ai/tree-engine', () => ({ generateInitialTree: vi.fn() }))
vi.mock('@/lib/corpus/retrieval', () => ({ retrieveCorpus: vi.fn() }))
vi.mock('@/lib/retrieval/orchestrator', () => ({ runRetrieval: vi.fn() }))
vi.mock('@/lib/retrieval/validator', () => ({ validateRetrievalResults: vi.fn() }))
vi.mock('@/lib/retrieval/adapters/nhtsa', () => ({ NHTSAAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/manufacturer-recall', () => ({ ManufacturerRecallAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/forum', () => ({ ForumAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/youtube', () => ({ YouTubeAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/reddit', () => ({ RedditAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/web-search', () => ({ WebSearchAdapter: class {} }))

import { POST } from '@/app/api/sessions/route'
import { paywallReject } from '@/lib/auth-access'
import { rateLimitReject } from '@/lib/rate-limit'
import {
  countOpenSessionsForTech,
  getOpenSessionForTech,
  getProfileByUserId,
} from '@/lib/db/queries'
import {
  createSessionForUser,
  findCompletedTechQuickSessionForUser,
} from '@/lib/sessions'

const user = { id: '00000000-0000-4000-8000-000000000001' }
const requestKey = '00000000-0000-4000-8000-000000000002'
const intake = {
  vehicleYear: 2018,
  vehicleMake: 'Ford',
  vehicleModel: 'F-150',
  vehicleEngine: '3.5L EcoBoost',
  mileage: 85210,
  customerComplaint: 'Loss of power going up hills',
}
const body = { ...intake, requestKey }
const profile = {
  id: '00000000-0000-4000-8000-000000000003',
  userId: user.id,
  shopId: '00000000-0000-4000-8000-000000000004',
  role: 'tech',
  skillTier: 2,
  membershipStatus: 'active',
  deactivatedAt: null,
}
const ids = { id: requestKey, ticketId: 'ticket-1', jobId: 'job-1' }

const paywallMock = vi.mocked(paywallReject)
const quotaMock = vi.mocked(rateLimitReject)
const profileMock = vi.mocked(getProfileByUserId)
const countMock = vi.mocked(countOpenSessionsForTech)
const openMock = vi.mocked(getOpenSessionForTech)
const preflightMock = vi.mocked(findCompletedTechQuickSessionForUser)
const createMock = vi.mocked(createSessionForUser)

function request(payload: unknown): Request {
  return new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  })
}

describe('POST /api/sessions Shop OS wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUserMock.mockResolvedValue({ data: { user } })
    paywallMock.mockResolvedValue(null)
    profileMock.mockResolvedValue(profile as never)
    preflightMock.mockResolvedValue({ ok: true, state: 'missing' })
    quotaMock.mockResolvedValue(null)
    countMock.mockResolvedValue(0)
    generateTreeMock.mockResolvedValue({ currentNodeId: 'root' })
    createMock.mockResolvedValue({ ok: true, ...ids })
  })

  it('authenticates and checks the paywall before parsing or consuming quota', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const unauthenticated = await POST(request('not json{'))
    expect(unauthenticated.status).toBe(401)
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'unauthorized' })
    expect(paywallMock).not.toHaveBeenCalled()

    getUserMock.mockResolvedValue({ data: { user } })
    paywallMock.mockResolvedValue(
      NextResponse.json({ error: 'paywall', reason: 'past_due' }, { status: 403 }),
    )
    const paywalled = await POST(request('not json{'))
    expect(paywalled.status).toBe(403)
    expect(profileMock).not.toHaveBeenCalled()
    expect(quotaMock).not.toHaveBeenCalled()
  })

  it('requires a strict UUID request key before profile, quota, cap, or provider work', async () => {
    const response = await POST(request({ ...intake, requestKey: 'not-a-uuid' }))
    expect(response.status).toBe(400)
    expect(profileMock).not.toHaveBeenCalled()
    expect(preflightMock).not.toHaveBeenCalled()
    expect(quotaMock).not.toHaveBeenCalled()
    expect(countMock).not.toHaveBeenCalled()
    expect(generateTreeMock).not.toHaveBeenCalled()
  })

  it.each([
    ['missing profile', null],
    ['missing shop', { ...profile, shopId: null }],
    ['pending', { ...profile, membershipStatus: 'pending' }],
    ['deactivated', { ...profile, deactivatedAt: new Date('2026-07-10T12:00:00Z') }],
    ['null tier', { ...profile, skillTier: null }],
    ['unsupported role', { ...profile, role: 'curator' }],
  ])('fails closed for a %s before preflight or quota', async (_label, actor) => {
    profileMock.mockResolvedValue(actor as never)
    const response = await POST(request(body))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'inactive wrenching profile' })
    expect(preflightMock).not.toHaveBeenCalled()
    expect(quotaMock).not.toHaveBeenCalled()
    expect(generateTreeMock).not.toHaveBeenCalled()
  })

  it('returns a completed identical retry before quota, open-cap, or provider work', async () => {
    preflightMock.mockResolvedValue({ ok: true, state: 'match', ...ids })
    const response = await POST(request(body))
    expect(preflightMock).toHaveBeenCalledWith({ db: {}, userId: user.id, body })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(ids)
    expect(quotaMock).not.toHaveBeenCalled()
    expect(countMock).not.toHaveBeenCalled()
    expect(generateTreeMock).not.toHaveBeenCalled()
    expect(createMock).not.toHaveBeenCalled()
  })

  it('fails a request-key collision before quota or provider work', async () => {
    preflightMock.mockResolvedValue({ ok: false, status: 400, error: 'request key unavailable' })
    const response = await POST(request(body))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'request key unavailable' })
    expect(quotaMock).not.toHaveBeenCalled()
    expect(generateTreeMock).not.toHaveBeenCalled()
  })

  it('checks shared intake quota before the open-session cap', async () => {
    quotaMock.mockResolvedValue(NextResponse.json({ error: 'rate_limited' }, { status: 429 }))
    const response = await POST(request(body))
    expect(response.status).toBe(429)
    expect(quotaMock).toHaveBeenCalledWith({}, `intake:${user.id}`, 10)
    expect(countMock).not.toHaveBeenCalled()
    expect(generateTreeMock).not.toHaveBeenCalled()
  })

  it('checks the open-session cap before provider work and preserves the conflict envelope', async () => {
    countMock.mockResolvedValue(5)
    openMock.mockResolvedValue({ id: 'session-open' } as never)
    const response = await POST(request(body))
    expect(countMock).toHaveBeenCalledWith({}, profile.id)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'open_session_limit',
      openSessionId: 'session-open',
      limit: 5,
    })
    expect(generateTreeMock).not.toHaveBeenCalled()
  })

  it('passes only validated intake to retrieval, then creates with intake plus request key and returns all IDs', async () => {
    const response = await POST(request(body))
    expect(generateTreeMock).toHaveBeenCalledWith(intake)
    expect(createMock).toHaveBeenCalledWith({
      db: {},
      userId: user.id,
      body,
      treeState: { currentNodeId: 'root' },
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(ids)
    expect(preflightMock.mock.invocationCallOrder[0]).toBeLessThan(quotaMock.mock.invocationCallOrder[0])
    expect(quotaMock.mock.invocationCallOrder[0]).toBeLessThan(countMock.mock.invocationCallOrder[0])
    expect(countMock.mock.invocationCallOrder[0]).toBeLessThan(generateTreeMock.mock.invocationCallOrder[0])
  })
})
