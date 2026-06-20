import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL } from '@/lib/ai/client'
import type { Citation, Conflict, Flow, Step } from '@/lib/flows/types'
import type { SynthesisInput, SynthesisOutput } from './types'

/**
 * Three-pass synthesis (agent-03: one-pass citation accuracy is 24-77%; splitting
 * structure → citations → conflicts converges). The output is a DRAFT only — never
 * published or served by this pipeline.
 *
 * DURABLE OUTPUT CONTRACT: each pass uses tool-use (forced tool_choice) so the SDK
 * returns the model's output as a PARSED object on a tool_use block — no free-text
 * JSON regex-parsing, which previously truncated mid-array on large flows and failed
 * the whole expensive run. Combined with adequate max_tokens + graceful degradation
 * (a failed citations/conflicts pass falls back instead of killing the run).
 */

const CITATION_SCHEMA = {
  type: 'object',
  properties: {
    sourceUrl: { type: 'string' },
    title: { type: 'string' },
    fetchedAt: { type: 'string' },
    excerpt: { type: 'string' },
    evidenceGrade: { type: 'string', enum: ['confirmed', 'plausible', 'unverified'] },
  },
  required: ['sourceUrl', 'title', 'fetchedAt', 'excerpt', 'evidenceGrade'],
} as const

const STEP_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['question', 'procedure'] },
    n: { type: 'number' },
    of: { type: 'number' },
    title: { type: 'string' },
    question: { type: 'string', description: 'when kind=question' },
    instructions: { type: 'string', description: 'when kind=procedure' },
    note: { type: 'string' },
    next: { type: 'string', description: 'when kind=procedure: the next step id' },
    answers: {
      type: 'array',
      description: 'when kind=question; each answer has EXACTLY ONE of next or finding',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          captured: { type: 'string' },
          next: { type: 'string' },
          finding: {
            type: 'object',
            properties: {
              verdict: { type: 'string' },
              action: { type: 'string' },
              expectedSignal: { type: 'string' },
              severity: { type: 'string', enum: ['fixable', 'investigate', 'next-system'] },
            },
            required: ['verdict', 'action', 'severity'],
          },
        },
        required: ['id', 'label'],
      },
    },
    citations: { type: 'array', items: CITATION_SCHEMA },
  },
  required: ['kind', 'n', 'of', 'title'],
} as const

const FLOW_SCHEMA = {
  type: 'object',
  properties: {
    startStepId: { type: 'string' },
    steps: {
      type: 'object',
      description: 'Map of stepId → Step. Every branch terminates in a finding.',
      additionalProperties: STEP_SCHEMA,
    },
  },
  required: ['startStepId', 'steps'],
} as const

const CONFLICTS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          sides: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                stance: { type: 'string' },
                citations: { type: 'array', items: CITATION_SCHEMA },
              },
              required: ['stance', 'citations'],
            },
          },
        },
        required: ['description', 'sides'],
      },
    },
  },
  required: ['conflicts'],
} as const

const EMIT_FLOW_TOOL = {
  name: 'emit_flow',
  description: 'Return the decision-tree flow as a structured object.',
  input_schema: FLOW_SCHEMA,
} as unknown as Anthropic.Messages.Tool

const EMIT_CONFLICTS_TOOL = {
  name: 'emit_conflicts',
  description: 'Return the cross-agent conflicts (empty array if none).',
  input_schema: CONFLICTS_INPUT_SCHEMA,
} as unknown as Anthropic.Messages.Tool

const EMIT_CITATIONS_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    citations: { type: 'array', items: CITATION_SCHEMA },
  },
  required: ['citations'],
} as const

const EMIT_CITATIONS_TOOL = {
  name: 'emit_citations',
  description: "Return ONLY this one step's inline citations (empty array if none apply).",
  input_schema: EMIT_CITATIONS_INPUT_SCHEMA,
} as unknown as Anthropic.Messages.Tool

const STRUCTURE_SYSTEM_PROMPT = `
You are a senior diagnostic engineer translating 3 parallel research agents' findings into a structured decision-tree flow.

Call the emit_flow tool with the flow. Rules (the schema rejects violations):
- Each answer has EXACTLY ONE of "next" (advance to a step id) or "finding".
- "severity" MUST be one of: "fixable", "investigate", "next-system".
- Cheap PIDs first, expensive teardowns last. Every branch terminates in a finding. Every question has at least 2 answers.
- No citations or conflicts yet — those are later passes.
`.trim()

const CITATIONS_SYSTEM_PROMPT = `
You attach inline citations to ONE step of a diagnostic decision-tree flow. You receive 3 parallel research agents' findings (each with sources + excerpts), then the single step to cite.

Call the emit_citations tool with the citations array for THIS step only (empty array if no finding supports it). Each citation MUST reference a source URL that actually appears in one of the agents' findings — never invent URLs.
- sourceUrl + title + fetchedAt + excerpt come VERBATIM from an agent finding.
- evidenceGrade: "confirmed" if 2+ agents cite the same claim, "plausible" if only 1 agent, "unverified" if no agent source (then excerpt may be empty; otherwise excerpt MUST be a non-empty real quote).
`.trim()

const CONFLICTS_SYSTEM_PROMPT = `
You detect cross-agent conflicts in research findings. You receive 3 agents' findings. Look for pairs where two agents contradict (e.g. "test X first" vs "test Y first"), rank a root cause very differently, or disagree on a labor time / threshold / repair scope.

Call the emit_conflicts tool with the conflicts array (empty array if none).
`.trim()

type ToolResult<T> = { input: T; usage: Anthropic.Messages.Usage }

async function callTool<T>(args: {
  system: string
  user: string
  tool: Anthropic.Messages.Tool
  maxTokens: number
}): Promise<ToolResult<T>> {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: args.maxTokens,
    system: args.system,
    tools: [args.tool],
    tool_choice: { type: 'tool', name: args.tool.name },
    messages: [{ role: 'user', content: args.user }],
  })
  const block = (Array.isArray(resp.content) ? resp.content : []).find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use' && b.name === args.tool.name,
  )
  if (!block) throw new Error(`synthesis: model did not call ${args.tool.name}`)
  return { input: block.input as T, usage: resp.usage }
}

const CITATION_CONCURRENCY = 4
const CITATIONS_MAX_TOKENS = 4_000

/**
 * Pass 2 (citations), per-step. The previous single whole-flow call asked the model
 * to re-emit the entire flow with citations added; on a large flow (18 steps) that
 * output truncated and graceful-degrade fell back to a 0-citation draft. Instead we
 * cite ONE step per call — each output is just that step's Citation[], so nothing
 * truncates — and reattach to the structure draft (whose shape is never re-emitted,
 * so it can't be mangled). The findings JSON repeats per step but is cached
 * (cache_control), so repeats read at ~10% cost. A single step's failure leaves only
 * that step uncited; the rest of the flow still gets citations.
 */
async function runCitationsPass(
  draftBody: Flow,
  findingsJson: string,
  addUsage: (u: Anthropic.Messages.Usage) => void,
): Promise<Flow> {
  const citationsById: Record<string, Citation[]> = {}

  const citeStep = async (id: string) => {
    try {
      const resp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: CITATIONS_MAX_TOKENS,
        system: [
          { type: 'text', text: CITATIONS_SYSTEM_PROMPT },
          { type: 'text', text: `Agents' findings:\n${findingsJson}`, cache_control: { type: 'ephemeral' } },
        ],
        tools: [EMIT_CITATIONS_TOOL],
        tool_choice: { type: 'tool', name: EMIT_CITATIONS_TOOL.name },
        messages: [{ role: 'user', content: `Step to cite:\n${JSON.stringify(draftBody.steps[id], null, 2)}` }],
      })
      addUsage(resp.usage)
      const block = (Array.isArray(resp.content) ? resp.content : []).find(
        (b): b is Anthropic.Messages.ToolUseBlock =>
          b.type === 'tool_use' && b.name === EMIT_CITATIONS_TOOL.name,
      )
      const cites = (block?.input as { citations?: Citation[] } | undefined)?.citations
      if (Array.isArray(cites)) citationsById[id] = cites
    } catch {
      // leave this step uncited — the rest of the flow still gets citations.
    }
  }

  // Bounded concurrency: a large flow shouldn't open dozens of simultaneous calls.
  const stepIds = Object.keys(draftBody.steps)
  for (let i = 0; i < stepIds.length; i += CITATION_CONCURRENCY) {
    await Promise.all(stepIds.slice(i, i + CITATION_CONCURRENCY).map(citeStep))
  }

  const steps: Record<string, Step> = {}
  for (const [id, step] of Object.entries(draftBody.steps)) {
    steps[id] = id in citationsById ? { ...step, citations: citationsById[id] } : step
  }
  return { ...draftBody, steps }
}

function isUsableFlow(f: unknown): f is Flow {
  const flow = f as Flow | undefined
  return (
    !!flow &&
    typeof flow === 'object' &&
    typeof flow.startStepId === 'string' &&
    !!flow.steps &&
    typeof flow.steps === 'object' &&
    Object.keys(flow.steps).length > 0
  )
}

export async function runSynthesis(input: SynthesisInput): Promise<SynthesisOutput> {
  const findingsPayload = input.agents
    .filter((a) => a.status !== 'failed')
    .map((a) => ({ persona: a.persona, findings: a.findings ?? [] }))
  const findingsJson = JSON.stringify(findingsPayload, null, 2)

  let inputTokens = 0
  let outputTokens = 0
  const addUsage = (u: Anthropic.Messages.Usage) => {
    inputTokens += u.input_tokens
    outputTokens += u.output_tokens
  }

  // Pass 1: structure — essential. If it produces no usable flow, the run can't proceed.
  const structure = await callTool<Flow>({
    system: STRUCTURE_SYSTEM_PROMPT,
    user: `Vehicle: ${input.platformDisplay}\nSymptom: ${input.symptomDisplay}\n\nAgents' findings:\n${findingsJson}`,
    tool: EMIT_FLOW_TOOL,
    maxTokens: 16_000,
  })
  addUsage(structure.usage)
  const draftBody = structure.input
  if (!isUsableFlow(draftBody)) {
    throw new Error('synthesis structure pass produced no usable flow')
  }

  // Pass 2: citations — per-step (see runCitationsPass). Individual steps degrade
  // in-pass; this outer guard degrades the whole pass to the uncited structure draft
  // only on a catastrophic (non-per-step) failure. A citations hiccup must never
  // throw away the whole run.
  let citedBody: Flow = draftBody
  try {
    citedBody = await runCitationsPass(draftBody, findingsJson, addUsage)
  } catch {
    // keep draftBody — uncited but usable.
  }

  // Pass 3: conflicts — degrade to [] on any failure.
  let conflicts: Conflict[] = []
  try {
    const conf = await callTool<{ conflicts: Conflict[] }>({
      system: CONFLICTS_SYSTEM_PROMPT,
      user: `Agents' findings:\n${findingsJson}`,
      tool: EMIT_CONFLICTS_TOOL,
      maxTokens: 8_000,
    })
    addUsage(conf.usage)
    if (Array.isArray(conf.input?.conflicts)) conflicts = conf.input.conflicts
  } catch {
    // no conflicts surfaced.
  }

  // Anti-fabrication enforcement (not prompt-only): strip any citation — in steps OR
  // conflict sides — whose sourceUrl no agent actually fetched this run (types.ts
  // invariant + feedback_research_not_training). The draft is human-reviewed, so
  // dropping a hallucinated citation is safer than failing the run.
  const allowedUrls = collectAgentUrls(input.agents)
  const cleanBody = stripUnknownCitations(citedBody, allowedUrls)
  const cleanConflicts = stripUnknownConflictCitations(conflicts, allowedUrls)

  const synthesisMd = buildSynthesisMd(input, cleanBody, cleanConflicts)

  return {
    draftBody: cleanBody,
    conflicts: cleanConflicts,
    synthesisMd,
    tokenUsage: { inputTokens, outputTokens },
  }
}

/** Every URL the agents actually fetched this run (finding sources + visited URLs). */
function collectAgentUrls(agents: SynthesisInput['agents']): Set<string> {
  const urls = new Set<string>()
  for (const a of agents) {
    // Defensive: a model-produced finding can omit `sources`/`visitedUrls`.
    for (const f of a.findings ?? []) for (const s of f.sources ?? []) if (s?.url) urls.add(s.url)
    for (const u of a.visitedUrls ?? []) if (u) urls.add(u)
  }
  return urls
}

const keepKnown = (cites: Citation[] | undefined, allowed: Set<string>): Citation[] | undefined =>
  cites?.filter((c) => allowed.has(c.sourceUrl))

function stripUnknownCitations(body: Flow, allowed: Set<string>): Flow {
  if (!body?.steps) return body
  const steps: Record<string, Step> = {}
  for (const [id, step] of Object.entries(body.steps)) {
    steps[id] = { ...step, citations: keepKnown(step.citations, allowed) }
  }
  return { ...body, steps }
}

function stripUnknownConflictCitations(conflicts: Conflict[], allowed: Set<string>): Conflict[] {
  return conflicts.map((c) => ({
    ...c,
    sides: (c.sides ?? []).map((s) => ({
      ...s,
      citations: (s.citations ?? []).filter((cit) => allowed.has(cit.sourceUrl)),
    })),
  }))
}

function buildSynthesisMd(input: SynthesisInput, body: Flow, conflicts: Conflict[]): string {
  const stepCount = Object.keys(body.steps ?? {}).length
  return `# Synthesis — ${input.platformDisplay} / ${input.symptomDisplay}

Generated by the curator research pipeline (PR-N3). This is a DRAFT for the curator to edit and publish.

## Agents
${input.agents
  .map((a) => `- ${a.persona}: ${a.status} · ${a.findings?.length ?? 0} findings · ${a.visitedUrls?.length ?? 0} URLs visited`)
  .join('\n')}

## Draft flow
${stepCount} steps. startStepId = ${body.startStepId}.

## Conflicts surfaced
${conflicts.length === 0 ? 'None.' : conflicts.map((c, i) => `${i + 1}. ${c.description}`).join('\n')}
`
}
