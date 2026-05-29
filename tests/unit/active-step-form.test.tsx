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

const submitMock = vi.fn()
const resetMock = vi.fn()
let mockState: {
  stages: Array<{ label: string }> | null
  stageIdx: number | null
  isLoading: boolean
  isDone: boolean
  error: string | null
  tree: unknown
}
vi.mock('@/lib/use-advance-stream', () => ({
  useAdvanceStream: () => ({
    state: mockState,
    submit: submitMock,
    reset: resetMock,
  }),
}))

import { ActiveStepForm } from '@/components/screens/active-step-form'

describe('ActiveStepForm — log-button integration', () => {
  beforeEach(() => {
    refreshMock.mockReset()
    submitMock.mockReset()
    resetMock.mockReset()
    mockState = {
      stages: null,
      stageIdx: null,
      isLoading: false,
      isDone: false,
      error: null,
      tree: null,
    }
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

  it('calls submit on click and shows loading state when hook reports isLoading', () => {
    const { rerender } = render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    fireEvent.change(screen.getByPlaceholderText(/log what you observed/i), {
      target: { value: 'left front squeal' },
    })
    fireEvent.click(screen.getByRole('button', { name: /log observation/i }))

    expect(submitMock).toHaveBeenCalledWith({
      sessionId: 's1',
      observation: 'left front squeal',
    })

    mockState.isLoading = true
    rerender(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    expect(
      screen.getByRole('button', { name: /log observation|recording/i }),
    ).toHaveAttribute('aria-busy', 'true')
  })

  it('holds done state for 700ms then triggers refresh', async () => {
    const { rerender } = render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    fireEvent.change(screen.getByPlaceholderText(/log what you observed/i), {
      target: { value: 'left front squeal' },
    })
    fireEvent.click(screen.getByRole('button', { name: /log observation/i }))

    // Hook flips to done
    mockState = {
      ...mockState,
      isLoading: false,
      isDone: true,
      tree: { nodes: [], currentNodeId: 'n2', message: 'ok' },
    }
    rerender(<ActiveStepForm sessionId="s1" nodeId="n1" />)

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /logged.*advancing/i }).className,
      ).toMatch(/is-done/)
    })
    expect(refreshMock).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(750)
    })

    expect(refreshMock).toHaveBeenCalledTimes(1)
  })

  it('shows error text when hook reports an error', () => {
    mockState.error = 'tree update failed'
    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    expect(screen.getByRole('alert')).toHaveTextContent('tree update failed')
  })

  // 2026-05-29 trust sweep: the "More options" (…) button next to Log had no
  // onClick — a dead control. Every dead affordance taxes trust in the live
  // ones. docs/strategy/2026-05-29-customer-interaction-doctrine.md (§2.5)
  it('does not render a dead "More options" button', () => {
    render(<ActiveStepForm sessionId="s1" nodeId="n1" />)
    expect(
      screen.queryByRole('button', { name: /more options/i }),
    ).not.toBeInTheDocument()
  })
})
