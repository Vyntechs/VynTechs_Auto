import type { TopologyTestAction } from '@/lib/diagnostics/load-system-topology'

export type AdaptiveBranchVerdict = 'ok' | 'warn' | 'fail' | 'impossible'

export type AdaptiveBranchResolution =
  | { kind: 'route'; toTestActionId: string }
  | { kind: 'words'; nextAction: string }
  | { kind: 'none' }

export function adaptiveStepId(step: TopologyTestAction): string {
  if (!step.id) {
    throw new Error('Adaptive diagnostic step is missing its database ID')
  }
  return step.id
}

export function resolveAdaptiveBranch(
  step: TopologyTestAction,
  verdict: AdaptiveBranchVerdict,
  implicatedSequence: readonly TopologyTestAction[],
): AdaptiveBranchResolution {
  const branch = step.branches.find((candidate) => candidate.verdict === verdict)
  if (!branch) return { kind: 'none' }
  if (branch.routesToTestActionId != null) {
    const targetIsImplicated = implicatedSequence.some(
      (candidate) =>
        candidate.implicatedByCurrentSymptom &&
        candidate.id === branch.routesToTestActionId,
    )
    if (!targetIsImplicated) return { kind: 'none' }
    return { kind: 'route', toTestActionId: branch.routesToTestActionId }
  }
  return { kind: 'words', nextAction: branch.nextAction }
}
