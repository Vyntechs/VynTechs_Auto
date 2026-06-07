import type {
  SystemTopology,
  TopologyTestAction,
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
