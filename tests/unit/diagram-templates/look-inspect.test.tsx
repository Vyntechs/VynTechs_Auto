import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import LookInspect, { LOOK_SLOTS } from '@/components/diagram-kit/templates/look-inspect'
import type {
  ResolvedScene, PartSlotFill, SlotName, SlotFill,
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
// In v1, T3 ALWAYS fills 'good-vs-bad' with null (no data model carries that prose yet), so the
// template renders the slot STRUCTURALLY → the honest degrade. We test that reality, not prose.
const scene: ResolvedScene = {
  shape: 'look-inspect',
  slots: {
    ...emptySlots(),
    'device-under-test': part({ partId: 'c-conn', kind: 'connector', name: 'C0123' }),
    'good-vs-bad': null,
  } as ResolvedScene['slots'],
  activeWireIds: [], overlay: null, gaugeSpec: null, forkRoute: null,
  focus: { selectedPartId: 'c-conn' }, pinsAllowed: false, verdict: 'neutral', elements: [],
}

describe('look-inspect template', () => {
  it('is device + good-vs-bad + detail only — no gauge/overlay/ground slots', () => {
    expect(Object.keys(LOOK_SLOTS).sort()).toEqual(['detail', 'device-under-test', 'good-vs-bad'])
  })
  it('places good-vs-bad beside the device (same row, to the right)', () => {
    const d = LOOK_SLOTS['device-under-test']!
    const g = LOOK_SLOTS['good-vs-bad']!
    expect(g.x).toBeGreaterThan(d.x)
  })
  it('renders the device + a STRUCTURAL good-vs-bad slot, no pins/gauge', () => {
    const { container } = render(<LookInspect scene={scene} />)
    expect(container.querySelector('[data-slot="device-under-test"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="good-vs-bad"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="gauge"]')).toBeNull()
    expect(container.querySelector('[data-slot="overlay"]')).toBeNull()
  })
  it('honestly degrades good-vs-bad in v1 (T3 fills it null until richer data exists)', () => {
    const { container } = render(<LookInspect scene={scene} />)
    const g = container.querySelector('[data-slot="good-vs-bad"]') as HTMLElement
    expect(g.className).toContain('is-degraded')
    expect(g.textContent).toMatch(/needs field check/i)
  })
  it('threads onInspect (R8)', () => {
    const onInspect = vi.fn()
    const { container } = render(<LookInspect scene={scene} onInspect={onInspect} />)
    fireEvent.click(container.querySelector('[data-inspect-part-id="c-conn"]') as HTMLElement)
    expect(onInspect).toHaveBeenCalledWith('c-conn')
  })
})
