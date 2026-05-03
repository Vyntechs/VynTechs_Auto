import { anthropic, MODEL, cachedSystem } from '@/lib/ai/client'
import { RETRIEVAL_VALIDATOR_SYSTEM } from '@/lib/ai/prompts'
import type { RetrievalContext, RetrievalResult } from './types'

const MIN_RELEVANCE = 0.4

export async function validateRetrievalResults(input: {
  ctx: RetrievalContext
  results: RetrievalResult[]
}): Promise<RetrievalResult[]> {
  if (input.results.length === 0) return []

  const userMessage = `Case context:
- Vehicle: ${input.ctx.vehicleYear} ${input.ctx.vehicleMake} ${input.ctx.vehicleModel}${input.ctx.vehicleEngine ? ` (${input.ctx.vehicleEngine})` : ''}
- Complaint: ${input.ctx.complaintText}
- DTCs: ${(input.ctx.dtcs ?? []).join(', ') || '(none)'}
- Current observation: ${input.ctx.observation ?? '(initial intake)'}

Snippets to grade (index : source : title : snippet):
${input.results.map((r, i) => `${i} : ${r.source} : ${r.title} : ${r.snippet.slice(0, 400)}`).join('\n\n')}

Return JSON only.`

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: cachedSystem(RETRIEVAL_VALIDATOR_SYSTEM),
    messages: [{ role: 'user', content: userMessage }],
  })
  const block = res.content.find(b => b.type === 'text')
  if (!block || block.type !== 'text') return input.results
  let parsed: { validated: Array<{ index: number; keep: boolean; relevance: number; why?: string }> }
  try {
    parsed = JSON.parse(block.text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, ''))
  } catch {
    return input.results
  }

  return parsed.validated
    .filter(v => v.keep && v.relevance >= MIN_RELEVANCE)
    .sort((a, b) => b.relevance - a.relevance)
    .map(v => input.results[v.index])
    .filter(Boolean)
}
