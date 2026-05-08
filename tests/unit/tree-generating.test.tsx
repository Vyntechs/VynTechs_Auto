import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TreeGenerating } from '@/components/screens/tree-generating'

describe('TreeGenerating', () => {
  it('renders the default plain-English headline when no past-case matches are provided', () => {
    render(<TreeGenerating />)
    expect(screen.getByText('Putting together your steps.')).toBeInTheDocument()
  })

  it('renders a matches-aware headline (singular) when matches === 1', () => {
    render(<TreeGenerating matches={1} />)
    expect(
      screen.getByText('Putting together your steps from 1 past case.'),
    ).toBeInTheDocument()
  })

  it('renders a matches-aware headline (plural) when matches > 1', () => {
    render(<TreeGenerating matches={3} />)
    expect(
      screen.getByText('Putting together your steps from 3 past cases.'),
    ).toBeInTheDocument()
  })

  // Regression guard: this screen used to be a true dead-end. If the AI stalled
  // or a session row landed with empty treeState, the user had no exit. The
  // back link is the escape hatch. Don't let anyone remove it.
  it('renders a "← My Jobs" back link to /today (regression: was a dead-end)', () => {
    render(<TreeGenerating />)
    const back = screen.getByRole('link', { name: /my jobs/i })
    expect(back).toHaveAttribute('href', '/today')
  })

  it('shows the vehicle and elapsed metadata when provided', () => {
    render(<TreeGenerating vehicle="2018 Ford F-150" elapsed="T+0:09" />)
    expect(screen.getByText(/2018 Ford F-150/)).toBeInTheDocument()
    expect(screen.getByText(/T\+0:09/)).toBeInTheDocument()
  })
})
