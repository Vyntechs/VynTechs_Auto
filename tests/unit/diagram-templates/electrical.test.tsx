import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import Electrical, { ELECTRICAL_SLOTS } from '@/components/diagram-kit/templates/electrical'
import type {
  ResolvedScene,
  StepShape,
  PartSlotFill,
  SlotName,
  SlotFill,
} from '@/lib/diagnostics/diagram/slot-interface'

const part = (over: Partial<PartSlotFill> & Pick<PartSlotFill, 'partId' | 'kind'>): PartSlotFill => ({
  fillKind: 'part',
  name: over.partId,
  roleSpecial: null,
  tier: 'anchor',
  provenance: 'drafted',
  terminals: [],
  active: false,
  selected: false,
  ...over,
})

function sceneFor(shape: StepShape): ResolvedScene {
  const slots = {
    source: part({ partId: 'c-pcm', kind: 'module', roleSpecial: 'power-source', name: 'PCM', tier: 'anchor' }),
    'device-under-test': part({ partId: 'c-frp', kind: 'sensor', name: 'FRP Sensor', tier: 'focus', active: true, selected: true }),
    ground: part({ partId: 'c-gnd', kind: 'splice', roleSpecial: 'ground', name: 'G104', tier: 'anchor' }),
    'downstream-anchor': part({ partId: 'c-load', kind: 'module', name: 'Load', tier: 'recede' }),
    overlay: { fillKind: 'overlay', overlay: { kind: 'probe-lead', attachPartId: 'c-frp', attachTerminalId: 'p-sig' } },
  } as Partial<Record<SlotName, SlotFill>>
  return {
    shape,
    slots: { ...emptySlots(), ...slots } as ResolvedScene['slots'],
    activeWireIds: ['w-sig'],
    overlay: { kind: 'probe-lead', attachPartId: 'c-frp', attachTerminalId: 'p-sig' },
    gaugeSpec: null,
    forkRoute: null,
    focus: { selectedPartId: 'c-frp' },
    pinsAllowed: true,
    verdict: 'neutral',
    elements: [],
  }
}

function emptySlots(): Record<SlotName, SlotFill> {
  return {
    source: null, 'device-under-test': null, ground: null, 'downstream-anchor': null,
    overlay: null, gauge: null, 'good-vs-bad': null, route: null, location: null,
    detail: null, 'quiet-field': null,
  }
}

describe('electrical template', () => {
  it('declares exactly the spec §5 electrical slots, the SINGLE overlay attachment region, and the detail prose slot', () => {
    const keys = Object.keys(ELECTRICAL_SLOTS).sort()
    expect(keys).toEqual(
      ['detail', 'device-under-test', 'downstream-anchor', 'ground', 'overlay', 'source'].sort(),
    )
  })

  it('places source above, device-under-test centered, ground below (tiered geometry)', () => {
    const src = ELECTRICAL_SLOTS.source!
    const dut = ELECTRICAL_SLOTS['device-under-test']!
    const gnd = ELECTRICAL_SLOTS.ground!
    expect(src.y).toBeLessThan(dut.y)
    expect(dut.y).toBeLessThan(gnd.y)
    expect(dut.tier).toBe('focus')
    expect(src.tier).toBe('anchor')
  })

  it('renders a stable root class + data-shape seam and exactly one overlay region', () => {
    const { container } = render(<Electrical scene={sceneFor('electrical-probe')} />)
    const root = container.querySelector('.diagram-template.tpl-electrical') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.dataset.shape).toBe('electrical-probe')
    expect(container.querySelectorAll('[data-slot="overlay"]').length).toBe(1)
  })

  it('reads the overlay kind from the frozen OverlaySpec (canonical spelling)', () => {
    const { container } = render(<Electrical scene={sceneFor('voltage-drop')} />)
    const ov = container.querySelector('[data-slot="overlay"]') as HTMLElement
    expect(ov.dataset.overlay).toBe('probe-lead')
  })

  it('serves duty-pwm and voltage-drop and continuity-ground with the SAME geometry (no new template)', () => {
    for (const shape of ['duty-pwm', 'voltage-drop', 'continuity-ground'] as StepShape[]) {
      const { container } = render(<Electrical scene={sceneFor(shape)} />)
      const root = container.querySelector('.diagram-template.tpl-electrical') as HTMLElement
      expect(root.dataset.shape).toBe(shape)
      const dut = container.querySelector('[data-slot="device-under-test"]') as HTMLElement
      expect(dut.style.top).toBe(`${ELECTRICAL_SLOTS['device-under-test']!.y}px`)
    }
  })

  it('threads onInspect down to each part slot (R8 tap-to-inspect fires with the partId)', () => {
    const onInspect = vi.fn()
    const { container } = render(<Electrical scene={sceneFor('electrical-probe')} onInspect={onInspect} />)
    const dut = container.querySelector('[data-inspect-part-id="c-frp"]') as HTMLElement
    fireEvent.click(dut)
    expect(onInspect).toHaveBeenCalledWith('c-frp')
  })

  it('reflects selectedPartId on the matching part slot', () => {
    const scene = sceneFor('electrical-probe')
    scene.slots['device-under-test'] = part({ partId: 'c-frp', kind: 'sensor', tier: 'focus', selected: false })
    const { container } = render(<Electrical scene={scene} selectedPartId="c-frp" />)
    const dut = container.querySelector('[data-inspect-part-id="c-frp"]') as HTMLElement
    expect(dut.dataset.selected).toBe('true')
  })

  it('degrades the overlay region when scene.overlay is null (honest, never blank)', () => {
    const scene = sceneFor('electrical-probe')
    scene.overlay = null
    const { container } = render(<Electrical scene={scene} />)
    const ov = container.querySelector('[data-slot="overlay"]') as HTMLElement
    expect(ov.className).toContain('is-degraded')
  })
})
