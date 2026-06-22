import { describe, it, expect } from 'vitest'
import type {
  SystemTopology,
  TopologyComponent,
  TopologyConnection,
  TopologyTestAction,
  TopologyScenario,
} from '@/lib/diagnostics/load-system-topology'
import {
  buildFocusedSlice,
  focusComponentIdForStep,
} from '@/lib/diagnostics/diagram/focused-slice'

// ---------------------------------------------------------------------------
// Minimal in-memory SystemTopology fixtures — pure, no DB. Mirrors the builder
// style in diagram-slot-resolver.test.ts so the slice helper is exercised end-
// to-end (the REAL functions, never a hand-copied mirror of their logic).
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
    connectionKind: 'electrical-wire',
    direction: 'bidirectional',
    description: null,
    sourceProvenance: 'TRAINING-CONFIRMED',
    electricalRole: '12v',
    fromPinId: null,
    toPinId: null,
    ...over,
  }
}

function action(
  over: Partial<TopologyTestAction> & { slug: string },
): TopologyTestAction {
  return {
    description: over.slug,
    scenarioRequired: 'any',
    observationMethod: 'electrical-meter',
    expectedObservation: null,
    invasiveness: 1,
    implicatedByCurrentSymptom: true,
    confidenceBoost: 0,
    branches: [],
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

/**
 * focus (`hp`) wired to two neighbors (`src`, `grd`); a 4th node (`island`) is
 * unrelated. There is also a neighbor-to-neighbor edge (`src`↔`grd`) that is
 * within the slice, and a neighbor-to-island edge that is NOT (one endpoint is
 * outside the slice).
 */
function fixture(): SystemTopology {
  const components = [
    comp({ id: 'hp', kind: 'pump', testActions: [action({ slug: 'measure-hp-volts' })] }),
    comp({ id: 'src', kind: 'connector' }),
    comp({ id: 'grd', kind: 'splice' }),
    comp({ id: 'island', kind: 'sensor', testActions: [action({ slug: 'island-check' })] }),
  ]
  const connections = [
    conn({ id: 'c-hp-src', fromComponentId: 'src', toComponentId: 'hp', electricalRole: '12v' }),
    conn({ id: 'c-hp-grd', fromComponentId: 'hp', toComponentId: 'grd', electricalRole: 'ground' }),
    // neighbor-to-neighbor — both endpoints in slice, must be kept
    conn({ id: 'c-src-grd', fromComponentId: 'src', toComponentId: 'grd', electricalRole: '12v' }),
    // neighbor-to-island — one endpoint outside slice, must be dropped
    conn({ id: 'c-src-island', fromComponentId: 'src', toComponentId: 'island', electricalRole: '12v' }),
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

describe('buildFocusedSlice', () => {
  it('keeps the focus + its depth-1 neighbors and drops the unrelated node', () => {
    const slice = buildFocusedSlice(fixture(), 'hp', 1)
    const ids = slice.components.map((c) => c.id).sort()
    expect(ids).toEqual(['grd', 'hp', 'src'])
    expect(ids).not.toContain('island')
  })

  it('keeps only connections whose BOTH endpoints are in the slice', () => {
    const slice = buildFocusedSlice(fixture(), 'hp', 1)
    const ids = slice.connections.map((c) => c.id).sort()
    // c-hp-src, c-hp-grd, c-src-grd kept; c-src-island dropped (island excluded)
    expect(ids).toEqual(['c-hp-grd', 'c-hp-src', 'c-src-grd'])
    expect(ids).not.toContain('c-src-island')
  })

  it('returns a NEW object and does not mutate the input topology', () => {
    const topo = fixture()
    const beforeComps = topo.components.length
    const beforeConns = topo.connections.length
    const slice = buildFocusedSlice(topo, 'hp', 1)
    expect(slice).not.toBe(topo)
    expect(topo.components.length).toBe(beforeComps)
    expect(topo.connections.length).toBe(beforeConns)
  })

  it('preserves scalar metadata (symptom, platform, scenarios, dataStatus)', () => {
    const topo = fixture()
    const slice = buildFocusedSlice(topo, 'hp', 1)
    expect(slice.symptom).toBe(topo.symptom)
    expect(slice.platform).toBe(topo.platform)
    expect(slice.scenarios).toBe(topo.scenarios)
    expect(slice.dataStatus).toBe(topo.dataStatus)
    expect(slice.system).toBe(topo.system)
  })

  it('an unknown focus id yields an empty slice (never throws)', () => {
    const slice = buildFocusedSlice(fixture(), 'nope', 1)
    expect(slice.components).toEqual([])
    expect(slice.connections).toEqual([])
  })

  it('depth 2 reaches the island via src (transitively connected)', () => {
    const slice = buildFocusedSlice(fixture(), 'hp', 2)
    const ids = slice.components.map((c) => c.id).sort()
    expect(ids).toContain('island')
  })
})

describe('focusComponentIdForStep', () => {
  it('returns the id of the component owning the step (matched by slug)', () => {
    const topo = fixture()
    const step = topo.components[0].testActions[0] // measure-hp-volts on hp
    expect(focusComponentIdForStep(topo, step)).toBe('hp')
  })

  it('returns the island id for the island-owned step', () => {
    const topo = fixture()
    const step = action({ slug: 'island-check' })
    expect(focusComponentIdForStep(topo, step)).toBe('island')
  })

  it('returns null when no component owns a matching slug', () => {
    const topo = fixture()
    const step = action({ slug: 'orphan-step' })
    expect(focusComponentIdForStep(topo, step)).toBeNull()
  })
})
