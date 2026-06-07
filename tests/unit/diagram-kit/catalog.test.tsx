import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { KitCatalog } from '@/components/diagram-kit/catalog'
import { PART_KINDS, PART_ROLE_SPECIALS } from '@/components/diagram-kit/part-api'
import { OVERLAY_KINDS } from '@/components/diagram-kit/overlays/overlay-api'

describe('KitCatalog', () => {
  it('renders every kind, role-special, and overlay with zero throw', () => {
    const { container } = render(<KitCatalog />)
    const cells = container.querySelectorAll('svg, .dk-overlay')
    expect(cells.length).toBeGreaterThanOrEqual(
      PART_KINDS.length + PART_ROLE_SPECIALS.length + OVERLAY_KINDS.length,
    )
  })

  it('renders all three provenance variants (gate column)', () => {
    const { container } = render(<KitCatalog />)
    expect(container.querySelector('[data-provenance="drafted"]')).not.toBeNull()
    expect(container.querySelector('[data-provenance="field-verified"]')).not.toBeNull()
    expect(container.querySelector('[data-provenance="needs-field-check"]')).not.toBeNull()
  })
})
