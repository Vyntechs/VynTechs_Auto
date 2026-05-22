import '../helpers/react-flow-mock'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopologyDiagram } from '@/components/topology/topology-diagram'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import { layoutTopology } from '@/lib/diagnostics/topology-layout'

function component(id: string, name: string) {
  return {
    id, slug: id, name, kind: 'sensor',
    location: null, function: null, electricalContract: null,
    sourceProvenance: 'TRAINING-CONFIRMED',
    observableProperties: [], testActions: [],
  }
}

const topology: SystemTopology = {
  platform: { slug: 'p', name: 'Platform' },
  symptom: { slug: 's', description: 'symptom' },
  system: 'fuel',
  components: [component('a', 'PCM'), component('b', 'FRP Sensor')],
  connections: [
    {
      id: 'e1', fromComponentId: 'a', toComponentId: 'b',
      connectionKind: 'electrical-wire', direction: 'unidirectional',
      description: null, sourceProvenance: 'TRAINING-CONFIRMED',
    },
  ],
}

describe('TopologyDiagram', () => {
  it('renders a node for every component', () => {
    render(
      <TopologyDiagram
        topology={topology}
        layout={layoutTopology(topology)}
        selectedId={null}
        onSelectComponent={vi.fn()}
        onSelectConnection={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    )
    expect(screen.getByText('PCM')).toBeInTheDocument()
    expect(screen.getByText('FRP Sensor')).toBeInTheDocument()
  })

  it('calls onSelectComponent with the component id when a node is clicked', () => {
    const onSelectComponent = vi.fn()
    render(
      <TopologyDiagram
        topology={topology}
        layout={layoutTopology(topology)}
        selectedId={null}
        onSelectComponent={onSelectComponent}
        onSelectConnection={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('PCM'))
    expect(onSelectComponent).toHaveBeenCalledWith('a')
  })

  it('selects a node when Enter is pressed on it', () => {
    const onSelectComponent = vi.fn()
    render(
      <TopologyDiagram
        topology={topology}
        layout={layoutTopology(topology)}
        selectedId={null}
        onSelectComponent={onSelectComponent}
        onSelectConnection={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    )
    fireEvent.keyDown(screen.getByText('PCM'), { key: 'Enter' })
    expect(onSelectComponent).toHaveBeenCalledWith('a')
  })

  it('clears the selection when Escape is pressed', () => {
    const onClearSelection = vi.fn()
    render(
      <TopologyDiagram
        topology={topology}
        layout={layoutTopology(topology)}
        selectedId={null}
        onSelectComponent={vi.fn()}
        onSelectConnection={vi.fn()}
        onClearSelection={onClearSelection}
      />,
    )
    fireEvent.keyDown(screen.getByText('PCM'), { key: 'Escape' })
    expect(onClearSelection).toHaveBeenCalled()
  })
})
