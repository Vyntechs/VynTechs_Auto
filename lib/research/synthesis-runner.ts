import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL } from '@/lib/ai/client'
import type { Citation, Conflict, Flow, Step } from '@/lib/flows/types'
import type { SynthesisInput, SynthesisOutput } from './types'

/**
 * Three-pass synthesis (agent-03: one-pass citation accuracy is 24-77%; splitting
 * structure → citations → conflicts converges). Reuses the shared lib/ai client.
 * The output is a DRAFT only — never published or served by this pipeline.
 */

const STRUCTURE_SYSTEM_PROMPT = `
You are a senior diagnostic engineer translating 3 parallel research agents' findings into a structured decision-tree flow.

Output a JSON object matching the Flow type:
{
  "startStepId": "step-1",
  "steps": {
    "step-1": {
      "kind": "question" | "procedure",
      "n": 1, "of": <total>,
      "title": "...",
      "question": "..." (when kind=question),
      "instructions": "..." (when kind=procedure),
      "answers": [ ... ]   (only when kind=question)
      "next": "step-2"     (only when kind=procedure)
    }
  }
}

Answer rules (STRICT — the schema rejects violations):
- Each answer is { "id": "a1", "label": "..." } plus EXACTLY ONE of:
    "next": "<stepId>"                         (advance to another step), OR
    "finding": { "verdict": "...", "action": "...", "severity": "...", "expectedSignal": "..." (optional) }
  Never both, never neither.
- "severity" MUST be one of: "fixable", "investigate", "next-system".

Hard rules:
- Cheap PIDs first, expensive teardowns last
- Every branch terminates in a finding
- Every question has at least 2 answers
- No citations or conflicts yet — those are passes 2 and 3

Output ONLY the JSON object, no commentary.
`.trim()

const CITATIONS_SYSTEM_PROMPT = `
You attach inline citations to a decision-tree flow.

You receive the flow body + 3 parallel research agents' findings (each with sources + excerpts).

Output the SAME flow body, but with every step's "citations" array populated. Each citation MUST reference a source URL that actually appears in one of the agents' findings — never invent URLs.

For each citation:
- sourceUrl + title + fetchedAt + excerpt come VERBATIM from the agent finding
- evidenceGrade: "confirmed" if 2+ agents cite the same claim, "plausible" if only 1 agent, "unverified" if the claim has no agent source (in which case the excerpt may be empty; otherwise the excerpt MUST be a non-empty real quote)

Output ONLY the updated Flow JSON.
`.trim()

const CONFLICTS_SYSTEM_PROMPT = `
You detect cross-agent conflicts in research findings.

You receive 3 agents' findings. Look for pairs where:
- Two agents make contradictory claims (e.g. "test X first" vs "test Y first")
- One agent ranks a candidate root cause #1 that another ranks #3 or lower
- Agents disagree on a labor time, threshold value, or repair scope

Output a JSON array:
[
  {
    "description": "Agents disagree on which test to run first for cold-start no-start.",
    "sides": [
      { "stance": "Test FICM voltage first", "citations": [{ "sourceUrl": "...", "title": "...", "fetchedAt": "...", "excerpt": "...", "evidenceGrade": "plausible" }] },
      { "stance": "Test ICP live during crank first", "citations": [...] }
    ]
  }
]

If no conflicts are detected, output [].
Output ONLY the JSON array.
`.trim()

export async function runSynthesis(input: SynthesisInput): Promise<SynthesisOutput> {
  const findingsPayload = input.agents
    .filter((a) => a.status !== 'failed')
    .map((a) => ({ persona: a.persona, findings: a.findings }))

  // Pass 1: structure
  const structureResp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8_000,
    system: STRUCTURE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Vehicle: ${input.platformDisplay}\nSymptom: ${input.symptomDisplay}\n\nAgents' findings:\n${JSON.stringify(findingsPayload, null, 2)}`,
      },
    ],
  })
  const draftBody = extractJsonObject<Flow>(structureResp)

  // Pass 2: citations
  const citationsResp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 12_000,
    system: CITATIONS_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Flow draft:\n${JSON.stringify(draftBody, null, 2)}\n\nAgents' findings:\n${JSON.stringify(findingsPayload, null, 2)}`,
      },
    ],
  })
  const citedBody = extractJsonObject<Flow>(citationsResp)

  // Pass 3: conflicts
  const conflictsResp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4_000,
    system: CONFLICTS_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Agents' findings:\n${JSON.stringify(findingsPayload, null, 2)}`,
      },
    ],
  })
  const conflicts = extractJsonArray<Conflict>(conflictsResp)

  // Anti-fabrication enforcement (not prompt-only): the synthesis layer must never emit a
  // citation URL that no agent actually fetched in this run (types.ts invariant +
  // feedback_research_not_training). Strip any citation — in steps OR conflict sides —
  // whose sourceUrl is absent from the agents' fetched URLs. The draft is human-reviewed,
  // so dropping a hallucinated citation is safer than failing the whole expensive run.
  const allowedUrls = collectAgentUrls(input.agents)
  const cleanBody = stripUnknownCitations(citedBody, allowedUrls)
  const cleanConflicts = stripUnknownConflictCitations(conflicts, allowedUrls)

  const synthesisMd = buildSynthesisMd(input, cleanBody, cleanConflicts)

  return {
    draftBody: cleanBody,
    conflicts: cleanConflicts,
    synthesisMd,
    tokenUsage: {
      inputTokens:
        structureResp.usage.input_tokens +
        citationsResp.usage.input_tokens +
        conflictsResp.usage.input_tokens,
      outputTokens:
        structureResp.usage.output_tokens +
        citationsResp.usage.output_tokens +
        conflictsResp.usage.output_tokens,
    },
  }
}

function extractJsonObject<T>(resp: Anthropic.Messages.Message): T {
  const text = lastTextBlock(resp)
  if (text === null) throw new Error('No text block in synthesis response')
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) throw new Error('No JSON object in synthesis response')
  return JSON.parse(m[0]) as T
}

function extractJsonArray<T>(resp: Anthropic.Messages.Message): T[] {
  const text = lastTextBlock(resp)
  if (text === null) return []
  const m = text.match(/\[[\s\S]*\]/)
  if (!m) return []
  try {
    return JSON.parse(m[0]) as T[]
  } catch {
    return []
  }
}

function lastTextBlock(resp: Anthropic.Messages.Message): string | null {
  const blocks = Array.isArray(resp.content) ? resp.content : []
  const block = [...blocks].reverse().find((b) => b.type === 'text')
  return block && block.type === 'text' ? block.text : null
}

/** Every URL the agents actually fetched this run (finding sources + visited URLs). */
function collectAgentUrls(agents: SynthesisInput['agents']): Set<string> {
  const urls = new Set<string>()
  for (const a of agents) {
    for (const f of a.findings) for (const s of f.sources) if (s.url) urls.add(s.url)
    for (const u of a.visitedUrls) if (u) urls.add(u)
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
    sides: c.sides.map((s) => ({ ...s, citations: s.citations.filter((cit) => allowed.has(cit.sourceUrl)) })),
  }))
}

function buildSynthesisMd(input: SynthesisInput, body: Flow, conflicts: Conflict[]): string {
  const stepCount = Object.keys(body.steps ?? {}).length
  return `# Synthesis — ${input.platformDisplay} / ${input.symptomDisplay}

Generated by the curator research pipeline (PR-N3). This is a DRAFT for the curator to edit and publish.

## Agents
${input.agents
  .map((a) => `- ${a.persona}: ${a.status} · ${a.findings.length} findings · ${a.visitedUrls.length} URLs visited`)
  .join('\n')}

## Draft flow
${stepCount} steps. startStepId = ${body.startStepId}.

## Conflicts surfaced
${conflicts.length === 0 ? 'None.' : conflicts.map((c, i) => `${i + 1}. ${c.description}`).join('\n')}
`
}
