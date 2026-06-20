import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { SlotBox } from '@/components/diagram-kit/templates/slot-box'
import type { SlotPlacement } from '@/components/diagram-kit/templates/template-local-types'
import type {
  SlotFill,
  PartSlotFill,
  DetailSlotFill,
  RouteSlotFill,
} from '@/lib/diagnostics/diagram/slot-interface'

const PLACE: SlotPlacement = { x: 660, y: 380, anchor: 'center', tier: 'focus' }

const partFill = (over: Partial<PartSlotFill> = {}): PartSlotFill => ({
  fillKind: 'part',
  partId: 'c-frp',
  kind: 'sensor',
  name: 'Fuel Rail Pressure Sensor',
  roleSpecial: null,
  tier: 'focus',
  provenance: 'drafted',
  terminals: [],
  active: true,
  selected: false,
  ...over,
})

describe('SlotBox', () => {
  it('positions the box at the placement coords and stamps slot name + tier as data attrs', () => {
    const { container } = render(
      <SlotBox name="device-under-test" placement={PLACE} fill={partFill()} />,
    )
    const box = container.querySelector('.slot-box') as HTMLElement
    expect(box).not.toBeNull()
    expect(box.dataset.slot).toBe('device-under-test')
    expect(box.dataset.tier).toBe('focus')
    expect(box.style.left).toBe('660px')
    expect(box.style.top).toBe('380px')
  })

  it('renders a degraded text box (never blank) when the fill is null', () => {
    const { container } = render(<SlotBox name="route" placement={PLACE} fill={null} />)
    const box = container.querySelector('.slot-box.is-degraded') as HTMLElement
    expect(box).not.toBeNull()
    expect(box.textContent).toMatch(/needs field check/i)
  })

  it('renders a flat PartSlotFill via the C2 registry and stamps data-inspect-part-id', () => {
    const { container } = render(
      <SlotBox name="device-under-test" placement={PLACE} fill={partFill()} />,
    )
    const box = container.querySelector('.slot-box') as HTMLElement
    expect(box.dataset.inspectPartId).toBe('c-frp')
    expect(container.querySelector('.slot-box.is-degraded')).toBeNull()
    // The part name renders through the kit, proving the registry was invoked.
    expect(box.textContent).toContain('Fuel Rail Pressure Sensor')
  })

  it('fires onInspect with the partId when a part box is clicked (R8 tap-to-inspect)', () => {
    const onInspect = vi.fn()
    const { container } = render(
      <SlotBox name="device-under-test" placement={PLACE} fill={partFill()} onInspect={onInspect} />,
    )
    const box = container.querySelector('[data-inspect-part-id="c-frp"]') as HTMLElement
    fireEvent.click(box)
    expect(onInspect).toHaveBeenCalledWith('c-frp')
  })

  it('fires onInspect on Enter/Space keydown (keyboard tap-to-inspect)', () => {
    const onInspect = vi.fn()
    const { container } = render(
      <SlotBox name="device-under-test" placement={PLACE} fill={partFill()} onInspect={onInspect} />,
    )
    const box = container.querySelector('[data-inspect-part-id="c-frp"]') as HTMLElement
    fireEvent.keyDown(box, { key: 'Enter' })
    fireEvent.keyDown(box, { key: ' ' })
    expect(onInspect).toHaveBeenCalledTimes(2)
  })

  it('reflects selection when selectedPartId matches the fill partId', () => {
    const { container } = render(
      <SlotBox
        name="device-under-test"
        placement={PLACE}
        fill={partFill({ selected: false })}
        selectedPartId="c-frp"
      />,
    )
    const box = container.querySelector('[data-inspect-part-id="c-frp"]') as HTMLElement
    expect(box.dataset.selected).toBe('true')
  })

  it('renders a DetailSlotFill prose payload without invoking the part registry', () => {
    const fill: DetailSlotFill = {
      fillKind: 'detail',
      probe: 'back-probe the signal pin',
      why: 'P0087 low rail pressure',
      secondary: 'sig + 5v-ref + low-ref',
      theori: null,
    }
    const { container } = render(<SlotBox name="detail" placement={PLACE} fill={fill} />)
    const box = container.querySelector('.slot-box--detail') as HTMLElement
    expect(box.textContent).toContain('P0087 low rail pressure')
    expect(box.textContent).toContain('back-probe the signal pin')
    expect(container.querySelector('.slot-box.is-degraded')).toBeNull()
  })

  it('degrades a DetailSlotFill with all-null prose to needs-field-check', () => {
    const fill: DetailSlotFill = {
      fillKind: 'detail',
      probe: null,
      why: null,
      secondary: null,
      theori: null,
    }
    const { container } = render(<SlotBox name="detail" placement={PLACE} fill={fill} />)
    expect(container.querySelector('.is-degraded')).not.toBeNull()
  })

  it('renders a RouteSlotFill words-only arm (degraded fork)', () => {
    const fill: RouteSlotFill = {
      fillKind: 'route',
      routesToTestActionId: null,
      nextActionText: 'next: inspect the harness toward the PCM',
    }
    const { container } = render(<SlotBox name="route" placement={PLACE} fill={fill} />)
    const box = container.querySelector('.slot-box') as HTMLElement
    expect(box.textContent).toContain('next: inspect the harness toward the PCM')
  })
})
