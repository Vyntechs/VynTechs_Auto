import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { Position } from '@xyflow/react'
import { WireEdge } from '@/components/topology/wire-edge'
import type { WireEdgeData } from '@/components/topology/wire-edge'

/** Render WireEdge directly in an SVG — bypasses ReactFlow orchestration
 *  which can't lay out edges under happy-dom (no real layout engine). */
function renderEdge(data: Partial<WireEdgeData>) {
  const props = {
    id: 'e1',
    source: 'a',
    target: 'b',
    sourceX: 0,
    sourceY: 0,
    targetX: 400,
    targetY: 200,
    sourcePosition: Position.Bottom,
    targetPosition: Position.Top,
    data: {
      electricalRole: 'pwm',
      pinId: 'pin-vcv-a',
      wireState: 'pwm-high',
      isActive: false,
      isDim: false,
      ...data,
    } as WireEdgeData,
  }
  return render(
    <svg>
      <WireEdge {...(props as Parameters<typeof WireEdge>[0])} />
    </svg>,
  )
}

describe('WireEdge', () => {
  it('renders the edge path with wire + role + state classes', () => {
    const { container } = renderEdge({})
    const path = container.querySelector('.wire')
    expect(path).not.toBeNull()
    expect(path?.classList.contains('wire--pwm')).toBe(true)
    expect(path?.classList.contains('pwm-high')).toBe(true)
  })

  it('applies is-active when data.isActive', () => {
    const { container } = renderEdge({ isActive: true })
    const path = container.querySelector('.wire')
    expect(path?.classList.contains('is-active')).toBe(true)
  })

  it('applies dim when data.isDim and not active', () => {
    const { container } = renderEdge({ isDim: true })
    const path = container.querySelector('.wire')
    expect(path?.classList.contains('dim')).toBe(true)
  })

  it('falls back to off state when wireState is undefined', () => {
    const { container } = renderEdge({ wireState: undefined })
    const path = container.querySelector('.wire')
    expect(path?.classList.contains('off')).toBe(true)
  })
})
