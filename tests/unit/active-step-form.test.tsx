import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'

const refreshMock = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    refresh: refreshMock,
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
}))

import { ActiveStepForm } from '@/components/screens/active-step-form'

describe('ActiveStepForm — log-button integration', () => {
  beforeEach(() => {
    refreshMock.mockReset()
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
      shouldAdvanceTime: true,
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows the LogButton in idle state by default', () => {
    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    const btn = screen.getByRole('button', { name: /log observation/i })
    expect(btn).toHaveAttribute('aria-busy', 'false')
  })

  it('disables the LogButton when textarea is empty', () => {
    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    expect(
      screen.getByRole('button', { name: /log observation/i }),
    ).toBeDisabled()
  })

  it('enters loading state on submit, then done state, then refreshes after 700ms hold', async () => {
    let resolveFetch!: (v: Response) => void
    const fetchPromise = new Promise<Response>((res) => {
      resolveFetch = res
    })
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(fetchPromise))

    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)

    const textarea = screen.getByPlaceholderText(/log what you observed/i)
    fireEvent.change(textarea, { target: { value: 'left front squeal' } })

    const btn = screen.getByRole('button', { name: /log observation/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(btn).toHaveAttribute('aria-busy', 'true')
    })

    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )
    })

    await waitFor(() => {
      expect(btn.className).toMatch(/is-done/)
    })
    expect(refreshMock).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(750)
    })

    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('returns to idle on error, does NOT show done flash, refresh NOT called', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: 'nope' }), { status: 400 }),
        ),
    )

    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    const textarea = screen.getByPlaceholderText(/log what you observed/i)
    fireEvent.change(textarea, { target: { value: 'left front squeal' } })

    const btn = screen.getByRole('button', { name: /log observation/i })
    fireEvent.click(btn)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('nope')
    })

    expect(btn.className).not.toMatch(/is-done/)
    expect(refreshMock).not.toHaveBeenCalled()
  })
})
