import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import Fork, { FORK_SLOTS } from '@/components/diagram-kit/templates/fork'
import type {
  ResolvedScene, PartSlotFill, SlotName, SlotFill, RouteSlotFill,
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
function forkScene(route: RouteSlotFill | null): ResolvedScene {
  return {
    shape: 'fork',
    slots: {
      ...emptySlots(),
      'device-under-test': part({ partId: 'c-next', kind: 'valve', name: 'Next Device' }),
      route,
    } as ResolvedScene['slots'],
    activeWireIds: [], overlay: null, gaugeSpec: null,
    forkRoute: route,
    focus: { selectedPartId: 'c-next' }, pinsAllowed: false, verdict: 'branch-fail', elements: [],
  }
}

describe('fork template', () => {
  it('declares EXACTLY one route slot + the one next device + detail — no second branch', () => {
    expect(Object.keys(FORK_SLOTS).sort()).toEqual(['detail', 'device-under-test', 'route'])
  })
  it('renders exactly one route slot, dimmed (cleared run)', () => {
    const route: RouteSlotFill = { fillKind: 'route', routesToTestActionId: 't-next', nextActionText: 'go to FRP test' }
    const { container } = render(<Fork scene={forkScene(route)} />)
    expect(container.querySelectorAll('[data-slot="route"]').length).toBe(1)
    const r = container.querySelector('[data-slot="route"]') as HTMLElement
    expect(r.dataset.tier).toBe('recede')
  })
  it('renders the words-only RouteSlotFill arm (honest thin data)', () => {
    const route: RouteSlotFill = { fillKind: 'route', routesToTestActionId: null, nextActionText: 'next: inspect the harness toward the PCM' }
    const { container } = render(<Fork scene={forkScene(route)} />)
    const r = container.querySelector('[data-slot="route"]') as HTMLElement
    expect(r.textContent).toContain('next: inspect the harness')
  })
  it('degrades the route slot when forkRoute is null (no branch authored)', () => {
    const { container } = render(<Fork scene={forkScene(null)} />)
    const r = container.querySelector('[data-slot="route"]') as HTMLElement
    expect(r.className).toContain('is-degraded')
  })
  it('threads onInspect (R8)', () => {
    const onInspect = vi.fn()
    const route: RouteSlotFill = { fillKind: 'route', routesToTestActionId: 't-next', nextActionText: 'go' }
    const { container } = render(<Fork scene={forkScene(route)} onInspect={onInspect} />)
    fireEvent.click(container.querySelector('[data-inspect-part-id="c-next"]') as HTMLElement)
    expect(onInspect).toHaveBeenCalledWith('c-next')
  })
})
