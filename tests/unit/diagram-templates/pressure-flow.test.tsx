import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import PressureFlow, { PRESSURE_SLOTS } from '@/components/diagram-kit/templates/pressure-flow'
import type {
  ResolvedScene,
  PartSlotFill,
  SlotName,
  SlotFill,
  GaugeSpec,
} from '@/lib/diagnostics/diagram/slot-interface'

const part = (over: Partial<PartSlotFill> & Pick<PartSlotFill, 'partId' | 'kind'>): PartSlotFill => ({
  fillKind: 'part', name: over.partId, roleSpecial: null, tier: 'anchor',
  provenance: 'drafted', terminals: [], active: false, selected: false, ...over,
})

function emptySlots(): Record<SlotName, SlotFill> {
  return {
    source: null, 'device-under-test': null, ground: null, 'downstream-anchor': null,
    overlay: null, gauge: null, 'good-vs-bad': null, route: null, location: null,
    detail: null, 'quiet-field': null,
  }
}

const gauge: GaugeSpec = {
  reading: { expect: '≥ 5000 psi', now: '1200 psi', unit: 'psi', mode: null, verdict: 'out-of-range' },
  verdict: 'out-of-range',
}

const teeOverlay = { kind: 'pressure-gauge-tee', attachPartId: 'c-frp', attachTerminalId: null } as const

const scene: ResolvedScene = {
  shape: 'pressure-flow',
  slots: {
    ...emptySlots(),
    'device-under-test': part({ partId: 'c-frp', kind: 'valve', name: 'FRP', tier: 'focus', active: true, selected: true }),
    'downstream-anchor': part({ partId: 'c-rail', kind: 'mechanical', name: 'Rail', tier: 'recede' }),
    gauge: { fillKind: 'gauge', gauge },
    overlay: { fillKind: 'overlay', overlay: teeOverlay },
  } as ResolvedScene['slots'],
  activeWireIds: [],
  overlay: teeOverlay,
  gaugeSpec: gauge,
  forkRoute: null,
  focus: { selectedPartId: 'c-frp' },
  pinsAllowed: false,
  verdict: 'out-of-range',
  elements: [],
}

describe('pressure-flow template — leak-lock', () => {
  it('has NO electrical source/ground slots (the leak-lock) but DOES carry the gauge-tee overlay', () => {
    // FORBIDDEN on pressure-flow per the frozen SHAPE_SLOT_RULES — no electrical source/ground key.
    expect('source' in PRESSURE_SLOTS).toBe(false)
    expect('ground' in PRESSURE_SLOTS).toBe(false)
    // REQUIRED on pressure-flow — the pressure-gauge-tee mechanical hookup region (NOT a 12V probe).
    expect('overlay' in PRESSURE_SLOTS).toBe(true)
  })

  it('lays out left→right along the fuel path (dut.x < downstream.x)', () => {
    const d = PRESSURE_SLOTS['device-under-test']!
    const a = PRESSURE_SLOTS['downstream-anchor']!
    expect(d.x).toBeLessThan(a.x)
    expect(d.tier).toBe('focus')
  })

  it('renders no source/ground and no GND/12V text — the path + gauge + gauge-tee overlay only', () => {
    const { container } = render(<PressureFlow scene={scene} />)
    expect(container.querySelector('[data-slot="source"]')).toBeNull()
    expect(container.querySelector('[data-slot="ground"]')).toBeNull()
    expect(container.querySelector('[data-slot="gauge"]')).not.toBeNull()
    // overlay is the pressure-gauge-tee mechanical hookup, not an electrical probe pin.
    const ov = container.querySelector('[data-slot="overlay"]') as HTMLElement
    expect(ov).not.toBeNull()
    expect(ov.dataset.overlay).toBe('pressure-gauge-tee')
    expect(container.textContent).not.toMatch(/\b(12V|GND)\b/)
    const root = container.querySelector('.diagram-template.tpl-pressure-flow') as HTMLElement
    expect(root.dataset.shape).toBe('pressure-flow')
  })

  it('reads the gauge reading from the frozen GaugeSpec (gauge.reading.expect/now)', () => {
    const { container } = render(<PressureFlow scene={scene} />)
    const g = container.querySelector('[data-slot="gauge"]') as HTMLElement
    expect(g.textContent).toContain('≥ 5000 psi')
    expect(g.textContent).toContain('1200 psi')
  })

  it('threads onInspect to part slots (R8)', () => {
    const onInspect = vi.fn()
    const { container } = render(<PressureFlow scene={scene} onInspect={onInspect} />)
    fireEvent.click(container.querySelector('[data-inspect-part-id="c-frp"]') as HTMLElement)
    expect(onInspect).toHaveBeenCalledWith('c-frp')
  })

  it('degrades the gauge region honestly when gaugeSpec is null', () => {
    const { container } = render(<PressureFlow scene={{ ...scene, gaugeSpec: null }} />)
    const g = container.querySelector('[data-slot="gauge"]') as HTMLElement
    expect(g.className).toContain('is-degraded')
  })
})
