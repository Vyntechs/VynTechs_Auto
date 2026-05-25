'use client'

import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react'
import {
  wireClassName,
  type TopologyWireState,
  type ElectricalRole,
} from './wire-state'

export type WireEdgeData = {
  electricalRole: ElectricalRole
  /** The pin whose wire activity drives this edge (fromPinId ?? toPinId). */
  pinId: string | null
  /** Resolved by toFlowElements from the active scenario; undefined → off. */
  wireState?: TopologyWireState
  /** True when this edge is the selected pin's own wire. */
  isActive: boolean
  /** True when a pin is selected and this edge isn't its wire. */
  isDim: boolean
}

/**
 * Custom React Flow edge for wires carrying an electricalRole.
 *
 * Path geometry: smoothstep (same as PR-B's default). The visual differences
 * live entirely in the className — stroke color from --role-<role>, dash
 * pattern + animation cycle from the wire-state class. is-active glows and
 * thickens; dim drops to 25% opacity.
 *
 * Non-electrical connections (fluid lines, mechanical linkages) don't use
 * this edge type — they keep the smoothstep + .topo-edge--<kind> styling from
 * PR-B.
 */
export function WireEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps<Edge<WireEdgeData>>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const className = wireClassName({
    role: data?.electricalRole ?? '12v',
    state: data?.wireState,
    isActive: data?.isActive ?? false,
    isDim: data?.isDim ?? false,
  })

  return <BaseEdge path={path} className={className} markerEnd={markerEnd} />
}
