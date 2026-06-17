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

const STRUCTURE_SYSTEM_PROMPT = `
You are a senior diagnostic engineer translating 3 parallel research agents' findings into a structured decision-tree flow.

Call the emit_flow tool with the flow. Rules (the schema rejects violations):
- Each answer has EXACTLY ONE of "next" (advance to a step id) or "finding".
- "severity" MUST be one of: "fixable", "investigate", "next-system".
- Cheap PIDs first, expensive teardowns last. Every branch terminates in a finding. Every question has at least 2 answers.
- No citations or conflicts yet — those are later passes.
`.trim()

const CITATIONS_SYSTEM_PROMPT = `
You attach inline citations to a decision-tree flow. You receive the flow body + 3 parallel research agents' findings (each with sources + excerpts).

Call the emit_flow tool with the SAME flow body, but with every step's "citations" array populated. Each citation MUST reference a source URL that actually appears in one of the agents' findings — never invent URLs.
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

  // Pass 2: citations — degrade to the uncited structure draft on ANY failure
  // (parse/truncation/API). A citations hiccup must never throw away the whole run.
  let citedBody: Flow = draftBody
  try {
    const cited = await callTool<Flow>({
      system: CITATIONS_SYSTEM_PROMPT,
      user: `Flow draft:\n${JSON.stringify(draftBody, null, 2)}\n\nAgents' findings:\n${findingsJson}`,
      tool: EMIT_FLOW_TOOL,
      maxTokens: 32_000,
    })
    addUsage(cited.usage)
    if (isUsableFlow(cited.input)) citedBody = cited.input
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
