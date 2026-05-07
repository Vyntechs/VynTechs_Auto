import { anthropic, MODEL, cachedSystem } from './client'
import type { TreeState, SessionEvent } from '@/lib/db/schema'

const MAX_RECENT_EVENTS = 10

export const REPAIR_GUIDANCE_SYSTEM = `You are an automotive master tech assistant in REPAIR PHASE.

The diagnosis is COMPLETE and LOCKED. Your job is repair-time guidance, not re-diagnosis.

Rules:
1. Help the tech execute the locked repair safely and correctly.
2. Answer concrete in-the-moment questions ("master cyl bolts are corroded — should I replace?").
3. Surface tangentially-related concerns the new observation suggests (e.g., "if you're already pulling the master cyl, also check the proportioning valve").
4. REFUSE to revise the root cause. DO NOT modify, contradict, or alter the locked diagnosis.

If the tech surfaces a NEW concern that suggests the original diagnosis was wrong, do NOT silently change the diagnosis. Tell them: "This observation suggests the original diagnosis may be incomplete. Consider marking this case incomplete and opening a new diagnostic session to investigate."

Output JSON only — { "text": string, "tangentialConcerns"?: string[] } — no prose, no fences, no other fields.`

export type RepairGuidancePromptInput = {
  tree: TreeState
  recentEvents: SessionEvent[]
  observation: string
}

export type RepairGuidancePromptOutput = {
  systemPrompt: string
  userMessage: string
}

export type RepairGuidanceResult = {
  text: string
  tangentialConcerns?: string[]
}

export function buildRepairGuidancePrompt(
  input: RepairGuidancePromptInput,
): RepairGuidancePromptOutput {
  const lockedDiagnosis = `Locked diagnosis:
- Root cause: ${input.tree.rootCauseSummary ?? '(none recorded)'}
- Recommended repair: ${input.tree.proposedAction?.description ?? '(none recorded)'}
- Expected signal post-repair: ${input.tree.proposedAction?.expectedSignal ?? '(none recorded)'}`

  const allRepairEvents = input.recentEvents.filter(
    e => e.eventType === 'repair_observation' || e.eventType === 'repair_guidance',
  )
  const recent = allRepairEvents.slice(-MAX_RECENT_EVENTS)
  const recentLines = recent
    .map(e => {
      if (e.eventType === 'repair_observation') {
        return `[tech] ${e.observationText ?? ''}`
      }
      const text =
        (e.aiResponse as { repairGuidance?: { text: string } } | null)?.repairGuidance?.text ?? ''
      return `[ai] ${text}`
    })
    .join('\n\n')

  const conversationBlock = recentLines
    ? `\n\nRecent repair conversation (last ${recent.length} events, oldest first):\n${recentLines}`
    : ''

  const userMessage = `${lockedDiagnosis}${conversationBlock}\n\nTech's new observation:\n${input.observation}`

  return {
    systemPrompt: REPAIR_GUIDANCE_SYSTEM,
    userMessage,
  }
}

export async function getRepairGuidance(
  input: RepairGuidancePromptInput,
): Promise<RepairGuidanceResult> {
  const { systemPrompt, userMessage } = buildRepairGuidancePrompt(input)

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: cachedSystem(systemPrompt),
    messages: [{ role: 'user', content: userMessage }],
  })

  const block = res.content.find((b: { type: string }) => b.type === 'text')
  if (!block || block.type !== 'text') {
    throw new Error('repair-guidance: no text block in response')
  }

  const cleaned = (block as { text: string }).text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch (err) {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start !== -1 && end > start) {
      parsed = JSON.parse(cleaned.slice(start, end + 1))
    } else {
      throw new Error(`repair-guidance: not valid JSON: ${(err as Error).message}`)
    }
  }

  // Server-side guard: drop any field other than text + tangentialConcerns.
  // Prevents prompt-injection where the model tries to override the diagnosis.
  const obj = parsed as Record<string, unknown>
  if (typeof obj.text !== 'string' || !obj.text.trim()) {
    throw new Error('repair-guidance: response missing text')
  }
  const tangentials = Array.isArray(obj.tangentialConcerns)
    ? obj.tangentialConcerns.filter((c): c is string => typeof c === 'string')
    : undefined

  return {
    text: obj.text,
    ...(tangentials && tangentials.length > 0 ? { tangentialConcerns: tangentials } : {}),
  }
}
