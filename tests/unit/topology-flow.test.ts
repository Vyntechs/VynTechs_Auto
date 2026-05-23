import { describe, it, expect } from 'vitest'
import {
  toFlowElements,
  type TopologySelectionState,
} from '@/components/topology/topology-flow'
import type {
  SystemTopology,
  TopologyScenario,
} from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'

function component(id: string, name: string, kind = 'sensor') {
  return {
    id,
    slug: id,
    name,
    kind,
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
  }
}

const topology: SystemTopology = {
  platform: { slug: 'p', name: 'Platform' },
  symptom: { slug: 's', description: 'symptom' },
  system: 'fuel',
  components: [component('a', 'PCM', 'module'), component('b', 'FRP', 'sensor')],
  connections: [
    {
      id: 'e1',
      fromComponentId: 'a',
      toComponentId: 'b',
      connectionKind: 'electrical-wire',
      direction: 'unidirectional',
      description: 'PCM reads FRP',
      sourceProvenance: 'TRAINING-CONFIRMED',
      electricalRole: null,
      fromPinId: null,
      toPinId: null,
    },
  ],
  scenarios: [],
  dataStatus: null,
  lastScenarioSlug: null,
}

const layout: TopologyLayout = {
  width: 400,
  height: 300,
  nodes: [
    { id: 'a', x: 10, y: 20, width: 210, height: 86 },
    { id: 'b', x: 30, y: 200, width: 210, height: 86 },
  ],
}

const emptySelection: TopologySelectionState = {
  kind: 'empty',
  activeScenarioSlug: null,
}

describe('toFlowElements', () => {
  it('maps every component to a topology node at its laid-out position', () => {
    const { nodes } = toFlowElements(topology, layout, emptySelection)
    expect(nodes).toHaveLength(2)
    const a = nodes.find((n) => n.id === 'a')!
    expect(a.type).toBe('topology')
    expect(a.position).toEqual({ x: 10, y: 20 })
    expect(a.data.component.name).toBe('PCM')
  })

  it('maps every connection to an edge with source/target ids', () => {
    const { edges } = toFlowElements(topology, layout, emptySelection)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ id: 'e1', source: 'a', target: 'b' })
  })

  it('classes each non-electrical edge by connection_kind for CSS styling', () => {
    const { edges } = toFlowElements(topology, layout, emptySelection)
    expect(edges[0].className).toContain('topo-edge--electrical-wire')
  })

  it('flags the selected node', () => {
    const sel: TopologySelectionState = {
      kind: 'component',
      id: 'a',
      activeScenarioSlug: null,
    }
    const { nodes } = toFlowElements(topology, layout, sel)
    expect(nodes.find((n) => n.id === 'a')!.data.selected).toBe(true)
    expect(nodes.find((n) => n.id === 'b')!.data.selected).toBe(false)
  })

  it('flags the selected non-electrical edge', () => {
    const sel: TopologySelectionState = {
      kind: 'connection',
      id: 'e1',
      activeScenarioSlug: null,
    }
    const { edges } = toFlowElements(topology, layout, sel)
    expect(edges[0].className).toContain('is-selected')
  })

  it('falls back to {0,0} when a component has no layout entry', () => {
    const { nodes } = toFlowElements(
      topology,
      { ...layout, nodes: [] },
      emptySelection,
    )
    expect(nodes[0].position).toEqual({ x: 0, y: 0 })
  })
})

// PR-C/B coverage — scenarios + pins + custom wire edge
function buildTopologyWithScenarios(): SystemTopology {
  const pcm = {
    ...component('pcm-id', 'PCM', 'module'),
    pins: [
      {
        id: 'pin-pcm-out',
        slug: 'pcm-out',
        name: 'VCV A out',
        roleAbbreviation: 'A',
        pinNumber: null,
        edge: 'right' as const,
        displayOrder: 0,
        probeLocation: 'x',
        expectedReading: 'x',
        missingLogic: 'x',
        labelGap: null,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
    ],
  }
  const vcv = {
    ...component('vcv-id', 'VCV', 'solenoid'),
    pins: [
      {
        id: 'pin-vcv-a',
        slug: 'vcv-a',
        name: 'Pin A',
        roleAbbreviation: 'A',
        pinNumber: null,
        edge: 'left' as const,
        displayOrder: 0,
        probeLocation: 'x',
        expectedReading: 'x',
        missingLogic: 'x',
        labelGap: null,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
    ],
  }
  const idle: TopologyScenario = {
    id: 'scn-idle',
    slug: 'idle',
    label: 'Idle',
    sub: 'sub',
    kind: 'operation',
    keyPosition: 'on',
    engineState: 'running',
    loadLevel: 'idle',
    isDefault: true,
    displayOrder: 0,
    pinStates: { 'pin-pcm-out': 'pwm-med', 'pin-vcv-a': 'pwm-med' },
    pinReadings: {},
  }
  return {
    platform: { slug: 'p', name: 'P' },
    symptom: { slug: 's', description: 'S' },
    system: 'fuel',
    components: [pcm, vcv],
    connections: [
      {
        id: 'conn-1',
        fromComponentId: 'pcm-id',
        toComponentId: 'vcv-id',
        connectionKind: 'electrical-wire',
        direction: 'unidirectional',
        description: null,
        sourceProvenance: 'TRAINING-CONFIRMED',
        electricalRole: 'pwm',
        fromPinId: 'pin-pcm-out',
        toPinId: 'pin-vcv-a',
      },
      {
        // Fluid line — no electricalRole, no pins
        id: 'conn-2',
        fromComponentId: 'vcv-id',
        toComponentId: 'pcm-id',
        connectionKind: 'fluid-line',
        direction: 'unidirectional',
        description: 'fuel return',
        sourceProvenance: 'TRAINING-CONFIRMED',
        electricalRole: null,
        fromPinId: null,
        toPinId: null,
      },
    ],
    scenarios: [idle],
    dataStatus: null,
    lastScenarioSlug: null,
  }
}

const pcmVcvLayout: TopologyLayout = {
  width: 600,
  height: 400,
  nodes: [
    { id: 'pcm-id', x: 0, y: 0, width: 210, height: 86 },
    { id: 'vcv-id', x: 300, y: 200, width: 210, height: 86 },
  ],
}

describe('toFlowElements — scenarios + pins (PR-C/B)', () => {
  it('emits wire-type edges for electrical connections with active scenario state', () => {
    const t = buildTopologyWithScenarios()
    const { edges } = toFlowElements(t, pcmVcvLayout, {
      kind: 'empty',
      activeScenarioSlug: 'idle',
    })
    const wireEdge = edges.find((e) => e.id === 'conn-1')!
    expect(wireEdge.type).toBe('wire')
    // Wire-edge data carries role + pinId + state + active/dim flags
    const data = wireEdge.data as {
      electricalRole: string
      pinId: string | null
      wireState: string
      isActive: boolean
      isDim: boolean
    }
    expect(data.electricalRole).toBe('pwm')
    expect(data.pinId).toBe('pin-pcm-out')
    expect(data.wireState).toBe('pwm-med')
    expect(wireEdge.sourceHandle).toBe('pin-pcm-out')
    expect(wireEdge.targetHandle).toBe('pin-vcv-a')
  })

  it('keeps fluid lines on smoothstep with the existing topo-edge palette', () => {
    const t = buildTopologyWithScenarios()
    const { edges } = toFlowElements(t, pcmVcvLayout, {
      kind: 'empty',
      activeScenarioSlug: 'idle',
    })
    const fluid = edges.find((e) => e.id === 'conn-2')!
    expect(fluid.type).toBe('smoothstep')
    expect(fluid.className).toContain('topo-edge--fluid-line')
  })

  it('marks edges as isActive when their pin is the selected pin', () => {
    const t = buildTopologyWithScenarios()
    const { edges } = toFlowElements(t, pcmVcvLayout, {
      kind: 'pin',
      id: 'pin-pcm-out',
      activeScenarioSlug: 'idle',
    })
    const wireEdge = edges.find((e) => e.id === 'conn-1')!
    const data = wireEdge.data as { isActive: boolean; isDim: boolean }
    expect(data.isActive).toBe(true)
    expect(data.isDim).toBe(false)
  })

  it('marks edges as isDim when a different pin is selected', () => {
    const t = buildTopologyWithScenarios()
    const { edges } = toFlowElements(t, pcmVcvLayout, {
      kind: 'pin',
      id: 'pin-different',
      activeScenarioSlug: 'idle',
    })
    const wireEdge = edges.find((e) => e.id === 'conn-1')!
    const data = wireEdge.data as { isActive: boolean; isDim: boolean }
    expect(data.isDim).toBe(true)
    expect(data.isActive).toBe(false)
  })

  it('falls back to off when scenario has no state for the pin', () => {
    const t = buildTopologyWithScenarios()
    const { edges } = toFlowElements(t, pcmVcvLayout, {
      kind: 'empty',
      activeScenarioSlug: 'no-such-scenario',
    })
    const wireEdge = edges.find((e) => e.id === 'conn-1')!
    const data = wireEdge.data as { wireState: string }
    expect(data.wireState).toBe('off')
  })

  it('stamps pins onto component node data', () => {
    const t = buildTopologyWithScenarios()
    const { nodes } = toFlowElements(t, pcmVcvLayout, {
      kind: 'empty',
      activeScenarioSlug: 'idle',
    })
    const pcmNode = nodes.find((n) => n.id === 'pcm-id')!
    expect(pcmNode.data.pins).toHaveLength(1)
    expect(pcmNode.data.pins[0]!.id).toBe('pin-pcm-out')
  })

  it('stamps selectedPinId onto every node when a pin is selected', () => {
    const t = buildTopologyWithScenarios()
    const { nodes } = toFlowElements(t, pcmVcvLayout, {
      kind: 'pin',
      id: 'pin-pcm-out',
      activeScenarioSlug: 'idle',
    })
    expect(nodes[0]!.data.selectedPinId).toBe('pin-pcm-out')
    expect(nodes[1]!.data.selectedPinId).toBe('pin-pcm-out')
  })

  it('selectedPinId is null when no pin selected', () => {
    const t = buildTopologyWithScenarios()
    const { nodes } = toFlowElements(t, pcmVcvLayout, {
      kind: 'empty',
      activeScenarioSlug: 'idle',
    })
    expect(nodes[0]!.data.selectedPinId).toBeNull()
  })
})
