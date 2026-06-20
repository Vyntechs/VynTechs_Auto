import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  PART_KINDS,
  PART_ROLE_SPECIALS,
  type DiagramPartProps,
} from '@/components/diagram-kit/part-api'
import { resolvePart, isFallbackKey } from '@/components/diagram-kit/registry'

const baseProps: DiagramPartProps = {
  kind: 'pump',
  roleSpecial: null,
  name: 'Test Part',
  tier: 'focus',
  active: false,
  selected: false,
  provenance: 'drafted',
}

describe('part registry', () => {
  it('resolves a component for every PartKind', () => {
    for (const kind of PART_KINDS) {
      expect(typeof resolvePart(kind)).toBe('function')
    }
  })

  it('resolves a component for every PartRoleSpecial', () => {
    for (const role of PART_ROLE_SPECIALS) {
      expect(typeof resolvePart(role)).toBe('function')
    }
  })

  it('resolves the generic fallback for an unseen key (never undefined)', () => {
    const Part = resolvePart('xenon-injector' as never)
    expect(typeof Part).toBe('function')
    expect(isFallbackKey('xenon-injector' as never)).toBe(true)
    expect(isFallbackKey('pump')).toBe(false)
  })

  it('the fallback renders a recognizable symbol, not a blank', () => {
    const Part = resolvePart('totally-new-thing' as never)
    const { container } = render(<Part {...baseProps} kind="totally-new-thing" />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.textContent).toContain('Test Part')
  })

  it('a resolved part renders an svg reflecting tier/active/selected', () => {
    const Part = resolvePart('sensor')
    const { container } = render(
      <Part {...baseProps} kind="sensor" tier="recede" active selected />,
    )
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('data-tier')).toBe('recede')
    expect(svg?.getAttribute('data-active')).toBe('true')
    expect(svg?.getAttribute('data-selected')).toBe('true')
  })
})
