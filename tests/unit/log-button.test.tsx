import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LogButton, DEFAULT_STAGES } from '@/components/vt/log-button'

describe('LogButton', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
      ],
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('renders idle face by default', () => {
    render(<LogButton />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveTextContent('Log observation')
    expect(btn).toHaveAttribute('aria-busy', 'false')
    expect(btn.className).not.toMatch(/is-loading/)
    expect(btn.className).not.toMatch(/is-done/)
  })

  it('shows custom idle label when provided', () => {
    render(<LogButton label="Save note" />)
    expect(screen.getByRole('button')).toHaveTextContent('Save note')
  })

  it('enters loading state with first stage label and aria-busy', () => {
    render(<LogButton state="loading" />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-busy', 'true')
    expect(btn.className).toMatch(/is-loading/)
    expect(btn).toHaveTextContent(DEFAULT_STAGES[0].label)
  })

  it('cycles to the next stage label after the first stage duration elapses', async () => {
    const stages = [
      { label: 'First step', ms: 600 },
      { label: 'Second step', ms: 600 },
    ]
    render(<LogButton state="loading" stages={stages} />)
    expect(screen.getByRole('button')).toHaveTextContent('First step')

    await act(async () => {
      vi.advanceTimersByTime(650)
    })

    expect(screen.getByRole('button')).toHaveTextContent('Second step')
  })

  it('pins to a specific stage when freezeStage is set, regardless of timer', async () => {
    const stages = [
      { label: 'S0', ms: 600 },
      { label: 'S1', ms: 600 },
      { label: 'S2', ms: 600 },
      { label: 'S3', ms: 600 },
    ]
    render(<LogButton state="loading" freezeStage={3} stages={stages} />)
    expect(screen.getByRole('button')).toHaveTextContent('S3')

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.getByRole('button')).toHaveTextContent('S3')
  })

  // 2026-05-29 trust sweep: the default narration cycled fabricated work claims
  // ("Parsing photo · 3 frames", "Re-scoring confidence") on a fixed timer
  // regardless of what actually happened. Real server-streamed stages still
  // narrate; the no-real-stages fallback is now a single honest stage.
  // docs/strategy/2026-05-29-customer-interaction-doctrine.md (§2.5)
  it('default narration carries no fabricated work claims', () => {
    const labels = DEFAULT_STAGES.map((s) => s.label).join(' · ')
    expect(labels).not.toMatch(/parsing photo/i)
    expect(labels).not.toMatch(/re-scoring confidence/i)
    expect(labels).not.toMatch(/retrieval ladder/i)
  })

  it('renders done face with check and "Logged · advancing" label', () => {
    render(<LogButton state="done" />)
    const btn = screen.getByRole('button')
    expect(btn.className).toMatch(/is-done/)
    expect(btn).toHaveTextContent('Logged · advancing')
  })

  it('fires onClick when idle and clicked', async () => {
    vi.useRealTimers()
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<LogButton onClick={onClick} />)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('respects disabled prop', async () => {
    vi.useRealTimers()
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<LogButton onClick={onClick} disabled />)
    const btn = screen.getByRole('button')
    expect(btn).toBeDisabled()
    await user.click(btn)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('shows total stage count in counter region while loading', () => {
    render(<LogButton state="loading" />)
    const btn = screen.getByRole('button')
    const totalPadded = String(DEFAULT_STAGES.length).padStart(2, '0')
    expect(btn.textContent).toContain(totalPadded)
  })

  it('applies the variant class', () => {
    const { rerender } = render(<LogButton variant="amber" />)
    expect(screen.getByRole('button').className).toMatch(/lb--amber/)
    rerender(<LogButton variant="paper" />)
    expect(screen.getByRole('button').className).toMatch(/lb--paper/)
  })
})
