import type {
  SystemTopology,
  TopologyTestAction,
  TopologyBranch,
} from '@/lib/diagnostics/load-system-topology'

/**
 * The ordered list of test actions the current symptom implicates.
 *
 * Pure / deterministic / no React / no DOM / no network. The order is a
 * function of the surfaced `priority` ONLY — never of system, observationMethod,
 * component kind, or any case-specific field — so a fuel, electrical, or DEF
 * sequence orders by the identical rule. A null priority sorts last; ties keep
 * their input (document/curator-authored) order via a stable sort.
 *
 * Defensive optional reads: `priority` is surfaced as an OPTIONAL C1 field
 * (`number | null | undefined`). We normalize `undefined` to `null` before
 * comparing, so an absent priority degrades identically to an explicit null
 * (honest degrade) rather than crashing the ordering.
 */
export function buildStepSequence(topology: SystemTopology): TopologyTestAction[] {
  const implicated: TopologyTestAction[] = []
  for (const component of topology.components) {
    for (const ta of component.testActions) {
      if (ta.implicatedByCurrentSymptom) implicated.push(ta)
    }
  }
  // Decorate-sort-undecorate keeps the sort stable across engines and makes the
  // null-last rule explicit without mutating priority.
  return implicated
    .map((action, index) => ({ action, index }))
    .sort((a, b) => {
      const pa = a.action.priority ?? null
      const pb = b.action.priority ?? null
      if (pa === pb) return a.index - b.index // stable: includes null === null
      if (pa === null) return 1 // nulls (and undefined) last
      if (pb === null) return -1
      return pa - pb
    })
    .map((d) => d.action)
}

/** Immutable index over a fixed, already-ordered step sequence. */
export type StepSequenceState = {
  readonly steps: readonly TopologyTestAction[]
  readonly index: number
}

export type StepAction =
  | { type: 'advance' }
  | { type: 'back' }
  | { type: 'goTo'; stepKey: string }

/**
 * Stable identity for a step. Read through this ONE helper so swapping the key
 * source (test-action id vs slug, per the C1 surface) is a single-line change.
 * The public TopologyTestAction carries no `id` today, so we key on `slug`.
 *
 * KNOWN v1 LIMITATION: resolveFork returns `toTestActionId` (a test_actions row
 * id), but the sequence is keyed by `slug`, so a future `goTo(toTestActionId)`
 * will not match until T1 surfaces a public test-action `id`. Most branches have
 * `routesToTestActionId === null` today and degrade to `words`, so the route
 * case is rare; when T1 surfaces the id, change this one helper to return it.
 */
export function stepKeyOf(step: TopologyTestAction): string {
  return step.slug
}

export function stepReducerInit(
  steps: readonly TopologyTestAction[],
): StepSequenceState {
  return { steps, index: 0 }
}

export function stepReducer(
  state: StepSequenceState,
  action: StepAction,
): StepSequenceState {
  const last = state.steps.length - 1
  switch (action.type) {
    case 'advance':
      if (last < 0) return state
      return { ...state, index: Math.min(state.index + 1, last) }
    case 'back':
      return { ...state, index: Math.max(state.index - 1, 0) }
    case 'goTo': {
      const next = state.steps.findIndex((s) => stepKeyOf(s) === action.stepKey)
      if (next === -1) return state // unknown key is a no-op
      return { ...state, index: next }
    }
    default:
      return state
  }
}

/** The current step, or null when the sequence is empty. */
export function selectCurrentStep(
  state: StepSequenceState,
): TopologyTestAction | null {
  return state.steps[state.index] ?? null
}

/** The pure RAW-branch-verdict vocabulary T6 feeds in. NOT the scene VerdictSignal. */
export type ForkVerdict = 'fail' | 'pass' | 'neutral'

export type ForkResolution =
  | { kind: 'route'; toTestActionId: string; reasoning: string | null; nextActionText: string }
  | { kind: 'words'; nextActionText: string; reasoning: string | null }
  | { kind: 'none' }

/**
 * Where this step routes given a verdict. Pure: matches by exact branch.verdict
 * string equality — no number parsing, no per-case/per-system logic. Routes via
 * routesToTestActionId when present; otherwise degrades honestly to the
 * words-only nextAction prose (today's steady state, where the id is null).
 *
 * Defensive optional reads: the C1 fork fields (`routesToTestActionId`,
 * `reasoning`) are OPTIONAL (`string | null | undefined`). A `!= null` check
 * treats `undefined` exactly like `null`, so an absent id degrades to `words`
 * (never a fabricated route). See stepKeyOf for the id-vs-slug v1 limitation.
 */
export function resolveFork(
  step: TopologyTestAction,
  verdict: ForkVerdict,
): ForkResolution {
  const match: TopologyBranch | undefined = step.branches.find(
    (b) => b.verdict === verdict,
  )
  if (!match) return { kind: 'none' }
  if (match.routesToTestActionId != null) {
    return {
      kind: 'route',
      toTestActionId: match.routesToTestActionId,
      reasoning: match.reasoning ?? null,
      nextActionText: match.nextAction,
    }
  }
  return { kind: 'words', nextActionText: match.nextAction, reasoning: match.reasoning ?? null }
}
