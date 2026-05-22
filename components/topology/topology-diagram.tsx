'use client'

import { useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type NodeTypes,
  type NodeMouseHandler,
  type EdgeMouseHandler,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './topology.css'

import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
import { toFlowElements, type TopologyFlowNode } from './topology-flow'
import { TopologyNode } from './topology-node'

const nodeTypes: NodeTypes = { topology: TopologyNode }

type Props = {
  topology: SystemTopology
  layout: TopologyLayout
  selectedId: string | null
  onSelectComponent: (componentId: string) => void
  onSelectConnection: (connectionId: string) => void
  onClearSelection: () => void
}

/**
 * The interactive pan/zoom canvas. Nodes are not draggable or connectable —
 * the layout is computed (Task 2), the tech only explores. Selection state
 * is owned by the parent (<TopologyDiagnostic>) and passed down.
 */
export function TopologyDiagram({
  topology,
  layout,
  selectedId,
  onSelectComponent,
  onSelectConnection,
  onClearSelection,
}: Props) {
  const { nodes, edges } = useMemo(
    () => toFlowElements(topology, layout, selectedId),
    [topology, layout, selectedId],
  )

  const onNodeClick: NodeMouseHandler<TopologyFlowNode> = (_event, node) => {
    onSelectComponent(node.id)
  }
  const onEdgeClick: EdgeMouseHandler = (_event, edge) => {
    onSelectConnection(edge.id)
  }

  return (
    <div className="topo__canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onClearSelection}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        colorMode="light"
      >
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
