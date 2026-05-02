import type { IntakePayload } from '@/lib/types'
import type { TreeNode } from '@/lib/ai/tree-engine'
import type { TreeStep, TreeStepStatus } from '@/components/vt'

export function formatVehicleName(intake: IntakePayload): string {
  return `${intake.vehicleYear} ${intake.vehicleMake} ${intake.vehicleModel}`
}

export function formatElapsed(start: Date, now: Date = new Date()): string {
  const ms = Math.max(0, now.getTime() - start.getTime())
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}

const TREE_STATUS_MAP: Record<TreeNode['status'], TreeStepStatus> = {
  resolved: 'done',
  active: 'active',
  pending: 'pending',
  pruned: 'pending',
}

export function nodesToSteps(nodes: TreeNode[]): TreeStep[] {
  return nodes
    .filter((n) => n.status !== 'pruned')
    .map((n) => ({
      id: n.id,
      label: n.label,
      status: TREE_STATUS_MAP[n.status],
    }))
}

export function getActiveNode(nodes: TreeNode[]): TreeNode | undefined {
  return nodes.find((n) => n.status === 'active')
}
