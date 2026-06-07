import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import SinglePid, { SINGLE_PID_SLOTS } from '@/components/diagram-kit/templates/single-pid'
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
const gauge: GaugeSpec = { reading: { expect: '180 °F', now: '120 °F', unit: '°F', mode: null, verdict: 'neutral' }, verdict: 'neutral' }
const scene: ResolvedScene = {
  shape: 'single-pid',
  slots: {
    ...emptySlots(),
    'device-under-test': part({ partId: 'c-ect', kind: 'sensor', name: 'ECT' }),
    gauge: { fillKind: 'gauge', gauge },
  } as ResolvedScene['slots'],
  activeWireIds: [], overlay: null, gaugeSpec: gauge, forkRoute: null,
  focus: { selectedPartId: 'c-ect' }, pinsAllowed: false, verdict: 'neutral', elements: [],
}

describe('single-pid template', () => {
  it('is device + gauge + detail only — no source/ground/overlay slots', () => {
    expect(Object.keys(SINGLE_PID_SLOTS).sort()).toEqual(['detail', 'device-under-test', 'gauge'])
  })
  it('renders the centered device + gauge, no pins', () => {
    const { container } = render(<SinglePid scene={scene} />)
    expect(container.querySelector('[data-slot="device-under-test"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="gauge"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="overlay"]')).toBeNull()
    expect((container.querySelector('.diagram-template') as HTMLElement).dataset.shape).toBe('single-pid')
  })
  it('reads the gauge from the frozen GaugeSpec.reading', () => {
    const { container } = render(<SinglePid scene={scene} />)
    expect((container.querySelector('[data-slot="gauge"]') as HTMLElement).textContent).toContain('180 °F')
  })
  it('threads onInspect (R8)', () => {
    const onInspect = vi.fn()
    const { container } = render(<SinglePid scene={scene} onInspect={onInspect} />)
    fireEvent.click(container.querySelector('[data-inspect-part-id="c-ect"]') as HTMLElement)
    expect(onInspect).toHaveBeenCalledWith('c-ect')
  })
})
