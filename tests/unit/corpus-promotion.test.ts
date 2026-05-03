import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { AppDb } from '@/lib/db/queries'

const embedMock = vi.fn().mockResolvedValue(Array(1536).fill(0.1))
vi.mock('@/lib/ai/embeddings', () => ({
  embed: embedMock,
}))

function makeDb(rows: unknown[]): { db: AppDb; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn().mockResolvedValue(rows)
  const db = { execute } as unknown as AppDb
  return { db, execute }
}

const BASE_INPUT = {
  sessionId: 'sess-1',
  shopId: 'shop-1',
  intake: {
    vehicleYear: 2018,
    vehicleMake: 'Ford',
    vehicleModel: 'F-150',
    vehicleEngine: '3.5L EcoBoost',
    customerComplaint: 'loss of power going up hills',
  },
  outcome: {
    rootCause: 'wastegate vacuum line crack',
    actionType: 'part_replacement' as const,
    verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' as const },
    diagMinutes: 45,
    repairMinutes: 20,
  },
  extractedDtcs: ['P0299', 'P0236'],
  extractedSymptomTags: ['power_loss'],
}

describe('promoteSessionToCorpus', () => {
  beforeEach(() => {
    embedMock.mockClear()
    vi.resetModules()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('inserts a corpus entry and returns its id', async () => {
    const { db, execute } = makeDb([{ id: 'corpus-new' }])
    const { promoteSessionToCorpus } = await import('@/lib/corpus/promotion')
    const id = await promoteSessionToCorpus(db, BASE_INPUT)
    expect(id).toBe('corpus-new')
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('embeds a target string that includes vehicle, root cause, DTCs, and tags', async () => {
    const { db } = makeDb([{ id: 'corpus-new' }])
    const { promoteSessionToCorpus } = await import('@/lib/corpus/promotion')
    await promoteSessionToCorpus(db, BASE_INPUT)
    const target: string = embedMock.mock.calls.at(-1)![0]
    expect(target).toContain('2018')
    expect(target).toContain('Ford')
    expect(target).toContain('F-150')
    expect(target).toContain('wastegate vacuum line crack')
    expect(target).toContain('P0299')
    expect(target).toContain('power_loss')
  })

  it('infers symptom tags from the customer complaint when not explicitly provided', async () => {
    const { inferSymptomTags } = await import('@/lib/corpus/promotion')
    expect(inferSymptomTags('loss of power going up hills')).toContain('power_loss')
    expect(inferSymptomTags('check engine light is on')).toContain('warning_light')
    expect(inferSymptomTags('rough idle and misfire')).toContain('misfire')
    expect(inferSymptomTags('won’t start')).toContain('starting_issue')
    expect(inferSymptomTags('overheating')).toContain('overheat')
    expect(inferSymptomTags('coolant leak')).toContain('leak')
    expect(inferSymptomTags('tick on cold start')).toContain('abnormal_noise')
    expect(inferSymptomTags('brake squeal')).toContain('brake')
  })
})
