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
  // Decline option removed 2026-05-09 — only Gather and Defer remain.
  optionKeys: ['gather_more_low_risk', 'defer'] as Array<
    'gather_more_low_risk' | 'defer'
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

  it('renders the FASTEST PATH FORWARD eyebrow above the confirm hero', () => {
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[
          { number: 1, title: 'A', description: 'a' },
          { number: 3, title: 'C', description: 'c' },
        ]}
        confirmAsk={{ prompt: 'Coolant milky?', onYes: vi.fn(), onNo: vi.fn() }}
      />,
    )
    expect(screen.getByText(/fastest path forward/i)).toBeInTheDocument()
  })

  it('omits the FASTEST PATH FORWARD eyebrow when no confirm/photo hero is shown', () => {
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[{ number: 1, title: 'A', description: 'a' }]}
      />,
    )
    expect(screen.queryByText(/fastest path forward/i)).not.toBeInTheDocument()
  })

  it('renders Working… on Yes/No buttons while busy', () => {
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[
          { number: 1, title: 'A', description: 'a' },
          { number: 3, title: 'C', description: 'c' },
        ]}
        confirmAsk={{
          prompt: 'Coolant milky?',
          yesLabel: 'Yes — milky',
          noLabel: 'No — clean',
          onYes: vi.fn(),
          onNo: vi.fn(),
          busy: true,
        }}
      />,
    )
    const buttons = screen.getAllByRole('button', { name: /working…/i })
    expect(buttons.length).toBeGreaterThanOrEqual(2)
  })

  it('renders the spokes section with the "OR, IF YOU CAN\'T ANSWER YET" header when 2 options', () => {
    render(
      <DeclineOrDefer
        vehicleName="x"
        vehicleVin="x"
        timer="x"
        gap="g"
        options={[
          { number: 1, title: 'A', description: 'a' },
          { number: 3, title: 'C', description: 'c' },
        ]}
        confirmAsk={{ prompt: 'q', onYes: vi.fn(), onNo: vi.fn() }}
      />,
    )
    expect(
      screen.getByText(/or, if you can't answer yet/i),
    ).toBeInTheDocument()
  })

  it('keeps the legacy "Three ways forward" header when 3 options (design gallery / preview)', () => {
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
      />,
    )
    expect(screen.getByText(/three ways forward/i)).toBeInTheDocument()
  })
})

describe('DeclineOrDeferLive (wired)', () => {
  function mockFetchSequence(...responses: Array<{ ok: boolean; status?: number; body?: unknown }>) {
    const fn = global.fetch as ReturnType<typeof vi.fn>
    for (const r of responses) {
      fn.mockResolvedValueOnce({
        ok: r.ok,
        status: r.status ?? (r.ok ? 200 : 500),
        json: async () => r.body ?? {},
      })
    }
  }

  it('does not render a "Decline this job" spoke (option removed 2026-05-09)', () => {
    render(<DeclineOrDeferLive {...baseProps} />)
    expect(
      screen.queryByRole('button', { name: /decline this job/i }),
    ).not.toBeInTheDocument()
  })

  it('releases the gate and routes to the session when "Gather more low-risk data" is clicked', async () => {
    mockFetchSequence({ ok: true, body: { ok: true } })
    render(<DeclineOrDeferLive {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /gather more low-risk data/i }))
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/sess-abc/release-gate',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/sessions/sess-abc'))
  })

  it('POSTs reason=defer when "Defer for curator review" is clicked', async () => {
    mockFetchSequence({
      ok: true,
      body: { status: 'deferred', language: { customerMessage: '', internalNote: '' } },
    })
    render(<DeclineOrDeferLive {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /defer for curator review/i }))
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/sessions'))
    const callBody = JSON.parse(
      (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    )
    expect(callBody.reason).toBe('defer')
  })

  it('surfaces a server error and clears pending state on Defer failure', async () => {
    mockFetchSequence({ ok: false, status: 500, body: { error: 'language generation failed' } })
    render(<DeclineOrDeferLive {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /defer for curator review/i }))
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/language generation failed/i),
    )
    expect(pushSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /defer for curator review/i })).not.toBeDisabled()
  })

  it('confirm hero — POSTs the choice to /advance, then releases the gate, then routes', async () => {
    // Two fetches: /advance, then /release-gate.
    mockFetchSequence({ ok: true, body: {} }, { ok: true, body: { ok: true } })
    render(
      <DeclineOrDeferLive
        {...baseProps}
        whatWouldClose={{ kind: 'confirm', prompt: 'Did C171 reseat cleanly?' }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^yes$/i }))
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/sess-abc/advance',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/sess-abc/release-gate',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/sessions/sess-abc'))
  })

  it('photo hero — uploads via /capture, then releases the gate, then routes', async () => {
    mockFetchSequence(
      { ok: true, body: { artifactId: 'art-xyz' } },
      { ok: true, body: { ok: true } },
    )
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
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement
    expect(fileInput).toBeTruthy()
    const file = new File(['x'], 'pinout.jpg', { type: 'image/jpeg' })
    Object.defineProperty(fileInput, 'files', { value: [file] })
    fireEvent.change(fileInput)
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/sess-abc/capture',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/sessions/sess-abc/release-gate',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('/sessions/sess-abc'))
  })

  it('does not render the hero when whatWouldClose is a legacy string', () => {
    render(<DeclineOrDeferLive {...baseProps} whatWouldClose="quote the FSM page" />)
    expect(screen.queryByRole('button', { name: /^yes$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /snap it/i })).not.toBeInTheDocument()
  })

  it('renders confirm hero buttons with yesLabel / noLabel when AI provides them', () => {
    render(
      <DeclineOrDeferLive
        {...baseProps}
        whatWouldClose={{
          kind: 'confirm',
          prompt: 'Do you have 12V at the clutch coil?',
          yesLabel: 'Yes — I have 12V',
          noLabel: 'No — no voltage',
        }}
      />,
    )
    expect(
      screen.getByRole('button', { name: /yes — i have 12v/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /no — no voltage/i }),
    ).toBeInTheDocument()
  })

  it('falls back to plain Yes/No buttons when AI omits the labels', () => {
    render(
      <DeclineOrDeferLive
        {...baseProps}
        whatWouldClose={{ kind: 'confirm', prompt: 'Coolant milky?' }}
      />,
    )
    expect(screen.getByRole('button', { name: /^yes$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^no$/i })).toBeInTheDocument()
  })
})
