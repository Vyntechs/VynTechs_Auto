import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  PART_KINDS,
  PART_ROLE_SPECIALS,
  type DiagramPartProps,
} from '@/components/diagram-kit/part-api'
import { resolvePart, isFallbackKey } from '@/components/diagram-kit/registry'

const base: DiagramPartProps = {
  kind: 'pump', roleSpecial: null, name: 'Part',
  tier: 'focus', active: false, selected: false, provenance: 'drafted',
}

describe('kind + role-special symbols', () => {
  it('every PartKind maps to a non-fallback bespoke symbol', () => {
    for (const kind of PART_KINDS) {
      expect(isFallbackKey(kind)).toBe(false)
      const Part = resolvePart(kind)
      const { container } = render(<Part {...base} kind={kind} />)
      const svg = container.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg?.classList.contains('dk-part--stub')).toBe(false)
      expect(svg?.getAttribute('data-kind')).toBe(kind)
    }
  })

  it('every PartRoleSpecial renders its own symbol', () => {
    for (const role of PART_ROLE_SPECIALS) {
      const Part = resolvePart(role)
      const { container } = render(
        <Part {...base} kind="module" roleSpecial={role} />,
      )
      expect(container.querySelector('svg')?.getAttribute('data-role-special'))
        .toBe(role)
    }
  })

  it('provenance changes the drawing, not a badge', () => {
    const Pump = resolvePart('pump')
    const drafted = render(<Pump {...base} provenance="drafted" />)
    const amber = render(<Pump {...base} provenance="needs-field-check" />)
    const verified = render(<Pump {...base} provenance="field-verified" />)
    expect(drafted.container.querySelector('[data-provenance="drafted"]')).not.toBeNull()
    expect(amber.container.querySelector('[data-provenance="needs-field-check"]')).not.toBeNull()
    expect(verified.container.querySelector('.dk-part__tick')).not.toBeNull()
    expect(amber.container.querySelector('.dk-part__tick')).toBeNull()
    // no textual badge — provenance never appears as a literal grade string
    expect(amber.container.textContent).not.toContain('GAP')
    expect(amber.container.textContent).not.toContain('needs-field-check')
  })

  it('tier=recede draws faded but never invisible', () => {
    const Valve = resolvePart('valve')
    const { container } = render(<Valve {...base} kind="valve" tier="recede" />)
    expect(container.querySelector('[data-tier="recede"]')).not.toBeNull()
  })
})
