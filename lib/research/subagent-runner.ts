import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL } from '@/lib/ai/client'
import type { Persona } from './personas'
import type { ResearchAgentOutput, ResearchFinding } from './types'

const MAX_RETRIES = 3
const BASE_BACKOFF_MS = 2_000
const MIN_FINDINGS = 3

/**
 * Anthropic's server-side web-search tool. The SDK (@anthropic-ai/sdk ^0.92.0)
 * types this as WebSearchTool20250305 — no cast needed. max_uses bounds cost
 * (web search is billed per use); 12 leaves headroom over the "aim for 10" prompt.
 */
const WEB_SEARCH_TOOL: Anthropic.Messages.WebSearchTool20250305 = {
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 12,
}

export type SubagentInput = {
  persona: Persona
  platformDisplay: string
  symptomDisplay: string
  /** Optional prior session context. */
  caseContext?: string
}

const userPromptFor = (input: SubagentInput) =>
  `
Case to research:
- Vehicle: ${input.platformDisplay}
- Complaint: ${input.symptomDisplay}
${input.caseContext ? `\nAdditional case context:\n${input.caseContext}\n` : ''}

Produce the structured JSON findings now. Aim for 8-12 substantive web searches.
`.trim()

/**
 * Dispatch ONE persona-bound research subagent with the web-search tool enabled.
 * The orchestrator runs three of these in parallel. Reuses the shared lib/ai
 * client (Proxy-wrapped, lazy-init) rather than constructing a fresh Anthropic
 * instance per call. Retries transient API/network failures with exponential
 * backoff; a successful-but-thin response (fewer than MIN_FINDINGS) is reported
 * as 'failed' without burning a retry (the orchestrator synthesizes with N-1).
 */
export async function runSubagent(input: SubagentInput): Promise<ResearchAgentOutput> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 16_000,
        system: input.persona.systemPrompt,
        tools: [WEB_SEARCH_TOOL],
        messages: [{ role: 'user', content: userPromptFor(input) }],
      })

      const parsed = parseStructuredOutput(response.content)
      const visitedUrls = collectVisitedUrls(response)

      return {
        persona: input.persona.id,
        status: parsed.findings.length >= MIN_FINDINGS ? 'completed' : 'failed',
        researchLog: parsed.researchLog,
        findings: parsed.findings,
        visitedUrls,
        tokenUsage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
        },
        errorMessage:
          parsed.findings.length >= MIN_FINDINGS
            ? undefined
            : `Subagent returned ${parsed.findings.length} finding(s) (need ${MIN_FINDINGS})`,
      }
    } catch (err) {
      lastError = err
      if (attempt < MAX_RETRIES - 1) {
        const backoff = BASE_BACKOFF_MS * Math.pow(2, attempt)
        await new Promise((r) => setTimeout(r, backoff))
      }
    }
  }

  return {
    persona: input.persona.id,
    status: 'failed',
    researchLog: '',
    findings: [],
    visitedUrls: [],
    tokenUsage: { inputTokens: 0, outputTokens: 0 },
    errorMessage: lastError instanceof Error ? lastError.message : 'Subagent failed after 3 retries',
  }
}

type ParsedOutput = { researchLog: string; findings: ResearchFinding[] }

function parseStructuredOutput(content: Anthropic.Messages.Message['content']): ParsedOutput {
  const blocks = Array.isArray(content) ? content : []
  const lastText = [...blocks].reverse().find((b) => b.type === 'text')
  if (!lastText || lastText.type !== 'text') return { researchLog: '', findings: [] }
  const text = lastText.text

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return { researchLog: text, findings: [] }
  try {
    const parsed = JSON.parse(jsonMatch[0]) as {
      researchLog?: string
      findings?: ResearchFinding[]
    }
    return {
      researchLog: parsed.researchLog ?? '',
      findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    }
  } catch {
    return { researchLog: text, findings: [] }
  }
}

function collectVisitedUrls(response: Anthropic.Messages.Message): string[] {
  const blocks = Array.isArray(response.content) ? response.content : []
  const urls = new Set<string>()
  for (const b of blocks) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
      for (const r of b.content) {
        if (r.type === 'web_search_result' && r.url) urls.add(r.url)
      }
    }
  }
  return Array.from(urls)
}
