import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { artifacts, profiles, sessionEvents, sessions, shops } from '@/lib/db/schema'
import { fetchCuratorCaseDetail } from '@/lib/curator/case-detail-query'
import * as caseDetailQuery from '@/lib/curator/case-detail-query'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

vi.mock('@/lib/db/client', () => ({ db: {} }))

const SHOP_ID = '00000000-0000-0000-0000-000000000701'
const USER_ID = '00000000-0000-0000-0000-000000000702'
const PROFILE_ID = '00000000-0000-0000-0000-000000000703'
const SESSION_ID = '00000000-0000-0000-0000-000000000704'

const intake = {
  vehicleYear: 2018,
  vehicleMake: 'Ford',
  vehicleModel: 'F-250',
  customerComplaint: 'Crank, no start',
}

const treeState = {
  currentNodeId: 'root',
  nodes: { root: { id: 'root', kind: 'observe', prompt: 'Check rail pressure' } },
  history: [],
} as never

describe('curator case detail without operational media', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    await db.insert(shops).values({ id: SHOP_ID, name: 'No Media Shop' })
    await db.insert(profiles).values({
      id: PROFILE_ID,
      userId: USER_ID,
      shopId: SHOP_ID,
      role: 'curator',
      isCurator: true,
    })
    await db.insert(sessions).values({
      id: SESSION_ID,
      shopId: SHOP_ID,
      techId: PROFILE_ID,
      status: 'closed',
      intake,
      treeState,
      outcome: {
        rootCause: 'Fuel supply restriction',
        actionType: 'repair',
        verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
        diagMinutes: 30,
        repairMinutes: 45,
      },
      closedAt: new Date('2026-07-15T12:00:00.000Z'),
    })
    await db.insert(sessionEvents).values({
      sessionId: SESSION_ID,
      nodeId: 'root',
      eventType: 'observation',
      observationText: 'Rail pressure stays below command.',
      aiResponse: { messageText: 'Inspect the supply side.' },
    })
    await db.insert(artifacts).values({
      sessionId: SESSION_ID,
      nodeId: 'root',
      kind: 'photo',
      storageKey: 'historical/do-not-touch.jpg',
      mimeType: 'image/jpeg',
      bytes: 4096,
      extractionStatus: 'done',
      extraction: { summary: 'Historical pump image' },
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await close()
  })

  it('returns session and text-event truth without projecting media or deleting history', async () => {
    const detail = await fetchCuratorCaseDetail(db, SESSION_ID)

    expect(detail?.session.id).toBe(SESSION_ID)
    expect(detail?.session.treeState).toEqual(treeState)
    expect(detail?.session.outcome?.rootCause).toBe('Fuel supply restriction')
    expect(detail?.events.map((event) => event.observationText)).toEqual([
      'Rail pressure stays below command.',
    ])
    expect(detail).not.toHaveProperty('artifacts')

    const historicalRows = await db.select().from(artifacts)
    expect(historicalRows).toHaveLength(1)
    expect(historicalRows[0]?.storageKey).toBe('historical/do-not-touch.jpg')
  })

  it('does not import or query the artifacts table', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'lib/curator/case-detail-query.ts'),
      'utf8',
    )

    expect(source).not.toMatch(/\bfrom\(artifacts\)/)
    expect(source).not.toMatch(/\bartifacts\b/)
  })

  it('renders the curator workflow with no media section or metadata', async () => {
    vi.spyOn(caseDetailQuery, 'fetchCuratorCaseDetail').mockResolvedValue({
      session: {
        id: SESSION_ID,
        shopId: SHOP_ID,
        techId: PROFILE_ID,
        vehicleId: null,
        status: 'closed',
        intake,
        treeState,
        outcome: {
          rootCause: 'Fuel supply restriction',
          actionType: 'repair',
          verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
          diagMinutes: 30,
          repairMinutes: 45,
        },
        createdAt: new Date('2026-07-15T11:00:00.000Z'),
        closedAt: new Date('2026-07-15T12:00:00.000Z'),
        curatorNote: null,
        curatorOverrideAction: null,
        maxCorpusSimilarity: null,
        wizardState: null,
        lastScenarioSlug: null,
        adaptiveDiagnosticState: null,
        adaptiveRevision: 0,
      },
      events: [
        {
          id: '00000000-0000-0000-0000-000000000705',
          sessionId: SESSION_ID,
          nodeId: 'root',
          eventType: 'observation',
          observationText: 'Rail pressure stays below command.',
          aiResponse: { messageText: 'Inspect the supply side.' },
          requestKey: null,
          requestActorProfileId: null,
          requestFingerprint: null,
          createdAt: new Date('2026-07-15T11:30:00.000Z'),
        },
      ],
    })
    const { default: CuratorCasePage } = await import('@/app/curator/cases/[sessionId]/page')

    const view = await CuratorCasePage({
      params: Promise.resolve({ sessionId: SESSION_ID }),
      searchParams: Promise.resolve({}),
    })
    const html = renderToStaticMarkup(view)

    expect(html).toContain('Conversation')
    expect(html).toContain('Diagnostic Path')
    expect(html).toContain('Outcome')
    expect(html).toContain('Rail pressure stays below command.')
    expect(html).not.toMatch(/Artifacts|image\/jpeg|4\.0 KB|extraction|storage|media/i)
  })
})
