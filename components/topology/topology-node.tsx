'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { TopologyFlowNode } from './topology-flow'

/**
 * React Flow custom node — the bone faceplate. Styled by component `kind`
 * via a `topo-node--<kind>` class (see topology.css). The two Handles exist
 * only so React Flow can route edges; they are visually hidden.
 */
export function TopologyNode({ data }: NodeProps<TopologyFlowNode>) {
  const { component, selected } = data
  return (
    <div
      className={`topo-node topo-node--${component.kind}${
        selected ? ' is-selected' : ''
      }`}
    >
      <Handle type="target" position={Position.Top} className="topo-handle" />
      <div className="topo-node__name">{component.name}</div>
      <div className="topo-node__kind">{component.kind}</div>
      {component.location && (
        <div className="topo-node__loc">{component.location}</div>
      )}
      {component.sourceProvenance === 'GAP' && (
        <div className="topo-node__gap">needs field check</div>
      )}
      <Handle
        type="source"
        position={Position.Bottom}
        className="topo-handle"
      />
    </div>
  )
}
