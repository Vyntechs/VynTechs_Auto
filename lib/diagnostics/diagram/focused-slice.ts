/**
 * focused-slice — derive a FOCUSED, still-WIRED sub-topology around one part.
 *
 * Pure; NO React/DOM/network/AI/@xyflow/dagre. The per-step diagnostic view
 * renders the ONE part being checked plus its immediate circuit context (so the
 * canvas shows a real wired circuit, not a single floating box). This builds
 * that slice by reusing the published bounded-circuit-set primitive
 * (`walkCircuitSet`) and keeping only the connections internal to the slice.
 *
 * Additive: this file introduces no behavior change to the engine. It does NOT
 * edit slot-resolver (the `findFocus` logic is intentionally re-derived here so
 * slot-resolver stays untouched per the task's no-engine-edit constraint).
 */
import type {
  SystemTopology,
  TopologyTestAction,
} from '@/lib/diagnostics/load-system-topology'
import { walkCircuitSet } from '@/lib/diagnostics/diagram/slot-resolver'

/**
 * A shallow copy of `topology` narrowed to `focusComponentId` + every component
 * within `depth` hops, keeping ONLY the connections whose BOTH endpoints survive
 * the narrowing. All scalar metadata (symptom, platform, scenarios, dataStatus,
 * system, lastScenarioSlug) is carried through unchanged.
 *
 * An unknown focus id yields an empty slice (walkCircuitSet returns []), never a
 * throw — the caller falls back to the honest empty state.
 */
export function buildFocusedSlice(
  topology: SystemTopology,
  focusComponentId: string,
  depth = 1,
): SystemTopology {
  const components = walkCircuitSet(topology, focusComponentId, depth)
  const sliceIds = new Set(components.map((c) => c.id))
  const connections = topology.connections.filter(
    (c) => sliceIds.has(c.fromComponentId) && sliceIds.has(c.toComponentId),
  )
  return { ...topology, components, connections }
}

/**
 * The id of the component that owns this step's test action (matched by the
 * action `slug`), or null when none does. Re-derives `findFocus`'s rule rather
 * than importing it, so slot-resolver's engine surface is left untouched.
 */
export function focusComponentIdForStep(
  topology: SystemTopology,
  step: TopologyTestAction,
): string | null {
  const owner = topology.components.find((c) =>
    c.testActions.some((t) => t.slug === step.slug),
  )
  return owner?.id ?? null
}
