import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TechSelector, type TeamMember } from '@/components/vt/tech-selector'

function mem(id: string, name: string, isCurrentUser = false): TeamMember {
  return { id, name, skillTier: 3, isCurrentUser }
}

describe('TechSelector — resting + solo states', () => {
  it('keeps a one-member roster open by default and allows assign then clear', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <TechSelector
        currentUserId="a"
        team={[mem('a', 'Brandon', true)]}
        selectedId={null}
        onChange={onChange}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    expect(trigger).toHaveTextContent(/open queue/i)

    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: /brandon/i }))
    expect(onChange).toHaveBeenLastCalledWith('a')

    rerender(
      <TechSelector
        currentUserId="a"
        team={[mem('a', 'Brandon', true)]}
        selectedId="a"
        onChange={onChange}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    fireEvent.click(screen.getByRole('option', { name: /clear.*open queue/i }))
    expect(onChange).toHaveBeenLastCalledWith(null)
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

describe('TechSelector — search + workload', () => {
  function bigTeam(n: number): TeamMember[] {
    const names = ['Brandon', 'Diana', 'Marcus', 'Alice', 'Bob', 'Charlie', 'Eve', 'Frank', 'Grace']
    return Array.from({ length: n }, (_, i) => ({
      id: `m${i}`,
      name: names[i],
      skillTier: 3,
      isCurrentUser: i === 0,
      workload: { open: i, today: 0 },
    }))
  }

  it('does NOT render the search input when team.length <= 5', () => {
    render(
      <TechSelector
        currentUserId="m0"
        team={bigTeam(5)}
        selectedId={null}
        onChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('renders a search input when team.length > 5 and filters live', () => {
    render(
      <TechSelector
        currentUserId="m0"
        team={bigTeam(8)}
        selectedId={null}
        onChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    const input = screen.getByRole('searchbox')
    fireEvent.change(input, { target: { value: 'di' } })
    const options = screen.getAllByRole('option').filter(
      (o) => !o.getAttribute('aria-label')?.includes('Clear'),
    )
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent(/diana/i)
  })

  it('renders workload badges {open} open / {today} today when workloadFailed is false', () => {
    const team: TeamMember[] = [
      { id: 'a', name: 'Brandon', skillTier: 3, isCurrentUser: true, workload: { open: 3, today: 1 } },
      { id: 'b', name: 'Diana', skillTier: 2, isCurrentUser: false, workload: { open: 5, today: 2 } },
    ]
    render(
      <TechSelector currentUserId="a" team={team} selectedId={null} onChange={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    expect(screen.getByText(/3 open/i)).toBeInTheDocument()
    expect(screen.getByText(/1 today/i)).toBeInTheDocument()
    expect(screen.getByText(/5 open/i)).toBeInTheDocument()
    expect(screen.getByText(/2 today/i)).toBeInTheDocument()
  })

  it('does NOT render workload badges when workloadFailed is true', () => {
    const team: TeamMember[] = [
      { id: 'a', name: 'Brandon', skillTier: 3, isCurrentUser: true, workload: { open: 3, today: 1 } },
      { id: 'b', name: 'Diana', skillTier: 2, isCurrentUser: false, workload: { open: 5, today: 2 } },
    ]
    render(
      <TechSelector
        currentUserId="a"
        team={team}
        workloadFailed
        selectedId={null}
        onChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    expect(screen.queryByText(/\d+ open/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+ today/i)).not.toBeInTheDocument()
  })

  it('tints the open badge with --busy class when open >= 5', () => {
    const team: TeamMember[] = [
      { id: 'a', name: 'Brandon', skillTier: 3, isCurrentUser: true, workload: { open: 5, today: 0 } },
      { id: 'b', name: 'Diana', skillTier: 2, isCurrentUser: false, workload: { open: 4, today: 0 } },
    ]
    render(
      <TechSelector currentUserId="a" team={team} selectedId={null} onChange={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('combobox', { name: /assigned to/i }))
    const brandonBadge = screen.getByText(/5 open/i).closest('.ts__badge')
    const dianaBadge = screen.getByText(/4 open/i).closest('.ts__badge')
    expect(brandonBadge).toHaveClass('ts__badge--busy')
    expect(dianaBadge).not.toHaveClass('ts__badge--busy')
  })
})

describe('TechSelector — keyboard', () => {
  const TEAM = [
    mem('a', 'Brandon', true),
    mem('b', 'Diana'),
    mem('c', 'Marcus'),
  ]

  it('opens on Enter from the trigger and aria-activedescendant points at first row', () => {
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const options = screen.getAllByRole('option')
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[0].id)
  })

  it('opens on Space from the trigger', () => {
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: ' ' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('moves focus with ArrowDown and wraps at the bottom', () => {
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const options = screen.getAllByRole('option')
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[1].id)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[2].id)
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[0].id)
  })

  it('moves focus with ArrowUp and wraps at the top', () => {
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={vi.fn()} />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const options = screen.getAllByRole('option')
    fireEvent.keyDown(trigger, { key: 'ArrowUp' })
    expect(trigger.getAttribute('aria-activedescendant')).toBe(options[options.length - 1].id)
  })

  it('commits the activedescendant on Enter and closes the popover', () => {
    const onChange = vi.fn()
    render(
      <TechSelector currentUserId="a" team={TEAM} selectedId={null} onChange={onChange} />,
    )
    const trigger = screen.getByRole('combobox', { name: /assigned to/i })
    trigger.focus()
    fireEvent.keyDown(trigger, { key: 'Enter' })
    fireEvent.keyDown(trigger, { key: 'ArrowDown' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith('b')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})
