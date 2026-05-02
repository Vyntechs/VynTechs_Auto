import { anthropic, MODEL, cachedSystem } from '@/lib/ai/client'
import { DECLINE_LANGUAGE_SYSTEM } from '@/lib/ai/prompts'

export type DeclineLanguage = {
  customerMessage: string
  internalNote: string
  recommendedReferral?: string
}

export type DeclineLanguageInput = {
  vehicleSummary: string
  complaint: string
  gap: string
  riskClass: string
  reason: 'decline' | 'defer'
}

export async function generateDeclineLanguage(
  input: DeclineLanguageInput,
): Promise<DeclineLanguage> {
  const userMessage = `Vehicle: ${input.vehicleSummary}
Customer complaint: ${input.complaint}
Diagnostic gap: ${input.gap}
Risk class blocking commit: ${input.riskClass}
Reason: ${input.reason === 'decline' ? 'shop is declining the job' : 'shop is holding the job for asynchronous expert review (24-72h turnaround)'}

Return JSON only.`

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: cachedSystem(DECLINE_LANGUAGE_SYSTEM),
    messages: [{ role: 'user', content: userMessage }],
  })
  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block')
  const cleaned = block.text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
  return JSON.parse(cleaned) as DeclineLanguage
}
