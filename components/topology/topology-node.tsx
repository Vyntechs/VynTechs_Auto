'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { TopologyFlowNode } from './topology-flow'
import type { TopologyPin } from '@/lib/diagnostics/load-system-topology'
import { useTopologySelection } from './topology-selection-context'

const EDGE_TO_POSITION: Record<TopologyPin['edge'], Position> = {
  top: Position.Top,
  right: Position.Right,
  bottom: Position.Bottom,
  left: Position.Left,
}

/**
 * The bone faceplate. PR-B rendered name + kind + location + GAP marker.
 * PR-C/B adds: pins along the component's edges, each with a React Flow
 * Handle (for edge routing) and a clickable rectangle (for pin selection).
 *
 * The two original top/bottom handles stay for non-pin connections (fluid
 * lines, mechanical linkages route by component, not pin).
 */
export function TopologyNode({ data }: NodeProps<TopologyFlowNode>) {
  const { component, pins, selected, selectedPinId, isFocused, isDimmed } = data
  const { onSelectPin, onSelectComponent } = useTopologySelection()

  const byEdge: Record<TopologyPin['edge'], TopologyPin[]> = {
    top: [],
    right: [],
    bottom: [],
    left: [],
  }
  for (const pin of pins) byEdge[pin.edge].push(pin)
  for (const edgeKey of Object.keys(byEdge) as TopologyPin['edge'][]) {
    byEdge[edgeKey].sort((a, b) => a.displayOrder - b.displayOrder)
  }

  // Component selection happens via React Flow's onNodeClick (set on the
  // parent diagram). Pin clicks call stopPropagation so React Flow's listener
  // never sees them. onSelectComponent stays in context for future direct
  // calls (e.g., a panel "jump to component" affordance).
  void onSelectComponent

  return (
    <div
      className={`topo-node topo-node--${component.kind}${
        selected ? ' is-selected' : ''
      }${isFocused ? ' is-focus' : ''}${isDimmed ? ' is-dim' : ''}`}
      aria-label={`${component.kind} ${component.name}`}
    >
      {/* Legacy top/bottom handles — for non-pin connections */}
      <Handle type="target" position={Position.Top} className="topo-handle" />
      <Handle
        type="source"
        position={Position.Bottom}
        className="topo-handle"
      />

      <div className="topo-node__name">{component.name}</div>
      <div className="topo-node__kind">{component.kind}</div>
      {component.location && (
        <div className="topo-node__loc">{component.location}</div>
      )}
      {component.sourceProvenance === 'GAP' && (
        <div className="topo-node__gap">needs field check</div>
      )}

      {/* Per-pin handles + clickable rectangles */}
      {(Object.entries(byEdge) as [TopologyPin['edge'], TopologyPin[]][]).flatMap(
        ([edge, pinsOnEdge]) =>
          pinsOnEdge.map((pin, index) => {
            const offsetPercent =
              ((index + 1) / (pinsOnEdge.length + 1)) * 100
            const positionStyle = pinPositionStyle(edge, offsetPercent)
            const isSel = selectedPinId === pin.id
            return (
              <div
                key={pin.id}
                style={positionStyle}
                className="topo-pin-wrap"
              >
                <Handle
                  id={pin.id}
                  type="source"
                  position={EDGE_TO_POSITION[edge]}
                  className="topo-pin-handle"
                  isConnectable={false}
                />
                {/* Co-located target handle (same id + position) so wires whose
                    toPinId points at this pin can land — fixes React Flow
                    error #008 "Couldn't create edge" dangling-edge warnings. */}
                <Handle
                  id={pin.id}
                  type="target"
                  position={EDGE_TO_POSITION[edge]}
                  className="topo-pin-handle"
                  isConnectable={false}
                />
                <button
                  type="button"
                  className={`topo-pin${isSel ? ' is-selected' : ''}`}
                  aria-label={`${component.name} ${pin.name} pin`}
                  aria-pressed={isSel}
                  onClick={(e) => {
                    e.stopPropagation()
                    onSelectPin(pin.id)
                  }}
                >
                  <span className="topo-pin__role">{pin.roleAbbreviation}</span>
                  <span className="topo-pin__num">{pin.pinNumber ?? '—'}</span>
                </button>
              </div>
            )
          }),
      )}
    </div>
  )
}

function pinPositionStyle(
  edge: TopologyPin['edge'],
  offsetPercent: number,
): React.CSSProperties {
  switch (edge) {
    case 'top':
      return {
        position: 'absolute',
        top: -10,
        left: `${offsetPercent}%`,
        transform: 'translateX(-50%)',
      }
    case 'right':
      return {
        position: 'absolute',
        right: -10,
        top: `${offsetPercent}%`,
        transform: 'translateY(-50%)',
      }
    case 'bottom':
      return {
        position: 'absolute',
        bottom: -10,
        left: `${offsetPercent}%`,
        transform: 'translateX(-50%)',
      }
    case 'left':
      return {
        position: 'absolute',
        left: -10,
        top: `${offsetPercent}%`,
        transform: 'translateY(-50%)',
      }
  }
}
