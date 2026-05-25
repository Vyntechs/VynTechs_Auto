import { describe, it, expect, vi, beforeEach } from 'vitest'

// ------- module mocks (must come before any imports from the mocked modules) -------

vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-test-1' } } }),
    },
  }),
}))

vi.mock('@/lib/db/client', () => ({ db: {} }))

vi.mock('@/lib/auth-access', () => ({
  paywallReject: vi.fn(async () => null),
}))

// Track whether AI tree gen was called
const generateInitialTreeWithRetrievalMock = vi.fn()
vi.mock('@/lib/retrieval/wire-into-tree', () => ({
  buildGenerateInitialTreeWithRetrieval: vi.fn(
    () => generateInitialTreeWithRetrievalMock,
  ),
}))

vi.mock('@/lib/ai/tree-engine', () => ({ generateInitialTree: vi.fn() }))
vi.mock('@/lib/retrieval/orchestrator', () => ({ runRetrieval: vi.fn() }))
vi.mock('@/lib/retrieval/validator', () => ({ validateRetrievalResults: vi.fn() }))
vi.mock('@/lib/corpus/retrieval', () => ({ retrieveCorpus: vi.fn() }))
vi.mock('@/lib/retrieval/adapters/nhtsa', () => ({ NHTSAAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/manufacturer-recall', () => ({
  ManufacturerRecallAdapter: class {},
}))
vi.mock('@/lib/retrieval/adapters/forum', () => ({ ForumAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/youtube', () => ({ YouTubeAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/reddit', () => ({ RedditAdapter: class {} }))
vi.mock('@/lib/retrieval/adapters/web-search', () => ({
  WebSearchAdapter: class {},
}))

// Track createSessionForUser calls
const createSessionForUserMock = vi.fn().mockResolvedValue({ ok: true, id: 'session-xyz' })
vi.mock('@/lib/sessions', () => ({
  createSessionForUser: (
    opts: Parameters<typeof createSessionForUserMock>[0],
  ) => createSessionForUserMock(opts),
}))

// countOpenSessionsForTech, getOpenSessionForTech, getProfileByUserId must not throw
const countOpenSessionsForTechMock = vi.fn().mockResolvedValue(0)
const getOpenSessionForTechMock = vi.fn().mockResolvedValue(null)
const getProfileByUserIdMock = vi.fn().mockResolvedValue({ id: 'profile-1', shopId: 'shop-1' })
vi.mock('@/lib/db/queries', async () => {
  const actual = await vi.importActual<typeof import('@/lib/db/queries')>('@/lib/db/queries')
  return {
    ...actual,
    countOpenSessionsForTech: (...args: unknown[]) =>
      (countOpenSessionsForTechMock as (...a: unknown[]) => unknown)(...args),
    getOpenSessionForTech: (...args: unknown[]) =>
      (getOpenSessionForTechMock as (...a: unknown[]) => unknown)(...args),
    getProfileByUserId: (...args: unknown[]) =>
      (getProfileByUserIdMock as (...a: unknown[]) => unknown)(...args),
  }
})

// Mock cache resolvers
const resolvePlatformSlugMock = vi.fn()
vi.mock('@/lib/diagnostics/resolve-platform', () => ({
  resolvePlatformSlug: (input: unknown) => resolvePlatformSlugMock(input),
}))

const resolveSymptomSlugMock = vi.fn()
vi.mock('@/lib/diagnostics/symptom-resolver', () => ({
  resolveSymptomSlug: (input: unknown) => resolveSymptomSlugMock(input),
}))

// ------- import route AFTER all mocks -------
import { POST } from '@/app/api/sessions/route'

// Valid cache-hit vehicle: Ford F-350 2019, 6.7L PSD
const cacheHitBody = {
  vehicleYear: 2019,
  vehicleMake: 'Ford',
  vehicleModel: 'F-350',
  vehicleEngine: '6.7L PSD',
  customerComplaint: 'cranks but will not start',
}

// Vehicle that won't cache-hit (different make)
const cacheMissBody = {
  vehicleYear: 2018,
  vehicleMake: 'Chevrolet',
  vehicleModel: 'Silverado',
  vehicleEngine: '6.6L Duramax',
  customerComplaint: 'cranks but will not start',
}

function makeRequest(body: unknown): Request {
  return new Request('http://localhost/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/sessions — cache-hit shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    countOpenSessionsForTechMock.mockResolvedValue(0)
    getOpenSessionForTechMock.mockResolvedValue(null)
    getProfileByUserIdMock.mockResolvedValue({ id: 'profile-1', shopId: 'shop-1' })
    createSessionForUserMock.mockResolvedValue({ ok: true, id: 'session-xyz' })
  })

  it('(a) cache hit — skips AI tree gen, creates session with cacheHitSymptomId set', async () => {
    const platformId = 'platform-uuid-abc'
    const symptomId = 'symptom-uuid-def'

    resolvePlatformSlugMock.mockReturnValue('ford-super-duty-4th-gen-67-psd')
    resolveSymptomSlugMock.mockResolvedValue({
      symptomSlug: 'no-start-cranks-normally-fuel-system-suspect',
      symptomId,
      platformId,
    })

    const res = await POST(makeRequest(cacheHitBody))
    expect(res.status).toBe(200)

    // AI tree gen must NOT have been called
    expect(generateInitialTreeWithRetrievalMock).not.toHaveBeenCalled()

    // createSessionForUser must have been called with cache-hit ids
    expect(createSessionForUserMock).toHaveBeenCalledOnce()
    const opts = createSessionForUserMock.mock.calls[0][0]
    expect(opts.cacheHitPlatformId).toBe(platformId)
    expect(opts.cacheHitSymptomId).toBe(symptomId)

    // treeState passed must be the empty sentinel (nodes: [])
    expect(opts.treeState).toMatchObject({ nodes: [] })
  })

  it('(b) cache miss — calls AI tree gen, cacheHitSymptomId is null/undefined', async () => {
    resolvePlatformSlugMock.mockReturnValue(null)
    resolveSymptomSlugMock.mockResolvedValue(null)

    const aiTree = {
      nodes: [{ id: 'n1', label: 'Initial', status: 'pending' }],
      currentNodeId: 'n1',
      message: 'Check fuel pressure.',
    }
    generateInitialTreeWithRetrievalMock.mockResolvedValue(aiTree)

    const res = await POST(makeRequest(cacheMissBody))
    expect(res.status).toBe(200)

    // AI tree gen MUST have been called
    expect(generateInitialTreeWithRetrievalMock).toHaveBeenCalledOnce()

    // createSessionForUser must not carry cache-hit ids
    expect(createSessionForUserMock).toHaveBeenCalledOnce()
    const opts = createSessionForUserMock.mock.calls[0][0]
    expect(opts.cacheHitSymptomId).toBeNull()
    // treeState must be the AI-generated tree (non-empty nodes)
    expect(opts.treeState).toEqual(aiTree)
  })
})
