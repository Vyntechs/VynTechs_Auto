import dagre from '@dagrejs/dagre'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'

/**
 * Fixed node footprint. The diagram CSS (`.topo-node` in topology.css) MUST
 * size nodes to match, or edges will not meet node borders cleanly.
 */
export const NODE_WIDTH = 210
export const NODE_HEIGHT = 86

export type TopologyNodeLayout = {
  id: string
  /** Top-left corner — React Flow's coordinate convention. */
  x: number
  y: number
  width: number
  height: number
}

export type TopologyLayout = {
  nodes: TopologyNodeLayout[]
  width: number
  height: number
}

/**
 * Pure layered layout: SystemTopology -> deterministic node positions.
 * dagre is deterministic, so the same topology always lays out the same way
 * (snapshot-testable). The PCM reads as the hub because every other fuel
 * component connects to it, so dagre ranks it at the top.
 */
export function layoutTopology(topology: SystemTopology): TopologyLayout {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 96, marginx: 24, marginy: 24 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const c of topology.components) {
    g.setNode(c.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const conn of topology.connections) {
    // The loader guarantees both endpoints are in the set, but guard so a
    // stray edge can never make dagre throw.
    if (g.hasNode(conn.fromComponentId) && g.hasNode(conn.toComponentId)) {
      g.setEdge(conn.fromComponentId, conn.toComponentId)
    }
  }

  dagre.layout(g)

  const nodes: TopologyNodeLayout[] = topology.components.map((c) => {
    const n = g.node(c.id)
    // dagre reports the node CENTRE; React Flow positions by TOP-LEFT.
    return {
      id: c.id,
      x: n.x - NODE_WIDTH / 2,
      y: n.y - NODE_HEIGHT / 2,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    }
  })

  const graph = g.graph()
  // dagre returns -Infinity for width/height when the graph has no nodes;
  // `??` does not catch that (it is a real number). Clamp to a finite value.
  const finite = (v: number | undefined) =>
    Number.isFinite(v) ? (v as number) : 0
  return { nodes, width: finite(graph.width), height: finite(graph.height) }
}
