import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { WIRE_ROLES, type Terminal as TerminalT } from '@/components/diagram-kit/part-api'
import { Wire } from '@/components/diagram-kit/wires/wire'
import { ConnectionLink } from '@/components/diagram-kit/wires/connection-link'
import { Terminal } from '@/components/diagram-kit/wires/terminal'

describe('Wire', () => {
  it('renders a path tagged with its role for every WireRole', () => {
    for (const role of WIRE_ROLES) {
      const { container } = render(
        <svg><Wire role={role} d="M0 0 L10 10" active={false} /></svg>,
      )
      expect(container.querySelector('path.dk-wire')?.getAttribute('data-role')).toBe(role)
    }
  })

  it('active wire is marked so the template can light it', () => {
    const { container } = render(<svg><Wire role="12v" d="M0 0 L1 1" active /></svg>)
    expect(container.querySelector('path.dk-wire')?.getAttribute('data-active')).toBe('true')
  })
})

describe('ConnectionLink', () => {
  it('draws fuel-line and mechanical-link distinctly by connectionKind', () => {
    const fuel = render(<svg><ConnectionLink kind="fuel-line" d="M0 0 L1 1" /></svg>)
    const mech = render(<svg><ConnectionLink kind="mechanical-link" d="M0 0 L1 1" /></svg>)
    expect(fuel.container.querySelector('[data-kind="fuel-line"]')).not.toBeNull()
    expect(mech.container.querySelector('[data-kind="mechanical-link"]')).not.toBeNull()
  })

  it('an unseen connectionKind degrades to a neutral link (never blank)', () => {
    const { container } = render(<svg><ConnectionLink kind="vapor-duct" d="M0 0 L1 1" /></svg>)
    expect(container.querySelector('path.dk-link')).not.toBeNull()
  })
})

const term: TerminalT = {
  id: 't1', role: 'signal', edge: 'right', label: 'SIG',
  visible: true, active: false, selected: false,
}

describe('Terminal (leak-lock: visible is engine-controlled)', () => {
  it('renders when visible', () => {
    const { container } = render(<svg><Terminal terminal={term} /></svg>)
    expect(container.querySelector('.dk-terminal')).not.toBeNull()
  })

  it('renders NOTHING when visible=false (never always-on)', () => {
    const { container } = render(
      <svg><Terminal terminal={{ ...term, visible: false }} /></svg>,
    )
    expect(container.querySelector('.dk-terminal')).toBeNull()
  })

  it('colors by its role', () => {
    const { container } = render(<svg><Terminal terminal={{ ...term, role: 'ground' }} /></svg>)
    expect(container.querySelector('.dk-terminal')?.getAttribute('data-role')).toBe('ground')
  })
})
