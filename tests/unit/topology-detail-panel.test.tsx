import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopologyDetailPanel } from '@/components/topology/topology-detail-panel'
import type {
  TopologyComponent,
  TopologyConnection,
} from '@/lib/diagnostics/load-system-topology'

const frp: TopologyComponent = {
  id: 'frp',
  slug: 'frp',
  name: 'FRP Sensor',
  kind: 'sensor',
  location: 'Front of DS rail',
  function: 'Reports rail pressure',
  electricalContract: '3-wire analog',
  sourceProvenance: 'TRAINING-CONFIRMED',
  observableProperties: [
    { slug: 'op1', description: 'Back-probe the signal pin', observationMethod: 'electrical_measurement_at_pin' },
  ],
  testActions: [
    {
      slug: 'ta-not',
      description: 'Check FRP at idle',
      scenarioRequired: 'idle',
      observationMethod: 'scan_tool_pid',
      expectedObservation: 'Idle pressure',
      invasiveness: 1,
      implicatedByCurrentSymptom: false,
      branches: [],
    },
    {
      slug: 'ta-imp',
      description: 'Check FRP at key-on',
      scenarioRequired: 'key-on',
      observationMethod: 'scan_tool_pid',
      expectedObservation: '26,000-28,000 PSI',
      invasiveness: 1,
      implicatedByCurrentSymptom: true,
      branches: [{ condition: 'Below range', verdict: 'fail', nextAction: 'Suspect supply' }],
    },
  ],
}

const pcm: TopologyComponent = {
  id: 'pcm',
  slug: 'pcm',
  name: 'PCM',
  kind: 'module',
  location: null,
  function: null,
  electricalContract: null,
  sourceProvenance: 'GAP',
  observableProperties: [],
  testActions: [],
}

describe('TopologyDetailPanel', () => {
  it('shows the empty-state prompt when nothing is selected', () => {
    render(
      <TopologyDetailPanel
        selection={{ kind: 'empty' }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/click any part or line/i)).toBeInTheDocument()
  })

  it('shows no close button in the empty state', () => {
    render(
      <TopologyDetailPanel
        selection={{ kind: 'empty' }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
  })

  it('renders a component name, location, and function', () => {
    render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: frp }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('FRP Sensor')).toBeInTheDocument()
    expect(screen.getByText('Front of DS rail')).toBeInTheDocument()
    expect(screen.getByText('Reports rail pressure')).toBeInTheDocument()
  })

  it('soft-fails missing fields to an em dash, never crashes', () => {
    render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: pcm }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('PCM')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3)
  })

  it('orders symptom-implicated test actions before the rest', () => {
    render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: frp }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const tests = screen.getAllByTestId('topo-test')
    expect(tests[0]).toHaveTextContent('Check FRP at key-on')
    expect(tests[1]).toHaveTextContent('Check FRP at idle')
  })

  it('renders a GAP provenance marker as "needs field verification"', () => {
    render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: pcm }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/needs field verification/i)).toBeInTheDocument()
  })

  it('renders a connection: description, kind, direction, and both endpoints', () => {
    const connection: TopologyConnection = {
      id: 'c1',
      fromComponentId: 'pcm',
      toComponentId: 'frp',
      connectionKind: 'electrical-wire',
      direction: 'bidirectional',
      description: 'PCM reads the FRP signal',
      sourceProvenance: 'TRAINING-CONFIRMED',
    }
    const onSelect = vi.fn()
    render(
      <TopologyDetailPanel
        selection={{ kind: 'connection', connection, fromComponent: pcm, toComponent: frp }}
        onSelectComponent={onSelect}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText('PCM reads the FRP signal')).toBeInTheDocument()
    expect(screen.getByText('Electrical wire')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /FRP Sensor/i }))
    expect(onSelect).toHaveBeenCalledWith('frp')
  })

  it('shows a close button that calls onClose when a part is selected', () => {
    const onClose = vi.fn()
    render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: frp }}
        onSelectComponent={vi.fn()}
        onClose={onClose}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('never says the word "AI" anywhere in the panel', () => {
    const { container } = render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: frp }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(container.textContent ?? '').not.toMatch(/\bAI\b/)
  })
})
