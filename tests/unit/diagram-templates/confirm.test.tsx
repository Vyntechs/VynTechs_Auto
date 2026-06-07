import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import Confirm, { CONFIRM_SLOTS } from '@/components/diagram-kit/templates/confirm'
import type {
  ResolvedScene, PartSlotFill, SlotName, SlotFill, DetailSlotFill,
} from '@/lib/diagnostics/diagram/slot-interface'

const part = (over: Partial<PartSlotFill> & Pick<PartSlotFill, 'partId' | 'kind'>): PartSlotFill => ({
  fillKind: 'part', name: over.partId, roleSpecial: null, tier: 'focus',
  provenance: 'drafted', terminals: [], active: true, selected: false, ...over,
})
function emptySlots(): Record<SlotName, SlotFill> {
  return {
    source: null, 'device-under-test': null, ground: null, 'downstream-anchor': null,
    overlay: null, gauge: null, 'good-vs-bad': null, route: null, location: null,
    detail: null, 'quiet-field': null,
  }
}
// 'quiet-field' is null in v1 (T3 fills it null) → honest degrade. 'detail' carries REAL prose.
const detail: DetailSlotFill = {
  fillKind: 'detail', probe: null, why: "P0087 low rail pressure", secondary: null, theori: null,
}
const scene: ResolvedScene = {
  shape: 'confirm',
  slots: {
    ...emptySlots(),
    'device-under-test': part({ partId: 'c-frp', kind: 'sensor', name: 'FRP Sensor' }),
    'quiet-field': null,
    detail,
  } as ResolvedScene['slots'],
  activeWireIds: [], overlay: null, gaugeSpec: null, forkRoute: null,
  focus: { selectedPartId: 'c-frp' }, pinsAllowed: false, verdict: 'neutral', elements: [],
}

describe('confirm template', () => {
  it('has the raised device, a SINGLE quiet-field backdrop, and a detail slot', () => {
    expect(Object.keys(CONFIRM_SLOTS).sort()).toEqual(['detail', 'device-under-test', 'quiet-field'])
  })
  it('renders exactly ONE quiet-field backdrop (not many placed parts), dimmed', () => {
    const { container } = render(<Confirm scene={scene} />)
    expect(container.querySelectorAll('[data-slot="quiet-field"]').length).toBe(1)
    const qf = container.querySelector('[data-slot="quiet-field"]') as HTMLElement
    expect(qf.dataset.tier).toBe('recede')
  })
  it('raises the symptom part above the quiet field (backdrop first in DOM, part paints on top)', () => {
    const { container } = render(<Confirm scene={scene} />)
    const slots = Array.from(container.querySelectorAll('[data-slot]')) as HTMLElement[]
    const qfIdx = slots.findIndex((s) => s.dataset.slot === 'quiet-field')
    const dutIdx = slots.findIndex((s) => s.dataset.slot === 'device-under-test')
    expect(qfIdx).toBeLessThan(dutIdx)
    expect((container.querySelector('[data-slot="device-under-test"]') as HTMLElement).dataset.tier).toBe('focus')
  })
  it('threads the real DetailSlotFill prose (why/see-source) into the detail slot', () => {
    const { container } = render(<Confirm scene={scene} />)
    expect((container.querySelector('[data-slot="detail"]') as HTMLElement).textContent).toContain('P0087 low rail pressure')
  })
  it('honestly degrades quiet-field in v1 (T3 fills it null until richer data exists)', () => {
    const { container } = render(<Confirm scene={scene} />)
    expect((container.querySelector('[data-slot="quiet-field"]') as HTMLElement).className).toContain('is-degraded')
  })
  it('threads onInspect (R8)', () => {
    const onInspect = vi.fn()
    const { container } = render(<Confirm scene={scene} onInspect={onInspect} />)
    fireEvent.click(container.querySelector('[data-inspect-part-id="c-frp"]') as HTMLElement)
    expect(onInspect).toHaveBeenCalledWith('c-frp')
  })
})
