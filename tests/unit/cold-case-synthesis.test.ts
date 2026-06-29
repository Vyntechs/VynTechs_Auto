import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { profiles, flows, researchRuns } from '@/lib/db/schema'
import type { SystemDataDraft } from '@/lib/diagnostics/promote-system-data'
import type { ResearchAgentOutput } from '@/lib/research/types'

// Mock the runners so no real Anthropic call happens (mirrors research-orchestrator.test.ts).
vi.mock('@/lib/research/subagent-runner', () => ({
  runSubagent: vi.fn(async ({ persona }: { persona: { id: string } }) => ({
    persona: persona.id,
    status: 'completed',
    researchLog: '',
    findings: [{ id: 'f1', claim: 'x', sources: [] }],
    visitedUrls: ['https://example.com'],
    tokenUsage: { inputTokens: 1, outputTokens: 1 },
  })),
}))
vi.mock('@/lib/research/synthesis-runner', () => ({
  runSynthesis: vi.fn(async () => ({
    draftBody: {
      startStepId: 'step-1',
      steps: {
        'step-1': {
          kind: 'question',
          n: 1,
          of: 1,
          title: 't',
          question: 'q?',
          answers: [{ id: 'a1', label: 'no', finding: { verdict: 'v', action: 'a', severity: 'fixable' } }],
        },
      },
    },
    conflicts: [],
    synthesisMd: '# md',
    tokenUsage: { inputTokens: 1, outputTokens: 1 },
  })),
}))

// DRAFT-ONLY system-data synthesis: mock the collaborator so executePipeline runs
// fully offline. The synthesis internals are covered by system-data-synthesis.test.ts;
// here we lock in that executePipeline SAVES the returned draft (status 'draft').
vi.mock('@/lib/research/system-data-synthesis', () => ({
  synthesizeSystemData: vi.fn(async (input: { platformSlug: string }) => ({
    draft: {
      platformSlug: input.platformSlug,
      status: 'draft' as const,
      components: [
        {
          slug: 'low-pressure-fuel-pump',
          name: 'Low-Pressure (Lift) Pump',
          kind: 'pump',
          systems: ['fuel'],
          sourceProvenance: 'TRAINING-INFERRED',
          inferenceClass: 'LOGIC',
          observableProperties: [],
        },
      ],
      connections: [],
    } satisfies SystemDataDraft,
    tokenUsage: { inputTokens: 1, outputTokens: 1 },
  })),
}))

import { runSubagent } from '@/lib/research/subagent-runner'
import { synthesizeSystemData } from '@/lib/research/system-data-synthesis'
import { startResearchRun, executePipeline } from '@/lib/research/orchestrator'

const PLATFORM = 'ford-super-duty-3rd-gen-60-psd'
const SYMPTOM = 'cranks-no-start'

const succeedingAgent = (persona: string): ResearchAgentOutput => ({
  persona: persona as ResearchAgentOutput['persona'],
  status: 'completed',
  researchLog: '',
  findings: [{ id: 'f1', claim: 'x', sources: [] }],
  visitedUrls: ['https://example.com'],
  tokenUsage: { inputTokens: 1, outputTokens: 1 },
})

const failedAgent = (persona: string): ResearchAgentOutput => ({
  persona: persona as ResearchAgentOutput['persona'],
  status: 'failed',
  researchLog: '',
  findings: [],
  visitedUrls: [],
  tokenUsage: { inputTokens: 0, outputTokens: 0 },
  errorMessage: 'boom',
})

describe('cold-case system-data draft (executePipeline)', () => {
  let db: TestDb
  let close: () => Promise<void>
  let profileId: string
  let flowId: string

  beforeEach(async () => {
    // Re-establish the succeeding default each test — vi.clearAllMocks() resets
    // calls but NOT a mockImplementation override (T1-C sets agents to failed).
    vi.mocked(runSubagent).mockImplementation(async ({ persona }) => succeedingAgent(persona.id))
    // Enable the feature flag for the tests that assert synthesis IS saved (T1-A/B/D/F).
    // T1-E explicitly deletes it to test the flag-OFF path.
    process.env.COLD_CASE_SYNTHESIS_ENABLED = 'true'
    ;({ db, close } = await createTestDb())
    ;[{ id: profileId }] = await db
      .insert(profiles)
      .values({ userId: randomUUID() })
      .returning({ id: profiles.id })
    ;[{ id: flowId }] = await db
      .insert(flows)
      .values({
        slug: `${PLATFORM}__${SYMPTOM}`,
        platformSlug: PLATFORM,
        symptomSlug: SYMPTOM,
        displayTitle: 'Test flow',
      })
      .returning({ id: flows.id })
  })
  afterEach(async () => {
    await close()
    vi.clearAllMocks()
    delete process.env.COLD_CASE_SYNTHESIS_ENABLED
  })

  const input = (over: Record<string, unknown> = {}) => ({
    platformSlug: PLATFORM,
    symptomSlug: SYMPTOM,
    platformDisplay: '2003–2007 Ford Super Duty (6.0L PSD)',
    symptomDisplay: 'Cranks, no start',
    flowId,
    initiatedByProfileId: profileId,
    ...over,
  })

  // T1-A
  it('saves a non-null system_data_draft with status draft + matching platformSlug when all agents succeed', async () => {
    const { runId } = await startResearchRun(input(), db)
    await executePipeline(runId, input(), db)

    const [row] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId)).limit(1)
    expect(row.status).toBe('completed')
    expect(row.systemDataDraft).not.toBeNull()
    const draft = row.systemDataDraft as SystemDataDraft
    expect(draft.status).toBe('draft')
    expect(draft.platformSlug).toBe(PLATFORM)
    expect(Array.isArray(draft.components)).toBe(true)
  })

  // T1-B
  it('always stamps status draft, never approved (promote refusal-gate preserved)', async () => {
    const { runId } = await startResearchRun(input(), db)
    await executePipeline(runId, input(), db)

    const [row] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId)).limit(1)
    const draft = row.systemDataDraft as SystemDataDraft
    expect(draft.status).toBe('draft')
    expect(draft.status).not.toBe('approved')
    expect((draft as { approvedBy?: string }).approvedBy).toBeUndefined()
  })

  // T1-C
  it('leaves system_data_draft null and does NOT attempt synthesis when all 3 agents fail', async () => {
    vi.mocked(runSubagent).mockImplementation(async ({ persona }) => failedAgent(persona.id))
    const { runId } = await startResearchRun(input(), db)
    await executePipeline(runId, input(), db)

    const [row] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId)).limit(1)
    expect(row.status).toBe('failed')
    expect(row.systemDataDraft).toBeNull()
    expect(synthesizeSystemData).not.toHaveBeenCalled()
  })

  // T1-D
  it('populates system_data_draft even with no flowId (no flow required for the draft path)', async () => {
    const noFlow = input({ flowId: undefined })
    const { runId } = await startResearchRun(noFlow, db)
    await executePipeline(runId, noFlow, db)

    const [row] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId)).limit(1)
    expect(row.status).toBe('completed')
    expect(row.systemDataDraft).not.toBeNull()
    expect((row.systemDataDraft as SystemDataDraft).status).toBe('draft')
  })

  // T1-E flag-OFF: executePipeline must complete normally, synthesizeSystemData must
  // never be called, and system_data_draft must be written null.
  it('does NOT call synthesizeSystemData and leaves system_data_draft null when COLD_CASE_SYNTHESIS_ENABLED is unset', async () => {
    delete process.env.COLD_CASE_SYNTHESIS_ENABLED
    const { runId } = await startResearchRun(input(), db)
    await executePipeline(runId, input(), db)

    const [row] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId)).limit(1)
    expect(row.status).toBe('completed')
    expect(synthesizeSystemData).not.toHaveBeenCalled()
    expect(row.systemDataDraft).toBeNull()
  })

  // T1-F error-isolation (flag ON): a synthesizeSystemData rejection must never block
  // the run from completing and must leave system_data_draft null.
  it('still completes and leaves system_data_draft null when synthesizeSystemData rejects (flag on)', async () => {
    vi.mocked(synthesizeSystemData).mockRejectedValueOnce(new Error('synthesis boom'))
    const { runId } = await startResearchRun(input(), db)
    await executePipeline(runId, input(), db)

    const [row] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId)).limit(1)
    expect(['completed', 'partial']).toContain(row.status)
    expect(row.systemDataDraft).toBeNull()
  })
})
