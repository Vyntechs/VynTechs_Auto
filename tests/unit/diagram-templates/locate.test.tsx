import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import Locate, { LOCATE_SLOTS } from '@/components/diagram-kit/templates/locate'
import type {
  ResolvedScene, PartSlotFill, SlotName, SlotFill, GaugeSpec,
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
// locate SUPPRESSES the gauge: even with a gaugeSpec present in the scene, the template has no
// gauge slot. 'location' is null in v1 (T3 fills it null) → honest degrade.
const gauge: GaugeSpec = { reading: { expect: 'x', now: 'y', unit: null, mode: null, verdict: 'neutral' }, verdict: 'neutral' }
const scene: ResolvedScene = {
  shape: 'locate',
  slots: {
    ...emptySlots(),
    'device-under-test': part({ partId: 'c-def', kind: 'connector', name: 'DEF Conn' }),
    location: null,
  } as ResolvedScene['slots'],
  activeWireIds: [], overlay: null, gaugeSpec: gauge, forkRoute: null,
  focus: { selectedPartId: 'c-def' }, pinsAllowed: false, verdict: 'neutral', elements: [],
}

describe('locate template', () => {
  it('SUPPRESSES the gauge — no gauge slot exists even when gaugeSpec is present', () => {
    expect('gauge' in LOCATE_SLOTS).toBe(false)
  })
  it('marks the part-to-find + its location context slot, renders no gauge', () => {
    const { container } = render(<Locate scene={scene} />)
    expect(container.querySelector('[data-slot="device-under-test"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="location"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="gauge"]')).toBeNull()
  })
  it('honestly degrades location in v1 (T3 fills it null until richer data exists)', () => {
    const { container } = render(<Locate scene={scene} />)
    const loc = container.querySelector('[data-slot="location"]') as HTMLElement
    expect(loc.className).toContain('is-degraded')
  })
  it('threads onInspect (R8)', () => {
    const onInspect = vi.fn()
    const { container } = render(<Locate scene={scene} onInspect={onInspect} />)
    fireEvent.click(container.querySelector('[data-inspect-part-id="c-def"]') as HTMLElement)
    expect(onInspect).toHaveBeenCalledWith('c-def')
  })
})
