import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/shop-os/quotes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/quotes')>()
  return {
    ...actual,
    getQuoteBuilder: vi.fn(), createDraftLine: vi.fn(), replaceDraftLine: vi.fn(),
    deleteDraftLine: vi.fn(), createQuoteVersion: vi.fn(), recordQuoteDecision: vi.fn(),
  }
})

import { GET as getBuilder } from '@/app/api/tickets/[id]/quote/route'
import { POST as createLine } from '@/app/api/tickets/[id]/quote/jobs/[jobId]/lines/route'
import { PUT as replaceLine, DELETE as deleteLine } from '@/app/api/tickets/[id]/quote/jobs/[jobId]/lines/[lineId]/route'
import { POST as createVersion } from '@/app/api/tickets/[id]/quote/versions/route'
import { POST as decide } from '@/app/api/tickets/[id]/quote/decisions/route'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import {
  createDraftLine, createQuoteVersion, deleteDraftLine, getQuoteBuilder,
  recordQuoteDecision, replaceDraftLine,
} from '@/lib/shop-os/quotes'

const TICKET_ID = '00000000-0000-4000-8000-000000000020'
const JOB_ID = '00000000-0000-4000-8000-000000000030'
const LINE_ID = '00000000-0000-4000-8000-000000000040'
const CLIENT_KEY = '00000000-0000-4000-8000-000000000050'
const profile = { id: '00000000-0000-4000-8000-000000000001', userId: '00000000-0000-4000-8000-000000000101' }
const authContext = { profile, user: { id: profile.userId, email: 'tech@test.local' } }
const actor = { profileId: profile.id }
const line = { kind: 'fee', description: 'Shop supplies', priceCents: 500, taxable: true }

const authMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const builderMock = vi.mocked(getQuoteBuilder)
const createLineMock = vi.mocked(createDraftLine)
const replaceLineMock = vi.mocked(replaceDraftLine)
const deleteLineMock = vi.mocked(deleteDraftLine)
const versionMock = vi.mocked(createQuoteVersion)
const decisionMock = vi.mocked(recordQuoteDecision)

const ticketParams = () => ({ params: Promise.resolve({ id: TICKET_ID }) })
const jobParams = () => ({ params: Promise.resolve({ id: TICKET_ID, jobId: JOB_ID }) })
const lineParams = () => ({ params: Promise.resolve({ id: TICKET_ID, jobId: JOB_ID, lineId: LINE_ID }) })
const request = (path: string, method: string, body?: unknown, raw?: string) => new Request(`http://localhost${path}`, {
  method,
  ...(body !== undefined || raw !== undefined ? {
    body: raw ?? JSON.stringify(body), headers: { 'content-type': 'application/json' },
  } : {}),
})

describe('Shop OS quote route contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(authContext as never)
    paywallMock.mockResolvedValue(null)
  })

  const calls = () => [
    { name: 'GET /api/tickets/:id/quote', invoke: () => getBuilder(request(`/api/tickets/${TICKET_ID}/quote`, 'GET'), ticketParams()), mock: builderMock },
    { name: 'POST /api/tickets/:id/quote/jobs/:jobId/lines', invoke: () => createLine(request(`/api/tickets/${TICKET_ID}/quote/jobs/${JOB_ID}/lines`, 'POST', { clientKey: CLIENT_KEY, line }), jobParams()), mock: createLineMock },
    { name: 'PUT /api/tickets/:id/quote/jobs/:jobId/lines/:lineId', invoke: () => replaceLine(request(`/api/tickets/${TICKET_ID}/quote/jobs/${JOB_ID}/lines/${LINE_ID}`, 'PUT', line), lineParams()), mock: replaceLineMock },
    { name: 'DELETE /api/tickets/:id/quote/jobs/:jobId/lines/:lineId', invoke: () => deleteLine(request(`/api/tickets/${TICKET_ID}/quote/jobs/${JOB_ID}/lines/${LINE_ID}`, 'DELETE'), lineParams()), mock: deleteLineMock },
    { name: 'POST /api/tickets/:id/quote/versions', invoke: () => createVersion(request(`/api/tickets/${TICKET_ID}/quote/versions`, 'POST', undefined, 'not-json{'), ticketParams()), mock: versionMock },
    { name: 'POST /api/tickets/:id/quote/decisions', invoke: () => decide(request(`/api/tickets/${TICKET_ID}/quote/decisions`, 'POST', { requestKey: CLIENT_KEY, jobId: JOB_ID, quoteVersionId: LINE_ID, decision: 'declined' }), ticketParams()), mock: decisionMock },
  ]

  it.each(calls())('$name authenticates before paywall and domain access', async ({ invoke, mock }) => {
    authMock.mockResolvedValue(null)
    const response = await invoke()
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(paywallMock).not.toHaveBeenCalled()
    expect(mock).not.toHaveBeenCalled()
  })

  it.each(calls())('$name returns the paywall response before domain access', async ({ invoke, mock }) => {
    paywallMock.mockResolvedValue(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    const response = await invoke()
    expect(response.status).toBe(403)
    expect(paywallMock).toHaveBeenCalledWith({}, profile.userId)
    expect(mock).not.toHaveBeenCalled()
  })

  it.each([
    { name: 'create line', invoke: () => createLine(request('/x', 'POST', undefined, 'not-json{'), jobParams()), mock: createLineMock },
    { name: 'replace line', invoke: () => replaceLine(request('/x', 'PUT', undefined, 'not-json{'), lineParams()), mock: replaceLineMock },
    { name: 'decision', invoke: () => decide(request('/x', 'POST', undefined, 'not-json{'), ticketParams()), mock: decisionMock },
  ])('rejects malformed JSON for $name before domain access', async ({ invoke, mock }) => {
    const response = await invoke()
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' })
    expect(mock).not.toHaveBeenCalled()
  })

  it('accepts an absent or strict empty version body and rejects malformed or nonempty bodies', async () => {
    versionMock.mockResolvedValue({ ok: true, changed: true, version: { id: LINE_ID, versionNumber: 1 } })
    expect((await createVersion(request('/x', 'POST'), ticketParams())).status).toBe(201)
    expect((await createVersion(request('/x', 'POST', {}), ticketParams())).status).toBe(201)
    expect(versionMock).toHaveBeenCalledTimes(2)

    let response = await createVersion(request('/x', 'POST', undefined, 'not-json{'), ticketParams())
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' })
    response = await createVersion(request('/x', 'POST', { extra: true }), ticketParams())
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_input' })
    expect(versionMock).toHaveBeenCalledTimes(2)
  })

  it('requires the exact create-line envelope and forwards only clientKey plus line', async () => {
    let response = await createLine(request('/x', 'POST', { clientKey: CLIENT_KEY, line, extra: true }), jobParams())
    expect(response.status).toBe(422)
    expect(createLineMock).not.toHaveBeenCalled()
    createLineMock.mockResolvedValue({ ok: true, changed: true, line: { id: LINE_ID } } as never)
    response = await createLine(request('/x', 'POST', { clientKey: CLIENT_KEY, line }), jobParams())
    expect(createLineMock).toHaveBeenCalledWith({}, { actor, ticketId: TICKET_ID, jobId: JOB_ID, clientKey: CLIENT_KEY, body: line })
    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ changed: true, line: { id: LINE_ID } })
  })

  it('serializes only public line fields even if a domain dependency returns internal extras', async () => {
    const unsafe = {
      id: LINE_ID, kind: 'part', description: 'Pads', sort: 0, quantity: 1,
      priceCents: 500, taxable: true, partNumber: null, brand: null,
      coreChargeCents: null, fitment: null, laborHours: null, laborRateCents: null,
      unitCostCents: 100, vendorAccountId: CLIENT_KEY, externalOfferId: 'secret',
      vendorSnapshot: { token: 'secret' }, partStatus: 'ordered', orderedAt: 'secret',
    }
    createLineMock.mockResolvedValue({ ok: true, changed: true, line: unsafe } as never)
    replaceLineMock.mockResolvedValue({ ok: true, changed: true, line: unsafe } as never)
    for (const response of [
      await createLine(request('/x', 'POST', { clientKey: CLIENT_KEY, line }), jobParams()),
      await replaceLine(request('/x', 'PUT', line), lineParams()),
    ]) {
      const serialized = JSON.stringify(await response.json())
      expect(serialized).not.toContain('unitCostCents')
      expect(serialized).not.toContain('vendorAccountId')
      expect(serialized).not.toContain('externalOfferId')
      expect(serialized).not.toContain('vendorSnapshot')
      expect(serialized).not.toContain('partStatus')
      expect(serialized).not.toContain('orderedAt')
    }
  })

  it('forwards builder, replace, delete, version, and decision inputs with exact success codes', async () => {
    builderMock.mockResolvedValue({ ok: true, builder: { ticket: { id: TICKET_ID } } } as never)
    replaceLineMock.mockResolvedValue({ ok: true, changed: false, line: { id: LINE_ID } } as never)
    deleteLineMock.mockResolvedValue({ ok: true, changed: true } as never)
    versionMock.mockResolvedValue({ ok: true, changed: true, version: { id: LINE_ID, versionNumber: 1 } })
    decisionMock.mockResolvedValue({ ok: true, changed: false, event: { id: LINE_ID }, projection: { approvalState: 'approved' } } as never)

    expect((await getBuilder(request('/x', 'GET'), ticketParams())).status).toBe(200)
    expect(builderMock).toHaveBeenCalledWith({}, { actor, ticketId: TICKET_ID })
    expect((await replaceLine(request('/x', 'PUT', line), lineParams())).status).toBe(200)
    expect(replaceLineMock).toHaveBeenCalledWith({}, { actor, ticketId: TICKET_ID, jobId: JOB_ID, lineId: LINE_ID, body: line })
    expect((await deleteLine(request('/x', 'DELETE'), lineParams())).status).toBe(200)
    expect(deleteLineMock).toHaveBeenCalledWith({}, { actor, ticketId: TICKET_ID, jobId: JOB_ID, lineId: LINE_ID })
    expect((await createVersion(request('/x', 'POST'), ticketParams())).status).toBe(201)
    expect(versionMock).toHaveBeenCalledWith({}, { actor, ticketId: TICKET_ID })
    const body = { requestKey: CLIENT_KEY, jobId: JOB_ID, quoteVersionId: LINE_ID, decision: 'declined' }
    const decisionResponse = await decide(request('/x', 'POST', body), ticketParams())
    expect(decisionResponse.status).toBe(200)
    expect(decisionMock).toHaveBeenCalledWith({}, { actor, ticketId: TICKET_ID, body })
    await expect(decisionResponse.json()).resolves.toEqual({ changed: false, event: { id: LINE_ID }, projection: { approvalState: 'approved' } })
  })

  it.each([
    { result: { ok: false, error: 'invalid_input' }, status: 422, body: { error: 'invalid_input' } },
    { result: { ok: false, error: 'not_found' }, status: 404, body: { error: 'not_found' } },
    { result: { ok: false, error: 'conflict', retryable: false }, status: 409, body: { error: 'conflict' } },
    { result: { ok: false, error: 'conflict', retryable: true }, status: 409, body: { error: 'conflict', retryable: true } },
  ])('maps quote domain outcome to $status without privacy leaks', async ({ result, status, body }) => {
    builderMock.mockResolvedValue(result as never)
    const response = await getBuilder(request('/x', 'GET'), ticketParams())
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual(body)
  })
})
