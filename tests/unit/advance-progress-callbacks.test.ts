import { describe, it, expect, vi } from 'vitest'
import { buildUpdateTreeWithRetrieval } from '@/lib/retrieval/wire-into-tree'
import type { AdvanceStreamEvent } from '@/lib/advance-stream-events'
import type { TreeState } from '@/lib/ai/tree-engine'

vi.mock('@/lib/db/queries', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/db/queries')>('@/lib/db/queries')
  return {
    ...actual,
    getProfileByUserId: vi.fn().mockResolvedValue({ id: 'p1', shopId: 'shop1' }),
    getSessionById: vi.fn().mockResolvedValue({
      id: 's1',
      techId: 'p1',
      status: 'open',
      treeState: { nodes: [], currentNodeId: 'n1', message: '' },
      intake: {
        vehicleYear: 2020,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        vehicleEngine: '5.0L',
        customerComplaint: 'misfire',
      },
    }),
    listArtifactsForSession: vi.fn().mockResolvedValue([]),
    appendSessionEvent: vi.fn().mockResolvedValue(undefined),
    updateSessionTreeState: vi.fn().mockResolvedValue(undefined),
    recordTechAssistRequest: vi.fn().mockResolvedValue({ exhausted: false }),
  }
})

vi.mock('@/lib/gating/gap-handler', () => ({
  gateProposedAction: vi.fn().mockResolvedValue({ ok: true }),
}))

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

describe('advanceSession onProgress', () => {
  function makeArtifacts(kinds: string[]) {
    return kinds.map((kind, i) => ({
      id: `a${i}`,
      sessionId: 's1',
      nodeId: 'n1',
      kind,
      extractionStatus: 'done',
      extraction: { summary: 'test' },
    }))
  }

  it('emits stage 0 (Recording observation) and stage 4 (Advancing to next step)', async () => {
    const { advanceSession } = await import('@/lib/sessions')
    const events: AdvanceStreamEvent[] = []
    const onProgress = (e: AdvanceStreamEvent) => events.push(e)

    await advanceSession({
      db: {} as never,
      userId: 'u1',
      sessionId: 's1',
      body: { observation: 'plug 4 burnt' },
      updateTree: vi.fn().mockResolvedValue(makeFakeTree()) as never,
      listArtifacts: vi.fn().mockResolvedValue([]) as never,
      onProgress,
    })

    const stageEvents = events.filter((e) => e.type === 'stage')
    expect(stageEvents[0]).toMatchObject({ label: 'Recording observation' })
    expect(stageEvents[stageEvents.length - 1]).toMatchObject({
      label: 'Advancing to next step',
    })
  })

  it('emits stage 1 (Parsing photo · N frames) when nodeArtifacts has photos', async () => {
    const { advanceSession } = await import('@/lib/sessions')
    const events: AdvanceStreamEvent[] = []
    const onProgress = (e: AdvanceStreamEvent) => events.push(e)

    await advanceSession({
      db: {} as never,
      userId: 'u1',
      sessionId: 's1',
      body: { observation: 'plug 4 burnt' },
      updateTree: vi.fn().mockResolvedValue(makeFakeTree()) as never,
      listArtifacts: vi
        .fn()
        .mockResolvedValue(makeArtifacts(['photo', 'photo'])) as never,
      onProgress,
    })

    const photoEvent = events.find(
      (e) => e.type === 'stage' && e.label.startsWith('Parsing photo'),
    )
    expect(photoEvent).toBeDefined()
    expect(photoEvent).toMatchObject({ label: 'Parsing photo · 2 frames' })
  })

  it('does NOT emit photo stage when no photo artifacts exist', async () => {
    const { advanceSession } = await import('@/lib/sessions')
    const events: AdvanceStreamEvent[] = []
    const onProgress = (e: AdvanceStreamEvent) => events.push(e)

    await advanceSession({
      db: {} as never,
      userId: 'u1',
      sessionId: 's1',
      body: { observation: 'plug 4 burnt' },
      updateTree: vi.fn().mockResolvedValue(makeFakeTree()) as never,
      listArtifacts: vi.fn().mockResolvedValue(makeArtifacts(['audio'])) as never,
      onProgress,
    })

    expect(
      events.some((e) => e.type === 'stage' && e.label.startsWith('Parsing photo')),
    ).toBe(false)
  })
})
