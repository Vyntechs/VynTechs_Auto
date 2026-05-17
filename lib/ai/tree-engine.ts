import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL, cachedSystem } from './client'
import { TREE_ENGINE_SYSTEM } from './prompts'
import type { IntakePayload } from '@/lib/types'
import type { GateDecision } from '@/lib/gating/gap-handler'
import type { RetrievalResult } from '@/lib/retrieval/types'
import type { CorpusMatch } from '@/lib/corpus/retrieval'
import type { MatchedKnowledgeItem } from '@/lib/knowledge/retrieval'

export type { CorpusMatch }

export type TreeNode = {
  id: string
  label: string
  status: 'pending' | 'active' | 'resolved' | 'pruned'
  rationale?: string
  children?: string[]
}

export type WhatWouldClose =
  | { kind: 'confirm'; prompt: string; yesLabel?: string; noLabel?: string }
  | { kind: 'photo'; prompt: string; extractFor: string }

export type ProposedAction = {
  description: string
  confidence: number
  expectedSignal?: string
  confidenceGap?: string
  whatWouldClose?: string | WhatWouldClose
}

export type RequestedArtifact = {
  kind:
    | 'photo'
    | 'scan_screen'
    | 'wiring_diagram'
    | 'audio'
    | 'video'
    | 'ambient_conditions'
  prompt: string
}

export type TreeState = {
  nodes: TreeNode[]
  currentNodeId: string
  message: string
  done?: boolean
  rootCauseSummary?: string
  requestedArtifact?: RequestedArtifact
  proposedAction?: ProposedAction
  gateDecision?: GateDecision
  // Phase 1 → 3 transition (added 2026-05-07; see spec
  // docs/superpowers/specs/2026-05-07-two-phase-diagnose-repair-design.md)
  phase?: 'diagnosing' | 'repairing'
  diagnosisLockedAt?: string
}

export type ToolDispatcher = (
  toolName: string,
  toolInput: Record<string, unknown>,
) => Promise<{ items: MatchedKnowledgeItem[] }>

export type TreeEngineResult = {
  tree: TreeState
  consultedItems: MatchedKnowledgeItem[]
}

type ToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}
type TextBlock = { type: 'text'; text: string }
type ContentBlock = TextBlock | ToolUseBlock

type AnthropicLikeResponse = {
  stop_reason?: string
  content: ContentBlock[]
}

export type AnthropicClient = {
  messages: {
    create: (args: unknown, opts?: { signal?: AbortSignal }) => Promise<AnthropicLikeResponse>
  }
}

export type ToolUseDeps = {
  tools?: Anthropic.Tool[]
  dispatcher?: ToolDispatcher
  client?: AnthropicClient
}

const MAX_TOOL_ROUNDS = 5

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      // Bail on abort/timeout — retrying just burns the remaining Vercel
      // budget on another guaranteed timeout, so the stream gets killed
      // mid-flight and the client never sees the clean error.
      if (
        e instanceof Error &&
        (e.name === 'AbortError' || e.name === 'TimeoutError')
      ) {
        throw e
      }
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)))
      }
    }
  }
  throw lastErr
}

type RunToolLoopInput = {
  system: ReturnType<typeof cachedSystem>
  initialUserMessage: string
  tools?: Anthropic.Tool[]
  dispatcher?: ToolDispatcher
  client: AnthropicClient
  callName: 'generateInitialTree' | 'updateTree'
  inputSize: number
}

async function runToolLoop(input: RunToolLoopInput): Promise<TreeEngineResult> {
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [
    { role: 'user', content: input.initialUserMessage },
  ]
  const consulted: MatchedKnowledgeItem[] = []

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const t0 = Date.now()
    const res = await input.client.messages.create(
      {
        model: MODEL,
        max_tokens: 4096,
        system: input.system,
        messages,
        ...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
      },
      { signal: AbortSignal.timeout(45_000) },
    )
    console.log(
      `${input.callName}: anthropic call took ${Date.now() - t0}ms (round=${round}, input ~${input.inputSize} chars)`,
    )

    const toolUseBlocks = res.content.filter(
      (b): b is ToolUseBlock => b.type === 'tool_use',
    )
    if (toolUseBlocks.length === 0 || res.stop_reason !== 'tool_use') {
      const textBlock = res.content.find((b): b is TextBlock => b.type === 'text')
      if (!textBlock) throw new Error('no text block in response')
      const tree = parseTreeJson(textBlock.text, res.stop_reason ?? undefined)
      return { tree, consultedItems: consulted }
    }

    messages.push({ role: 'assistant', content: res.content })
    const toolResults: Array<{
      type: 'tool_result'
      tool_use_id: string
      content: string
      is_error?: boolean
    }> = []
    for (const tu of toolUseBlocks) {
      if (!input.dispatcher) {
        // No dispatcher means caller didn't wire knowledge. The AI shouldn't
        // be able to call tools in this case (we wouldn't have passed `tools`),
        // but defend in depth: return empty so the AI continues normally.
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({ items: [] }),
        })
        continue
      }
      try {
        const result = await input.dispatcher(tu.name, tu.input)
        consulted.push(...result.items)
        if (result.items.length === 0) {
          // PR 4 telemetry hook (option a — console.log to Vercel logs). The
          // 'gaps to fill' backlog is populated by grepping these lines. If we
          // ever want to query gaps, this becomes a table (kickoff item 7).
          console.log(
            JSON.stringify({
              event: 'knowledge_tool_empty',
              tool: tu.name,
              input: tu.input,
            }),
          )
        }
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({ items: result.items }),
        })
      } catch (err) {
        console.warn(`knowledge tool ${tu.name} failed:`, err)
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify({ items: [], error: 'tool_execution_failed' }),
          is_error: true,
        })
      }
    }
    messages.push({ role: 'user', content: toolResults })
  }

  throw new Error(
    `${input.callName} exceeded tool-use round cap (MAX_TOOL_ROUNDS=${MAX_TOOL_ROUNDS})`,
  )
}

export async function generateInitialTree(
  intake: IntakePayload,
  corpus?: CorpusMatch[],
  retrieval?: RetrievalResult[],
  deps: ToolUseDeps = {},
): Promise<TreeEngineResult> {
  const userMessage = buildIntakeUserMessage(intake, corpus, retrieval)
  return withRetry(async () =>
    runToolLoop({
      system: cachedSystem(TREE_ENGINE_SYSTEM),
      initialUserMessage: userMessage,
      tools: deps.tools,
      dispatcher: deps.dispatcher,
      client: deps.client ?? (anthropic as unknown as AnthropicClient),
      callName: 'generateInitialTree',
      inputSize: userMessage.length,
    }),
  )
}

function buildIntakeUserMessage(
  intake: IntakePayload,
  corpus?: CorpusMatch[],
  retrieval?: RetrievalResult[],
): string {
  const engine = intake.vehicleEngine ? ` (${intake.vehicleEngine})` : ''
  const mileage = intake.mileage ? `, ${intake.mileage} mi` : ''
  return `Vehicle: ${intake.vehicleYear} ${intake.vehicleMake} ${intake.vehicleModel}${engine}${mileage}.

Customer complaint: ${intake.customerComplaint}${ambientConditionsBlock(intake.ambientConditions)}${corpusContextBlock(corpus)}${retrievalContextBlock(retrieval)}

Generate the initial decision tree. Return JSON only — no prose, no fences.`
}

export function ambientConditionsBlock(
  conditions: IntakePayload['ambientConditions'],
): string {
  if (!conditions) return ''
  const parts: string[] = [`${conditions.temperatureF.toFixed(0)}°F`]
  if (typeof conditions.humidityPct === 'number') {
    parts.push(`${conditions.humidityPct.toFixed(0)}% humidity`)
  }
  if (typeof conditions.windKph === 'number') {
    parts.push(`wind ${conditions.windKph.toFixed(0)} kph`)
  }
  if (conditions.conditions) parts.push(conditions.conditions)
  const tag =
    conditions.source === 'geolocation'
      ? 'geolocation lookup, tech-confirmed'
      : 'tech-entered'
  return `\n\nAmbient conditions at the bay: ${parts.join(', ')} (${tag}).`
}

function retrievalContextBlock(retrieval: RetrievalResult[] | undefined): string {
  if (!retrieval || retrieval.length === 0) return ''
  const lines = retrieval
    .slice(0, 5)
    .map(
      (r, i) => `(${i + 1}) [${r.source}] ${r.title}\n    ${r.snippet.slice(0, 400)}`,
    )
    .join('\n\n')
  return `\n\nInternet retrieval (graded for relevance):\n${lines}`
}

function corpusContextBlock(corpus: CorpusMatch[] | undefined): string {
  if (corpus === undefined) return ''
  if (corpus.length === 0) {
    return '\n\nCorpus context: no prior matches in the network. Reason from training knowledge alone.'
  }
  const lines = corpus.map((c, i) => formatCorpusMatch(c, i)).join('\n\n')
  return `\n\nCorpus context (top ${corpus.length} matches, vehicle + DTC + symptom matched, vector-ranked):\n${lines}`
}

function formatCorpusMatch(c: CorpusMatch, i: number): string {
  // Founder entries are the highest source of truth in the system —
  // vetted by the shop owner. Tag them so the model treats their root
  // cause as a strong prior and reflects that in proposedAction.confidence.
  const tag = c.entrySource === 'founder' ? ' [SHOP-OWNER VERIFIED — highest trust]' : ''
  return `(${i + 1})${tag} confidence=${c.confidenceScore.toFixed(2)} success=${c.successConfirmCount} comebacks=${c.comebackRecordedCount} similarity=${c.similarityScore.toFixed(2)}\n    rootCause: ${c.rootCause}\n    summary: ${c.summary}`
}

export async function updateTree(input: {
  intake: IntakePayload
  currentTree: TreeState
  observation: string
  artifacts?: Array<{
    kind: string
    summary?: string
    structured?: Record<string, unknown>
    text?: string
  }>
  corpus?: CorpusMatch[]
  retrieval?: RetrievalResult[]
  /** Session-scoped DTC codes from all done scan_screen extractions (not just the
   *  current node). Carried through so the route wrapper can build a retrieval
   *  context that keeps its DTC anchor after the tree advances past `scan-codes`.
   *  Not consumed by `updateTree` itself — pass-through for the wrapper. */
  sessionDtcs?: string[]
  /** PR 4. Optional knowledge tool wiring. When `tools` is non-empty and
   *  `dispatcher` is set, the AI may call knowledge tools mid-conversation
   *  and consulted items are returned in the result. */
  tools?: Anthropic.Tool[]
  dispatcher?: ToolDispatcher
  client?: AnthropicClient
}): Promise<TreeEngineResult> {
  const artifactBlock =
    (input.artifacts ?? []).length > 0
      ? `\n\nArtifacts captured for this step (extracted by the perception layer):\n${(input.artifacts ?? [])
          .map(
            (a, i) =>
              `(${i + 1}) ${a.kind}: ${a.summary ?? '(no summary)'}\n${a.text ? `text: ${a.text}\n` : ''}${a.structured ? `structured: ${JSON.stringify(a.structured)}` : ''}`,
          )
          .join('\n\n')}`
      : ''

  const corpusBlock =
    (input.corpus ?? []).length > 0
      ? `\n\nCorpus matches (cross-shop prior cases, vector-ranked):\n${(input.corpus ?? [])
          .map((c, i) => formatCorpusMatch(c, i))
          .join('\n\n')}`
      : ''

  const retrievalBlock =
    (input.retrieval ?? []).length > 0
      ? `\n\nInternet retrieval (graded for relevance):\n${input.retrieval!
          .slice(0, 5)
          .map(
            (r, i) =>
              `(${i + 1}) [${r.source}] ${r.title}\n    ${r.snippet.slice(0, 400)}`,
          )
          .join('\n\n')}`
      : ''

  const userMessage = `Initial intake: ${JSON.stringify(input.intake)}${ambientConditionsBlock(input.intake.ambientConditions)}

Current tree state:
${JSON.stringify(input.currentTree, null, 2)}

Tech's observation on current step (${input.currentTree.currentNodeId}):
${input.observation}${artifactBlock}${corpusBlock}${retrievalBlock}

Update the tree based on this observation, any artifact evidence, the corpus matches, and the retrieval results. If sources conflict, surface the conflict transparently in the message field. Resolve or prune branches as appropriate. Set the next current step. If you have enough information to identify the root cause, set done=true and provide rootCauseSummary.

Return JSON only — no prose, no fences.`

  return withRetry(async () =>
    runToolLoop({
      system: cachedSystem(TREE_ENGINE_SYSTEM),
      initialUserMessage: userMessage,
      tools: input.tools,
      dispatcher: input.dispatcher,
      client: input.client ?? (anthropic as unknown as AnthropicClient),
      callName: 'updateTree',
      inputSize: userMessage.length,
    }),
  )
}

export function parseTreeJson(text: string, stopReason?: string): TreeState {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (firstErr) {
    // Recovery: extract from first '{' to last '}' (handles stray prose around the JSON).
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(cleaned.slice(start, end + 1))
      } catch {
        throw new Error(
          `tree response not valid JSON (stop_reason=${stopReason ?? 'unknown'}, len=${cleaned.length}): ${
            (firstErr as Error).message
          }`,
        )
      }
    } else {
      throw new Error(
        `tree response not valid JSON (stop_reason=${stopReason ?? 'unknown'}, len=${cleaned.length}): ${
          (firstErr as Error).message
        }`,
      )
    }
  }

  if (
    !Array.isArray((parsed as { nodes?: unknown })?.nodes) ||
    typeof (parsed as { currentNodeId?: unknown })?.currentNodeId !== 'string' ||
    typeof (parsed as { message?: unknown })?.message !== 'string'
  ) {
    throw new Error('invalid tree response shape')
  }

  const proposedAction = (parsed as { proposedAction?: { whatWouldClose?: unknown } })
    .proposedAction
  const wwc = proposedAction?.whatWouldClose
  if (wwc !== undefined && typeof wwc !== 'string') {
    if (typeof wwc !== 'object' || wwc === null) {
      throw new Error('invalid whatWouldClose: must be string or object')
    }
    const obj = wwc as {
      kind?: unknown
      prompt?: unknown
      extractFor?: unknown
      yesLabel?: unknown
      noLabel?: unknown
    }
    if (typeof obj.prompt !== 'string') {
      throw new Error('invalid whatWouldClose: prompt must be a string')
    }
    if (obj.kind !== 'confirm' && obj.kind !== 'photo') {
      throw new Error(`invalid whatWouldClose: unknown kind "${String(obj.kind)}"`)
    }
    if (obj.kind === 'photo' && typeof obj.extractFor !== 'string') {
      throw new Error('invalid whatWouldClose: photo kind requires extractFor')
    }
    if (obj.kind === 'confirm') {
      if (obj.yesLabel !== undefined && typeof obj.yesLabel !== 'string') {
        throw new Error('invalid whatWouldClose: yesLabel must be a string when present')
      }
      if (obj.noLabel !== undefined && typeof obj.noLabel !== 'string') {
        throw new Error('invalid whatWouldClose: noLabel must be a string when present')
      }
    }
  }

  return parsed as TreeState
}
