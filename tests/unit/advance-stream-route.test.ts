import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseEvent } from '@/lib/advance-stream-events'
import type { AdvanceStreamEvent } from '@/lib/advance-stream-events'

vi.mock('@/lib/supabase-server', () => ({
  getServerSupabase: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }),
    },
  }),
}))

vi.mock('@/lib/db/client', () => ({ db: {} }))
// Stub the paywall check so the test exercises route logic only — the
// real paywall path is covered by auth-access.test.ts.
vi.mock('@/lib/auth-access', () => ({
  paywallReject: vi.fn(async () => null),
}))

const getSessionByIdMock = vi.fn().mockResolvedValue({
  id: 's1',
  treeState: { currentNodeId: 'n1' },
})
const listArtifactsForSessionMock = vi.fn().mockResolvedValue([])
vi.mock('@/lib/db/queries', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/db/queries')>('@/lib/db/queries')
  return {
    ...actual,
    getSessionById: (...args: unknown[]) =>
      (getSessionByIdMock as unknown as (...a: unknown[]) => unknown)(...args),
    listArtifactsForSession: (...args: unknown[]) =>
      (
        listArtifactsForSessionMock as unknown as (
          ...a: unknown[]
        ) => unknown
      )(...args),
  }
})

const advanceSessionMock = vi.fn()
vi.mock('@/lib/sessions', () => ({
  advanceSession: (opts: Parameters<typeof advanceSessionMock>[0]) =>
    advanceSessionMock(opts),
}))

const buildUpdateTreeWithRetrievalMock = vi.fn(
  (_deps: unknown) => () => Promise.resolve({}),
)
vi.mock('@/lib/retrieval/wire-into-tree', () => ({
  buildUpdateTreeWithRetrieval: (deps: unknown) =>
    buildUpdateTreeWithRetrievalMock(deps),
}))

vi.mock('@/lib/ai/tree-engine', () => ({ updateTree: vi.fn() }))
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

import { POST } from '@/app/api/sessions/[id]/advance/stream/route'

async function readAllEvents(res: Response): Promise<AdvanceStreamEvent[]> {
  const text = await res.text()
  return text
    .split('\n')
    .filter((line) => line.length > 0)
    .map(parseEvent)
}

describe('POST /api/sessions/[id]/advance/stream', () => {
  beforeEach(() => {
    advanceSessionMock.mockReset()
    buildUpdateTreeWithRetrievalMock.mockReset()
    buildUpdateTreeWithRetrievalMock.mockReturnValue(() =>
      Promise.resolve({} as never),
    )
    listArtifactsForSessionMock.mockResolvedValue([])
  })

  it('emits init -> stages -> done on success (no photo)', async () => {
    advanceSessionMock.mockImplementation(async (opts) => {
      opts.onProgress({
        type: 'stage',
        idx: -1,
        label: 'Recording observation',
      })
      const wrapperDeps = (
        buildUpdateTreeWithRetrievalMock.mock.calls as unknown as Array<
          [{ onProgress: (e: AdvanceStreamEvent) => void }]
        >
      )[0][0]
      wrapperDeps.onProgress({
        type: 'stage',
        idx: -1,
        label: 'Updating retrieval ladder',
      })
      wrapperDeps.onProgress({
        type: 'stage',
        idx: -1,
        label: 'Re-scoring confidence',
      })
      opts.onProgress({
        type: 'stage',
        idx: -1,
        label: 'Advancing to next step',
      })
      return {
        ok: true,
        tree: { nodes: [], currentNodeId: 'n2', message: 'ok' },
      }
    })

    const req = new Request(
      'http://localhost/api/sessions/s1/advance/stream',
      {
        method: 'POST',
        body: JSON.stringify({ observation: 'plug 4 burnt' }),
      },
    )
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(200)

    const events = await readAllEvents(res)
    expect(events[0]).toMatchObject({ type: 'init' })
    const init = events[0] as Extract<AdvanceStreamEvent, { type: 'init' }>
    expect(init.stages.map((s) => s.label)).toEqual([
      'Recording observation',
      'Updating retrieval ladder',
      'Re-scoring confidence',
      'Advancing to next step',
    ])

    const stages = events.filter((e) => e.type === 'stage') as Array<
      Extract<AdvanceStreamEvent, { type: 'stage' }>
    >
    expect(stages.map((s) => s.idx)).toEqual([0, 1, 2, 3])

    expect(events[events.length - 1]).toMatchObject({ type: 'done' })
  })

  it('emits init with photo stage when nodeArtifacts contains a photo', async () => {
    listArtifactsForSessionMock.mockResolvedValueOnce([
      { id: 'a1', nodeId: 'n1', kind: 'photo', extractionStatus: 'done' },
      { id: 'a2', nodeId: 'n1', kind: 'photo', extractionStatus: 'done' },
      { id: 'a3', nodeId: 'n1', kind: 'photo', extractionStatus: 'done' },
    ])

    advanceSessionMock.mockImplementation(async (opts) => {
      opts.onProgress({
        type: 'stage',
        idx: -1,
        label: 'Recording observation',
      })
      opts.onProgress({
        type: 'stage',
        idx: -1,
        label: 'Parsing photo · 3 frames',
      })
      const wrapperDeps = (
        buildUpdateTreeWithRetrievalMock.mock.calls as unknown as Array<
          [{ onProgress: (e: AdvanceStreamEvent) => void }]
        >
      )[0][0]
      wrapperDeps.onProgress({
        type: 'stage',
        idx: -1,
        label: 'Updating retrieval ladder',
      })
      wrapperDeps.onProgress({
        type: 'stage',
        idx: -1,
        label: 'Re-scoring confidence',
      })
      opts.onProgress({
        type: 'stage',
        idx: -1,
        label: 'Advancing to next step',
      })
      return { ok: true, tree: {} }
    })

    const req = new Request(
      'http://localhost/api/sessions/s1/advance/stream',
      {
        method: 'POST',
        body: JSON.stringify({ observation: 'plug 4 burnt' }),
      },
    )
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) })

    const events = await readAllEvents(res)
    const init = events[0] as Extract<AdvanceStreamEvent, { type: 'init' }>
    expect(init.stages).toHaveLength(5)
    expect(init.stages[1].label).toBe('Parsing photo · 3 frames')
  })

  it('emits error event when advanceSession returns ok:false', async () => {
    advanceSessionMock.mockResolvedValue({
      ok: false,
      status: 400,
      error: 'bad input',
    })

    const req = new Request(
      'http://localhost/api/sessions/s1/advance/stream',
      {
        method: 'POST',
        body: JSON.stringify({ observation: '' }),
      },
    )
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) })

    const events = await readAllEvents(res)
    expect(events.some((e) => e.type === 'error')).toBe(true)
  })

  it('returns 401 JSON when unauthenticated', async () => {
    const supabaseMod = await import('@/lib/supabase-server')
    ;(supabaseMod.getServerSupabase as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    })

    const req = new Request(
      'http://localhost/api/sessions/s1/advance/stream',
      {
        method: 'POST',
        body: JSON.stringify({ observation: 'x' }),
      },
    )
    const res = await POST(req, { params: Promise.resolve({ id: 's1' }) })
    expect(res.status).toBe(401)
  })
})
