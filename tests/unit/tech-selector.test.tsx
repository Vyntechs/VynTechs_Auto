import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

describe('TechSelector — popover', () => {
  const TEAM = [
    mem('a', 'Brandon', true),
    mem('b', 'Diana'),
    mem('c', 'Marcus'),
  ]

  it('opens the popover on trigger click and lists all members in order', () => {
    render(
      <TechSelector
        currentUserId="a"
        team={TEAM}
        selectedId={null}
        onChange={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveTextContent(/brandon/i)
    expect(options[1]).toHaveTextContent(/diana/i)
    expect(options[2]).toHaveTextContent(/marcus/i)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('closes the popover on Escape from the trigger', () => {
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('calls onChange with the selected id and closes the popover when a row is clicked', () => {
    const onChange = vi.fn()
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    fireEvent.click(screen.getByRole('option', { name: /diana/i }))
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('does NOT render a Clear row when nothing is selected', () => {
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    expect(screen.queryByRole('option', { name: /clear/i })).not.toBeInTheDocument()
  })

  it('renders a Clear row when a selection exists, and onChange(null) when clicked', () => {
    const onChange = vi.fn()
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId="b" onChange={onChange} />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    const clear = screen.getByRole('option', { name: /clear.*open queue/i })
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('closes the popover when clicking outside', () => {
    render(
      <div>
        <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />
        <button>Outside</button>
      </div>,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(screen.getByRole('button', { name: /outside/i }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
