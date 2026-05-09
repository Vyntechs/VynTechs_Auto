import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { pushSpy } = vi.hoisted(() => ({ pushSpy: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushSpy }),
}))

beforeEach(() => {
  pushSpy.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

import { DeclineOrDefer } from '@/components/screens/decline-or-defer'
import { DeclineOrDeferLive } from '@/components/screens/decline-or-defer-live'

const baseProps = {
  sessionId: 'sess-abc',
  vehicleName: '2018 Ford F-150 — 3.5L EcoBoost',
  vehicleVin: 'Session · sess-abc',
  timer: '0:58',
  gap: 'Required confidence 95%; current 80%.',
  riskClass: 'destructive' as const,
  optionKeys: ['gather_more_low_risk', 'decline', 'defer'] as Array<
    'gather_more_low_risk' | 'decline' | 'defer'
  >,
}

describe('DeclineOrDefer (presentational)', () => {
  it('renders inert buttons in preview mode (no callback)', () => {
    render(
      <DeclineOrDefer
        vehicleName="Test Vehicle"
        vehicleVin="vin"
        timer="0:00"
        gap="why blocked"
        options={[
          { number: 1, title: 'A', description: 'a' },
          { number: 2, title: 'B', description: 'b' },
          { number: 3, title: 'C', description: 'c' },
        ]}
      />,
    )
    const btn = screen.getByText('A').closest('button')!
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    // No callback, no error — just nothing happens
  })

  it('invokes onSelectOption with the clicked option number', () => {
    const onSelect = vi.fn()
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[
          { number: 1, title: 'A', description: 'a' },
          { number: 2, title: 'B', description: 'b' },
          { number: 3, title: 'C', description: 'c' },
        ]}
        onSelectOption={onSelect}
      />,
    )
    fireEvent.click(screen.getByText('B').closest('button')!)
    expect(onSelect).toHaveBeenCalledWith(2)
  })

  it('disables all buttons and marks the pending one busy when pending', () => {
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[
          { number: 1, title: 'A', description: 'a' },
          { number: 2, title: 'B', description: 'b' },
          { number: 3, title: 'C', description: 'c' },
        ]}
        onSelectOption={vi.fn()}
        pending={2}
      />,
    )
    expect(screen.getByText('A').closest('button')).toBeDisabled()
    expect(screen.getByText('B').closest('button')).toHaveAttribute('aria-busy', 'true')
  })

  it('hides the decorative play-arrow glyph from screen readers', () => {
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[{ number: 1, title: 'A', description: 'a' }]}
        riskLabel="Custom risk label"
      />,
    )
    // ⏵ is decorative; SRs would announce it as a triangle/play character.
    // Wrap it in aria-hidden so only the riskLabel is announced.
    const arrowNode = screen.getByText('⏵', { exact: false })
    expect(arrowNode).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByText('Custom risk label')).toBeInTheDocument()
  })

  it('shows error text in an alert region when error is set', () => {
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[{ number: 1, title: 'A', description: 'a' }]}
        onSelectOption={vi.fn()}
        error="something went wrong"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i)
  })

  // 2026-05-08 nav audit: live decline page was sending "back" to /today
  // instead of to the diagnosis the tech was just on. DeclineOrDefer gained
  // an optional `back` prop with a /today fallback so the design gallery
  // still works without a session id.
  it('honors a custom back-link target when one is provided (live caller)', () => {
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[{ number: 1, title: 'A', description: 'a' }]}
        back={{ href: '/sessions/sess-xyz', label: 'Diagnosis' }}
      />,
    )
    const back = screen.getByRole('link', { name: /diagnosis/i })
    expect(back).toHaveAttribute('href', '/sessions/sess-xyz')
  })

  it('falls back to /today (My Jobs) when no back prop is provided (design gallery)', () => {
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[{ number: 1, title: 'A', description: 'a' }]}
      />,
    )
    const back = screen.getByRole('link', { name: /my jobs/i })
    expect(back).toHaveAttribute('href', '/today')
  })

  it('renders a confirm hero with Yes/No when confirmAsk is provided', () => {
    const onYes = vi.fn()
    const onNo = vi.fn()
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[
          { number: 1, title: 'A', description: 'a' },
          { number: 2, title: 'B', description: 'b' },
          { number: 3, title: 'C', description: 'c' },
        ]}
        confirmAsk={{
          prompt: 'Did C171 positively re-latch?',
          onYes,
          onNo,
        }}
      />,
    )
    expect(screen.getByText(/Did C171 positively re-latch/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^yes$/i }))
    expect(onYes).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /^no$/i }))
    expect(onNo).toHaveBeenCalledTimes(1)
  })

  it('renders a photo hero with Snap-it when photoAsk is provided', () => {
    const onSnap = vi.fn()
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[
          { number: 1, title: 'A', description: 'a' },
          { number: 2, title: 'B', description: 'b' },
          { number: 3, title: 'C', description: 'c' },
        ]}
        photoAsk={{
          prompt: 'Snap the C171 pinout page',
          onSnap,
        }}
      />,
    )
    expect(screen.getByText(/Snap the C171 pinout page/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /snap it/i }))
    expect(onSnap).toHaveBeenCalledTimes(1)
  })

  it('renders no hero when neither confirmAsk nor photoAsk is provided', () => {
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[{ number: 1, title: 'A', description: 'a' }]}
      />,
    )
    expect(screen.queryByRole('button', { name: /^yes$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /snap it/i })).not.toBeInTheDocument()
  })
})

describe('DeclineOrDeferLive (wired)', () => {
  it('routes back to the session when "Gather more low-risk data" is clicked', () => {
    render(<DeclineOrDeferLive {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /gather more low-risk data/i }))
    expect(pushSpy).toHaveBeenCalledWith('/sessions/sess-abc')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('POSTs reason=decline with gap+riskClass when "Decline this job" is clicked', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'declined', language: { customerMessage: '', internalNote: '' } }),
    })
    render(<DeclineOrDeferLive {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /decline this job/i }))
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/sessions'))
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/sessions/sess-abc/decline-or-defer',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          reason: 'decline',
          gap: baseProps.gap,
          riskClass: 'destructive',
        }),
      }),
    )
  })

  it('POSTs reason=defer when "Defer for curator review" is clicked', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'deferred', language: { customerMessage: '', internalNote: '' } }),
    })
    render(<DeclineOrDeferLive {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /defer for curator review/i }))
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/sessions'))
    const callBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    )
    expect(callBody.reason).toBe('defer')
  })

  it('surfaces a server error and clears pending state', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: 'language generation failed' }),
    })
    render(<DeclineOrDeferLive {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /decline this job/i }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/language generation failed/i),
    )
    expect(pushSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /decline this job/i })).not.toBeDisabled()
  })

  it('renders a confirm hero and POSTs the choice as observation to /advance', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    })
    render(
      <DeclineOrDeferLive
        {...baseProps}
        whatWouldClose={{ kind: 'confirm', prompt: 'Did C171 reseat cleanly?' }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^yes$/i }))
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/sessions/sess-abc/advance',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('Yes'),
      }),
    )
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/sessions/sess-abc'))
  })

  it('renders a photo hero with a hidden file input that uploads to /capture', async () => {
    ;(global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ artifactId: 'art-xyz' }),
    })
    const { container } = render(
      <DeclineOrDeferLive
        {...baseProps}
        whatWouldClose={{
          kind: 'photo',
          prompt: 'Snap the C171 pinout page',
          extractFor: 'full pinout for C171',
        }}
      />,
    )
    expect(screen.getByText(/Snap the C171 pinout page/i)).toBeInTheDocument()
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()
    expect(fileInput.getAttribute('accept')).toMatch(/image/)
    expect(fileInput.getAttribute('capture')).toBe('environment')

    const file = new File(['x'], 'pinout.jpg', { type: 'image/jpeg' })
    Object.defineProperty(fileInput, 'files', { value: [file] })
    fireEvent.change(fileInput)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/sessions/sess-abc/capture',
      expect.objectContaining({ method: 'POST' }),
    )
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/sessions/sess-abc'))
  })

  it('does not render the hero when whatWouldClose is a legacy string', () => {
    render(<DeclineOrDeferLive {...baseProps} whatWouldClose="quote the FSM page" />)
    expect(screen.queryByRole('button', { name: /^yes$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /snap it/i })).not.toBeInTheDocument()
  })
})
