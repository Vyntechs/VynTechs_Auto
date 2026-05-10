import { describe, it, expect, vi } from 'vitest'
import { buildUpdateTreeWithRetrieval } from '@/lib/retrieval/wire-into-tree'
import type { AdvanceStreamEvent } from '@/lib/advance-stream-events'
import type { TreeState } from '@/lib/ai/tree-engine'

const makeFakeTree = (): TreeState =>
  ({
    nodes: [],
    currentNodeId: 'n1',
    message: 'ok',
  }) as unknown as TreeState

describe('buildUpdateTreeWithRetrieval onProgress', () => {
  it('emits stage 2 (Updating retrieval ladder) before runRetrieval and stage 3 (Re-scoring) after', async () => {
    const events: AdvanceStreamEvent[] = []
    const onProgress = (e: AdvanceStreamEvent) => events.push(e)

    const runRetrieval = vi.fn().mockResolvedValue({
      results: [],
      cacheHits: [],
      errors: [],
    })
    const validateRetrievalResults = vi.fn().mockResolvedValue([])
    const updateTree = vi.fn().mockResolvedValue(makeFakeTree())

    const wrapped = buildUpdateTreeWithRetrieval({
      db: {} as never,
      adapters: [],
      updateTree: updateTree as never,
      runRetrieval: runRetrieval as never,
      validateRetrievalResults: validateRetrievalResults as never,
      onProgress,
    })

    await wrapped({
      intake: {
        vehicleYear: 2020,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        vehicleEngine: '5.0L',
        customerComplaint: 'misfire',
      } as never,
      currentTree: makeFakeTree(),
      observation: 'plug 4 burnt',
    } as never)

    const stageEvents = events.filter((e) => e.type === 'stage')
    expect(stageEvents).toHaveLength(2)
    expect(stageEvents[0]).toMatchObject({
      type: 'stage',
      label: 'Updating retrieval ladder',
    })
    expect(stageEvents[1]).toMatchObject({
      type: 'stage',
      label: 'Re-scoring confidence',
    })
  })

  it('does nothing when onProgress is not provided', async () => {
    const runRetrieval = vi
      .fn()
      .mockResolvedValue({ results: [], cacheHits: [], errors: [] })
    const validateRetrievalResults = vi.fn().mockResolvedValue([])
    const updateTree = vi.fn().mockResolvedValue(makeFakeTree())

    const wrapped = buildUpdateTreeWithRetrieval({
      db: {} as never,
      adapters: [],
      updateTree: updateTree as never,
      runRetrieval: runRetrieval as never,
      validateRetrievalResults: validateRetrievalResults as never,
    })

    await expect(
      wrapped({
        intake: {
          vehicleYear: 2020,
          vehicleMake: 'Ford',
          vehicleModel: 'F-150',
          vehicleEngine: '5.0L',
          customerComplaint: 'misfire',
        } as never,
        currentTree: makeFakeTree(),
        observation: 'plug 4 burnt',
      } as never),
    ).resolves.toBeDefined()
  })
})
