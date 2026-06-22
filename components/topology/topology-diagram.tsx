'use client'

import { useMemo, type KeyboardEvent } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  type NodeTypes,
  type NodeMouseHandler,
  type EdgeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './topology.css'

import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
import {
  toFlowElements,
  type TopologyFlowNode,
  type TopologySelectionState,
} from './topology-flow'
import { TopologyNode } from './topology-node'
import { WireEdge } from './wire-edge'
import { TopologySelectionProvider } from './topology-selection-context'

const nodeTypes: NodeTypes = { topology: TopologyNode }
const edgeTypes: EdgeTypes = { wire: WireEdge }

/** Shared by the initial fit and the Controls "Fit View" button. The minZoom
 *  floor keeps the diagram legible on open instead of fitting it tiny. */
const FIT_VIEW_OPTIONS = { padding: 0.2, minZoom: 0.7 }

type Props = {
  topology: SystemTopology
  layout: TopologyLayout
  selection: TopologySelectionState
  onSelectComponent: (componentId: string) => void
  onSelectPin: (pinId: string) => void
  onClearSelection: () => void
  /** When set, that part lights up and the rest dim (focused-slice mode).
   *  Undefined → whole-system mode, unchanged behavior. */
  focusedComponentId?: string
}

/**
 * The interactive pan/zoom canvas. Nodes are not draggable or connectable —
 * the layout is computed, the tech only explores. Selection state is owned by
 * the parent (<TopologyDiagnostic>) and passed down. The custom node consumes
 * pin / component click handlers via TopologySelectionContext.
 */
export function TopologyDiagram({
  topology,
  layout,
  selection,
  onSelectComponent,
  onSelectPin,
  onClearSelection,
  focusedComponentId,
}: Props) {
  const { nodes, edges } = useMemo(
    () => toFlowElements(topology, layout, selection, focusedComponentId),
    [topology, layout, selection, focusedComponentId],
  )

  // Component clicks come through React Flow's onNodeClick (delegated at the
  // React Flow root). Pin button clicks stopPropagation so React Flow's
  // listener doesn't see them.
  const onNodeClick: NodeMouseHandler<TopologyFlowNode> = (_event, node) => {
    onSelectComponent(node.id)
  }

  // Keyboard selection. React Flow makes nodes focusable but does not select
  // them on Enter/Space — handle the bubble from a focused node. Pin buttons
  // are native <button>s, so they get Enter/Space natively.
  const onCanvasKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      onClearSelection()
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (!(event.target instanceof HTMLElement)) return
    // Don't double-fire if the focus is on a pin button (which already
    // handles Enter/Space natively as a click).
    if (event.target.closest('.topo-pin')) return
    const nodeEl = event.target.closest<HTMLElement>('.react-flow__node')
    if (nodeEl?.dataset.id) {
      event.preventDefault()
      onSelectComponent(nodeEl.dataset.id)
    }
  }

  return (
    <TopologySelectionProvider
      value={{
        onSelectPin,
        onSelectComponent,
        onClear: onClearSelection,
      }}
    >
      <div className="topo__canvas" onKeyDown={onCanvasKeyDown}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={false}
          nodesConnectable={false}
          edgesFocusable
          onNodeClick={onNodeClick}
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
    </TopologySelectionProvider>
  )
}
