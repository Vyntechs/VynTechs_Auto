import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { LogButton, DEFAULT_STAGES } from '@/components/vt/log-button'

describe('LogButton', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // happy-dom's rAF doesn't always advance with vi.advanceTimersByTime
    // so back it with setTimeout for deterministic stage-cycling tests.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 16) as unknown as number,
    )
    vi.stubGlobal('cancelAnimationFrame', (id: number) =>
      clearTimeout(id as unknown as ReturnType<typeof setTimeout>),
    )
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

  it('cycles to next stage label after first stage duration elapses', async () => {
    render(<LogButton state="loading" />)
    expect(screen.getByRole('button')).toHaveTextContent(DEFAULT_STAGES[0].label)

    await act(async () => {
      vi.advanceTimersByTime(DEFAULT_STAGES[0].ms + 50)
    })

    expect(screen.getByRole('button')).toHaveTextContent(DEFAULT_STAGES[1].label)
  })

  it('pins to specific stage when freezeStage is set, regardless of timer', async () => {
    render(<LogButton state="loading" freezeStage={3} />)
    expect(screen.getByRole('button')).toHaveTextContent(DEFAULT_STAGES[3].label)

    await act(async () => {
      vi.advanceTimersByTime(5000)
    })

    expect(screen.getByRole('button')).toHaveTextContent(DEFAULT_STAGES[3].label)
  })

  it('renders done face with check and "Logged · advancing" label', () => {
    render(<LogButton state="done" />)
    const btn = screen.getByRole('button')
    expect(btn.className).toMatch(/is-done/)
    expect(btn).toHaveTextContent('Logged · advancing')
  })

  it('fires onClick when idle and clicked', async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    const onClick = vi.fn()
    const user = userEvent.setup()
    render(<LogButton onClick={onClick} />)
    await user.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('respects disabled prop', async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
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
