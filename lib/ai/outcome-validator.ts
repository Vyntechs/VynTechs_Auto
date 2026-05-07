import { anthropic, MODEL, cachedSystem } from './client'
import { OUTCOME_VALIDATOR_SYSTEM } from './prompts'

export type ValidatorResult = {
  ok: boolean
  feedback?: string
  suggested?: string
}

export type ValidatorInput = {
  rootCause: string
  notes?: string
}

export async function validateSpecificity(
  input: ValidatorInput,
): Promise<ValidatorResult> {
  const userMessage = `Root cause:
${input.rootCause}

Notes for next time:
${input.notes && input.notes.trim() ? input.notes.trim() : '(none)'}

Return JSON only.`

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: cachedSystem(OUTCOME_VALIDATOR_SYSTEM),
    messages: [{ role: 'user', content: userMessage }],
  })
  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block')
  const cleaned = block.text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
  return JSON.parse(cleaned) as ValidatorResult
}
