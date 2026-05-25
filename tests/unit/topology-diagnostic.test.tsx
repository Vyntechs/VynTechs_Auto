import '../helpers/react-flow-mock'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopologyDiagnostic } from '@/components/screens/topology-diagnostic'
import type { SystemTopology } from '@/lib/diagnostics/load-system-topology'
import { layoutTopology } from '@/lib/diagnostics/topology-layout'

function component(id: string, name: string) {
  return {
    id, slug: id, name, kind: 'sensor',
    location: 'somewhere', function: 'does a thing', electricalContract: null,
    subtitle: null, role: null, wireSummary: null, body: null,
    probingTactic: null, unknownNote: null,
    sourceProvenance: 'TRAINING-CONFIRMED',
    observableProperties: [], testActions: [], pins: [],
  }
}

const topology: SystemTopology = {
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

describe('TopologyDiagnostic', () => {
  it('renders the vehicle + symptom header and an empty panel', () => {
    render(<TopologyDiagnostic topology={topology} layout={layoutTopology(topology)} vehicleName="2019 Ford F-250" />)
    expect(screen.getByText(/2019 Ford F-250/)).toBeInTheDocument()
    expect(
      screen.getByText('P0087 — Fuel Rail Pressure Too Low'),
    ).toBeInTheDocument()
    expect(screen.getByText(/click any part or line/i)).toBeInTheDocument()
  })

  it('fills the panel with the component when its node is clicked', () => {
    render(<TopologyDiagnostic topology={topology} layout={layoutTopology(topology)} vehicleName="2019 Ford F-250" />)
    fireEvent.click(screen.getByText('FRP Sensor'))
    expect(screen.getByText('does a thing')).toBeInTheDocument()
  })
})
