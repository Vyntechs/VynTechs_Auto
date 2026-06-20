import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { STEP_TEMPLATES, resolveTemplate } from '@/components/diagram-kit/templates/registry'
import { ALL_STEP_SHAPES } from '@/lib/diagnostics/diagram/slot-interface'
import type { StepShape, ResolvedScene, SlotName, SlotFill } from '@/lib/diagnostics/diagram/slot-interface'

function emptySlots(): Record<SlotName, SlotFill> {
  return {
    source: null, 'device-under-test': null, ground: null, 'downstream-anchor': null,
    overlay: null, gauge: null, 'good-vs-bad': null, route: null, location: null,
    detail: null, 'quiet-field': null,
  }
}
function bareScene(shape: StepShape): ResolvedScene {
  return {
    shape, slots: emptySlots(), activeWireIds: [], overlay: null, gaugeSpec: null,
    forkRoute: null, focus: { selectedPartId: '' }, pinsAllowed: false, verdict: 'neutral', elements: [],
  }
}

describe('template registry', () => {
  it('maps EVERY v1 StepShape to a template (no shape unmapped — fail-loud Record)', () => {
    for (const shape of ALL_STEP_SHAPES) {
      expect(STEP_TEMPLATES[shape]).toBeTypeOf('function')
    }
  })

  it('routes duty-pwm + voltage-drop + continuity-ground to the SAME electrical template', () => {
    expect(STEP_TEMPLATES['duty-pwm']).toBe(STEP_TEMPLATES['electrical-probe'])
    expect(STEP_TEMPLATES['voltage-drop']).toBe(STEP_TEMPLATES['electrical-probe'])
    expect(STEP_TEMPLATES['continuity-ground']).toBe(STEP_TEMPLATES['electrical-probe'])
  })

  it('keys ONLY on shape — resolveTemplate(shape) needs no observationMethod', () => {
    const Tpl = resolveTemplate('pressure-flow')
    const { container } = render(<Tpl scene={bareScene('pressure-flow')} />)
    expect((container.querySelector('.diagram-template') as HTMLElement).dataset.shape).toBe('pressure-flow')
  })

  it('returns a generic fallback for an unseen shape — never blank, never throws', () => {
    const Tpl = resolveTemplate('totally-new-shape' as StepShape)
    const { container } = render(<Tpl scene={bareScene('totally-new-shape' as StepShape)} />)
    const root = container.querySelector('.diagram-template.tpl-generic') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.textContent).toMatch(/needs field check/i)
  })

  it('every mapped template renders without throwing on a bare (empty-slots) scene', () => {
    for (const shape of ALL_STEP_SHAPES) {
      const Tpl = resolveTemplate(shape)
      expect(() => render(<Tpl scene={bareScene(shape)} />)).not.toThrow()
    }
  })
})
