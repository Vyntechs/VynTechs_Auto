import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopologyDetailPanel } from '@/components/topology/topology-detail-panel'
import type {
  TopologyComponent,
  TopologyConnection,
  TopologyPin,
  TopologyScenario,
} from '@/lib/diagnostics/load-system-topology'

const frp: TopologyComponent = {
  id: 'frp',
  slug: 'frp',
  name: 'FRP Sensor',
  kind: 'sensor',
  location: 'Front of DS rail',
  function: 'Reports rail pressure',
  electricalContract: '3-wire analog',
  subtitle: null,
  role: null,
  wireSummary: null,
  body: null,
  probingTactic: null,
  unknownNote: null,
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
  pins: [],
}

const pcm: TopologyComponent = {
  id: 'pcm',
  slug: 'pcm',
  name: 'PCM',
  kind: 'module',
  location: null,
  function: null,
  electricalContract: null,
  subtitle: null,
  role: null,
  wireSummary: null,
  body: null,
  probingTactic: null,
  unknownNote: null,
  sourceProvenance: 'GAP',
  observableProperties: [],
  testActions: [],
  pins: [],
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
      electricalRole: null,
      fromPinId: null,
      toPinId: null,
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

// ---------------------------------------------------------------------------
// Pin fixtures
// ---------------------------------------------------------------------------

const signalPin: TopologyPin = {
  id: 'pin-1',
  slug: 'frp-signal',
  name: 'Signal',
  roleAbbreviation: 'S',
  pinNumber: null,
  edge: 'top',
  displayOrder: 0,
  probeLocation: 'Back-probe the signal pin at FRP connector',
  expectedReading: '0.5–4.5 <b>V</b>',
  missingLogic: '<b>High</b> = circuit open',
  labelGap: 'Wire color not captured',
  sourceProvenance: 'TRAINING-CONFIRMED',
}

const frpWithPin: TopologyComponent = { ...frp, pins: [signalPin] }

const idleScenario: TopologyScenario = {
  id: 'scn-idle',
  slug: 'idle',
  label: 'Idle',
  sub: 'sub',
  kind: 'operation',
  keyPosition: 'on',
  engineState: 'running',
  loadLevel: 'idle',
  isDefault: true,
  displayOrder: 0,
  pinStates: {},
  pinReadings: { 'pin-1': '<b>1.4 V</b> at idle pressure' },
}

const faultScenario: TopologyScenario = {
  ...idleScenario,
  id: 'scn-fault',
  slug: 'fault-high',
  label: 'Pegged high pressure',
  kind: 'fault',
  pinReadings: { 'pin-1': 'Pegged 4.9 V' },
}

// ---------------------------------------------------------------------------
// Pin panel tests (PR-C/B)
// ---------------------------------------------------------------------------

describe('TopologyDetailPanel — pin selection (PR-C/B)', () => {
  it('renders the pin variant with title, where-to-probe, right-now reading, expected, diagnostic, label gap', () => {
    render(
      <TopologyDetailPanel
        selection={{
          kind: 'pin',
          pin: signalPin,
          component: frpWithPin,
          scenario: idleScenario,
        }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByText(/Pin · Signal/)).toBeInTheDocument()
    expect(screen.getByText(/FRP Sensor · Signal/)).toBeInTheDocument()
    expect(screen.getByText(/Back-probe the signal pin/i)).toBeInTheDocument()
    // Right-now reading from scenario.pinReadings (bold "1.4 V")
    expect(screen.getByText(/1\.4 V/i)).toBeInTheDocument()
    // Expected range from pin.expectedReading (bold "V")
    expect(screen.getByText(/0\.5/i)).toBeInTheDocument()
    // Diagnostic if wrong (bold "High")
    expect(screen.getByText(/circuit open/i)).toBeInTheDocument()
    // Label gap
    expect(screen.getByText(/Wire color not captured/i)).toBeInTheDocument()
  })

  it('shows "no live reading captured" placeholder when scenario lacks a pin reading', () => {
    const noReadingScenario: TopologyScenario = { ...idleScenario, pinReadings: {} }
    render(
      <TopologyDetailPanel
        selection={{
          kind: 'pin',
          pin: signalPin,
          component: frpWithPin,
          scenario: noReadingScenario,
        }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(
      screen.getByText(/no live reading captured for this scenario/i),
    ).toBeInTheDocument()
  })

  it('applies is-fault class on the right-now box when scenario is a fault', () => {
    const { container } = render(
      <TopologyDetailPanel
        selection={{
          kind: 'pin',
          pin: signalPin,
          component: frpWithPin,
          scenario: faultScenario,
        }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(
      container.querySelector('.topo-panel__right-now.is-fault'),
    ).not.toBeNull()
  })

  it('renders no scenario label when scenario is null (no-scenarios fallback)', () => {
    const { container } = render(
      <TopologyDetailPanel
        selection={{
          kind: 'pin',
          pin: signalPin,
          component: frpWithPin,
          scenario: null,
        }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(
      container.querySelector('.topo-panel__right-now-label'),
    ).toBeNull()
  })

  it('withBoldOnly renders plain text and <b> spans from mixed markup', () => {
    render(
      <TopologyDetailPanel
        selection={{
          kind: 'pin',
          pin: signalPin,
          component: frpWithPin,
          scenario: idleScenario,
        }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    // pin.expectedReading = '0.5–4.5 <b>V</b>' — "V" should be in a <b> tag
    // pin.missingLogic = '<b>High</b> = circuit open' — "High" should be in a <b> tag
    const bTags = document.querySelectorAll('.topo-panel__expect b, .topo-panel__alarm b')
    const bTexts = Array.from(bTags).map((el) => el.textContent)
    // expectedReading has <b>V</b>, missingLogic has <b>High</b> plus a static "Diagnostic:" <b>
    expect(bTexts).toContain('V')
    expect(bTexts).toContain('High')
  })
})

// ---------------------------------------------------------------------------
// Component pin list tests (PR-C/B)
// ---------------------------------------------------------------------------

describe('TopologyDetailPanel — component pin list (PR-C/B)', () => {
  it('renders a clickable pin list when component has pins and is not PCM/mechanical/splice', () => {
    const onSelectPin = vi.fn()
    render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: frpWithPin }}
        onSelectComponent={vi.fn()}
        onSelectPin={onSelectPin}
        onClose={vi.fn()}
      />,
    )
    const pinListItem = screen.getByRole('button', { name: /signal/i })
    fireEvent.click(pinListItem)
    expect(onSelectPin).toHaveBeenCalledWith('pin-1')
  })

  it('suppresses the pin list for PCM', () => {
    const pcmWithPin: TopologyComponent = {
      ...pcm,
      slug: 'pcm',
      pins: [signalPin],
    }
    const { container } = render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: pcmWithPin }}
        onSelectComponent={vi.fn()}
        onSelectPin={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(container.querySelector('.topo-panel__pin-list')).toBeNull()
  })

  it('suppresses the pin list for mechanical components', () => {
    const mechWithPin: TopologyComponent = {
      ...frp,
      kind: 'mechanical',
      pins: [signalPin],
    }
    const { container } = render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: mechWithPin }}
        onSelectComponent={vi.fn()}
        onSelectPin={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(container.querySelector('.topo-panel__pin-list')).toBeNull()
  })

  it('suppresses the pin list for splice components', () => {
    const spliceWithPin: TopologyComponent = {
      ...frp,
      slug: 'splice-1',
      kind: 'splice',
      pins: [signalPin],
    }
    const { container } = render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: spliceWithPin }}
        onSelectComponent={vi.fn()}
        onSelectPin={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(container.querySelector('.topo-panel__pin-list')).toBeNull()
  })

  it('suppresses the pin list when onSelectPin is not provided', () => {
    const { container } = render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: frpWithPin }}
        onSelectComponent={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(container.querySelector('.topo-panel__pin-list')).toBeNull()
  })

  it('suppresses the pin list when the component has no pins', () => {
    const { container } = render(
      <TopologyDetailPanel
        selection={{ kind: 'component', component: frp }}
        onSelectComponent={vi.fn()}
        onSelectPin={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(container.querySelector('.topo-panel__pin-list')).toBeNull()
  })
})
