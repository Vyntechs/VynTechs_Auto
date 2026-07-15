import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

vi.mock('@/lib/auth', () => ({ requireUserAndProfile: vi.fn() }))
vi.mock('@/lib/auth-access', () => ({ paywallReject: vi.fn() }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: {} }))
vi.mock('@/lib/ai/customer-story', () => ({ generateCustomerStory: vi.fn() }))
vi.mock('@/lib/shop-os/customer-stories', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/customer-stories')>()
  return {
    ...actual,
    getCustomerStoryWorkspace: vi.fn(),
    generateAndSaveCustomerStory: vi.fn(),
    saveReviewedCustomerStory: vi.fn(),
  }
})

import * as storyRoute from '@/app/api/tickets/[id]/quote/jobs/[jobId]/story/route'
import { generateCustomerStory } from '@/lib/ai/customer-story'
import { requireUserAndProfile } from '@/lib/auth'
import { paywallReject } from '@/lib/auth-access'
import {
  generateAndSaveCustomerStory,
  getCustomerStoryWorkspace,
  saveReviewedCustomerStory,
  type CustomerStoryError,
} from '@/lib/shop-os/customer-stories'

const { GET, POST } = storyRoute
const PUT = (storyRoute as unknown as { PUT: typeof POST }).PUT

const TICKET_ID = '00000000-0000-4000-8000-000000000020'
const JOB_ID = '00000000-0000-4000-8000-000000000030'
const CLIENT_KEY = '00000000-0000-4000-8000-000000000050'
const EVENT_ID = '00000000-0000-4000-8000-000000000060'
const ARTIFACT_ID = '00000000-0000-4000-8000-000000000070'
const profile = { id: '00000000-0000-4000-8000-000000000001', userId: '00000000-0000-4000-8000-000000000101' }
const authContext = { profile, user: { id: profile.userId, email: 'tech@test.local' } }
const actor = { profileId: profile.id }
const params = () => ({ params: Promise.resolve({ id: TICKET_ID, jobId: JOB_ID }) })
const path = `/api/tickets/${TICKET_ID}/quote/jobs/${JOB_ID}/story`
const postBody = {
  clientKey: CLIENT_KEY,
  expectedStoryRevision: 0,
  sourceEventIds: [EVENT_ID],
  sourceArtifactIds: [],
}
const story = {
  whatYouToldUs: 'Battery warning appeared.',
  whatWeFound: 'Alternator output is below specification.',
  whatWeRecommend: 'Replace the alternator.',
  whatItMeansIfWaived: 'If you choose not to proceed, the diagnosed issue remains unresolved.',
  howWeKnow: [{ claim: 'Charging output measured 10.8 volts.', sourceEventIds: [EVENT_ID], sourceArtifactIds: [] }],
}
const storyMeta = {
  source: 'ai' as const,
  sessionId: '00000000-0000-4000-8000-000000000080',
  generatedAt: '2026-07-11T12:00:00.000Z',
  lastEditedByProfileId: profile.id,
  lastEditedAt: '2026-07-11T12:00:00.000Z',
  generationClientKey: CLIENT_KEY,
  generationRequestFingerprint: 'private-fingerprint',
  generatedByProfileId: profile.id,
  storyRevision: 1,
  reviewStatus: 'reviewed' as const,
  reviewClientKey: CLIENT_KEY,
  reviewRequestFingerprint: 'b'.repeat(64),
  reviewedByProfileId: profile.id,
  reviewedAt: '2026-07-11T12:02:00.000Z',
}

const authMock = vi.mocked(requireUserAndProfile)
const paywallMock = vi.mocked(paywallReject)
const workspaceMock = vi.mocked(getCustomerStoryWorkspace)
const generationMock = vi.mocked(generateAndSaveCustomerStory)
const reviewMock = vi.mocked(saveReviewedCustomerStory)
const providerMock = vi.mocked(generateCustomerStory)
const reviewBody = {
  clientKey: CLIENT_KEY,
  expectedStoryRevision: 1,
  whatWeFound: 'Alternator output is below specification.',
  whatWeRecommend: 'Replace the alternator.',
}

function request(method: 'GET' | 'POST' | 'PUT', body?: unknown, raw?: string, query = ''): Request {
  return new Request(`http://localhost${path}${query}`, {
    method,
    ...(method !== 'GET' ? {
      body: raw ?? JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    } : {}),
  })
}

describe('customer story route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue(authContext as never)
    paywallMock.mockResolvedValue(null)
  })

  it.each([
    ['GET', () => GET(request('GET'), params()), workspaceMock],
    ['POST', () => POST(request('POST', postBody), params()), generationMock],
  ] as const)('%s authenticates before paywall or domain access', async (_method, invoke, domainMock) => {
    authMock.mockResolvedValue(null)
    const response = await invoke()
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthenticated' })
    expect(paywallMock).not.toHaveBeenCalled()
    expect(domainMock).not.toHaveBeenCalled()
    expect(providerMock).not.toHaveBeenCalled()
  })

  it.each([
    ['GET', () => GET(request('GET'), params()), workspaceMock],
    ['POST', () => POST(request('POST', undefined, 'not-json{'), params()), generationMock],
  ] as const)('%s returns the paywall response before parsing or domain access', async (_method, invoke, domainMock) => {
    paywallMock.mockResolvedValue(NextResponse.json({ error: 'paywall', reason: 'past_due' }, { status: 403 }))
    const response = await invoke()
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'paywall', reason: 'past_due' })
    expect(paywallMock).toHaveBeenCalledWith({}, profile.userId)
    expect(domainMock).not.toHaveBeenCalled()
    expect(providerMock).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON before domain or provider access', async () => {
    const response = await POST(request('POST', undefined, 'not-json{'), params())
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' })
    expect(generationMock).not.toHaveBeenCalled()
    expect(providerMock).not.toHaveBeenCalled()
  })

  it.each([
    { ...postBody, extra: true },
    { ...postBody, clientKey: 'not-a-uuid' },
    { ...postBody, expectedStoryRevision: -1 },
    { ...postBody, expectedStoryRevision: 1.5 },
    { ...postBody, sourceEventIds: 'not-an-array' },
    { ...postBody, sourceArtifactIds: [ARTIFACT_ID, ARTIFACT_ID] },
    { ...postBody, sourceEventIds: Array.from({ length: 21 }, (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`) },
  ])('rejects a non-contract POST envelope before domain or provider access', async (body) => {
    const response = await POST(request('POST', body), params())
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_input' })
    expect(generationMock).not.toHaveBeenCalled()
    expect(providerMock).not.toHaveBeenCalled()
  })

  it('forwards strict independent cursors and returns only the safe workspace projection', async () => {
    const safeMeta = {
      source: 'ai' as const,
      sessionId: storyMeta.sessionId,
      generatedAt: storyMeta.generatedAt,
      lastEditedByProfileId: profile.id,
      lastEditedAt: storyMeta.lastEditedAt,
    }
    const workspace = {
      story,
      storyMeta: safeMeta,
      storyRevision: 1,
      evidence: {
        events: Array.from({ length: 25 }, (_, index) => ({ id: EVENT_ID, kind: 'observation', createdAt: storyMeta.generatedAt, label: `Event ${index}` })),
        artifacts: [],
        nextEventCursor: 'next-event',
        nextArtifactCursor: null,
      },
    }
    workspaceMock.mockResolvedValue({ ok: true, workspace })
    const response = await GET(request('GET', undefined, undefined, '?eventCursor=event-token'), params())
    expect(workspaceMock).toHaveBeenCalledWith({}, {
      actor, ticketId: TICKET_ID, jobId: JOB_ID,
      eventCursor: 'event-token',
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual(workspace)
    expect(JSON.stringify(workspace)).not.toContain('private-fingerprint')
  })

  it.each([
    '?eventCursor=',
    '?artifactCursor=',
    '?eventCursor=a&eventCursor=b',
    '?unknown=value',
  ])('rejects invalid or ambiguous cursor query %s before domain access', async (query) => {
    const response = await GET(request('GET', undefined, undefined, query), params())
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_input' })
    expect(workspaceMock).not.toHaveBeenCalled()
  })

  it('passes exact generation input and production provider dependency, then maps changed success', async () => {
    generationMock.mockResolvedValue({ ok: true, changed: true, story, storyMeta, storyRevision: 1 })
    const response = await POST(request('POST', postBody), params())
    expect(generationMock).toHaveBeenCalledWith({}, {
      actor, ticketId: TICKET_ID, jobId: JOB_ID, ...postBody,
    }, { generateCustomerStory })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ changed: true, story, storyMeta, storyRevision: 1 })
  })

  it('maps an exact committed retry as unchanged server truth without provider invocation', async () => {
    generationMock.mockResolvedValue({ ok: true, changed: false, story, storyMeta, storyRevision: 1 })
    const response = await POST(request('POST', postBody), params())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ changed: false, story, storyMeta, storyRevision: 1 })
    expect(providerMock).not.toHaveBeenCalled()
  })

  it('exports the reviewed-story PUT seam', () => {
    expect(PUT).toBeTypeOf('function')
  })

  it('PUT authenticates and applies the paywall before parsing or domain access', async () => {
    authMock.mockResolvedValueOnce(null)
    let response = await PUT(request('PUT', reviewBody), params())
    expect(response.status).toBe(401)
    expect(reviewMock).not.toHaveBeenCalled()

    authMock.mockResolvedValue(authContext as never)
    paywallMock.mockResolvedValueOnce(NextResponse.json({ error: 'paywall' }, { status: 403 }))
    response = await PUT(request('PUT', undefined, 'not-json{'), params())
    expect(response.status).toBe(403)
    expect(reviewMock).not.toHaveBeenCalled()
  })

  it.each([
    { ...reviewBody, extra: true },
    { ...reviewBody, clientKey: 'not-a-uuid' },
    { ...reviewBody, expectedStoryRevision: -1 },
    { ...reviewBody, whatWeFound: '' },
    { ...reviewBody, whatWeRecommend: 'x'.repeat(5_001) },
    { ...reviewBody, whatWeFound: '  \n\t' },
    { ...reviewBody, whatWeFound: '\u200b\u200c\u2060' },
    { ...reviewBody, whatWeRecommend: '\u0000\u0007' },
  ])('rejects a non-contract PUT envelope before domain access', async (body) => {
    const response = await PUT(request('PUT', body), params())
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_input' })
    expect(reviewMock).not.toHaveBeenCalled()
  })

  it('rejects malformed PUT JSON before domain access', async () => {
    const response = await PUT(request('PUT', undefined, 'not-json{'), params())
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_json' })
    expect(reviewMock).not.toHaveBeenCalled()
  })

  it('passes only the reviewed narrative contract and maps committed server truth', async () => {
    reviewMock.mockResolvedValue({ ok: true, changed: true, story, storyMeta, storyRevision: 2 })
    const response = await PUT(request('PUT', {
      ...reviewBody,
      whatWeFound: '  Alternator output is below specification.\r\n\u200b ',
      whatWeRecommend: '\u200b Replace the alternator. ',
    }), params())
    expect(reviewMock).toHaveBeenCalledWith({}, {
      actor, ticketId: TICKET_ID, jobId: JOB_ID, ...reviewBody,
    })
    expect(response.status).toBe(200)
    const responseBody = await response.json()
    expect(responseBody).toEqual({
      changed: true,
      story,
      storyMeta: {
        source: 'ai',
        sessionId: storyMeta.sessionId,
        generatedAt: storyMeta.generatedAt,
        lastEditedAt: storyMeta.lastEditedAt,
        reviewStatus: 'reviewed',
        storyRevision: 1,
        reviewedAt: storyMeta.reviewedAt,
      },
      storyRevision: 2,
    })
    expect(JSON.stringify(responseBody)).not.toMatch(/Fingerprint|ProfileId|ClientKey/)
    expect(providerMock).not.toHaveBeenCalled()
  })

  it('maps PUT conflict without logging or provider work', async () => {
    reviewMock.mockResolvedValue({ ok: false, error: 'conflict', retryable: true })
    const response = await PUT(request('PUT', reviewBody), params())
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'conflict', retryable: true })
    expect(providerMock).not.toHaveBeenCalled()
  })

  it.each<[CustomerStoryError, number, boolean?]>([
    ['invalid_input', 422],
    ['not_found', 404],
    ['forbidden', 403],
    ['state_conflict', 409],
    ['invalid_evidence', 422],
    ['conflict', 409, false],
    ['conflict', 409, true],
    ['provider_timeout', 504],
    ['provider_failed', 502],
  ])('maps %s to HTTP %i with only the pinned safe body', async (error, status, retryable) => {
    generationMock.mockResolvedValue({ ok: false, error, ...(retryable === undefined ? {} : { retryable }) })
    const response = await POST(request('POST', postBody), params())
    expect(response.status).toBe(status)
    await expect(response.json()).resolves.toEqual(retryable ? { error, retryable: true } : { error })
    expect(providerMock).not.toHaveBeenCalled()
  })

  it('maps GET privacy and cursor failures with pinned helpers', async () => {
    workspaceMock.mockResolvedValueOnce({ ok: false, error: 'not_found' })
    let response = await GET(request('GET'), params())
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
    workspaceMock.mockResolvedValueOnce({ ok: false, error: 'invalid_input' })
    response = await GET(request('GET', undefined, undefined, '?eventCursor=opaque'), params())
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_input' })
  })
})
