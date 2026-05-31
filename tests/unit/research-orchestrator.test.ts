import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { profiles, flows, researchRuns, flowVersions } from '@/lib/db/schema'

// Mock the runners so no real Anthropic call happens.
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

import { startResearchRun, findRecentResearchRun, executePipeline } from '@/lib/research/orchestrator'

const PLATFORM = 'ford-super-duty-3rd-gen-60-psd'
const SYMPTOM = 'cranks-no-start'

describe('orchestrator (slug-keyed)', () => {
  let db: TestDb
  let close: () => Promise<void>
  let profileId: string
  let flowId: string

  beforeEach(async () => {
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
  })

  const input = () => ({
    platformSlug: PLATFORM,
    symptomSlug: SYMPTOM,
    platformDisplay: '2003–2007 Ford Super Duty (6.0L PSD)',
    symptomDisplay: 'Cranks, no start',
    flowId,
    initiatedByProfileId: profileId,
  })

  it('writes research_runs keyed on platform_slug + symptom_slug, status running', async () => {
    const { runId } = await startResearchRun(input(), db)
    const [row] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId)).limit(1)
    expect(row.platformSlug).toBe(PLATFORM)
    expect(row.symptomSlug).toBe(SYMPTOM)
    expect(row.status).toBe('running')
    expect(row.initiatedBy).toBe(profileId)
    // per-agent outputs initialized for the polling client
    expect(Array.isArray(row.agentOutputs)).toBe(true)
    expect((row.agentOutputs as unknown[]).length).toBe(3)
  })

  it('findRecentResearchRun matches on the slug pair within the window', async () => {
    const [done] = await db
      .insert(researchRuns)
      .values({
        flowId,
        platformSlug: PLATFORM,
        symptomSlug: SYMPTOM,
        status: 'completed',
        initiatedBy: profileId,
        completedAt: new Date(),
      })
      .returning({ id: researchRuns.id })
    const found = await findRecentResearchRun({ platformSlug: PLATFORM, symptomSlug: SYMPTOM }, db)
    expect(found?.id).toBe(done.id)

    const miss = await findRecentResearchRun({ platformSlug: PLATFORM, symptomSlug: 'other-symptom' }, db)
    expect(miss).toBeNull()
  })

  it('creates a draft flow_version (state=draft, researchRunId set) when flowId is supplied', async () => {
    const { runId } = await startResearchRun(input(), db)
    await executePipeline(runId, input(), db)

    const [version] = await db
      .select()
      .from(flowVersions)
      .where(eq(flowVersions.researchRunId, runId))
      .limit(1)
    expect(version).toBeTruthy()
    expect(version.state).toBe('draft')
    expect(version.flowId).toBe(flowId)
    expect(version.body).toMatchObject({ startStepId: 'step-1' })

    const [run] = await db.select().from(researchRuns).where(eq(researchRuns.id, runId)).limit(1)
    expect(run.status).toBe('completed')
    expect(run.completedAt).toBeTruthy()
    // The orchestrator persists whatever runSynthesis returns (mocked to '# md' here).
    expect(run.synthesisMd).toBe('# md')
  })

  it('does NOT reference platforms/symptoms tables (slug-only contract lock)', () => {
    const src = readFileSync(path.join(process.cwd(), 'lib/research/orchestrator.ts'), 'utf8')
    expect(src).not.toMatch(/\bplatforms\b/)
    expect(src).not.toMatch(/\bsymptoms\b/)
  })
})
