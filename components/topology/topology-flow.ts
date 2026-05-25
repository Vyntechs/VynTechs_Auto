import { MarkerType, type Edge, type Node } from '@xyflow/react'
import type {
  SystemTopology,
  TopologyComponent,
  TopologyConnection,
  TopologyPin,
} from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
import type { WireEdgeData } from './wire-edge'

export type TopologyNodeData = {
  component: TopologyComponent
  pins: TopologyPin[]
  selected: boolean
  selectedPinId: string | null
}

export type TopologyEdgeData = {
  connection: TopologyConnection
}

export type TopologyFlowNode = Node<TopologyNodeData, 'topology'>
/** Either a smoothstep edge (fluid/mechanical) or a custom wire edge. */
export type TopologyFlowEdge = Edge<TopologyEdgeData> | Edge<WireEdgeData>

/** The selection state the diagram needs to know about. */
export type TopologySelectionState =
  | { kind: 'empty'; activeScenarioSlug: string | null }
  | { kind: 'component'; id: string; activeScenarioSlug: string | null }
  | { kind: 'connection'; id: string; activeScenarioSlug: string | null }
  | { kind: 'pin'; id: string; activeScenarioSlug: string | null }

/**
 * Build React Flow nodes + edges from topology + layout + selection state.
 * Pure (no React, no DOM). Splits edge types:
 *
 *   - electrical wires (electricalRole != null) → custom 'wire' type carrying
 *     wireState, electricalRole, pinId, isActive, isDim
 *   - everything else (fluid lines, mechanical linkages, etc.) → smoothstep
 *     with the existing topo-edge--<kind> className from PR-B
 */
export function toFlowElements(
  topology: SystemTopology,
  layout: TopologyLayout,
  selection: TopologySelectionState,
): { nodes: TopologyFlowNode[]; edges: TopologyFlowEdge[] } {
  const positionById = new Map(layout.nodes.map((n) => [n.id, n]))

  // Resolve the active scenario to a pin-state map (empty if not found).
  const activeScenario = selection.activeScenarioSlug
    ? topology.scenarios.find((s) => s.slug === selection.activeScenarioSlug)
    : undefined
  const pinStates = activeScenario?.pinStates ?? {}

  const selectedComponentId =
    selection.kind === 'component' ? selection.id : null
  const selectedPinId = selection.kind === 'pin' ? selection.id : null

  const nodes: TopologyFlowNode[] = topology.components.map((component) => {
    const pos = positionById.get(component.id)
    return {
      id: component.id,
      type: 'topology',
      position: { x: pos?.x ?? 0, y: pos?.y ?? 0 },
      data: {
        component,
        pins: component.pins,
        selected: selectedComponentId === component.id,
        selectedPinId,
      },
    }
  })

  const edges: TopologyFlowEdge[] = topology.connections.map((connection) => {
    const isSelectedEdge =
      selection.kind === 'connection' && selection.id === connection.id

    // Non-electrical → smoothstep with the existing palette
    if (connection.electricalRole == null) {
      return {
        id: connection.id,
        source: connection.fromComponentId,
        target: connection.toComponentId,
        type: 'smoothstep',
        data: { connection },
        className: `topo-edge topo-edge--${connection.connectionKind}${
          isSelectedEdge ? ' is-selected' : ''
        }`,
        markerEnd:
          connection.direction === 'unidirectional'
            ? { type: MarkerType.ArrowClosed }
            : undefined,
      } satisfies Edge<TopologyEdgeData>
    }

    // Electrical → custom wire edge with scenario-driven state
    const drivingPinId = connection.fromPinId ?? connection.toPinId
    const wireState = drivingPinId ? pinStates[drivingPinId] : undefined
    const isActive =
      selectedPinId != null &&
      (connection.fromPinId === selectedPinId ||
        connection.toPinId === selectedPinId)
    const isDim = selectedPinId != null && !isActive

    return {
      id: connection.id,
      source: connection.fromComponentId,
      target: connection.toComponentId,
      sourceHandle: connection.fromPinId ?? undefined,
      targetHandle: connection.toPinId ?? undefined,
      type: 'wire',
      data: {
        electricalRole: connection.electricalRole,
        pinId: drivingPinId,
        wireState: wireState ?? 'off',
        isActive,
        isDim,
      },
      markerEnd:
        connection.direction === 'unidirectional'
          ? { type: MarkerType.ArrowClosed }
          : undefined,
    } satisfies Edge<WireEdgeData>
  })

  return { nodes, edges }
}
