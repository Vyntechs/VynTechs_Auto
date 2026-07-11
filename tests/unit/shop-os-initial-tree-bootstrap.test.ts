import { describe, expect, it, vi } from 'vitest'
import type { AppDb } from '@/lib/db/queries'
import type { TreeState } from '@/lib/ai/tree-engine'
import type { IntakePayload } from '@/lib/types'
import type { RetrievalAdapter } from '@/lib/retrieval/types'
import {
  generateInitialDiagnosticTree,
  type InitialTreeBootstrapDependencies,
} from '@/lib/diagnostics/initial-tree-bootstrap'

const intake: IntakePayload = {
  vehicleYear: 2014,
  vehicleMake: 'Ford',
  vehicleModel: 'F-250',
  vehicleEngine: '6.7L Power Stroke',
  mileage: 142_000,
  customerComplaint: 'P0087 and low rail pressure under load',
}

const generatedTree: TreeState = {
  nodes: [{ id: 'scan-codes', label: 'Pull DTCs', status: 'active' }],
  currentNodeId: 'scan-codes',
  message: 'Pull current and history codes.',
}

type GeneratedMock = ReturnType<
  typeof vi.fn<(intake: IntakePayload) => Promise<TreeState>>
>

type TestDependencies = InitialTreeBootstrapDependencies & {
  generated: GeneratedMock
}

function makeDeps(): TestDependencies {
  const generated = vi.fn(async (_intake: IntakePayload) => generatedTree)
  const adapter: RetrievalAdapter = {
    id: 'test-adapter',
    weight: 1,
    query: vi.fn(async () => []),
  }
  return {
    adapters: [adapter],
    resolvePlatformSlug: vi.fn<InitialTreeBootstrapDependencies['resolvePlatformSlug']>(
      (): string | null => 'ford-super-duty-3rd-gen-67-psd',
    ),
    extractDtcCodes: vi.fn<InitialTreeBootstrapDependencies['extractDtcCodes']>(
      () => ['P0087'],
    ),
    resolveSymptomSlug: vi.fn<InitialTreeBootstrapDependencies['resolveSymptomSlug']>(
      () => 'p0087',
    ),
    reconcileSeededSymptom: vi.fn<
      InitialTreeBootstrapDependencies['reconcileSeededSymptom']
    >(async () => null),
    generateInitialTree:
      vi.fn<InitialTreeBootstrapDependencies['generateInitialTree']>(),
    runRetrieval: vi.fn<InitialTreeBootstrapDependencies['runRetrieval']>(),
    validateRetrievalResults:
      vi.fn<InitialTreeBootstrapDependencies['validateRetrievalResults']>(),
    retrieveCorpus: vi.fn<InitialTreeBootstrapDependencies['retrieveCorpus']>(),
    buildGenerateInitialTreeWithRetrieval: vi.fn<
      InitialTreeBootstrapDependencies['buildGenerateInitialTreeWithRetrieval']
    >(() => generated),
    generated,
  }
}

describe('generateInitialDiagnosticTree', () => {
  it('returns the exact populated topology sentinel and performs no AI or retrieval work on a topology hit', async () => {
    const db = {} as AppDb
    const deps = makeDeps()
    vi.mocked(deps.reconcileSeededSymptom).mockResolvedValue(
      'p0087-fuel-rail-pressure-too-low',
    )

    const result = await generateInitialDiagnosticTree(db, intake, deps)

    expect(deps.resolvePlatformSlug).toHaveBeenCalledWith({
      year: 2014,
      make: 'Ford',
      model: 'F-250',
      engine: '6.7L Power Stroke',
    })
    expect(deps.extractDtcCodes).toHaveBeenCalledWith(intake.customerComplaint)
    expect(deps.resolveSymptomSlug).toHaveBeenCalledWith({
      dtcCodes: ['P0087'],
      complaintText: intake.customerComplaint,
    })
    expect(deps.reconcileSeededSymptom).toHaveBeenCalledWith(
      db,
      'ford-super-duty-3rd-gen-67-psd',
      { candidateSlug: 'p0087', complaintText: intake.customerComplaint },
    )
    expect(result).toEqual({
      nodes: [{ id: '_topology', label: 'topology', status: 'active' }],
      currentNodeId: '_topology',
      message: '',
      done: true,
    })
    expect(result.nodes).not.toHaveLength(0)
    expect(deps.buildGenerateInitialTreeWithRetrieval).not.toHaveBeenCalled()
    expect(deps.generated).not.toHaveBeenCalled()
    expect(deps.generateInitialTree).not.toHaveBeenCalled()
    expect(deps.runRetrieval).not.toHaveBeenCalled()
    expect(deps.validateRetrievalResults).not.toHaveBeenCalled()
    expect(deps.retrieveCorpus).not.toHaveBeenCalled()
  })

  it('returns isolated topology state and nodes for every bootstrap call', async () => {
    const db = {} as AppDb
    const deps = makeDeps()
    vi.mocked(deps.reconcileSeededSymptom).mockResolvedValue(
      'p0087-fuel-rail-pressure-too-low',
    )

    const first = await generateInitialDiagnosticTree(db, intake, deps)
    const second = await generateInitialDiagnosticTree(db, intake, deps)

    expect(first).not.toBe(second)
    expect(first.nodes).not.toBe(second.nodes)

    first.nodes[0].label = 'mutated by a caller'
    expect(second.nodes[0]).toEqual({
      id: '_topology',
      label: 'topology',
      status: 'active',
    })
  })

  it('uses the existing retrieval initializer with the exact configured wiring when topology is absent', async () => {
    const db = {} as AppDb
    const deps = makeDeps()

    const result = await generateInitialDiagnosticTree(db, intake, deps)

    expect(deps.buildGenerateInitialTreeWithRetrieval).toHaveBeenCalledOnce()
    expect(deps.buildGenerateInitialTreeWithRetrieval).toHaveBeenCalledWith({
      db,
      adapters: deps.adapters,
      generateInitialTree: deps.generateInitialTree,
      runRetrieval: deps.runRetrieval,
      validateRetrievalResults: deps.validateRetrievalResults,
      retrieveCorpus: deps.retrieveCorpus,
    })
    expect(deps.generated).toHaveBeenCalledOnce()
    expect(deps.generated).toHaveBeenCalledWith(intake)
    expect(result).toBe(generatedTree)
  })

  it('skips database topology reconciliation for unsupported platforms but still runs the existing initializer', async () => {
    const db = {} as AppDb
    const deps = makeDeps()
    vi.mocked(deps.resolvePlatformSlug).mockReturnValue(null)

    await generateInitialDiagnosticTree(db, { ...intake, vehicleEngine: undefined }, deps)

    expect(deps.resolvePlatformSlug).toHaveBeenCalledWith({
      year: 2014,
      make: 'Ford',
      model: 'F-250',
      engine: '',
    })
    expect(deps.reconcileSeededSymptom).not.toHaveBeenCalled()
    expect(deps.generated).toHaveBeenCalledOnce()
  })
})
