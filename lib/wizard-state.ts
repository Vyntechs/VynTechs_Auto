/**
 * Pure-function wizard reducer for the curator flow walker (PR-N4).
 *
 * Architecture:
 *  - No xstate. Every function is a pure transform over WizardState.
 *  - WizardState is persisted to sessions.wizard_state (jsonb) and is
 *    version-PINNED via flowVersionId: a running session never silently
 *    picks up a new published flow version mid-walk (spec §3.2).
 *
 * synthesizeHandoffFromFinding:
 *  RepairPhaseView reads phase/rootCauseSummary/proposedAction/diagnosisLockedAt
 *  from a TreeState. A curator finding carries exactly that semantic content.
 *  This function returns only those four fields; the caller merges them onto
 *  the existing treeState. We do NOT fabricate tree nodes or curator-absent
 *  fields, per the anti-fabrication doctrine (PR #98).
 */

import type { Finding, Flow, Step, WizardState } from '@/lib/flows/types'
import type { ProposedAction } from '@/lib/ai/tree-engine'

/**
 * Advance the wizard by one answer. Returns a new WizardState — never mutates.
 *
 * For `procedure` steps the `answerId` argument is ignored; the step always
 * advances to `step.next` and records a synthetic `'_proc'` history entry.
 *
 * Throws if:
 *  - The state is already terminal (finding is non-null).
 *  - The current step is not found in the flow (broken flowVersionId).
 *  - The answerId is not found on the current question step (does not apply
 *    to procedure steps, which ignore answerId entirely).
 *  - The matched answer has neither `next` nor `finding` (flow authoring bug).
 */
export function advance(state: WizardState, flow: Flow, answerId: string): WizardState {
  if (state.finding) {
    throw new Error('Cannot advance from a terminal state — call back() first to undo.')
  }

  const step = flow.steps[state.stepId]
  if (!step) {
    throw new Error(`Current step "${state.stepId}" not found in flow`)
  }

  if (step.kind === 'procedure') {
    return {
      ...state,
      stepId: step.next,
      history: [
        ...state.history,
        { stepId: state.stepId, answerId: '_proc', label: 'Continue', title: step.title },
      ],
    }
  }

  const answer = step.answers.find((a) => a.id === answerId)
  if (!answer) {
    throw new Error(`Answer "${answerId}" not found on step "${state.stepId}"`)
  }

  const entry = {
    stepId: state.stepId,
    answerId: answer.id,
    label: answer.label,
    title: step.title,
    captured: answer.captured,
  }

  if ('finding' in answer && answer.finding) {
    return { ...state, history: [...state.history, entry], finding: answer.finding }
  }
  if ('next' in answer && answer.next) {
    return { ...state, stepId: answer.next, history: [...state.history, entry] }
  }
  throw new Error(
    `Answer "${answerId}" has neither next nor finding (flow validation bug — should have been caught at publish)`,
  )
}

/**
 * Pop the latest history entry and restore the wizard to the previous step.
 * Also clears any terminal finding (so the tech can revise their answer).
 * No-ops when history is empty.
 */
// `_flow` is unused today but kept for API symmetry with `advance()` so callers
// can pass the same `(state, flow)` pair to both functions without branching.
export function back(state: WizardState, _flow: Flow): WizardState {
  if (state.history.length === 0) return state
  const next = state.history.slice(0, -1)
  const popped = state.history[state.history.length - 1]
  return { ...state, stepId: popped.stepId, history: next, finding: null }
}

/**
 * Return a fresh WizardState for a given flow version.
 * Use when starting a new wizard session or resetting from scratch.
 */
export function reset(flow: Flow, flowVersionId: string): WizardState {
  return { flowVersionId, stepId: flow.startStepId, history: [], finding: null }
}

/** True when the wizard has reached a terminal answer (finding is non-null). */
export function isTerminal(state: WizardState): boolean {
  return state.finding !== null
}

/** Return the Step object for the current stepId, or undefined if not found. */
export function currentStep(state: WizardState, flow: Flow): Step | undefined {
  return flow.steps[state.stepId]
}

/**
 * Synthesize the handoff fields that RepairPhaseView reads from a TreeState.
 *
 * Returns only the four fields the repair phase needs (phase, rootCauseSummary,
 * proposedAction, diagnosisLockedAt). The caller merges these onto the existing
 * treeState. We do not fabricate tree nodes or any other TreeState fields.
 */
export function synthesizeHandoffFromFinding(args: { finding: Finding }): {
  phase: 'repairing'
  rootCauseSummary: string
  proposedAction: ProposedAction
  diagnosisLockedAt: string
} {
  return {
    phase: 'repairing',
    rootCauseSummary: args.finding.verdict,
    proposedAction: {
      description: args.finding.action,
      confidence: args.finding.confidence ?? 1.0,
      expectedSignal: args.finding.expectedSignal,
    },
    diagnosisLockedAt: new Date().toISOString(),
  }
}
