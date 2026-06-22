import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type {
  SystemTopology,
  TopologyTestAction,
  TopologyScenario,
  TopologyComponent,
} from '@/lib/diagnostics/load-system-topology'
import type { TopologyLayout } from '@/lib/diagnostics/topology-layout'
import { assembleStepView, TopologyDiagnostic } from '@/components/screens/topology-diagnostic'

// The whole-system escape needs a layout; the assembled DEFAULT view does not,
// so an empty real-shaped layout is enough for these unit renders (no casts).
const emptyLayout: TopologyLayout = { nodes: [], width: 0, height: 0 }

// A minimal topology whose only implicated action is a PRESSURE step, placed on
// a component's testActions (where buildStepSequence actually reads it — NOT a
// root testActions field; the plan's sketch had it at the root, which yields
// zero steps. Reconciled to the real C1 shape: component.testActions[]).
//
// The assembled view must come back with a real scene + a template fn, and must
// NOT leak terminals on a pressure step (the leak-class bug we are killing).
function pressureAction(overrides: Partial<TopologyTestAction> = {}): TopologyTestAction {
  return {
    slug: 'rail-pressure-key-on',
    description: 'Rail pressure, key on engine off',
    scenarioRequired: 'key-on-engine-off',
    observationMethod: 'pressure_test_with_gauge',
    expectedObservation: '>= 5000 psi',
    invasiveness: 1,
    implicatedByCurrentSymptom: true,
    meterMode: 'pressure',
    expectedValue: 5000,
    expectedUnit: 'psi',
    expectedTolerance: null,
    stepKind: null,
    confidenceBoost: 0,
    priority: 1,
    branches: [],
    ...overrides,
  }
}

function pumpComponent(actions: TopologyTestAction[]): TopologyComponent {
  return {
    id: 'c-pump',
    slug: 'cp4-pump',
    name: 'CP4 Pump',
    kind: 'pump',
    location: 'engine valley',
    function: null,
    electricalContract: null,
    subtitle: null,
    role: null,
    wireSummary: null,
    body: null,
    probingTactic: null,
    unknownNote: null,
    sourceProvenance: 'drafted',
    observableProperties: [],
    testActions: actions,
    pins: [],
  }
}

function scenario(): TopologyScenario {
  return {
    id: 's-koeo',
    slug: 'key-on-engine-off',
    label: 'Key on, engine off',
    sub: 'pump primed, no crank',
    kind: 'operation',
    keyPosition: 'on',
    engineState: 'off',
    loadLevel: null,
    isDefault: true,
    displayOrder: 0,
    pinStates: {},
    pinReadings: {},
    isOutOfRange: {},
  }
}

function fuelPressureTopology(actions = [pressureAction()]): SystemTopology {
  return {
    platform: { slug: 'ford-super-duty-4th-gen-67-psd', name: '6.7L Power Stroke' },
    symptom: { slug: 'p0087-fuel-rail-pressure-too-low', description: 'Rail pressure too low' },
    system: 'fuel',
    components: [pumpComponent(actions)],
    connections: [],
    scenarios: [scenario()],
    dataStatus: null,
    lastScenarioSlug: null,
  }
}

describe('assembleStepView — the render pipeline', () => {
  it('returns a resolved scene + a template for the current step', () => {
    const topo = fuelPressureTopology()
    const activeScenario: TopologyScenario | null = topo.scenarios[0] ?? null

    const view = assembleStepView(topo, activeScenario)
    expect(view.kind).toBe('scene')
    if (view.kind !== 'scene') return
    expect(view.scene.shape).toBe('pressure-flow')
    expect(typeof view.Template).toBe('function')
    // Leak-lock: a pressure step renders ZERO terminals in the flat element set.
    // R3: the discriminant is `elementKind`, NOT `kind` — `kind` is the PartKind
    // value, so filtering on `kind` always returns [] and passes VACUOUSLY even
    // on a real terminal leak. Must be `elementKind`. (master §2 C3 / R3.)
    expect(view.scene.elements.filter((e) => e.elementKind === 'terminal')).toHaveLength(0)
  })

  it('positive control: an electrical probe step DOES surface terminals (leak-lock not vacuous)', () => {
    // If the accessor were wrong (e.g. filtering `kind`), this would be empty and
    // the pressure leak-lock would pass for the wrong reason. Prove the accessor
    // is real by showing it is non-empty when terminals genuinely exist.
    const electrical = pressureAction({
      slug: 'lift-pump-12v-probe',
      observationMethod: 'electrical_measurement_at_pin',
      meterMode: 'volts',
      expectedUnit: 'V',
      expectedValue: 12,
    })
    const topo: SystemTopology = {
      ...fuelPressureTopology([electrical]),
      components: [
        {
          ...pumpComponent([electrical]),
          pins: [
            {
              id: 'p-12v',
              slug: 'b-plus',
              name: 'B+',
              roleAbbreviation: '12V',
              pinNumber: '1',
              edge: 'top',
              displayOrder: 0,
              probeLocation: 'connector pin 1',
              expectedReading: '12V',
              missingLogic: '',
              labelGap: null,
              sourceProvenance: 'drafted',
            },
          ],
        },
      ],
    }
    const view = assembleStepView(topo, topo.scenarios[0] ?? null)
    expect(view.kind).toBe('scene')
    if (view.kind !== 'scene') return
    // The probe shape is one of the electrical family; terminals are allowed and
    // should appear for a part carrying a pin. (Generality, not exact count.)
    expect(view.scene.shape).not.toBe('pressure-flow')
    const terminalCount = view.scene.elements.filter((e) => e.elementKind === 'terminal').length
    expect(terminalCount).toBeGreaterThan(0)
  })

  it('degrades honestly to a zero-step view when nothing is implicated', () => {
    // No implicated actions: the universal "needs field check" path, not a crash.
    const topo = fuelPressureTopology([
      pressureAction({ implicatedByCurrentSymptom: false }),
    ])
    const view = assembleStepView(topo, null)
    expect(view.kind).toBe('empty')
  })
})

describe('TopologyDiagnostic — assembled screen', () => {
  it('mounts the assembled diagram region + kept chrome, no step-counter, no "AI"', () => {
    const topo = fuelPressureTopology()
    render(
      <TopologyDiagnostic
        topology={topo}
        layout={emptyLayout}
        vehicleName="2017 F-250"
        sessionId="preview"
        symptoms={[]}
        activeSymptomSlug=""
      />,
    )
    // The assembled diagram region is present (stable root class).
    expect(document.querySelector('.topo__assembled')).not.toBeNull()
    // Kept chrome: the whole-system escape control is reachable.
    expect(screen.getByRole('button', { name: /whole system/i })).toBeInTheDocument()
    // Forbidden strings anywhere in the rendered output.
    expect(document.body.textContent ?? '').not.toMatch(/step\s+\d+\s+of\s+\d+/i)
    expect(document.body.textContent ?? '').not.toMatch(/\bAI\b/)
  })

  it('shows the honest zero-step state, not a crash, when nothing is implicated', () => {
    const topo = fuelPressureTopology([
      pressureAction({ implicatedByCurrentSymptom: false }),
    ])
    render(
      <TopologyDiagnostic
        topology={topo}
        layout={emptyLayout}
        vehicleName="2017 F-250"
        sessionId="preview"
        symptoms={[]}
        activeSymptomSlug=""
      />,
    )
    const headline = document.querySelector('.topo__no-plan-title')
    expect(headline).not.toBeNull()
    expect(headline?.textContent ?? '').toMatch(/no test plan captured for this code yet/i)
  })

  it('tapping a scene element opens the detail panel (free selection KEPT)', () => {
    const topo = fuelPressureTopology()
    render(
      <TopologyDiagnostic
        topology={topo}
        layout={emptyLayout}
        vehicleName="2017 F-250"
        sessionId="preview"
        symptoms={[]}
        activeSymptomSlug=""
      />,
    )
    // The template exposes a tappable region per scene element via onInspect;
    // the screen wires it to selection. Tap the first inspectable element whose
    // id is a real component (so the lookup resolves to a panel selection).
    const inspectable = document.querySelector('[data-inspect-part-id="c-pump"]')
    expect(inspectable).not.toBeNull()
    fireEvent.click(inspectable as Element)
    // The panel resolves the tapped component and shows its name — proving the
    // template->screen tap bridge wired the selection, not just that the aside
    // exists (the aside is always mounted).
    const panel = document.querySelector('.topo-panel.is-open')
    expect(panel).not.toBeNull()
    expect(panel?.textContent ?? '').toContain('CP4 Pump')
  })
})

describe('mobile Meter sheet', () => {
  it('mounts MeterSheet when the resolved scene carries a gauge spec', () => {
    const topo = fuelPressureTopology()
    render(
      <TopologyDiagnostic
        topology={topo}
        layout={emptyLayout}
        vehicleName="2017 F-250"
        sessionId="preview"
        symptoms={[]}
        activeSymptomSlug=""
      />,
    )
    // The pressure scene resolves a gauge, so the sheet host must be present.
    // (peek<->expanded tap-to-toggle is owned + tested by T5; T6 only proves
    // the sheet mounts on a gauge scene, and the Meter hero renders inside it.)
    const sheet = document.querySelector('[data-testid="meter-sheet"]')
    expect(sheet).not.toBeNull()
    expect(sheet?.querySelector('.meter-card')).not.toBeNull()
  })
})
