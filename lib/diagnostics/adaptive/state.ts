import type { TopologyTestAction } from '@/lib/diagnostics/load-system-topology'
import type {
  AdaptiveCoverage,
  AdaptiveDiagnosticState,
  DiagnosticMode,
} from './contracts'
import { adaptiveStepId } from './step-adapter'

export function initialAdaptiveState(
  coverage: AdaptiveCoverage,
): AdaptiveDiagnosticState {
  let mode: DiagnosticMode
  switch (coverage.state) {
    case 'exact':
    case 'verified_equivalent':
      mode = coverage.technicianInstructionsAvailable ? 'guided' : 'manual'
      break
    case 'partial':
    case 'draft':
    case 'unsupported':
      mode = 'manual'
      break
  }

  return {
    schemaVersion: 1,
    mode,
    coverage,
    currentTestActionId: null,
    finding: null,
  }
}

export function changeDiagnosticMode(
  state: AdaptiveDiagnosticState,
  mode: DiagnosticMode,
): AdaptiveDiagnosticState {
  switch (mode) {
    case 'guided':
      return { ...state, mode: 'guided' }
    case 'manual':
      return { ...state, mode: 'manual' }
  }
}

export function selectCurrentAdaptiveTest(
  state: AdaptiveDiagnosticState,
  steps: readonly TopologyTestAction[],
): TopologyTestAction | null {
  const fallback = steps[0] ?? null
  if (state.currentTestActionId === null) return fallback

  return steps.find(
    (step) => adaptiveStepId(step) === state.currentTestActionId,
  ) ?? fallback
}
