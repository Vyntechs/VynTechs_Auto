import { anthropic, MODEL, cachedSystem } from './client'
import { TREE_ENGINE_SYSTEM } from './prompts'
import type { IntakePayload } from '@/lib/types'
import type { GateDecision } from '@/lib/gating/gap-handler'

export type TreeNode = {
  id: string
  label: string
  status: 'pending' | 'active' | 'resolved' | 'pruned'
  rationale?: string
  children?: string[]
}

export type ProposedAction = {
  description: string
  confidence: number
  expectedSignal?: string
  confidenceGap?: string
  whatWouldClose?: string
}

export type RequestedArtifact = {
  kind: 'photo' | 'scan_screen' | 'wiring_diagram' | 'audio' | 'video'
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
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * (i + 1)))
      }
    }
  }
  throw lastErr
}

export async function generateInitialTree(intake: IntakePayload): Promise<TreeState> {
  const userMessage = buildIntakeUserMessage(intake)

  return withRetry(async () => {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: cachedSystem(TREE_ENGINE_SYSTEM),
      messages: [{ role: 'user', content: userMessage }],
    })

    const block = res.content.find((b: { type: string }) => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('no text block in response')
    return parseTreeJson(block.text, res.stop_reason ?? undefined)
  })
}

function buildIntakeUserMessage(intake: IntakePayload): string {
  const engine = intake.vehicleEngine ? ` (${intake.vehicleEngine})` : ''
  const mileage = intake.mileage ? `, ${intake.mileage} mi` : ''
  return `Vehicle: ${intake.vehicleYear} ${intake.vehicleMake} ${intake.vehicleModel}${engine}${mileage}.

Customer complaint: ${intake.customerComplaint}

Generate the initial decision tree. Return JSON only — no prose, no fences.`
}

export async function updateTree(input: {
  intake: IntakePayload
  currentTree: TreeState
  observation: string
}): Promise<TreeState> {
  const userMessage = `Initial intake: ${JSON.stringify(input.intake)}

Current tree state:
${JSON.stringify(input.currentTree, null, 2)}

Tech's observation on current step (${input.currentTree.currentNodeId}):
${input.observation}

Update the tree based on this observation. Resolve or prune branches as appropriate. Set the next current step. If you have enough information to identify the root cause, set done=true and provide rootCauseSummary.

Return JSON only — no prose, no fences.`

  return withRetry(async () => {
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: cachedSystem(TREE_ENGINE_SYSTEM),
      messages: [{ role: 'user', content: userMessage }],
    })

    const block = res.content.find((b: { type: string }) => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('no text block in response')
    return parseTreeJson(block.text, res.stop_reason ?? undefined)
  })
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
  return parsed as TreeState
}
