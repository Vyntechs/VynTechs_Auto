/**
 * Types for the research pipeline (PR-N3).
 * - A research run dispatches 3 persona-tuned subagents.
 * - Each subagent returns ResearchAgentOutput with findings + sources.
 * - Synthesis converts the 3 outputs into a Flow draft with inline citations + conflicts.
 *
 * SLUG-KEYED: research runs identify a case by platform_slug / symptom_slug TEXT
 * (matching the slug-keyed research_runs table from PR-N1). Display names are resolved
 * by the caller from PR-N2's known-slug catalog (lib/curator/slug-catalog.ts) — NOT by
 * querying platforms/symptoms (those tables are not in main's schema / the PGlite test DB).
 *
 * Anti-fabrication contract (mirrors PR-N1 Citation.excerpt required):
 *  - Every finding must reference at least one source the subagent fetched IN THIS RUN.
 *  - The synthesis layer never adds a URL not present in some agent's findings.
 */

import type { Citation, Conflict, Flow } from '@/lib/flows/types'

export type ResearchPersonaId =
  | 'aftermarket-shop-owner'
  | 'oem-master-tech'
  | 'independent-diesel-shop'

export type ResearchSource = {
  url: string
  title: string
  fetchedAt: string
  excerpt: string
}

export type ResearchFinding = {
  /** Stable id within this agent's output. Used by synthesis to cross-reference. */
  id: string
  /** A factual claim, written as one sentence. */
  claim: string
  /** Sources the agent fetched in-session that support this claim. */
  sources: ResearchSource[]
  /** Optional explicit caveat the agent surfaces (uncertainty, conflicts noticed in-run). */
  caveat?: string
}

export type ResearchAgentOutput = {
  persona: ResearchPersonaId
  /** Status of this individual agent. Synthesis can proceed with a 'failed' agent (N-1). */
  status: 'running' | 'completed' | 'failed'
  /** The agent's reasoning trace (for audit + Brandon review if synthesis seems off). */
  researchLog: string
  /** Findings produced by the agent. */
  findings: ResearchFinding[]
  /** Distinct URLs visited in this run (sanity-check vs claimed sources). */
  visitedUrls: string[]
  /** Token usage for cost accounting. */
  tokenUsage: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }
  /** If status='failed', the error message. */
  errorMessage?: string
}

/**
 * CANONICAL runSynthesis CONTRACT — owned/defined by PR-N3. This is the single source of
 * truth for the synthesis signature; every caller (including PR-N7's re-research) conforms
 * to THIS shape — no adapter, no parallel copy:
 *   runSynthesis(input: SynthesisInput): Promise<SynthesisOutput>
 * Callers pass DISPLAY strings (resolved via the slug catalog), pass results as `agents`
 * (NOT `personaOutputs`), read `draftBody` (NOT `flowBody`), and compute partial/incomplete
 * from per-agent statuses — there is NO `synthesis.partial` field.
 */
export type SynthesisInput = {
  /** Display name resolved from the known-slug catalog (PR-N2), e.g. '2003–2007 Ford Super Duty (6.0L PSD)'. */
  platformDisplay: string
  /** Display name resolved from the known-slug catalog, e.g. 'Cranks, no start'. */
  symptomDisplay: string
  /** The 3 per-persona research outputs (NOT `personaOutputs`). */
  agents: ResearchAgentOutput[]
}

export type SynthesisOutput = {
  /** Pre-filled DRAFT Flow body (NOT `flowBody`). Never published by this pipeline. */
  draftBody: Flow
  /** Cross-agent conflicts detected during synthesis. */
  conflicts: Conflict[]
  /** Human-readable synthesis summary persisted to research_runs.synthesis_md. */
  synthesisMd: string
  /** Total tokens spent across the 3 synthesis sub-passes. */
  tokenUsage: { inputTokens: number; outputTokens: number }
}

/**
 * SLUG-KEYED input. The caller (start route) supplies the slug pair + the resolved
 * display strings (looked up from the known-slug catalog before dispatch).
 */
export type ResearchRunInput = {
  platformSlug: string
  symptomSlug: string
  platformDisplay: string
  symptomDisplay: string
  /** Present when researching an existing flow (re-fill). Absent for first-time research. */
  flowId?: string
  initiatedByProfileId: string
}

export type ResearchRunStatusView = {
  id: string
  status: 'running' | 'completed' | 'failed' | 'partial'
  errorMessage: string | null
  /** Per-agent progress (REAL status read from the DB — never fabricated). */
  agents: Array<{
    persona: ResearchPersonaId
    /** Human-readable persona name for display (no "AI" word). */
    displayName: string
    status: 'running' | 'completed' | 'failed'
    /** e.g. "3 findings, 8 sources" or "failed: …" — derived from real agent output. */
    progressNote?: string
  }>
  startedAt: string
  completedAt: string | null
  /** Once a draft flow_version was created, its id (drives the redirect to the editor). */
  flowVersionId?: string
}

/** The Citation/Conflict/Flow shapes the synthesis emits are owned by lib/flows/types. */
export type { Citation, Conflict, Flow }
