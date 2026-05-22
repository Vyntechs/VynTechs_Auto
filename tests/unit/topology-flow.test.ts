import { describe, it, expect } from 'vitest'
import { toFlowElements } from '@/components/topology/topology-flow'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
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
    sourceProvenance: 'TRAINING-CONFIRMED',
    observableProperties: [],
    testActions: [],
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
    },
  ],
}

const layout: TopologyLayout = {
  width: 400,
  height: 300,
  nodes: [
    { id: 'a', x: 10, y: 20, width: 210, height: 86 },
    { id: 'b', x: 30, y: 200, width: 210, height: 86 },
  ],
}

describe('toFlowElements', () => {
  it('maps every component to a topology node at its laid-out position', () => {
    const { nodes } = toFlowElements(topology, layout, null)
    expect(nodes).toHaveLength(2)
    const a = nodes.find((n) => n.id === 'a')!
    expect(a.type).toBe('topology')
    expect(a.position).toEqual({ x: 10, y: 20 })
    expect(a.data.component.name).toBe('PCM')
  })

  it('maps every connection to an edge with source/target ids', () => {
    const { edges } = toFlowElements(topology, layout, null)
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ id: 'e1', source: 'a', target: 'b' })
  })

  it('classes each edge by connection_kind for CSS styling', () => {
    const { edges } = toFlowElements(topology, layout, null)
    expect(edges[0].className).toContain('topo-edge--electrical-wire')
  })

  it('flags the selected node and edge', () => {
    const sel = toFlowElements(topology, layout, 'a')
    expect(sel.nodes.find((n) => n.id === 'a')!.data.selected).toBe(true)
    expect(sel.nodes.find((n) => n.id === 'b')!.data.selected).toBe(false)
    const selEdge = toFlowElements(topology, layout, 'e1')
    expect(selEdge.edges[0].className).toContain('is-selected')
  })

  it('falls back to {0,0} when a component has no layout entry', () => {
    const { nodes } = toFlowElements(topology, { ...layout, nodes: [] }, null)
    expect(nodes[0].position).toEqual({ x: 0, y: 0 })
  })
})
