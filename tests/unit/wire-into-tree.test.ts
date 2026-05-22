import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildUpdateTreeWithRetrieval,
  buildGenerateInitialTreeWithRetrieval,
} from '@/lib/retrieval/wire-into-tree'
import type { TreeState, CorpusMatch } from '@/lib/ai/tree-engine'
import type { CorpusRetrievalInput } from '@/lib/corpus/retrieval'
import type { IntakePayload } from '@/lib/types'
import type { RetrievalAdapter, RetrievalContext, RetrievalResult } from '@/lib/retrieval/types'
import type { AppDb } from '@/lib/db/queries'
import type { RetrievalRun } from '@/lib/retrieval/orchestrator'

const fakeDb = {} as AppDb
const fakeAdapters: RetrievalAdapter[] = []

const baseInput = {
  intake: {
    vehicleYear: 2018,
    vehicleMake: 'Ford',
    vehicleModel: 'F-150',
    customerComplaint: 'loss of power',
  },
  currentTree: {
    nodes: [{ id: 'a', label: 'Step', status: 'active' as const }],
    currentNodeId: 'a',
    message: 'go',
  },
  observation: 'observed',
}

const stubTree: TreeState = {
  nodes: [{ id: 'a', label: 'Step', status: 'resolved' }],
  currentNodeId: 'b',
  message: 'next step',
}

describe('buildUpdateTreeWithRetrieval', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('threads input.sessionDtcs through to the retrieval ctx', async () => {
    let capturedCtx: RetrievalContext | undefined
    const runRetrieval = vi.fn(async (arg: { ctx: RetrievalContext }) => {
      capturedCtx = arg.ctx
      return {
        results: [],
        queriesUsed: 0,
        wallClockMs: 0,
        tokensUsed: 0,
        cacheHits: [],
        errors: [],
      } satisfies RetrievalRun
    })
    const validateRetrievalResults = vi.fn(async () => [] as RetrievalResult[])
    const updateTree = vi.fn(async () => stubTree)

    const wrapped = buildUpdateTreeWithRetrieval({
      db: fakeDb,
      adapters: fakeAdapters,
      updateTree,
      runRetrieval,
      validateRetrievalResults,
    })

    await wrapped({ ...baseInput, sessionDtcs: ['P0299', 'P0171'] })

    expect(runRetrieval).toHaveBeenCalledTimes(1)
    expect(capturedCtx?.dtcs).toEqual(['P0299', 'P0171'])
  })

  it('falls through to retrieval: [] when the orchestrator throws', async () => {
    let capturedUpdateTreeInput: Parameters<typeof import('@/lib/ai/tree-engine').updateTree>[0] | undefined
    const runRetrieval = vi.fn(async () => {
      throw new Error('orchestrator down')
    })
    const validateRetrievalResults = vi.fn(async () => [] as RetrievalResult[])
    const updateTree = vi.fn(
      async (input: Parameters<typeof import('@/lib/ai/tree-engine').updateTree>[0]) => {
        capturedUpdateTreeInput = input
        return stubTree
      },
    )

    const wrapped = buildUpdateTreeWithRetrieval({
      db: fakeDb,
      adapters: fakeAdapters,
      updateTree,
      runRetrieval,
      validateRetrievalResults,
    })

    await wrapped({ ...baseInput, sessionDtcs: ['P0299'] })

    expect(updateTree).toHaveBeenCalledTimes(1)
    expect(capturedUpdateTreeInput?.retrieval).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('retrieval failed:', expect.any(Error))
    // Grader should NOT have been called when the orchestrator threw.
    expect(validateRetrievalResults).not.toHaveBeenCalled()
  })

  it('falls back to ungraded results when the grader throws', async () => {
    const ungraded: RetrievalResult[] = [
      { source: 'nhtsa', title: '17V123 wastegate', snippet: 'recall: wastegate vacuum line' },
    ]
    let capturedUpdateTreeInput: Parameters<typeof import('@/lib/ai/tree-engine').updateTree>[0] | undefined
    const runRetrieval = vi.fn(async () => ({
      results: ungraded,
      queriesUsed: 1,
      wallClockMs: 100,
      tokensUsed: 50,
      cacheHits: [],
      errors: [],
    } satisfies RetrievalRun))
    const validateRetrievalResults = vi.fn(async () => {
      throw new Error('grader down')
    })
    const updateTree = vi.fn(
      async (input: Parameters<typeof import('@/lib/ai/tree-engine').updateTree>[0]) => {
        capturedUpdateTreeInput = input
        return stubTree
      },
    )

    const wrapped = buildUpdateTreeWithRetrieval({
      db: fakeDb,
      adapters: fakeAdapters,
      updateTree,
      runRetrieval,
      validateRetrievalResults,
    })

    await wrapped({ ...baseInput, sessionDtcs: ['P0299'] })

    expect(updateTree).toHaveBeenCalledTimes(1)
    expect(capturedUpdateTreeInput?.retrieval).toEqual(ungraded)
    expect(warnSpy).toHaveBeenCalledWith('retrieval validation failed:', expect.any(Error))
  })
})

describe('buildUpdateTreeWithRetrieval — corpus retrieval (Phase K8)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  const okRetrieval = {
    runRetrieval: vi.fn(async () =>
      ({
        results: [],
        queriesUsed: 0,
        wallClockMs: 0,
        tokensUsed: 0,
        cacheHits: [],
        errors: [],
      }) satisfies RetrievalRun,
    ),
    validateRetrievalResults: vi.fn(async () => [] as RetrievalResult[]),
  }

  const corpusMatch: CorpusMatch = {
    id: 'c1',
    rootCause: 'wastegate vacuum line crack',
    summary: '2018 F-150 EcoBoost: WG line',
    confidenceScore: 0.85,
    successConfirmCount: 5,
    comebackRecordedCount: 0,
    similarityScore: 0.91,
    entrySource: 'auto_promoted',
  }

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  it('passes corpus to updateTree when retrieveCorpus is provided', async () => {
    let capturedInput: Parameters<typeof import('@/lib/ai/tree-engine').updateTree>[0] | undefined
    const updateTree = vi.fn(async (input) => {
      capturedInput = input
      return stubTree
    })
    const retrieveCorpus = vi.fn(async (_db: AppDb, _input: CorpusRetrievalInput) => [corpusMatch])

    const wrapped = buildUpdateTreeWithRetrieval({
      db: fakeDb,
      adapters: fakeAdapters,
      updateTree,
      retrieveCorpus,
      ...okRetrieval,
    })

    await wrapped({ ...baseInput, sessionDtcs: ['P0299'] })
    expect(retrieveCorpus).toHaveBeenCalledTimes(1)
    const corpusCallInput = retrieveCorpus.mock.calls[0]![1]
    expect(corpusCallInput.vehicleMake).toBe('Ford')
    expect(corpusCallInput.dtcs).toEqual(['P0299'])
    expect(capturedInput?.corpus).toEqual([corpusMatch])
  })

  it('falls through to corpus: [] when retrieveCorpus throws', async () => {
    let capturedInput: Parameters<typeof import('@/lib/ai/tree-engine').updateTree>[0] | undefined
    const updateTree = vi.fn(async (input) => {
      capturedInput = input
      return stubTree
    })
    const retrieveCorpus = vi.fn(async (_db: AppDb, _input: CorpusRetrievalInput) => {
      throw new Error('corpus boom')
    })

    const wrapped = buildUpdateTreeWithRetrieval({
      db: fakeDb,
      adapters: fakeAdapters,
      updateTree,
      retrieveCorpus,
      ...okRetrieval,
    })

    await wrapped({ ...baseInput, sessionDtcs: ['P0299'] })
    expect(capturedInput?.corpus).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('corpus retrieval failed:', expect.any(Error))
  })

  it('omits corpus from updateTree input when retrieveCorpus is not provided (back-compat)', async () => {
    let capturedInput: Parameters<typeof import('@/lib/ai/tree-engine').updateTree>[0] | undefined
    const updateTree = vi.fn(async (input) => {
      capturedInput = input
      return stubTree
    })

    const wrapped = buildUpdateTreeWithRetrieval({
      db: fakeDb,
      adapters: fakeAdapters,
      updateTree,
      ...okRetrieval,
    })

    await wrapped({ ...baseInput, sessionDtcs: ['P0299'] })
    expect(capturedInput?.corpus).toBeUndefined()
  })
})

describe('buildGenerateInitialTreeWithRetrieval', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  const intake: IntakePayload = {
    vehicleYear: 2020,
    vehicleMake: 'Ford',
    vehicleModel: 'F-250',
    vehicleEngine: '6.7L Powerstroke',
    customerComplaint: 'P0087, loss of power, intermittent stumble',
  }

  const initialTree: TreeState = {
    nodes: [{ id: 'scan-codes', label: 'Scan codes', status: 'active' }],
    currentNodeId: 'scan-codes',
    message: 'pull DTCs',
  }

  const okRetrieval = {
    runRetrieval: vi.fn(
      async () =>
        ({
          results: [
            {
              source: 'web-search',
              url: 'https://x.test',
              title: 'CP4 failure on 6.7',
              snippet: 'metal contamination signature',
            },
          ],
          queriesUsed: 1,
          wallClockMs: 50,
          tokensUsed: 30,
          cacheHits: [],
          errors: [],
        }) satisfies RetrievalRun,
    ),
    validateRetrievalResults: vi.fn(async (input: { results: RetrievalResult[] }) => input.results),
  }

  it('runs retrieval and corpus in parallel and forwards both to generateInitialTree', async () => {
    const captured: { intake?: IntakePayload; corpus?: CorpusMatch[]; retrieval?: RetrievalResult[] } = {}
    const generateInitialTree = vi.fn(
      async (a: IntakePayload, c?: CorpusMatch[], r?: RetrievalResult[]) => {
        captured.intake = a
        captured.corpus = c
        captured.retrieval = r
        return initialTree
      },
    )
    const corpusMatches: CorpusMatch[] = [
      {
        id: 'cp4-corpus-1',
        rootCause: 'CP4 metal contamination',
        summary: 'pump wear',
        confidenceScore: 0.9,
        successConfirmCount: 12,
        comebackRecordedCount: 0,
        similarityScore: 0.84,
        entrySource: 'auto_promoted',
      },
    ]
    const retrieveCorpus = vi.fn(async (_db: AppDb, _input: CorpusRetrievalInput) => corpusMatches)

    const wrapped = buildGenerateInitialTreeWithRetrieval({
      db: {} as AppDb,
      adapters: [],
      generateInitialTree,
      retrieveCorpus,
      ...okRetrieval,
    })

    const result = await wrapped(intake)

    expect(result).toBe(initialTree)
    expect(captured.intake).toEqual(intake)
    expect(captured.corpus).toEqual(corpusMatches)
    expect(captured.retrieval).toHaveLength(1)
    expect(captured.retrieval![0].source).toBe('web-search')
  })

  it('falls through to retrieval: [] when the orchestrator throws', async () => {
    let capturedRetrieval: RetrievalResult[] | undefined
    const generateInitialTree = vi.fn(
      async (_a: IntakePayload, _c?: CorpusMatch[], r?: RetrievalResult[]) => {
        capturedRetrieval = r
        return initialTree
      },
    )

    const wrapped = buildGenerateInitialTreeWithRetrieval({
      db: {} as AppDb,
      adapters: [],
      generateInitialTree,
      runRetrieval: vi.fn(async () => {
        throw new Error('orchestrator down')
      }),
      validateRetrievalResults: vi.fn(async () => [] as RetrievalResult[]),
    })

    await wrapped(intake)
    expect(capturedRetrieval).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('intake retrieval failed:', expect.any(Error))
  })

  it('falls through to corpus: [] when retrieveCorpus throws', async () => {
    let capturedCorpus: CorpusMatch[] | undefined
    const generateInitialTree = vi.fn(
      async (_a: IntakePayload, c?: CorpusMatch[], _r?: RetrievalResult[]) => {
        capturedCorpus = c
        return initialTree
      },
    )

    const wrapped = buildGenerateInitialTreeWithRetrieval({
      db: {} as AppDb,
      adapters: [],
      generateInitialTree,
      retrieveCorpus: vi.fn(async () => {
        throw new Error('corpus down')
      }),
      ...okRetrieval,
    })

    await wrapped(intake)
    expect(capturedCorpus).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('intake corpus retrieval failed:', expect.any(Error))
  })

  it('proceeds without evidence when the optional-evidence phase exceeds the deadline', async () => {
    vi.useFakeTimers()
    try {
      let capturedRetrieval: RetrievalResult[] | undefined
      let capturedCorpus: CorpusMatch[] | undefined
      const generateInitialTree = vi.fn(
        async (_a: IntakePayload, c?: CorpusMatch[], r?: RetrievalResult[]) => {
          capturedCorpus = c
          capturedRetrieval = r
          return initialTree
        },
      )

      const wrapped = buildGenerateInitialTreeWithRetrieval({
        db: {} as AppDb,
        adapters: [],
        generateInitialTree,
        // Never resolves — simulates a stalled retrieval round (cold cache,
        // degraded upstream API) that would otherwise block past the route's
        // 60s serverless ceiling and surface as a 504.
        runRetrieval: vi.fn(() => new Promise<RetrievalRun>(() => {})),
        validateRetrievalResults: vi.fn(async () => [] as RetrievalResult[]),
        retrieveCorpus: vi.fn(() => new Promise<CorpusMatch[]>(() => {})),
      })

      const pending = wrapped(intake)
      await vi.advanceTimersByTimeAsync(20_000)
      const result = await pending

      expect(result).toBe(initialTree)
      expect(capturedRetrieval).toEqual([])
      expect(capturedCorpus).toEqual([])
      expect(generateInitialTree).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('passes corpus=undefined to generateInitialTree when retrieveCorpus is not provided', async () => {
    let capturedCorpus: CorpusMatch[] | undefined
    const generateInitialTree = vi.fn(
      async (_a: IntakePayload, c?: CorpusMatch[], _r?: RetrievalResult[]) => {
        capturedCorpus = c
        return initialTree
      },
    )

    const wrapped = buildGenerateInitialTreeWithRetrieval({
      db: {} as AppDb,
      adapters: [],
      generateInitialTree,
      ...okRetrieval,
    })

    await wrapped(intake)
    expect(capturedCorpus).toBeUndefined()
  })
})
