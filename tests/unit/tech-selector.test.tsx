import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TechSelector, type TeamMember } from '@/components/vt/tech-selector'

function mem(id: string, name: string, isCurrentUser = false): TeamMember {
  return { id, name, isCurrentUser }
}

describe('TechSelector — resting + solo states', () => {
  it('renders an inert "You · only tech" pill when team has one member', () => {
    render(
      <TechSelector
        currentUserId="a"
        team={[mem('a', 'Brandon', true)]}
        selectedId={null}
        onChange={vi.fn()}
      />,
    )
    const pill = screen.getByRole('group', { name: /assigned to/i })
    expect(pill).toHaveAttribute('aria-disabled', 'true')
    expect(pill).toHaveTextContent(/you/i)
    expect(pill).toHaveTextContent(/only tech/i)
  })

  it('renders an active "Open queue ▾" combobox when team has 2+ members and nothing selected', () => {
    render(
      <TechSelector
        currentUserId="a"
        team={[mem('a', 'Brandon', true), mem('b', 'Diana')]}
        selectedId={null}
        onChange={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveTextContent(/open queue/i)
  })

  it('renders the selected member name when selectedId is set', () => {
    render(
      <TechSelector
        currentUserId="a"
        team={[mem('a', 'Brandon', true), mem('b', 'Diana')]}
        selectedId="b"
        onChange={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    expect(trigger).toHaveTextContent(/diana/i)
    expect(trigger).not.toHaveTextContent(/open queue/i)
  })
})
