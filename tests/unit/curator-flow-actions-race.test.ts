import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { flows, flowVersions, profiles, shops } from '@/lib/db/schema'
import type { Flow } from '@/lib/flows/types'

let currentDb: TestDb
let transactionEntered: (() => void) | null = null
let transactionRelease: Promise<void> | null = null

vi.mock('@/lib/db/client', () => ({
  db: new Proxy({} as TestDb, {
    get: (_target, property) => {
      if (property === 'transaction') {
        return async (callback: Parameters<TestDb['transaction']>[0]) => {
          transactionEntered?.()
          if (transactionRelease) await transactionRelease
          return currentDb.transaction(callback)
        }
      }
      const value = (currentDb as unknown as Record<PropertyKey, unknown>)[property]
      return typeof value === 'function' ? value.bind(currentDb) : value
    },
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/curator/route-helpers', () => ({
  requireCuratorProfile: vi.fn(),
}))

const SHOP = '00000000-0000-0000-0000-0000000000a1'
const USER = '00000000-0000-0000-0000-0000000000a2'
const CURATOR = '00000000-0000-0000-0000-0000000000a3'

const validBody: Flow = {
  startStepId: 'step-1',
  steps: {
    'step-1': {
      kind: 'question',
      n: 1,
      of: 1,
      title: 'Fuel pressure',
      question: 'Is pressure in range?',
      answers: [{
        id: 'answer-1',
        label: 'No',
        finding: { verdict: 'Pressure low', action: 'Test supply', severity: 'investigate' },
      }],
    },
  },
}

const invalidBody: Flow = {
  startStepId: 'step-1',
  steps: {
    'step-1': {
      kind: 'question', n: 1, of: 1, title: '', question: '', answers: [],
    },
  },
}

describe('curator flow save/publish concurrency', () => {
  let close: () => Promise<void>
  let flowVersionId: string

  beforeEach(async () => {
    const created = await createTestDb()
    currentDb = created.db
    close = created.close
    transactionEntered = null
    transactionRelease = null

    await currentDb.insert(shops).values({ id: SHOP, name: 'Test Shop' })
    await currentDb.insert(profiles).values({
      id: CURATOR,
      userId: USER,
      shopId: SHOP,
      role: 'owner',
      isCurator: true,
    })
    const { requireCuratorProfile } = await import('@/lib/curator/route-helpers')
    vi.mocked(requireCuratorProfile).mockResolvedValue({ id: CURATOR } as never)

    const [flow] = await currentDb.insert(flows).values({
      slug: 'race-proof',
      platformSlug: 'ford-super-duty-4th-gen-67-psd',
      symptomSlug: 'cranks-no-start',
      displayTitle: 'Race proof',
    }).returning({ id: flows.id })
    const [version] = await currentDb.insert(flowVersions).values({
      flowId: flow.id,
      versionNumber: 1,
      state: 'draft',
      body: validBody,
      authoredBy: CURATOR,
      changeNote: 'valid draft',
    }).returning({ id: flowVersions.id })
    flowVersionId = version.id
  })

  afterEach(async () => {
    transactionEntered = null
    transactionRelease = null
    vi.clearAllMocks()
    await close()
  })

  it('validates the body that actually wins the publish lock', async () => {
    let release!: () => void
    transactionRelease = new Promise<void>((resolve) => { release = resolve })
    const entered = new Promise<void>((resolve) => { transactionEntered = resolve })

    const { publishDraft, saveDraft } = await import('@/app/curator/flows/actions')
    const publishing = publishDraft({ flowVersionId, changeNote: 'publish valid body' })
    await entered

    await saveDraft({ flowVersionId, body: invalidBody, changeNote: 'late invalid body' })
    release()

    const result = await publishing
    expect(result.ok).toBe(false)

    const [stored] = await currentDb.select().from(flowVersions)
      .where(eq(flowVersions.id, flowVersionId))
    expect(stored.state).toBe('draft')
    expect(stored.body).toEqual(invalidBody)
  })
})
