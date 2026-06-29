import { eq, and, gt, desc } from 'drizzle-orm'
import { db as defaultDb } from '@/lib/db/client'
import type { AppDb } from '@/lib/db/queries'
import { researchRuns, flowVersions } from '@/lib/db/schema'
import { nextVersionFor } from '@/lib/curator/flow-versions' // shared helper, owned by PR-N2
import { isColdCaseSynthesisEnabled } from '@/lib/feature-flags'
import { runSubagent } from './subagent-runner'
import { runSynthesis } from './synthesis-runner'
import { synthesizeSystemData } from './system-data-synthesis'
import { RESEARCH_PERSONAS } from './personas'
import type { ResearchAgentOutput, ResearchRunInput } from './types'

export type StartResult = { runId: string }

/**
 * SLUG-KEYED: a research run identifies a case by its platform/symptom slug pair.
 * Display names arrive pre-resolved on `input` (the caller looks them up in PR-N2's
 * known-slug catalog) — this module NEVER queries a platform/symptom table.
 *
 * Dispatch is split from insert: startResearchRun writes the row and returns the id
 * immediately; the heavy fan-out + synthesis runs in executePipeline, which the API
 * route schedules via Next's after() so it survives the response on Vercel Fluid
 * Compute (a bare fire-and-forget promise would be frozen once the response flushes).
 * Splitting this way also keeps both functions pure + unit-testable.
 */
export async function startResearchRun(
  input: ResearchRunInput,
  db: AppDb = defaultDb,
): Promise<StartResult> {
  const initialOutputs: ResearchAgentOutput[] = RESEARCH_PERSONAS.map((p) => ({
    persona: p.id,
    status: 'running' as const,
    researchLog: '',
    findings: [],
    visitedUrls: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
  }))

  const [run] = await db
    .insert(researchRuns)
    .values({
      flowId: input.flowId ?? null,
      platformSlug: input.platformSlug,
      symptomSlug: input.symptomSlug,
      status: 'running',
      agentOutputs: initialOutputs,
      synthesisMd: '',
      initiatedBy: input.initiatedByProfileId,
    })
    .returning()

  return { runId: run.id }
}

/**
 * Find a completed research_run within `withinDays` for the same slug pair. Drives the
 * UI's "Reuse prior research" prompt (cost optimization — agent-03 + agent-05).
 */
export async function findRecentResearchRun(
  args: { platformSlug: string; symptomSlug: string; withinDays?: number },
  db: AppDb = defaultDb,
): Promise<{ id: string; completedAt: Date; flowId?: string; flowVersionId?: string } | null> {
  const days = args.withinDays ?? 90
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000)
  const [row] = await db
    .select({
      id: researchRuns.id,
      completedAt: researchRuns.completedAt,
      flowId: researchRuns.flowId,
      flowVersionId: flowVersions.id, // a draft version referencing this run, if any
    })
    .from(researchRuns)
    .leftJoin(flowVersions, eq(flowVersions.researchRunId, researchRuns.id))
    .where(
      and(
        eq(researchRuns.platformSlug, args.platformSlug),
        eq(researchRuns.symptomSlug, args.symptomSlug),
        eq(researchRuns.status, 'completed'),
        gt(researchRuns.completedAt, cutoff),
      ),
    )
    .orderBy(desc(researchRuns.completedAt))
    .limit(1)
  if (!row || !row.completedAt) return null
  return {
    id: row.id,
    completedAt: row.completedAt,
    flowId: row.flowId ?? undefined,
    flowVersionId: row.flowVersionId ?? undefined,
  }
}

/**
 * The heavy work: fan out 3 persona subagents, persist their real per-agent status,
 * synthesize a DRAFT Flow, and (when researching an existing flow) write a draft
 * flow_version referencing this run. Self-contained: any thrown error marks the run
 * 'failed' so the polling client never hangs. The pipeline writes state='draft' ONLY —
 * it never publishes or serves (AI-as-tool: Brandon edits + publishes by hand).
 */
export async function executePipeline(
  runId: string,
  input: ResearchRunInput,
  db: AppDb = defaultDb,
): Promise<void> {
  try {
    const platform = input.platformDisplay
    const symptom = input.symptomDisplay

    // Fan out the personas in parallel. runSubagent already swallows its own errors
    // (returning a 'failed' output), but guard the dispatch defensively anyway.
    const agentResults = await Promise.all(
      RESEARCH_PERSONAS.map(async (persona): Promise<ResearchAgentOutput> => {
        try {
          return await runSubagent({ persona, platformDisplay: platform, symptomDisplay: symptom })
        } catch (err) {
          return {
            persona: persona.id,
            status: 'failed',
            researchLog: '',
            findings: [],
            visitedUrls: [],
            tokenUsage: { inputTokens: 0, outputTokens: 0 },
            errorMessage: err instanceof Error ? err.message : 'subagent threw',
          }
        }
      }),
    )

    // Persist partial state so the polling client sees real per-agent results.
    await db.update(researchRuns).set({ agentOutputs: agentResults }).where(eq(researchRuns.id, runId))

    // Pre-mortem mitigation (agent-06): all three failed → stop, mark failed.
    if (agentResults.every((a) => a.status === 'failed')) {
      await db
        .update(researchRuns)
        .set({ status: 'failed', errorMessage: 'All 3 research passes failed', completedAt: new Date() })
        .where(eq(researchRuns.id, runId))
      return
    }

    // Flow synthesis runs always. System-data synthesis is DRAFT-ONLY and gated
    // behind COLD_CASE_SYNTHESIS_ENABLED — when the flag is off the column is
    // written null and no extra AI call is made. A synthesis failure must NEVER
    // block the research run from completing — it is caught and the draft left null.
    const [synthesis, systemDataResult] = await Promise.all([
      runSynthesis({
        platformDisplay: platform,
        symptomDisplay: symptom,
        agents: agentResults,
      }),
      isColdCaseSynthesisEnabled()
        ? synthesizeSystemData({
            platformSlug: input.platformSlug,
            platformDisplay: platform,
            symptomDisplay: symptom,
            agents: agentResults,
          }).catch((err) => {
            console.error('system-data synthesis failed:', err)
            return null
          })
        : Promise.resolve(null),
    ])

    const finalStatus = agentResults.every((a) => a.status === 'completed') ? 'completed' : 'partial'

    await db.transaction(async (tx) => {
      if (input.flowId) {
        const nextVer = await nextVersionFor(tx, input.flowId)
        await tx.insert(flowVersions).values({
          flowId: input.flowId,
          versionNumber: nextVer,
          state: 'draft', // AI-as-tool: the pipeline NEVER publishes
          body: synthesis.draftBody,
          authoredBy: input.initiatedByProfileId,
          changeNote: 'research-pipeline pre-fill',
          researchRunId: runId,
        })
      }
      // No-flowId path is forbidden in PR-N3: the UI creates the flow row first.

      await tx
        .update(researchRuns)
        .set({
          status: finalStatus,
          synthesisMd: synthesis.synthesisMd,
          // DRAFT-ONLY envelope (status 'draft'); null when synthesis failed.
          systemDataDraft: systemDataResult?.draft ?? null,
          completedAt: new Date(),
        })
        .where(eq(researchRuns.id, runId))
    })
  } catch (err) {
    await db
      .update(researchRuns)
      .set({
        status: 'failed',
        errorMessage: err instanceof Error ? err.message : 'research pipeline failed',
        completedAt: new Date(),
      })
      .where(eq(researchRuns.id, runId))
  }
}
