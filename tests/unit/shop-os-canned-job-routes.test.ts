import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn(), isFounder: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/shop-os/canned-jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/canned-jobs')>()
  return {
    ...actual,
    listCannedJobs: vi.fn(),
    createCannedJob: vi.fn(),
    replaceCannedJob: vi.fn(),
    retireCannedJob: vi.fn(),
    applyCannedJobToTicket: vi.fn(),
  }
})

import { GET, POST } from '@/app/api/shop/canned-jobs/route'
import { PUT, DELETE } from '@/app/api/shop/canned-jobs/[id]/route'
import { POST as applyCanned } from '@/app/api/tickets/[id]/quote/canned-jobs/route'
import { isFounder, requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import {
  createCannedJob,
  applyCannedJobToTicket,
  listCannedJobs,
  replaceCannedJob,
  retireCannedJob,
} from '@/lib/shop-os/canned-jobs'

const PROFILE_ID = '00000000-0000-4000-8000-000000000001'
const USER_ID = '00000000-0000-4000-8000-000000000101'
const CANNED_ID = '00000000-0000-4000-8000-000000000201'
const CLIENT_KEY = '00000000-0000-4000-8000-000000000301'
const FINGERPRINT = 'a'.repeat(64)
const profile = { id: PROFILE_ID, userId: USER_ID, role: 'owner' }
const authContext = { profile, user: { id: USER_ID, email: 'owner@shop.test' } }
const cannedJob = {
  id: CANNED_ID,
  title: 'Front brake service',
  kind: 'repair',
  defaultRequiredSkillTier: 2,
  sort: 10,
  lines: [{
    kind: 'fee', description: 'Shop supplies', sort: 0, priceCents: 500, taxable: true,
  }],
  fingerprint: FINGERPRINT,
  summary: {
    subtotalCents: 500,
    taxableSubtotalCents: 500,
    taxCents: 41,
    totalCents: 541,
  },
}
const input = {
  title: cannedJob.title,
  kind: cannedJob.kind,
  defaultRequiredSkillTier: 2,
  sort: 10,
  lines: cannedJob.lines,
}

const authMock = vi.mocked(requireUserAndProfile)
const founderMock = vi.mocked(isFounder)
const paywallMock = vi.mocked(paywallReject)
const listMock = vi.mocked(listCannedJobs)
const createMock = vi.mocked(createCannedJob)
const replaceMock = vi.mocked(replaceCannedJob)
const retireMock = vi.mocked(retireCannedJob)
const applyMock = vi.mocked(applyCannedJobToTicket)

function request(method: string, body?: unknown, raw?: string) {
  return new Request('http://localhost/api/shop/canned-jobs', {
    method,
    ...(body !== undefined || raw !== undefined ? {
      body: raw ?? JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    } : {}),
  })
}
const params = () => ({ params: Promise.resolve({ id: CANNED_ID }) })
const ticketParams = () => ({ params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000401' }) })
const applyBody = {
  clientKey: CLIENT_KEY,
  cannedJobId: CANNED_ID,
  expectedFingerprint: FINGERPRINT,
  expectedTaxRateBps: 825,
}

describe('Shop OS canned-job routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(authContext as never)
    founderMock.mockReturnValue(false)
    paywallMock.mockResolvedValue(null)
  })

  const calls = () => [
    { invoke: () => GET(), mock: listMock },
    { invoke: () => POST(request('POST', { clientKey: CLIENT_KEY, cannedJob: input })), mock: createMock },
    { invoke: () => PUT(request('PUT', { expectedFingerprint: FINGERPRINT, cannedJob: input }), params()), mock: replaceMock },
    { invoke: () => DELETE(request('DELETE', { expectedFingerprint: FINGERPRINT }), params()), mock: retireMock },
    { invoke: () => applyCanned(request('POST', applyBody), ticketParams()), mock: applyMock },
  ]

  it.each(calls())('authenticates and checks paywall before domain access', async ({ invoke, mock }) => {
    authMock.mockResolvedValue(null)
    let response = await invoke()
    expect(response.status).toBe(401)
    expect(mock).not.toHaveBeenCalled()
    authMock.mockResolvedValue(authContext as never)
    paywallMock.mockResolvedValue(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    response = await invoke()
    expect(response.status).toBe(403)
    expect(mock).not.toHaveBeenCalled()
  })

  it.each([
    { invoke: () => POST(request('POST', undefined, 'bad{')), mock: createMock },
    { invoke: () => PUT(request('PUT', undefined, 'bad{'), params()), mock: replaceMock },
    { invoke: () => DELETE(request('DELETE', undefined, 'bad{'), params()), mock: retireMock },
    { invoke: () => applyCanned(request('POST', undefined, 'bad{'), ticketParams()), mock: applyMock },
  ])('rejects malformed JSON before mutation', async ({ invoke, mock }) => {
    const response = await invoke()
    expect(response.status).toBe(400)
    expect(mock).not.toHaveBeenCalled()
  })

  it('requires exact mutation envelopes', async () => {
    expect((await POST(request('POST', { clientKey: CLIENT_KEY, cannedJob: input, extra: true }))).status).toBe(422)
    expect((await PUT(request('PUT', { expectedFingerprint: FINGERPRINT, cannedJob: input, extra: true }), params())).status).toBe(422)
    expect((await DELETE(request('DELETE', { expectedFingerprint: FINGERPRINT, extra: true }), params())).status).toBe(422)
    expect((await applyCanned(request('POST', { ...applyBody, extra: true }), ticketParams())).status).toBe(422)
    expect(createMock).not.toHaveBeenCalled()
    expect(replaceMock).not.toHaveBeenCalled()
    expect(retireMock).not.toHaveBeenCalled()
    expect(applyMock).not.toHaveBeenCalled()
  })

  it('forwards the exact canned-apply envelope and serializes only safe job truth', async () => {
    const job = {
      id: '00000000-0000-4000-8000-000000000501',
      title: 'Front brake service',
      kind: 'repair',
      requiredSkillTier: 2,
      lineCount: 3,
      shopId: 'SECRET_SHOP',
      assignedTechId: 'SECRET_PROFILE',
      approvalState: 'approved',
    }
    applyMock.mockResolvedValue({ ok: true, changed: true, job } as never)
    const response = await applyCanned(request('POST', applyBody), ticketParams())
    expect(response.status).toBe(201)
    expect(applyMock).toHaveBeenCalledWith({}, {
      actor: { profileId: PROFILE_ID },
      ticketId: '00000000-0000-4000-8000-000000000401',
      ...applyBody,
    })
    const serialized = JSON.stringify(await response.json())
    expect(serialized).toContain('Front brake service')
    expect(serialized).not.toMatch(/SECRET_|shopId|assignedTechId|approvalState/)
  })

  it('forwards founder context and exact inputs with honest success codes', async () => {
    founderMock.mockReturnValue(true)
    listMock.mockResolvedValue({ ok: true, cannedJobs: [cannedJob], taxRateBps: 825 } as never)
    createMock.mockResolvedValue({ ok: true, changed: true, cannedJob } as never)
    replaceMock.mockResolvedValue({ ok: true, changed: false, cannedJob } as never)
    retireMock.mockResolvedValue({ ok: true, changed: true, cannedJob } as never)

    expect((await GET()).status).toBe(200)
    expect(listMock).toHaveBeenCalledWith({}, { actor: { profileId: PROFILE_ID, founderOverride: true } })
    const created = await POST(request('POST', { clientKey: CLIENT_KEY, cannedJob: input }))
    expect(created.status).toBe(201)
    expect(createMock).toHaveBeenCalledWith({}, {
      actor: { profileId: PROFILE_ID, founderOverride: true }, clientKey: CLIENT_KEY, body: input,
    })
    expect((await PUT(request('PUT', { expectedFingerprint: FINGERPRINT, cannedJob: input }), params())).status).toBe(200)
    expect(replaceMock).toHaveBeenCalledWith({}, {
      actor: { profileId: PROFILE_ID, founderOverride: true }, cannedJobId: CANNED_ID,
      expectedFingerprint: FINGERPRINT, body: input,
    })
    expect((await DELETE(request('DELETE', { expectedFingerprint: FINGERPRINT }), params())).status).toBe(200)
    expect(retireMock).toHaveBeenCalledWith({}, {
      actor: { profileId: PROFILE_ID, founderOverride: true }, cannedJobId: CANNED_ID,
      expectedFingerprint: FINGERPRINT,
    })
  })

  it('serializes only the exact public canned projection', async () => {
    const unsafe = {
      ...cannedJob,
      shopId: 'SECRET_SHOP',
      unitCostCents: 100,
      vendorSnapshot: { token: 'SECRET_VENDOR' },
      createdByProfileId: 'SECRET_PROFILE',
    }
    listMock.mockResolvedValue({ ok: true, cannedJobs: [unsafe], taxRateBps: null } as never)
    const response = await GET()
    const serialized = JSON.stringify(await response.json())
    expect(serialized).not.toMatch(/SECRET_|unitCost|vendor|shopId|ProfileId/)
    expect(serialized).toContain('Front brake service')
  })

  it.each([
    [{ ok: false, error: 'invalid_input' }, 422],
    [{ ok: false, error: 'not_found' }, 404],
    [{ ok: false, error: 'conflict', retryable: false }, 409],
    [{ ok: false, error: 'conflict', retryable: true }, 409],
  ])('maps domain failures without leaking context', async (result, status) => {
    listMock.mockResolvedValue(result as never)
    const response = await GET()
    expect(response.status).toBe(status)
    const body = await response.json()
    expect(body).toEqual('retryable' in result && result.retryable
      ? { error: result.error, retryable: true }
      : { error: result.error })
  })
})
