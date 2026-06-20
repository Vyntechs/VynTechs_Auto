import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type {
  SystemTopology,
  TopologyComponent,
  TopologyConnection,
  TopologyTestAction,
  TopologyScenario,
  TopologyPin,
} from '@/lib/diagnostics/load-system-topology'
import type { PartSlotFill } from '@/lib/diagnostics/diagram/slot-interface'
import {
  SHAPE_SLOT_RULES as RULES,
  ALL_STEP_SHAPES,
} from '@/lib/diagnostics/diagram/slot-interface'
import {
  assembleScene,
  resolveSlots,
  walkCircuitSet,
  computeVerdict,
} from '@/lib/diagnostics/diagram/slot-resolver'

// ---------------------------------------------------------------------------
// Fixture builders — pure in-memory SystemTopology, NO createTestDb, NO DB.
// Adapted to the FROZEN C1 types (TopologyComponent.id/slug/name + prose fields).
// ---------------------------------------------------------------------------

function comp(
  over: Partial<TopologyComponent> & { id: string; kind: string },
): TopologyComponent {
  return {
    slug: over.id,
    name: over.id,
    location: null,
    function: null,
    electricalContract: null,
    subtitle: null,
    role: null,
    wireSummary: null,
    body: null,
    probingTactic: null,
    unknownNote: null,
    sourceProvenance: 'TRAINING-CONFIRMED',
    observableProperties: [],
    testActions: [],
    pins: [],
    ...over,
  }
}

function conn(
  over: Partial<TopologyConnection> & {
    id: string
    fromComponentId: string
    toComponentId: string
  },
): TopologyConnection {
  return {
    connectionKind: 'fluid-line',
    direction: 'unidirectional',
    description: null,
    sourceProvenance: 'TRAINING-CONFIRMED',
    electricalRole: null,
    fromPinId: null,
    toPinId: null,
    ...over,
  }
}

function action(
  over: Partial<TopologyTestAction> & { slug: string; observationMethod: string },
): TopologyTestAction {
  return {
    description: over.slug,
    scenarioRequired: 'any',
    expectedObservation: null,
    invasiveness: 1,
    implicatedByCurrentSymptom: true,
    branches: [],
    ...over,
  }
}

function pin(over: Partial<TopologyPin> & { id: string }): TopologyPin {
  return {
    slug: over.id,
    name: over.id.toUpperCase(),
    roleAbbreviation: 'A',
    pinNumber: '1',
    edge: 'left',
    displayOrder: 0,
    probeLocation: '',
    expectedReading: '',
    missingLogic: '',
    labelGap: null,
    sourceProvenance: 'x',
    ...over,
  }
}

const SCENARIO: TopologyScenario = {
  id: 's1',
  slug: 'key-on',
  label: 'Key On',
  sub: '',
  kind: 'operation',
  keyPosition: 'on',
  engineState: 'off',
  loadLevel: null,
  isDefault: true,
  displayOrder: 0,
  pinStates: {},
  pinReadings: {},
}

// A 4-node fuel chain: lift -> filter -> hp -> rail, plus a disconnected island.
function fuelTopology(): SystemTopology {
  const components = [
    comp({ id: 'lift', kind: 'pump' }),
    comp({ id: 'filter', kind: 'mechanical' }),
    comp({ id: 'hp', kind: 'pump' }),
    comp({ id: 'rail', kind: 'mechanical' }),
    comp({ id: 'island', kind: 'sensor' }), // disconnected — must NOT be walked in
  ]
  const connections = [
    conn({ id: 'c1', fromComponentId: 'lift', toComponentId: 'filter' }),
    conn({ id: 'c2', fromComponentId: 'filter', toComponentId: 'hp' }),
    conn({ id: 'c3', fromComponentId: 'hp', toComponentId: 'rail' }),
  ]
  return {
    platform: { slug: 'p', name: 'P' },
    symptom: { slug: 's', description: 'd' },
    system: 'fuel',
    components,
    connections,
    scenarios: [SCENARIO],
    dataStatus: null,
    lastScenarioSlug: null,
  }
}

// ---------------------------------------------------------------------------
// Task 5 — graph-walk circuit set + DUT slot
// ---------------------------------------------------------------------------

describe('walkCircuitSet (Task 5)', () => {
  it('walks neighbors of the focus up to the depth budget, excluding islands', () => {
    const topo = fuelTopology()
    const ids = walkCircuitSet(topo, 'hp', 2)
      .map((c) => c.id)
      .sort()
    expect(ids).toContain('hp')
    expect(ids).toContain('filter')
    expect(ids).toContain('rail')
    expect(ids).toContain('lift') // 2 hops from hp via filter
    expect(ids).not.toContain('island')
  })

  it('depth 1 stays to immediate neighbors only', () => {
    const ids = walkCircuitSet(fuelTopology(), 'hp', 1)
      .map((c) => c.id)
      .sort()
    expect(ids).toEqual(['filter', 'hp', 'rail'])
  })

  it('an unknown focus id returns an empty set (never throws)', () => {
    expect(walkCircuitSet(fuelTopology(), 'nope', 2)).toEqual([])
  })
})

describe('assembleScene — device-under-test + elements seed (Task 5)', () => {
  it('sets focus to the step component and emits the DUT part into elements', () => {
    const topo = fuelTopology()
    topo.components[2].testActions = [
      action({
        slug: 'hp-pressure',
        observationMethod: 'pressure_test_with_gauge',
        meterMode: 'pressure',
      }),
    ]
    const step = topo.components[2].testActions[0]
    const scene = assembleScene(topo, step, SCENARIO)

    expect(scene.focus.selectedPartId).toBe('hp')
    expect(scene.shape).toBe('pressure-flow')
    const dut = scene.slots['device-under-test'] as PartSlotFill
    expect(dut?.fillKind).toBe('part')
    expect(dut.name).toBe('hp') // name from TopologyComponent.name (frozen PartSlotFill)
    expect(dut.active).toBe(true) // the device-under-test is honestly active
    expect(
      scene.elements.some((e) => e.elementKind === 'part' && e.partId === 'hp'),
    ).toBe(true)
  })

  it('resolveSlots is the exported alias of assembleScene (R1)', () => {
    expect(resolveSlots).toBe(assembleScene)
  })

  it('a null activeScenario does not throw and yields a neutral verdict (R10)', () => {
    const topo = fuelTopology()
    topo.components[2].testActions = [
      action({ slug: 'x', observationMethod: 'scan_tool_pid', meterMode: 'pid' }),
    ]
    const scene = assembleScene(topo, topo.components[2].testActions[0], null)
    expect(scene.verdict).toBe('neutral')
  })

  it('every shape sets a top-level ResolvedScene.verdict (R7)', () => {
    const topo = fuelTopology()
    topo.components[2].testActions = [
      action({ slug: 'look', observationMethod: 'direct_visual_inspection' }),
    ]
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    expect(scene.shape).toBe('look-inspect') // a gauge-less shape
    expect(['out-of-range', 'branch-fail', 'neutral']).toContain(scene.verdict)
  })
})

// ---------------------------------------------------------------------------
// Task 6 — source / ground / downstream-anchor from data-derived roles
// ---------------------------------------------------------------------------

describe('assembleScene — source/ground/downstream from roles (Task 6)', () => {
  it('derives source from a power/ref wire and ground from a ground wire', () => {
    const topo = fuelTopology()
    const ecu = comp({ id: 'pcm', kind: 'module' })
    const gnd = comp({ id: 'gnd', kind: 'splice' })
    topo.components.push(ecu, gnd)
    topo.components[2].testActions = [
      action({
        slug: 'hp-volts',
        observationMethod: 'electrical_measurement_at_pin',
        meterMode: 'volts',
      }),
    ]
    topo.connections.push(
      conn({
        id: 'pwr',
        fromComponentId: 'pcm',
        toComponentId: 'hp',
        connectionKind: 'wire',
        electricalRole: '12v',
        fromPinId: 'pcm-a',
        toPinId: 'hp-1',
      }),
      conn({
        id: 'grd',
        fromComponentId: 'hp',
        toComponentId: 'gnd',
        connectionKind: 'wire',
        electricalRole: 'ground',
        fromPinId: 'hp-2',
        toPinId: 'gnd-1',
      }),
    )
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)

    expect(scene.shape).toBe('electrical-probe')
    expect((scene.slots['source'] as PartSlotFill)?.partId).toBe('pcm')
    expect((scene.slots['ground'] as PartSlotFill)?.partId).toBe('gnd')
    expect(scene.activeWireIds).toContain('pwr')
    expect(scene.activeWireIds).toContain('grd')
  })

  it('5v-ref also qualifies as source (role-agnostic among power/ref)', () => {
    const topo = fuelTopology()
    topo.components.push(comp({ id: 'ref', kind: 'module' }))
    topo.components[3].testActions = [
      action({
        slug: 'rail-volts',
        observationMethod: 'electrical_measurement_at_pin',
        meterMode: 'volts',
      }),
    ]
    topo.connections.push(
      conn({
        id: 'ref-w',
        fromComponentId: 'ref',
        toComponentId: 'rail',
        connectionKind: 'wire',
        electricalRole: '5v-ref',
        fromPinId: 'r-a',
        toPinId: 'rail-1',
      }),
    )
    const scene = assembleScene(topo, topo.components[3].testActions[0], SCENARIO)
    expect((scene.slots['source'] as PartSlotFill)?.partId).toBe('ref')
  })

  it('does NOT name a downstream consumer as source when the focus is the FROM (upstream) end', () => {
    // The focus FEEDS a downstream consumer over a 12v wire (focus = from end),
    // and NO power wire feeds INTO the focus. source must be null: power flows
    // from→to, so the focus's source is whoever feeds IT, not who it feeds.
    const topo = fuelTopology()
    topo.components.push(comp({ id: 'consumer', kind: 'actuator' }))
    topo.components[2].testActions = [
      action({
        slug: 'hp-feed',
        observationMethod: 'electrical_measurement_at_pin',
        meterMode: 'volts',
      }),
    ]
    topo.connections.push(
      conn({
        id: 'feed',
        fromComponentId: 'hp', // focus is the upstream supplier here
        toComponentId: 'consumer',
        connectionKind: 'wire',
        electricalRole: '12v',
        fromPinId: 'hp-a',
        toPinId: 'consumer-1',
      }),
    )
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    expect(scene.shape).toBe('electrical-probe')
    // The engine must NOT name 'consumer' (the thing hp powers) as hp's source.
    expect(scene.slots['source']).toBeNull()
  })

  it('DEGRADES honestly on null electricalRole — empty source/ground, no fabrication', () => {
    const topo = fuelTopology() // every connection has electricalRole: null
    topo.components[2].testActions = [
      action({
        slug: 'hp-volts2',
        observationMethod: 'electrical_measurement_at_pin',
        meterMode: 'volts',
      }),
    ]
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    expect(scene.slots['source']).toBeNull()
    expect(scene.slots['ground']).toBeNull()
  })

  it('downstream-anchor = outbound fluid-line on a flow step', () => {
    const topo = fuelTopology()
    topo.components[2].testActions = [
      action({
        slug: 'hp-press',
        observationMethod: 'pressure_test_with_gauge',
        meterMode: 'pressure',
      }),
    ]
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    // hp -> rail is the outbound fluid-line
    expect((scene.slots['downstream-anchor'] as PartSlotFill)?.partId).toBe('rail')
  })

  it('source/ground/downstream parts on the active wire are honestly active', () => {
    const topo = fuelTopology()
    topo.components.push(comp({ id: 'pcm', kind: 'module' }))
    topo.components[2].testActions = [
      action({
        slug: 'act-v',
        observationMethod: 'electrical_measurement_at_pin',
        meterMode: 'volts',
      }),
    ]
    topo.connections.push(
      conn({
        id: 'pwr2',
        fromComponentId: 'pcm',
        toComponentId: 'hp',
        connectionKind: 'wire',
        electricalRole: '12v',
        fromPinId: 'a',
        toPinId: 'b',
      }),
    )
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    // source sits on the active wire touching the focus → active true.
    expect((scene.slots['source'] as PartSlotFill).active).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Task 7 — terminals via pinsAllowed (the leak-lock) + the single overlay
// ---------------------------------------------------------------------------

describe('assembleScene — terminals leak-lock + single overlay (Task 7)', () => {
  it('a pressure step yields ZERO terminals in elements + a gauge-tee overlay', () => {
    const topo = fuelTopology()
    topo.components[2].pins = [pin({ id: 'p1' })]
    topo.components[2].testActions = [
      action({
        slug: 'press',
        observationMethod: 'pressure_test_with_gauge',
        meterMode: 'pressure',
      }),
    ]
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    expect(scene.pinsAllowed).toBe(false)
    expect(scene.elements.filter((e) => e.elementKind === 'terminal')).toHaveLength(0)
    expect(scene.overlay?.kind).toBe('pressure-gauge-tee')
  })

  it('an electrical step emits the focus terminals AND a probe-lead overlay (positive control)', () => {
    const topo = fuelTopology()
    topo.components[2].pins = [
      pin({ id: 'p1', roleAbbreviation: 'A', edge: 'left' }),
      pin({ id: 'p2', roleAbbreviation: 'G', edge: 'right', displayOrder: 1 }),
    ]
    topo.components[2].testActions = [
      action({
        slug: 'volt',
        observationMethod: 'electrical_measurement_at_pin',
        meterMode: 'volts',
      }),
    ]
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    expect(scene.pinsAllowed).toBe(true)
    expect(scene.elements.filter((e) => e.elementKind === 'terminal')).toHaveLength(2)
    expect(scene.overlay?.kind).toBe('probe-lead')
    expect(scene.overlay?.attachPartId).toBe('hp')
  })

  it('a look step has no overlay and no terminals (no hookup on a visual check)', () => {
    const topo = fuelTopology()
    topo.components[2].pins = [pin({ id: 'p1' })]
    topo.components[2].testActions = [
      action({ slug: 'look', observationMethod: 'direct_visual_inspection' }),
    ]
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    expect(scene.overlay).toBeNull()
    expect(scene.elements.filter((e) => e.elementKind === 'terminal')).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Task 8 — verdict signal (out-of-range → branch-fail → neutral) + gauge
// ---------------------------------------------------------------------------

describe('computeVerdict — pure-data precedence (Task 8)', () => {
  it('isOutOfRange is authoritative (beats a passing branch)', () => {
    const scn = { ...SCENARIO, isOutOfRange: { p1: true } }
    const step = action({
      slug: 'x',
      observationMethod: 'scan_tool_pid',
      meterMode: 'pid',
      branches: [{ condition: 'c', verdict: 'pass', nextAction: 'n' }],
    })
    expect(computeVerdict(step, scn, [pin({ id: 'p1' })])).toBe('out-of-range')
  })

  it('falls to branch-fail when a branch verdict is "fail" and nothing is out of range', () => {
    const scn = { ...SCENARIO, isOutOfRange: {} }
    const step = action({
      slug: 'x',
      observationMethod: 'scan_tool_pid',
      meterMode: 'pid',
      branches: [{ condition: 'c', verdict: 'fail', nextAction: 'n' }],
    })
    expect(computeVerdict(step, scn, [pin({ id: 'p1' })])).toBe('branch-fail')
  })

  it('neutral graphite default — never red without evidence', () => {
    const scn = { ...SCENARIO, isOutOfRange: {} }
    const step = action({
      slug: 'x',
      observationMethod: 'scan_tool_pid',
      meterMode: 'pid',
      branches: [{ condition: 'c', verdict: 'pass', nextAction: 'n' }],
    })
    expect(computeVerdict(step, scn, [pin({ id: 'p1' })])).toBe('neutral')
  })

  it('missing isOutOfRange map (pre-migration data) => neutral, never throws', () => {
    const step = action({ slug: 'x', observationMethod: 'scan_tool_pid', meterMode: 'pid' })
    expect(computeVerdict(step, SCENARIO, [pin({ id: 'p1' })])).toBe('neutral')
  })

  it('a null scenario does not crash; a failing branch still yields branch-fail', () => {
    const step = action({
      slug: 'x',
      observationMethod: 'scan_tool_pid',
      meterMode: 'pid',
      branches: [{ condition: 'c', verdict: 'fail', nextAction: 'n' }],
    })
    // null scenario means no out-of-range evidence, but a failing branch still
    // reads as branch-fail (branch verdict is scenario-independent).
    expect(computeVerdict(step, null, [pin({ id: 'p1' })])).toBe('branch-fail')
  })

  it('a null scenario with NO branches => neutral (the genuine R10 null-safety case)', () => {
    const stepNoBranches = action({
      slug: 'x',
      observationMethod: 'scan_tool_pid',
      meterMode: 'pid',
      branches: [],
    })
    // No out-of-range evidence (null scenario) AND no failing branch → neutral,
    // never red without evidence and never a crash on the null scenario.
    expect(computeVerdict(stepNoBranches, null, [pin({ id: 'p1' })])).toBe('neutral')
  })

  it('R14 scope: out-of-range is currently keyed to the FOCUS pins ONLY (documented limitation)', () => {
    // TODO(R14): widen to all walked-scene pins later. Today an out-of-range
    // flag on a pin that does NOT belong to the focus is NOT seen by the verdict.
    const scn = { ...SCENARIO, isOutOfRange: { 'some-other-pin': true } }
    const step = action({ slug: 'x', observationMethod: 'scan_tool_pid', meterMode: 'pid' })
    // focus pins are only [p1]; the out-of-range 'some-other-pin' is invisible.
    expect(computeVerdict(step, scn, [pin({ id: 'p1' })])).toBe('neutral')
  })
})

describe('assembleScene — gaugeSpec + scene verdict mirror (Task 8)', () => {
  it('a single-pid step exposes a gaugeSpec whose verdict mirrors the scene verdict', () => {
    const topo = fuelTopology()
    topo.components[2].testActions = [
      action({ slug: 'pid', observationMethod: 'scan_tool_pid', meterMode: 'pid' }),
    ]
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    expect(scene.gaugeSpec?.verdict).toBe('neutral')
    expect(scene.gaugeSpec?.verdict).toBe(scene.verdict)
  })

  it('an out-of-range focus pin drives scene.verdict AND gaugeSpec.verdict to out-of-range', () => {
    const topo = fuelTopology()
    topo.components[2].pins = [pin({ id: 'fp' })]
    topo.components[2].testActions = [
      action({ slug: 'pid2', observationMethod: 'scan_tool_pid', meterMode: 'pid' }),
    ]
    const scn = { ...SCENARIO, isOutOfRange: { fp: true } }
    const scene = assembleScene(topo, topo.components[2].testActions[0], scn)
    expect(scene.verdict).toBe('out-of-range')
    expect(scene.gaugeSpec?.verdict).toBe('out-of-range')
  })

  it('buildReading supplies the frozen PartReading keys {expect, now, unit, mode, verdict}', () => {
    const topo = fuelTopology()
    topo.components[2].testActions = [
      action({
        slug: 'rd',
        observationMethod: 'scan_tool_pid',
        meterMode: 'pid',
        expectedObservation: '500 PSI',
        expectedUnit: 'PSI',
      }),
    ]
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    const reading = scene.gaugeSpec!.reading
    expect(reading.expect).toBe('500 PSI')
    expect(reading.now).toBeNull()
    expect(reading.unit).toBe('PSI')
    expect(reading.mode).toBe('pid')
    expect(reading.verdict).toBe(scene.verdict)
  })
})

// ---------------------------------------------------------------------------
// Task 9 — the detail content payload + fork route arm
// ---------------------------------------------------------------------------

describe('assembleScene — detail payload + fork route (Task 9)', () => {
  it('builds the detail slot from component prose (probe/why), null where absent', () => {
    const topo = fuelTopology()
    topo.components[2].probingTactic = 'Back-probe pin 1 with key on.'
    topo.components[2].body = 'The HP pump is mechanical.'
    topo.components[2].testActions = [
      action({ slug: 'd', observationMethod: 'scan_tool_pid', meterMode: 'pid' }),
    ]
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    const detail = scene.slots['detail']
    expect(detail?.fillKind).toBe('detail')
    if (detail?.fillKind === 'detail') {
      expect(detail.probe).toBe('Back-probe pin 1 with key on.')
      expect(detail.why).toBe('The HP pump is mechanical.')
      expect(detail.secondary).toBeNull()
    }
  })

  it('a fork step emits one route arm using routesToTestActionId when present', () => {
    const topo = fuelTopology()
    topo.components[2].testActions = [
      action({
        slug: 'fk',
        observationMethod: 'scan_tool_pid',
        meterMode: 'pid',
        stepKind: 'fork', // fork is now an explicit decision step (not "has branches")
        branches: [
          {
            condition: 'low',
            verdict: 'fail',
            nextAction: 'Test the lift pump',
            routesToTestActionId: 'ta-99',
            reasoning: 'r',
          },
        ],
      }),
    ]
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    expect(scene.shape).toBe('fork')
    expect(scene.forkRoute?.routesToTestActionId).toBe('ta-99')
    expect(scene.forkRoute?.nextActionText).toBe('Test the lift pump')
    expect(scene.slots['route']).toEqual(scene.forkRoute)
  })

  it('a fork DEGRADES to words-only when routesToTestActionId is null', () => {
    const topo = fuelTopology()
    topo.components[2].testActions = [
      action({
        slug: 'fk2',
        observationMethod: 'scan_tool_pid',
        meterMode: 'pid',
        stepKind: 'fork', // fork is now an explicit decision step (not "has branches")
        branches: [
          { condition: 'low', verdict: 'fail', nextAction: 'Check the FRP sensor wiring' },
        ],
      }),
    ]
    const scene = assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
    expect(scene.shape).toBe('fork')
    expect(scene.forkRoute?.routesToTestActionId).toBeNull()
    expect(scene.forkRoute?.nextActionText).toBe('Check the FRP sensor wiring')
  })
})

// ---------------------------------------------------------------------------
// Task 10 — generality across unlike systems + no-orphan + purity guard
// ---------------------------------------------------------------------------

describe('generality across unlike systems (data-only, zero per-case code) (Task 10)', () => {
  // (2) a purely-electrical DEF heater circuit — different system, same engine.
  function defElectricalTopology(): SystemTopology {
    const components = [
      comp({ id: 'pcm', kind: 'module' }),
      comp({ id: 'def-heater', kind: 'actuator' }),
      comp({ id: 'gnd', kind: 'splice' }),
    ]
    const connections = [
      conn({
        id: 'w1',
        fromComponentId: 'pcm',
        toComponentId: 'def-heater',
        connectionKind: 'wire',
        electricalRole: '12v',
        fromPinId: 'a',
        toPinId: 'b',
      }),
      conn({
        id: 'w2',
        fromComponentId: 'def-heater',
        toComponentId: 'gnd',
        connectionKind: 'wire',
        electricalRole: 'ground',
        fromPinId: 'c',
        toPinId: 'd',
      }),
    ]
    return {
      platform: { slug: 'p', name: 'P' },
      symptom: { slug: 's', description: 'd' },
      system: 'def',
      components,
      connections,
      scenarios: [SCENARIO],
      dataStatus: null,
      lastScenarioSlug: null,
    }
  }

  // (3) a charging-system PID read — non-fuel, non-electrical-probe.
  function chargingPidTopology(): SystemTopology {
    const components = [comp({ id: 'alt', kind: 'module' })]
    return {
      platform: { slug: 'p', name: 'P' },
      symptom: { slug: 's', description: 'd' },
      system: 'charging',
      components,
      connections: [],
      scenarios: [SCENARIO],
      dataStatus: null,
      lastScenarioSlug: null,
    }
  }

  it('(1) fuel pressure-flow + (2) DEF electrical-probe + (3) charging single-pid all resolve through one code path', () => {
    // The IDENTICAL assertion loop over 3 unlike SystemTopology fixtures.
    const fuel = fuelTopology()
    fuel.components[2].testActions = [
      action({ slug: 'f', observationMethod: 'pressure_test_with_gauge', meterMode: 'pressure' }),
    ]
    const def = defElectricalTopology()
    def.components[1].pins = [pin({ id: 'pp' })]
    def.components[1].testActions = [
      action({
        slug: 'def-v',
        observationMethod: 'electrical_measurement_at_pin',
        meterMode: 'volts',
      }),
    ]
    const charging = chargingPidTopology()
    charging.components[0].testActions = [
      action({ slug: 'chg', observationMethod: 'scan_tool_pid', meterMode: 'pid' }),
    ]

    const cases: Array<{ topo: SystemTopology; step: TopologyTestAction }> = [
      { topo: fuel, step: fuel.components[2].testActions[0] },
      { topo: def, step: def.components[1].testActions[0] },
      { topo: charging, step: charging.components[0].testActions[0] },
    ]
    // Identical loop — every fixture must produce a well-formed scene, and the
    // electrical-vs-non-electrical leak-lock must hold per fixture (a fixture
    // that took a system-specific path would leak terminals or fill a forbidden
    // source/ground slot, tripping this).
    for (const { topo, step } of cases) {
      const scene = assembleScene(topo, step, SCENARIO)
      expect(scene.elements.length).toBeGreaterThan(0)
      expect(scene.slots['device-under-test']?.fillKind).toBe('part')
      expect(['out-of-range', 'branch-fail', 'neutral']).toContain(scene.verdict)
      expect(ALL_STEP_SHAPES).toContain(scene.shape)

      const isElectrical = [
        'electrical-probe',
        'continuity-ground',
        'voltage-drop',
        'duty-pwm',
      ].includes(scene.shape)
      if (isElectrical) {
        expect(scene.pinsAllowed).toBe(true)
      } else {
        expect(
          scene.elements.filter((e) => e.elementKind === 'terminal'),
        ).toHaveLength(0)
        expect(scene.slots['source']).toBeNull()
        expect(scene.slots['ground']).toBeNull()
        expect(scene.pinsAllowed).toBe(false)
      }
    }
  })

  it('a DEF electrical-probe step resolves source/ground/terminals identically to fuel', () => {
    const topo = defElectricalTopology()
    topo.components[1].pins = [pin({ id: 'pp' })]
    topo.components[1].testActions = [
      action({
        slug: 'def-v',
        observationMethod: 'electrical_measurement_at_pin',
        meterMode: 'volts',
      }),
    ]
    const scene = assembleScene(topo, topo.components[1].testActions[0], SCENARIO)
    expect(scene.shape).toBe('electrical-probe')
    expect((scene.slots['source'] as PartSlotFill)?.partId).toBe('pcm')
    expect((scene.slots['ground'] as PartSlotFill)?.partId).toBe('gnd')
    expect(scene.elements.filter((e) => e.elementKind === 'terminal')).toHaveLength(1)
  })

  it('a charging PID step lays out as single-pid with no electrical leak', () => {
    const topo = chargingPidTopology()
    topo.components[0].testActions = [
      action({ slug: 'chg', observationMethod: 'scan_tool_pid', meterMode: 'pid' }),
    ]
    const scene = assembleScene(topo, topo.components[0].testActions[0], SCENARIO)
    expect(scene.shape).toBe('single-pid')
    expect(scene.slots['source']).toBeNull()
    expect(scene.slots['ground']).toBeNull()
    expect(scene.elements.filter((e) => e.elementKind === 'terminal')).toHaveLength(0)
  })

  it('an UNSEEN observationMethod renders via fallback (no throw, elements > 0)', () => {
    const topo = chargingPidTopology()
    topo.components[0].testActions = [
      action({ slug: 'unseen', observationMethod: 'flux_capacitor_resonance' }),
    ]
    const scene = assembleScene(topo, topo.components[0].testActions[0], SCENARIO)
    expect(scene.shape).toBe('single-pid') // generic fallback
    expect(scene.elements.length).toBeGreaterThan(0)
  })

  it('an UNSEEN kind on the focus still renders a part element (no per-kind switch)', () => {
    const topo = chargingPidTopology()
    topo.components[0] = comp({ id: 'alt', kind: 'tachyon-emitter' })
    topo.components[0].testActions = [
      action({ slug: 'k', observationMethod: 'scan_tool_pid', meterMode: 'pid' }),
    ]
    const scene = assembleScene(topo, topo.components[0].testActions[0], SCENARIO)
    expect(
      scene.elements.some((e) => e.elementKind === 'part' && e.partId === 'alt'),
    ).toBe(true)
  })
})

describe('no-orphan-slot invariant (Task 10)', () => {
  function everyShapeScene(
    method: string,
    meterMode: TopologyTestAction['meterMode'],
    stepKind: TopologyTestAction['stepKind'],
    branchy: boolean,
  ) {
    const topo = fuelTopology()
    const br = branchy
      ? [{ condition: 'c', verdict: 'fail', nextAction: 'n' }]
      : []
    topo.components[2].testActions = [
      action({ slug: 'z', observationMethod: method, meterMode, stepKind, branches: br }),
    ]
    return assembleScene(topo, topo.components[2].testActions[0], SCENARIO)
  }

  it('no resolver-filled slot is FORBIDDEN by its shape rule', () => {
    const cases = [
      everyShapeScene('electrical_measurement_at_pin', 'volts', null, false),
      everyShapeScene('electrical_measurement_at_pin', 'ohms', null, false),
      everyShapeScene('electrical_measurement_at_pin', 'drop', null, false),
      everyShapeScene('electrical_measurement_at_pin', 'duty', null, false),
      everyShapeScene('pressure_test_with_gauge', 'pressure', null, false),
      everyShapeScene('scan_tool_pid', 'pid', null, false),
      everyShapeScene('direct_visual_inspection', null, null, false),
      everyShapeScene('scan_tool_pid', 'pid', 'locate', false),
      everyShapeScene('scan_tool_pid', 'pid', null, true), // fork
    ]
    for (const scene of cases) {
      const rule = RULES[scene.shape]
      for (const [name, fill] of Object.entries(scene.slots)) {
        if (fill !== null) {
          expect(
            rule.forbidden,
            `${scene.shape} filled forbidden slot ${name}`,
          ).not.toContain(name)
        }
      }
    }
  })
})

describe('purity guard (Task 10 / Override G)', () => {
  // The impl modules live under lib/diagnostics/diagram/; the test lives under
  // tests/unit/. Build repo-absolute paths from cwd (vitest cwd = repo root).
  const IMPL_DIR = path.resolve(process.cwd(), 'lib/diagnostics/diagram')

  // Strip line + block comments so a documented word (e.g. "AI-free") in a
  // comment cannot trip the guard — we assert on real CODE only.
  function stripComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  }

  it('show-rule.ts and slot-resolver.ts import nothing from react/dom/network/ai/xyflow/dagre', () => {
    for (const f of ['show-rule.ts', 'slot-resolver.ts']) {
      const code = stripComments(readFileSync(path.join(IMPL_DIR, f), 'utf8'))
      expect(code, `${f} must not import react`).not.toMatch(/from\s+['"]react['"]/)
      expect(code, `${f} must not import react-dom`).not.toMatch(/from\s+['"]react-dom/)
      expect(code, `${f} must not import @xyflow`).not.toMatch(/@xyflow/)
      expect(code, `${f} must not import dagre`).not.toMatch(/\bdagre\b/)
      expect(code, `${f} must not call fetch`).not.toMatch(/\bfetch\(/)
      expect(code, `${f} must not reference an AI module`).not.toMatch(/from\s+['"]@?ai/)
      // NO runtime call to loadSystemTopology (type-only import of C1 shapes is OK).
      expect(code, `${f} must not CALL loadSystemTopology`).not.toMatch(
        /loadSystemTopology\s*\(/,
      )
    }
  })
})
