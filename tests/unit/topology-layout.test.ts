import { describe, it, expect } from 'vitest'
import {
  layoutTopology,
  NODE_WIDTH,
  NODE_HEIGHT,
} from '@/lib/diagnostics/topology-layout'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'

function component(id: string, name: string) {
  return {
    id,
    slug: id,
    name,
    kind: 'sensor',
    location: null,
    function: null,
    electricalContract: null,
    sourceProvenance: 'TRAINING-CONFIRMED',
    observableProperties: [],
    testActions: [],
  }
}

function makeTopology(): SystemTopology {
  return {
    platform: { slug: 'p', name: 'Platform' },
    symptom: { slug: 's', description: 'symptom' },
    system: 'fuel',
    components: [
      component('a', 'PCM'),
      component('b', 'FRP Sensor'),
      component('c', 'Lift Pump'),
    ],
    connections: [
      {
        id: 'e1',
        fromComponentId: 'a',
        toComponentId: 'b',
        connectionKind: 'electrical-wire',
        direction: 'bidirectional',
        description: null,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
      {
        id: 'e2',
        fromComponentId: 'a',
        toComponentId: 'c',
        connectionKind: 'electrical-wire',
        direction: 'unidirectional',
        description: null,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
    ],
  }
}

describe('layoutTopology', () => {
  it('places every component, keyed by id', () => {
    const layout = layoutTopology(makeTopology())
    expect(layout.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c'])
  })

  it('is deterministic — the same topology lays out identically', () => {
    const topo = makeTopology()
    expect(layoutTopology(topo)).toEqual(layoutTopology(topo))
  })

  it('gives every node the fixed footprint', () => {
    for (const n of layoutTopology(makeTopology()).nodes) {
      expect(n.width).toBe(NODE_WIDTH)
      expect(n.height).toBe(NODE_HEIGHT)
    }
  })

  it('produces non-overlapping node rectangles', () => {
    const { nodes } = layoutTopology(makeTopology())
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const overlap =
          a.x < b.x + b.width &&
          a.x + a.width > b.x &&
          a.y < b.y + b.height &&
          a.y + a.height > b.y
        expect(overlap).toBe(false)
      }
    }
  })

  it('returns an empty layout for an empty component list', () => {
    const empty = { ...makeTopology(), components: [], connections: [] }
    expect(layoutTopology(empty).nodes).toEqual([])
  })
})
