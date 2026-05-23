import '../helpers/react-flow-mock'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TopologyDiagnostic } from '@/components/screens/topology-diagnostic'
import type {
  SystemTopology,
  TopologyScenario,
} from '@/lib/diagnostics/load-system-topology'
import { layoutTopology } from '@/lib/diagnostics/topology-layout'

function component(id: string, name: string) {
  return {
    id,
    slug: id,
    name,
    kind: 'sensor',
    location: 'somewhere',
    function: 'does a thing',
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
    pins: [],
  }
}

const baseTopology: SystemTopology = {
  platform: { slug: 'ford-sd', name: 'Ford Super Duty (2017-2022)' },
  symptom: {
    slug: 'p0087-fuel-rail-pressure-too-low',
    description: 'Fuel rail pressure too low',
  },
  system: 'fuel',
  components: [component('a', 'PCM'), component('b', 'FRP Sensor')],
  connections: [],
  scenarios: [],
  dataStatus: null,
  lastScenarioSlug: null,
}

const scn = (overrides: Partial<TopologyScenario>): TopologyScenario => ({
  id: overrides.slug ?? 'x',
  slug: 'x',
  label: 'x',
  sub: 'x',
  kind: 'operation',
  keyPosition: null,
  engineState: null,
  loadLevel: null,
  isDefault: false,
  displayOrder: 0,
  pinStates: {},
  pinReadings: {},
  ...overrides,
})

const eightScenarios: TopologyScenario[] = [
  scn({ slug: 'key-off', label: 'Key off', kind: 'operation', keyPosition: 'off' }),
  scn({
    slug: 'key-on',
    label: 'Key on',
    kind: 'operation',
    keyPosition: 'on',
    engineState: 'off',
  }),
  scn({
    slug: 'idle',
    label: 'Idle',
    sub: 'lift pump steady',
    kind: 'operation',
    keyPosition: 'on',
    engineState: 'running',
    loadLevel: 'idle',
    isDefault: true,
  }),
  scn({
    slug: 'heavy-load',
    label: 'Heavy',
    sub: 'all PWMs pegged',
    kind: 'operation',
    keyPosition: 'on',
    engineState: 'running',
    loadLevel: 'heavy',
  }),
  scn({
    slug: 'fault-high',
    label: 'Pegged high pressure',
    sub: 'something is stuck',
    kind: 'fault',
  }),
]

describe('TopologyDiagnostic', () => {
  it('renders the vehicle + symptom header and an empty panel', () => {
    render(
      <TopologyDiagnostic
        topology={baseTopology}
        layout={layoutTopology(baseTopology)}
        vehicleName="2019 Ford F-250"
        sessionId="s1"
      />,
    )
    expect(screen.getByText(/2019 Ford F-250/)).toBeInTheDocument()
    expect(
      screen.getByText('P0087 — Fuel Rail Pressure Too Low'),
    ).toBeInTheDocument()
    expect(screen.getByText(/click any part or line/i)).toBeInTheDocument()
  })

  it('fills the panel with the component when its node is clicked', () => {
    render(
      <TopologyDiagnostic
        topology={baseTopology}
        layout={layoutTopology(baseTopology)}
        vehicleName="2019 Ford F-250"
        sessionId="s1"
      />,
    )
    fireEvent.click(screen.getByText('FRP Sensor'))
    expect(screen.getByText('does a thing')).toBeInTheDocument()
  })
})

// PR-C/B coverage — scenario state + persistence
describe('TopologyDiagnostic — scenario state (PR-C/B)', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    )
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  const topology: SystemTopology = {
    ...baseTopology,
    scenarios: eightScenarios,
  }

  it('renders the live readout with the active scenario label', () => {
    render(
      <TopologyDiagnostic
        topology={topology}
        layout={layoutTopology(topology)}
        vehicleName="F-250"
        sessionId="s1"
      />,
    )
    expect(screen.getByText(/now showing/i)).toBeInTheDocument()
    // Default scenario is the isDefault one → 'Idle'
    expect(
      screen.getAllByText('Idle').find((el) => el.tagName === 'B'),
    ).toBeDefined()
  })

  it('defaults to lastScenarioSlug when present', () => {
    render(
      <TopologyDiagnostic
        topology={{ ...topology, lastScenarioSlug: 'heavy-load' }}
        layout={layoutTopology(topology)}
        vehicleName="F-250"
        sessionId="s1"
      />,
    )
    expect(
      screen.getAllByText('Heavy').find((el) => el.tagName === 'B'),
    ).toBeDefined()
  })

  it('falls back to isDefault when lastScenarioSlug is null', () => {
    render(
      <TopologyDiagnostic
        topology={topology}
        layout={layoutTopology(topology)}
        vehicleName="F-250"
        sessionId="s1"
      />,
    )
    expect(
      screen.getAllByText('Idle').find((el) => el.tagName === 'B'),
    ).toBeDefined()
  })

  it('fires POST to /api/sessions/:id/scenario when scenario changes', async () => {
    render(
      <TopologyDiagnostic
        topology={topology}
        layout={layoutTopology(topology)}
        vehicleName="F-250"
        sessionId="s1"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^heavy$/i }))
    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        '/api/sessions/s1/scenario',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ slug: 'heavy-load' }),
        }),
      )
    })
  })

  it('updates the live readout when scenario changes', () => {
    render(
      <TopologyDiagnostic
        topology={topology}
        layout={layoutTopology(topology)}
        vehicleName="F-250"
        sessionId="s1"
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^heavy$/i }))
    expect(
      screen.getAllByText('Heavy').find((el) => el.tagName === 'B'),
    ).toBeDefined()
    expect(screen.getByText(/all PWMs pegged/i)).toBeInTheDocument()
  })

  it('applies is-fault on the readout when a fault scenario is active', () => {
    const { container } = render(
      <TopologyDiagnostic
        topology={{ ...topology, lastScenarioSlug: 'fault-high' }}
        layout={layoutTopology(topology)}
        vehicleName="F-250"
        sessionId="s1"
      />,
    )
    expect(container.querySelector('.topo__readout.is-fault')).not.toBeNull()
  })

  it('does NOT render the scenario bar when there are no scenarios', () => {
    const { container } = render(
      <TopologyDiagnostic
        topology={baseTopology}
        layout={layoutTopology(baseTopology)}
        vehicleName="F-250"
        sessionId="s1"
      />,
    )
    expect(container.querySelector('.topo-scenario-bar')).toBeNull()
  })

  it('does NOT POST persistence on initial render', () => {
    render(
      <TopologyDiagnostic
        topology={topology}
        layout={layoutTopology(topology)}
        vehicleName="F-250"
        sessionId="s1"
      />,
    )
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
