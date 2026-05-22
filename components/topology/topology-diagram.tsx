'use client'

import { useMemo, type KeyboardEvent } from 'react'
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

/** Shared by the initial fit and the Controls "Fit View" button. The minZoom
 *  floor keeps the diagram legible on open instead of fitting it tiny. */
const FIT_VIEW_OPTIONS = { padding: 0.2, minZoom: 0.7 }

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
 * the layout is computed, the tech only explores. Selection state is owned by
 * the parent (<TopologyDiagnostic>) and passed down.
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

  // Keyboard selection. React Flow makes nodes focusable but does not select
  // them on Enter/Space. This handler catches the key event bubbling up from a
  // focused node (React Flow stamps the component id onto `data-id`) and
  // selects it; Escape clears the current selection.
  const onCanvasKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      onClearSelection()
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (!(event.target instanceof HTMLElement)) return
    const nodeEl = event.target.closest<HTMLElement>('.react-flow__node')
    if (nodeEl?.dataset.id) {
      event.preventDefault()
      onSelectComponent(nodeEl.dataset.id)
    }
  }

  return (
    <div className="topo__canvas" onKeyDown={onCanvasKeyDown}>
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
        fitViewOptions={FIT_VIEW_OPTIONS}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        colorMode="light"
      >
        <Background />
        <Controls showInteractive={false} fitViewOptions={FIT_VIEW_OPTIONS} />
      </ReactFlow>
    </div>
  )
}
