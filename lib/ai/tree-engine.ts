import { anthropic, MODEL, cachedSystem } from './client'
import { TREE_ENGINE_SYSTEM } from './prompts'
import type { IntakePayload } from '@/lib/types'

export type TreeNode = {
  id: string
  label: string
  status: 'pending' | 'active' | 'resolved' | 'pruned'
  rationale?: string
  children?: string[]
}

export type TreeState = {
  nodes: TreeNode[]
  currentNodeId: string
  message: string
  done?: boolean
  rootCauseSummary?: string
}

export async function generateInitialTree(intake: IntakePayload): Promise<TreeState> {
  const userMessage = buildIntakeUserMessage(intake)

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: cachedSystem(TREE_ENGINE_SYSTEM),
    messages: [{ role: 'user', content: userMessage }],
  })

  const block = res.content.find((b: { type: string }) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block in response')
  return parseTreeJson(block.text)
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

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system: cachedSystem(TREE_ENGINE_SYSTEM),
    messages: [{ role: 'user', content: userMessage }],
  })

  const block = res.content.find((b: { type: string }) => b.type === 'text')
  if (!block || block.type !== 'text') throw new Error('no text block in response')
  return parseTreeJson(block.text)
}

export function parseTreeJson(text: string): TreeState {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
  const parsed = JSON.parse(cleaned)
  if (
    !Array.isArray(parsed?.nodes) ||
    typeof parsed?.currentNodeId !== 'string' ||
    typeof parsed?.message !== 'string'
  ) {
    throw new Error('invalid tree response shape')
  }
  return parsed as TreeState
}
