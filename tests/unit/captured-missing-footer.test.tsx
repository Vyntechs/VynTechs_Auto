import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CapturedMissingFooter } from '@/components/topology/captured-missing-footer'
import type {
  SystemTopology,
  TopologyComponent,
  TopologyPin,
} from '@/lib/diagnostics/load-system-topology'

const fixturePin = (overrides: Partial<TopologyPin> = {}): TopologyPin => ({
  id: 'p1',
  slug: 'p1',
  name: 'P',
  roleAbbreviation: 'P',
  pinNumber: null,
  edge: 'top',
  displayOrder: 0,
  probeLocation: 'x',
  expectedReading: 'x',
  missingLogic: 'x',
  labelGap: null,
  sourceProvenance: 'TRAINING-CONFIRMED',
  ...overrides,
})

const fixtureComponent = (
  id: string,
  overrides: Partial<TopologyComponent> = {},
): TopologyComponent => ({
  id,
  slug: id,
  name: id.toUpperCase(),
  kind: 'sensor',
  location: 'somewhere',
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
  pins: [],
  ...overrides,
})

const baseTopology = (overrides: Partial<SystemTopology> = {}): SystemTopology => ({
  platform: { slug: 'p', name: 'P' },
  symptom: { slug: 's', description: 'S' },
  system: 'fuel',
  components: [],
  connections: [],
  scenarios: [],
  dataStatus: {
    capturedHeader: 'Captured from theory · enough to diagnose',
    missingHeader: 'Labels not yet captured · make probing faster, not possible',
    closingNote:
      "Each gap above closes one at a time as techs encounter the information in the bay — paste, save, label appears on the diagram. The diagram itself doesn't wait for completion to be useful.",
  },
  lastScenarioSlug: null,
  ...overrides,
})

describe('CapturedMissingFooter', () => {
  it('renders both column headers from dataStatus', () => {
    render(<CapturedMissingFooter topology={baseTopology()} />)
    expect(screen.getByText(/captured from theory/i)).toBeInTheDocument()
    expect(screen.getByText(/labels not yet captured/i)).toBeInTheDocument()
  })

  it('renders the closing italic note from dataStatus', () => {
    render(<CapturedMissingFooter topology={baseTopology()} />)
    expect(
      screen.getByText(/Each gap above closes one at a time/i),
    ).toBeInTheDocument()
  })

  it('derives captured count for components', () => {
    const t = baseTopology({
      components: [fixtureComponent('a'), fixtureComponent('b'), fixtureComponent('c')],
    })
    render(<CapturedMissingFooter topology={t} />)
    expect(screen.getByText(/3 components/i)).toBeInTheDocument()
  })

  it('derives captured count for pins', () => {
    const t = baseTopology({
      components: [
        fixtureComponent('a', {
          pins: [fixturePin({ id: 'p1' }), fixturePin({ id: 'p2' })],
        }),
        fixtureComponent('b', {
          pins: [fixturePin({ id: 'p3' })],
        }),
      ],
    })
    render(<CapturedMissingFooter topology={t} />)
    expect(screen.getByText(/3 pins/i)).toBeInTheDocument()
  })

  it('derives captured count for electrical wires', () => {
    const t = baseTopology({
      connections: [
        {
          id: 'c1',
          fromComponentId: 'a',
          toComponentId: 'b',
          connectionKind: 'electrical-wire',
          direction: 'unidirectional',
          description: null,
          sourceProvenance: 'TRAINING-CONFIRMED',
          electricalRole: 'pwm',
          fromPinId: null,
          toPinId: null,
        },
        {
          id: 'c2',
          fromComponentId: 'a',
          toComponentId: 'b',
          connectionKind: 'fluid-line',
          direction: 'unidirectional',
          description: null,
          sourceProvenance: 'TRAINING-CONFIRMED',
          electricalRole: null,
          fromPinId: null,
          toPinId: null,
        },
      ],
    })
    render(<CapturedMissingFooter topology={t} />)
    // Only the electrical-role connection counts
    expect(screen.getByText(/1 electrical wire/i)).toBeInTheDocument()
  })

  it('derives missing count for pins without pinNumber', () => {
    const t = baseTopology({
      components: [
        fixtureComponent('a', {
          pins: [
            fixturePin({ id: 'p1', pinNumber: null }),
            fixturePin({ id: 'p2', pinNumber: '47' }),
            fixturePin({ id: 'p3', pinNumber: null }),
          ],
        }),
      ],
    })
    render(<CapturedMissingFooter topology={t} />)
    expect(screen.getByText(/2 pin numbers/i)).toBeInTheDocument()
  })

  it('derives missing count for components without location', () => {
    const t = baseTopology({
      components: [
        fixtureComponent('a', { location: null }),
        fixtureComponent('b', { location: 'has a location' }),
        fixtureComponent('c', { location: null }),
      ],
    })
    render(<CapturedMissingFooter topology={t} />)
    expect(screen.getByText(/2 component locations/i)).toBeInTheDocument()
  })

  it('returns null when dataStatus is null (soft-fail)', () => {
    const t = baseTopology({ dataStatus: null })
    const { container } = render(<CapturedMissingFooter topology={t} />)
    expect(container.querySelector('.topo-footer')).toBeNull()
    expect(container.children).toHaveLength(0)
  })
})
