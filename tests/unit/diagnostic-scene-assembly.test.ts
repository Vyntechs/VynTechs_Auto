// INTEGRATION — the deterministic scalability/leak gate for the rebuilt diagram.
//
// This is the GATE, not a participant: it is READ-ONLY on every other track's
// code. It feeds synthetic, vocabulary-only `SystemTopology` fixtures through the
// RUNTIME assembler (`assembleScene`, R1 — the runtime export from slot-resolver,
// never the `AssembleScene` TYPE) and asserts the invariants from
// `ResolvedScene.elements` per `StepShape`:
//   - LEAK-LOCK: non-electrical shapes emit ZERO `terminal` elements (filter on
//     `elementKind === 'terminal'`, R3 — NOT `kind`, which would pass vacuously),
//     plus a POSITIVE CONTROL (electrical-probe MUST emit terminals) so a wrong
//     accessor fails loud instead of green.
//   - GENERALITY: the IDENTICAL assertion loop holds across three unlike systems
//     (fuel + a purely-electrical case + a non-fuel DEF case). A system-specific
//     branch in the engine would break one of the three.
//   - VERDICT HONESTY: neutral by default; red ONLY when `isOutOfRange` or a
//     branch `verdict === 'fail'` (out-of-range → branch-fail precedence).
//   - HONEST DEGRADE: an UNSEEN kind/observationMethod renders via the generic
//     fallback — non-empty `elements`, never a throw.
//
// Fixtures are SYNTHETIC by design (scene-data.json is parts-only; the real
// seeded-route proof is the live walker, an env-gated artifact). The loader
// (C1/T1) is proven separately by promote-system-data.test.ts.

import { describe, it, expect } from 'vitest'
import { assembleScene } from '@/lib/diagnostics/diagram/slot-resolver'
import { selectStepShape } from '@/lib/diagnostics/diagram/show-rule'
import {
  buildStepSequence,
  selectCurrentStep,
  stepKeyOf,
  stepReducer,
  stepReducerInit,
} from '@/lib/diagnostics/diagram/step-sequence'
import type {
  SystemTopology,
  TopologyComponent,
  TopologyScenario,
  TopologyTestAction,
  TopologyPin,
} from '@/lib/diagnostics/load-system-topology'
import type { ResolvedElement, StepShape } from '@/lib/diagnostics/diagram/slot-interface'

// --- fixture builders (C1-shaped; inputs only, NEVER branched on in assertions) ---

function syntheticStep(over: Partial<TopologyTestAction> = {}): TopologyTestAction {
  return {
    slug: 'synthetic-step',
    description: 'synthetic step',
    scenarioRequired: 'key-on-engine-off',
    observationMethod: 'pressure_test_with_gauge',
    expectedObservation: null,
    invasiveness: 1,
    implicatedByCurrentSymptom: true,
    branches: [],
    meterMode: null,
    expectedValue: null,
    expectedUnit: null,
    expectedTolerance: null,
    stepKind: null,
    priority: 1,
    ...over,
  }
}

function pin(over: Partial<TopologyPin> & { id: string }): TopologyPin {
  return {
    slug: over.id,
    name: over.id,
    roleAbbreviation: '12V',
    pinNumber: '1',
    edge: 'top',
    displayOrder: 0,
    probeLocation: '',
    expectedReading: '',
    missingLogic: '',
    labelGap: null,
    sourceProvenance: 'drafted',
    ...over,
  }
}

function component(over: Partial<TopologyComponent> = {}): TopologyComponent {
  return {
    id: over.id ?? 'c1',
    slug: over.slug ?? 'c1',
    name: over.name ?? 'Part',
    kind: over.kind ?? 'sensor',
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
    testActions: [],
    pins: [],
    ...over,
  }
}

/** A C1-shaped topology in any system — fixture input only, no branching. */
function syntheticTopology(
  system: string,
  focus: TopologyComponent,
  scenarios: TopologyScenario[] = [],
): SystemTopology {
  return {
    platform: { slug: 'synthetic', name: 'Synthetic Platform' },
    symptom: { slug: `${system}-fault`, description: `${system} fault` },
    system,
    components: [focus],
    connections: [],
    scenarios,
    dataStatus: null,
    lastScenarioSlug: null,
  }
}

/**
 * Attach the step to the focus component (so `findFocus` resolves it by slug),
 * then run the RUNTIME assembler. Mirrors how the screen feeds the current step;
 * the engine never receives a detached step in production (it comes off a
 * component's testActions).
 */
function assembleFor(
  topo: SystemTopology,
  step: TopologyTestAction,
  scenario: TopologyScenario | null,
) {
  topo.components[0].testActions = [step]
  return assembleScene(topo, step, scenario)
}

const terminalCount = (els: ResolvedElement[]) =>
  els.filter((e) => e.elementKind === 'terminal').length
const sourceOrGroundFilled = (scene: { slots: Record<string, unknown> }) =>
  scene.slots['source'] != null || scene.slots['ground'] != null

// ---------------------------------------------------------------------------

describe('diagnostic scene assembly — scaffold', () => {
  it('assembleScene returns a flat enumerable element set + the focus part', () => {
    const focus = component({ id: 'cp4', slug: 'cp4-pump', name: 'CP4 Pump', kind: 'pump' })
    const topo = syntheticTopology('fuel', focus)
    const scene = assembleFor(topo, syntheticStep(), null)
    expect(Array.isArray(scene.elements)).toBe(true)
    expect(scene.focus.selectedPartId).toBe('cp4')
    expect(scene.elements.some((e) => e.elementKind === 'part' && e.partId === 'cp4')).toBe(true)
  })

  it('keeps first-step ordering and slug-key reducer behavior when IDs are present', () => {
    const first = syntheticStep({
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'first-by-priority',
      priority: 1,
    })
    const second = syntheticStep({
      id: '22222222-2222-4222-8222-222222222222',
      slug: 'second-by-priority',
      priority: 2,
    })
    const topo = syntheticTopology('fuel', component({ testActions: [second, first] }))
    const sequence = buildStepSequence(topo)

    expect(selectCurrentStep(stepReducerInit(sequence))).toBe(first)
    expect(stepKeyOf(first)).toBe('first-by-priority')

    const byDatabaseId = stepReducer(stepReducerInit(sequence), {
      type: 'goTo',
      stepKey: '22222222-2222-4222-8222-222222222222',
    })
    expect(selectCurrentStep(byDatabaseId)).toBe(first)

    const byLegacySlug = stepReducer(byDatabaseId, {
      type: 'goTo',
      stepKey: 'second-by-priority',
    })
    expect(selectCurrentStep(byLegacySlug)).toBe(second)
  })
})

// --- the core leak invariant, driven through selectStepShape (no shape hardcoded) ---

const NON_ELECTRICAL_DRIVERS: Array<{
  shape: Extract<StepShape, 'pressure-flow' | 'single-pid' | 'look-inspect' | 'locate' | 'confirm'>
  step: Partial<TopologyTestAction>
}> = [
  { shape: 'pressure-flow', step: { observationMethod: 'pressure_test_with_gauge' } },
  { shape: 'single-pid', step: { observationMethod: 'scan_tool_pid' } },
  { shape: 'look-inspect', step: { observationMethod: 'direct_visual_inspection' } },
  { shape: 'locate', step: { observationMethod: 'direct_visual_inspection', stepKind: 'locate' } },
  // confirm is reachable via stepKind === 'confirm' (the data-driven framing step),
  // NOT via an observationMethod — symptom_confirmation is not a recognized method.
  { shape: 'confirm', step: { observationMethod: 'scan_tool_pid', stepKind: 'confirm' } },
]

describe('diagnostic scene assembly — leak invariant (per StepShape)', () => {
  it.each(NON_ELECTRICAL_DRIVERS)(
    'shape $shape renders ZERO terminals + no source/ground (no 12V/GND leak)',
    ({ shape, step }) => {
      const focus = component({ id: 'dut', kind: 'sensor', pins: [pin({ id: 'p1' })] })
      const topo = syntheticTopology('fuel', focus)
      const ta = syntheticStep(step)
      // Guard: the engine must actually classify this step as the shape under test
      // (so we never assert against a shape the engine didn't pick).
      const resolved = selectStepShape(
        ta.observationMethod,
        ta.meterMode ?? null,
        ta.stepKind ?? null,
        ta.branches.length > 0,
      )
      expect(resolved).toBe(shape)
      const scene = assembleFor(topo, ta, null)
      expect(scene.shape).toBe(shape)
      // Even though the focus carries a pin, a non-electrical shape emits no
      // terminals — the leak-lock is the shape, not the data.
      expect(terminalCount(scene.elements)).toBe(0)
      expect(scene.pinsAllowed).toBe(false)
      expect(sourceOrGroundFilled(scene)).toBe(false)
    },
  )

  it('POSITIVE CONTROL: electrical-probe DOES surface terminals (accessor not vacuous)', () => {
    // If terminalCount filtered `kind` instead of `elementKind`, it would be 0
    // here too and every leak assertion would pass for the wrong reason. A real
    // electrical step over a pinned focus MUST be non-empty.
    const focus = component({ id: 'frp', kind: 'sensor', pins: [pin({ id: 'p1' })] })
    const topo = syntheticTopology('fuel', focus)
    const ta = syntheticStep({ observationMethod: 'electrical_measurement_at_pin', meterMode: 'volts' })
    const scene = assembleFor(topo, ta, null)
    expect(scene.shape).toBe('electrical-probe')
    expect(scene.pinsAllowed).toBe(true)
    expect(terminalCount(scene.elements)).toBeGreaterThan(0)
  })

  it('fork emits exactly one route arm (explicit stepKind=fork decision step)', () => {
    const focus = component({ id: 'dut', kind: 'sensor' })
    const topo = syntheticTopology('fuel', focus)
    const ta = syntheticStep({
      observationMethod: 'scan_tool_pid',
      stepKind: 'fork', // fork is an explicit decision step, not "has branches"
      branches: [
        { condition: 'low', verdict: 'fail', nextAction: 'inspect pump', routesToTestActionId: null, reasoning: null },
      ],
    })
    const scene = assembleFor(topo, ta, null)
    expect(scene.shape).toBe('fork')
    expect(scene.forkRoute).not.toBeNull()
  })
})

// --- generality: the IDENTICAL loop over three unlike systems ---

const SYSTEMS: Array<{ label: string; make: () => SystemTopology }> = [
  {
    label: 'fuel (pressure path)',
    make: () => syntheticTopology('fuel', component({ id: 'rail', slug: 'rail', kind: 'mechanical' })),
  },
  {
    label: 'electrical (NOx sensor circuit)',
    make: () => syntheticTopology('emissions', component({ id: 'nox', slug: 'nox', kind: 'sensor', pins: [pin({ id: 'np1' })] })),
  },
  {
    label: 'non-fuel (DEF dosing line)',
    make: () => syntheticTopology('def', component({ id: 'def-inj', slug: 'def-inj', kind: 'actuator' })),
  },
]

describe('diagnostic scene assembly — generality across unlike systems', () => {
  it.each(SYSTEMS)('$label: a pressure step leaks zero terminals + no source/ground', ({ make }) => {
    const scene = assembleFor(make(), syntheticStep({ observationMethod: 'pressure_test_with_gauge' }), null)
    expect(scene.shape).toBe('pressure-flow')
    expect(terminalCount(scene.elements)).toBe(0)
    expect(scene.pinsAllowed).toBe(false)
    expect(sourceOrGroundFilled(scene)).toBe(false)
  })

  it.each(SYSTEMS)('$label: a look step renders no active wires + no terminals', ({ make }) => {
    const scene = assembleFor(make(), syntheticStep({ observationMethod: 'direct_visual_inspection' }), null)
    expect(scene.shape).toBe('look-inspect')
    expect(scene.activeWireIds).toEqual([])
    expect(terminalCount(scene.elements)).toBe(0)
  })

  it.each(SYSTEMS)('$label: an electrical step is pins-allowed identically (no per-system gate)', ({ make }) => {
    const scene = assembleFor(make(), syntheticStep({ observationMethod: 'electrical_measurement_at_pin', meterMode: 'volts' }), null)
    expect(scene.shape).toBe('electrical-probe')
    expect(scene.pinsAllowed).toBe(true)
  })
})

// --- verdict honesty: pure data, red only on a real fault ---

describe('diagnostic scene assembly — verdict honesty', () => {
  it('neutral by default — no red without isOutOfRange or a branch fail', () => {
    const scene = assembleFor(
      syntheticTopology('fuel', component({ id: 'dut', kind: 'sensor' })),
      syntheticStep({ observationMethod: 'scan_tool_pid', branches: [] }),
      null,
    )
    expect(scene.verdict).toBe('neutral')
  })

  it('an out-of-range scenario reading flips the verdict to out-of-range', () => {
    const focus = component({ id: 'frp', slug: 'frp', kind: 'sensor', pins: [pin({ id: 'p1', slug: 'sig', roleAbbreviation: 'SIG' })] })
    const scenario: TopologyScenario = {
      id: 's1', slug: 'koeo', label: 'KOEO', sub: '', kind: 'fault',
      keyPosition: 'on', engineState: 'off', loadLevel: null, isDefault: true,
      displayOrder: 0, pinStates: {}, pinReadings: { p1: 'low' }, isOutOfRange: { p1: true },
    }
    const topo = syntheticTopology('fuel', focus, [scenario])
    const ta = syntheticStep({ observationMethod: 'electrical_measurement_at_pin', meterMode: 'volts' })
    const scene = assembleFor(topo, ta, scenario)
    expect(scene.verdict).toBe('out-of-range')
  })

  it('a branch verdict === "fail" flips the verdict without out-of-range', () => {
    const topo = syntheticTopology('fuel', component({ id: 'dut', kind: 'sensor' }))
    const ta = syntheticStep({
      observationMethod: 'scan_tool_pid',
      branches: [{ condition: 'x', verdict: 'fail', nextAction: 'replace', routesToTestActionId: null, reasoning: null }],
    })
    const scene = assembleFor(topo, ta, null)
    // A branchy PID renders as the READING (single-pid) — fork is stepKind-only now;
    // the branches still set the scene VERDICT to branch-fail (they route the next
    // step, they don't replace the view).
    expect(scene.shape).toBe('single-pid')
    expect(scene.verdict).toBe('branch-fail')
  })

  it('an UNSEEN kind + observationMethod render via fallback — never blank, never throw', () => {
    const focus = component({ id: 'x', slug: 'x', kind: 'flux-capacitor' })
    const topo = syntheticTopology('warp', focus)
    const ta = syntheticStep({ observationMethod: 'tachyon_scan_never_seen' })
    let scene: ReturnType<typeof assembleScene> | null = null
    expect(() => { scene = assembleFor(topo, ta, null) }).not.toThrow()
    expect(scene!.elements.length).toBeGreaterThan(0)
    expect(scene!.focus.selectedPartId).toBe('x')
    // Unseen → the generic neutral single reading, never a fabricated red.
    expect(scene!.verdict).toBe('neutral')
  })
})
