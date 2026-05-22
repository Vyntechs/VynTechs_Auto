import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type {
  SystemTopology,
  TopologyComponent,
  TopologyConnection,
} from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'

export type TopologyNodeData = {
  component: TopologyComponent
  selected: boolean
}
export type TopologyEdgeData = {
  connection: TopologyConnection
}

export type TopologyFlowNode = Node<TopologyNodeData, 'topology'>
export type TopologyFlowEdge = Edge<TopologyEdgeData>

/**
 * Build the React Flow node + edge arrays from a topology and its layout.
 * Pure — no React, no DOM — so it is fully unit-testable. `selectedId` is the
 * id of the selected component OR connection; it is stamped onto node data
 * and edge classes so the canvas can style the selection.
 */
export function toFlowElements(
  topology: SystemTopology,
  layout: TopologyLayout,
  selectedId: string | null,
): { nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] } {
  const positionById = new Map(layout.nodes.map((n) => [n.id, n]))

  const nodes: TopologyFlowNode[] = topology.components.map((component) => {
    const pos = positionById.get(component.id)
    return {
      id: component.id,
      type: 'topology',
      position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
      data: { component, selected: selectedId === component.id },
    }
  })

  const edges: TopologyFlowEdge[] = topology.connections.map((connection) => {
    const isSelected = selectedId === connection.id
    return {
      id: connection.id,
      source: connection.fromComponentId,
      target: connection.toComponentId,
      type: 'smoothstep',
      data: { connection },
      // connection_kind drives colour; class keeps the palette in topology.css
      // (spec D4). `is-selected` thickens/highlights the chosen edge.
      className: `topo-edge topo-edge--${connection.connectionKind}${
        isSelected ? ' is-selected' : ''
      }`,
      markerEnd:
        connection.direction === 'unidirectional'
          ? { type: MarkerType.ArrowClosed }
          : undefined,
    }
  })

  return { nodes, edges }
}
