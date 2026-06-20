import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { CONTACT_SHEET_SCENES } from '@/components/diagram-kit/templates/contact-sheet-fixtures'
import { resolveTemplate } from '@/components/diagram-kit/templates/registry'
import { ALL_STEP_SHAPES, ALL_OVERLAY_KINDS } from '@/lib/diagnostics/diagram/slot-interface'
import type { StepShape } from '@/lib/diagnostics/diagram/slot-interface'

describe('contact-sheet fixtures', () => {
  it('has one renderable scene per v1 StepShape with the focus device above the sheet zone', () => {
    for (const shape of ALL_STEP_SHAPES) {
      const Tpl = resolveTemplate(shape)
      const scene = CONTACT_SHEET_SCENES[shape]
      const { container } = render(<Tpl scene={scene} />)
      expect((container.querySelector('.diagram-template') as HTMLElement).dataset.shape).toBe(shape)
      // active region ceiling: the focused device sits in the top ~58% (above the sheet zone)
      const dut = container.querySelector('[data-slot="device-under-test"]') as HTMLElement | null
      if (dut) expect(parseInt(dut.style.top, 10)).toBeLessThanOrEqual(760 * 0.58)
    }
  })

  it('every electrical fixture uses a canonical OverlayKind spelling', () => {
    for (const shape of Object.keys(CONTACT_SHEET_SCENES) as StepShape[]) {
      const ov = CONTACT_SHEET_SCENES[shape].overlay
      if (ov) expect(ALL_OVERLAY_KINDS).toContain(ov.kind)
    }
  })
})
