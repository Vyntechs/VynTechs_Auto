import '../helpers/react-flow-mock'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopologyDiagram } from '@/components/topology/topology-diagram'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import type { TopologySelectionState } from '@/components/topology/topology-flow'
import { layoutTopology } from '@/lib/diagnostics/topology-layout'

function component(
  id: string,
  name: string,
  pins: SystemTopology['components'][number]['pins'] = [],
) {
  return {
    id,
    slug: id,
    name,
    kind: 'sensor',
    location: null,
    function: null,
    electricalContract: null,
    subtitle: null,
    role: null,
    wireSummary: null,
    body: null,
    probingTactic: null,
    unknownNote: null,
    sourceProvenance: 'TRAINING-CONFIRMED',
    observableProperties: [],
    testActions: [],
    pins,
  }
}

const topology: SystemTopology = {
  platform: { slug: 'p', name: 'Platform' },
  symptom: { slug: 's', description: 'symptom' },
  system: 'fuel',
  components: [component('a', 'PCM'), component('b', 'FRP Sensor')],
  connections: [
    {
      id: 'e1',
      fromComponentId: 'a',
      toComponentId: 'b',
      connectionKind: 'electrical-wire',
      direction: 'unidirectional',
      description: null,
      sourceProvenance: 'TRAINING-CONFIRMED',
      electricalRole: null,
      fromPinId: null,
      toPinId: null,
    },
  ],
  scenarios: [],
  dataStatus: null,
  lastScenarioSlug: null,
}

const emptySelection: TopologySelectionState = {
  kind: 'empty',
  activeScenarioSlug: null,
}

describe('TopologyDiagram', () => {
  it('renders a node for every component', () => {
    render(
      <TopologyDiagram
        topology={topology}
        layout={layoutTopology(topology)}
        selection={emptySelection}
        onSelectComponent={vi.fn()}
        onSelectPin={vi.fn()}
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
        selection={emptySelection}
        onSelectComponent={onSelectComponent}
        onSelectPin={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    )
    // Click bubbles to React Flow's onNodeClick which calls onSelectComponent.
    fireEvent.click(screen.getByText('PCM'))
    expect(onSelectComponent).toHaveBeenCalledWith('a')
  })

  it('selects a node when Enter is pressed on it', () => {
    const onSelectComponent = vi.fn()
    render(
      <TopologyDiagram
        topology={topology}
        layout={layoutTopology(topology)}
        selection={emptySelection}
        onSelectComponent={onSelectComponent}
        onSelectPin={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    )
    fireEvent.keyDown(screen.getByText('PCM'), { key: 'Enter' })
    expect(onSelectComponent).toHaveBeenCalledWith('a')
  })

  it('selects a node when Space is pressed on it', () => {
    const onSelectComponent = vi.fn()
    render(
      <TopologyDiagram
        topology={topology}
        layout={layoutTopology(topology)}
        selection={emptySelection}
        onSelectComponent={onSelectComponent}
        onSelectPin={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    )
    fireEvent.keyDown(screen.getByText('PCM'), { key: ' ' })
    expect(onSelectComponent).toHaveBeenCalledWith('a')
  })

  it('clears the selection when Escape is pressed', () => {
    const onClearSelection = vi.fn()
    render(
      <TopologyDiagram
        topology={topology}
        layout={layoutTopology(topology)}
        selection={emptySelection}
        onSelectComponent={vi.fn()}
        onSelectPin={vi.fn()}
        onClearSelection={onClearSelection}
      />,
    )
    fireEvent.keyDown(screen.getByText('PCM'), { key: 'Escape' })
    expect(onClearSelection).toHaveBeenCalled()
  })
})

// PR-C/B coverage — per-pin clickable rectangles
const topologyWithPins: SystemTopology = {
  ...topology,
  components: [
    component('a', 'PCM'),
    component('b', 'FRP Sensor', [
      {
        id: 'pin-signal',
        slug: 'frp-signal',
        name: 'Signal',
        roleAbbreviation: 'S',
        pinNumber: null,
        edge: 'top',
        displayOrder: 0,
        probeLocation: 'x',
        expectedReading: 'x',
        missingLogic: 'x',
        labelGap: null,
        sourceProvenance: 'TRAINING-CONFIRMED',
      },
    ]),
  ],
}

describe('TopologyDiagram — pin rendering (PR-C/B)', () => {
  it('renders a clickable button for each component pin', () => {
    const { container } = render(
      <TopologyDiagram
        topology={topologyWithPins}
        layout={layoutTopology(topologyWithPins)}
        selection={emptySelection}
        onSelectComponent={vi.fn()}
        onSelectPin={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    )
    const pinButton = container.querySelector(
      'button[aria-label*="Signal pin"]',
    )
    expect(pinButton).not.toBeNull()
  })

  it('calls onSelectPin (not onSelectComponent) when a pin is clicked', () => {
    const onSelectPin = vi.fn()
    const onSelectComponent = vi.fn()
    const { container } = render(
      <TopologyDiagram
        topology={topologyWithPins}
        layout={layoutTopology(topologyWithPins)}
        selection={emptySelection}
        onSelectComponent={onSelectComponent}
        onSelectPin={onSelectPin}
        onClearSelection={vi.fn()}
      />,
    )
    const pinButton = container.querySelector(
      'button[aria-label*="Signal pin"]',
    ) as HTMLButtonElement
    expect(pinButton).not.toBeNull()
    fireEvent.click(pinButton)
    expect(onSelectPin).toHaveBeenCalledWith('pin-signal')
    expect(onSelectComponent).not.toHaveBeenCalled()
  })

  it('shows pin number — when not captured (em-dash fallback)', () => {
    const { container } = render(
      <TopologyDiagram
        topology={topologyWithPins}
        layout={layoutTopology(topologyWithPins)}
        selection={emptySelection}
        onSelectComponent={vi.fn()}
        onSelectPin={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    )
    const pinButton = container.querySelector(
      'button[aria-label*="Signal pin"]',
    )
    expect(pinButton?.textContent).toContain('—')
  })

  it('marks the selected pin button with is-selected + aria-pressed', () => {
    const selection: TopologySelectionState = {
      kind: 'pin',
      id: 'pin-signal',
      activeScenarioSlug: null,
    }
    const { container } = render(
      <TopologyDiagram
        topology={topologyWithPins}
        layout={layoutTopology(topologyWithPins)}
        selection={selection}
        onSelectComponent={vi.fn()}
        onSelectPin={vi.fn()}
        onClearSelection={vi.fn()}
      />,
    )
    const pinButton = container.querySelector(
      'button[aria-label*="Signal pin"]',
    )
    expect(pinButton?.classList.contains('is-selected')).toBe(true)
    expect(pinButton?.getAttribute('aria-pressed')).toBe('true')
  })
})
