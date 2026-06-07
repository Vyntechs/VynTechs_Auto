import { describe, it, expect } from 'vitest'
import type {
  SystemTopology,
  TopologyTestAction,
  TopologyComponent,
} from '@/lib/diagnostics/load-system-topology'
import { buildStepSequence } from '@/lib/diagnostics/diagram/step-sequence'

// ---------------------------------------------------------------------------
// Synthetic fixtures. scene-data.json is parts-only (no test_actions /
// branch_logic), so the step pipeline is exercised from hand-built actions
// in the real TopologyTestAction shape. We build three UNLIKE systems to
// prove the engine has zero system-specific behavior.
// ---------------------------------------------------------------------------

function action(over: Partial<TopologyTestAction> & { slug: string }): TopologyTestAction {
  return {
    slug: over.slug,
    description: over.description ?? 'test action',
    scenarioRequired: over.scenarioRequired ?? 'kp-eng-off',
    observationMethod: over.observationMethod ?? 'electrical_measurement_at_pin',
    expectedObservation: over.expectedObservation ?? null,
    invasiveness: over.invasiveness ?? 1,
    implicatedByCurrentSymptom: over.implicatedByCurrentSymptom ?? true,
    priority: over.priority ?? null,
    branches: over.branches ?? [],
  }
}

function topologyWith(actions: TopologyTestAction[]): SystemTopology {
  // Spread the actions across two components to prove buildStepSequence
  // flattens across components, not just within one.
  const half = Math.ceil(actions.length / 2)
  const mk = (id: string, ta: TopologyTestAction[]): TopologyComponent => ({
    id,
    slug: id,
    name: id,
    kind: 'sensor',
    location: null,
    function: null,
    electricalContract: null,
    subtitle: null,
    role: null,
    wireSummary: null,
    body: null,
    probingTactic: null,
    unknownNote: null,
    sourceProvenance: 'drafted',
    observableProperties: [],
    testActions: ta,
    pins: [],
  })
  return {
    platform: { slug: 'p', name: 'P' },
    symptom: { slug: 's', description: 'S' },
    system: 'fuel',
    components: [mk('c1', actions.slice(0, half)), mk('c2', actions.slice(half))],
    connections: [],
    scenarios: [],
    dataStatus: null,
    lastScenarioSlug: null,
  }
}

describe('buildStepSequence', () => {
  it('returns only implicated actions, ordered by priority ascending', () => {
    const topo = topologyWith([
      action({ slug: 'a-third', priority: 3 }),
      action({ slug: 'b-first', priority: 1 }),
      action({ slug: 'c-not-implicated', priority: 2, implicatedByCurrentSymptom: false }),
      action({ slug: 'd-second', priority: 2 }),
    ])
    const seq = buildStepSequence(topo)
    expect(seq.map((s) => s.slug)).toEqual(['b-first', 'd-second', 'a-third'])
  })

  it('sorts null priority last, preserving input order among nulls (stable)', () => {
    const topo = topologyWith([
      action({ slug: 'null-1', priority: null }),
      action({ slug: 'has-prio', priority: 5 }),
      action({ slug: 'null-2', priority: null }),
    ])
    const seq = buildStepSequence(topo)
    expect(seq.map((s) => s.slug)).toEqual(['has-prio', 'null-1', 'null-2'])
  })

  it('returns an empty list when the symptom implicates no actions (honest empty-state)', () => {
    const topo = topologyWith([
      action({ slug: 'x', implicatedByCurrentSymptom: false }),
      action({ slug: 'y', implicatedByCurrentSymptom: false }),
    ])
    expect(buildStepSequence(topo)).toEqual([])
  })

  it('is system-agnostic: a fuel, electrical, and DEF sequence order identically by priority', () => {
    const byPrio = (slugPrefix: string, method: string) =>
      topologyWith([
        action({ slug: `${slugPrefix}-2`, priority: 2, observationMethod: method }),
        action({ slug: `${slugPrefix}-1`, priority: 1, observationMethod: method }),
      ])
    const fuel = buildStepSequence(byPrio('fuel', 'pressure_test_with_gauge'))
    const elec = buildStepSequence(byPrio('elec', 'electrical_measurement_at_pin'))
    const def = buildStepSequence(byPrio('def', 'scan_tool_pid'))
    expect(fuel.map((s) => s.priority)).toEqual([1, 2])
    expect(elec.map((s) => s.priority)).toEqual([1, 2])
    expect(def.map((s) => s.priority)).toEqual([1, 2])
  })
})
