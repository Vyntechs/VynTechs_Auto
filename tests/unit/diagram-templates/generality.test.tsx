import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { resolveTemplate } from '@/components/diagram-kit/templates/registry'
import type {
  ResolvedScene, StepShape, SlotName, SlotFill, PartSlotFill, OverlaySpec, GaugeSpec,
} from '@/lib/diagnostics/diagram/slot-interface'

const part = (
  partId: string, kind: PartSlotFill['kind'], roleSpecial: PartSlotFill['roleSpecial'] = null,
): PartSlotFill => ({
  fillKind: 'part', partId, kind, name: partId, roleSpecial, tier: 'anchor',
  provenance: 'drafted', terminals: [], active: false, selected: false,
})

function emptySlots(): Record<SlotName, SlotFill> {
  return {
    source: null, 'device-under-test': null, ground: null, 'downstream-anchor': null,
    overlay: null, gauge: null, 'good-vs-bad': null, route: null, location: null,
    detail: null, 'quiet-field': null,
  }
}

const gauge = (expect: string, now: string): GaugeSpec => ({
  reading: { expect, now, unit: null, mode: null, verdict: 'neutral' }, verdict: 'neutral',
})

/** Build a scene the way T3 would, for an arbitrary system. The template never sees the system. */
function scene(shape: StepShape, slots: Partial<Record<SlotName, SlotFill>>, overlay: OverlaySpec | null, gaugeSpec: GaugeSpec | null): ResolvedScene {
  return {
    shape,
    slots: { ...emptySlots(), ...slots } as ResolvedScene['slots'],
    activeWireIds: [], overlay, gaugeSpec, forkRoute: null,
    focus: { selectedPartId: 'c' }, pinsAllowed: shape !== 'pressure-flow' && overlay != null,
    verdict: 'neutral', elements: [],
  }
}

// Four UNLIKE systems, same vocabulary. The template code is identical for all of them.
const CASES: {
  name: string; shape: StepShape; slots: Partial<Record<SlotName, SlotFill>>; overlay: OverlaySpec | null; gaugeSpec: GaugeSpec | null
}[] = [
  // FUEL — a pressure step (the 6.7L fixture's shape)
  {
    name: 'fuel pressure', shape: 'pressure-flow',
    slots: {
      source: part('c-pump', 'pump'), 'device-under-test': part('c-frp', 'valve'),
      'downstream-anchor': part('c-rail', 'mechanical'),
      gauge: { fillKind: 'gauge', gauge: gauge('≥5000psi', '1200psi') },
    },
    overlay: null, gaugeSpec: gauge('≥5000psi', '1200psi'),
  },
  // PURELY ELECTRICAL — a probe step
  {
    name: 'electrical probe', shape: 'electrical-probe',
    slots: {
      source: part('c-pcm', 'module', 'power-source'), 'device-under-test': part('c-frp', 'sensor'),
      ground: part('c-gnd', 'splice', 'ground'),
      overlay: { fillKind: 'overlay', overlay: { kind: 'probe-lead', attachPartId: 'c-frp', attachTerminalId: 'p-sig' } },
    },
    overlay: { kind: 'probe-lead', attachPartId: 'c-frp', attachTerminalId: 'p-sig' }, gaugeSpec: null,
  },
  // DEF (non-fuel fluid) — a single PID reading on the DEF quality sensor
  {
    name: 'DEF pid', shape: 'single-pid',
    slots: {
      'device-under-test': part('c-def', 'sensor'),
      gauge: { fillKind: 'gauge', gauge: gauge('32%', '0%') },
    },
    overlay: null, gaugeSpec: gauge('32%', '0%'),
  },
  // CHARGING (non-fuel) — a voltage-drop check (degrades onto electrical.tsx, canonical spelling)
  {
    name: 'charging voltage-drop', shape: 'voltage-drop',
    slots: {
      source: part('c-alt', 'module', 'power-source'), 'device-under-test': part('c-bat', 'module'),
      ground: part('c-gnd', 'splice', 'ground'),
      overlay: { fillKind: 'overlay', overlay: { kind: 'voltage-drop-bracket', attachPartId: 'c-bat', attachTerminalId: 'b+' } },
    },
    overlay: { kind: 'voltage-drop-bracket', attachPartId: 'c-bat', attachTerminalId: 'b+' }, gaugeSpec: null,
  },
]

const ELECTRICAL_SHAPES = new Set<StepShape>(['electrical-probe', 'continuity-ground', 'voltage-drop', 'duty-pwm'])

describe('generality across unlike systems (the scalability bar)', () => {
  for (const c of CASES) {
    it(`${c.name}: renders clean with the same templates, zero per-system code`, () => {
      const Tpl = resolveTemplate(c.shape)
      const { container } = render(<Tpl scene={scene(c.shape, c.slots, c.overlay, c.gaugeSpec)} />)
      expect((container.querySelector('.diagram-template') as HTMLElement).dataset.shape).toBe(c.shape)
      expect(container.querySelector('[data-slot="device-under-test"]')).not.toBeNull()
    })

    it(`${c.name}: leak-lock — terminals/overlay appear ONLY on electrical shapes`, () => {
      const Tpl = resolveTemplate(c.shape)
      const { container } = render(<Tpl scene={scene(c.shape, c.slots, c.overlay, c.gaugeSpec)} />)
      const hasOverlay = container.querySelector('[data-slot="overlay"]') != null
      const hasGround = container.querySelector('[data-slot="ground"]') != null
      if (ELECTRICAL_SHAPES.has(c.shape)) {
        expect(hasOverlay).toBe(true)
      } else {
        // non-electrical: NO 12V/GND, NO terminal overlay — structurally impossible
        expect(hasOverlay).toBe(false)
        expect(hasGround).toBe(false)
        expect(container.textContent).not.toMatch(/\b(12V|GND)\b/)
      }
    })
  }

  it('partial data degrades honestly on every shape (empty slots => no crash)', () => {
    for (const c of CASES) {
      const Tpl = resolveTemplate(c.shape)
      const { container } = render(<Tpl scene={scene(c.shape, {}, null, null)} />)
      expect(container.querySelector('.diagram-template')).not.toBeNull()
    }
  })
})
