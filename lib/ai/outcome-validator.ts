import { anthropic, MODEL, cachedSystem } from './client'
import { OUTCOME_VALIDATOR_SYSTEM } from './prompts'

export type ValidatorResult = {
  ok: boolean
  feedback?: string
  suggested?: string
}

export async function validateSpecificity(text: string): Promise<ValidatorResult> {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 256,
    system: cachedSystem(OUTCOME_VALIDATOR_SYSTEM),
    messages: [
      { role: 'user', content: `Root cause text:\n${text}\n\nReturn JSON only.` },
    ],
  })
  const block = res.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block')
  const cleaned = block.text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
  return JSON.parse(cleaned) as ValidatorResult
}
