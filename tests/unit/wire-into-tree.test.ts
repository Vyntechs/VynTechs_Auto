import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildUpdateTreeWithRetrieval } from '@/lib/retrieval/wire-into-tree'
import type { TreeState } from '@/lib/ai/tree-engine'
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
