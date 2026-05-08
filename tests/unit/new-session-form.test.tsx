import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import { NewSessionForm } from '@/components/intake/new-session-form'

describe('NewSessionForm', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'session-123' }),
        text: async () => '',
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    mockPush.mockReset()
  })

  it('renders inputs for vehicle year, make, model, and customer complaint', () => {
    render(<NewSessionForm />)
    expect(screen.getByLabelText(/year/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/make/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/model/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/customer complaint/i)).toBeInTheDocument()
  })

  it('posts the form values to /api/sessions on submit', async () => {
    render(<NewSessionForm />)
    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: '2018' } })
    fireEvent.change(screen.getByLabelText(/make/i), { target: { value: 'Ford' } })
    fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'F-150' } })
    fireEvent.change(screen.getByLabelText(/customer complaint/i), {
      target: { value: 'loss of power going up hills' },
    })

    fireEvent.click(screen.getByRole('button', { name: /start/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('/api/sessions')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.vehicleMake).toBe('Ford')
    expect(body.customerComplaint).toBe('loss of power going up hills')
  })

  // 2026-05-08 plain-English audit pass: shop-talk "Building your diagnostic
  // plan" → "Putting together your steps". Hold the fetch promise so the
  // generating state stays true while we observe the eyebrow.
  it('shows "Putting together your steps" eyebrow during submit (was: "Building your diagnostic plan")', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
    render(<NewSessionForm />)
    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: '2018' } })
    fireEvent.change(screen.getByLabelText(/make/i), { target: { value: 'Ford' } })
    fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'F-150' } })
    fireEvent.change(screen.getByLabelText(/customer complaint/i), {
      target: { value: 'loss of power going up hills' },
    })
    fireEvent.click(screen.getByRole('button', { name: /start/i }))

    await waitFor(() => {
      expect(screen.getByText(/putting together your steps/i)).toBeInTheDocument()
    })
    // The old shop-talk phrasing should NOT be visible.
    expect(screen.queryByText(/building your diagnostic plan/i)).not.toBeInTheDocument()
  })

  it('surfaces the open-session-limit conflict with a resume link and does NOT auto-redirect', async () => {
    // The server enforces a soft cap on concurrent open sessions per tech
    // (currently 5). HTTP 409 includes the existing-session id and the cap.
    // Auto-redirecting silently makes the user think their freshly-submitted
    // intake was hijacked — instead the form must explain the conflict and
    // let the user choose what to do.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          error: 'open_session_limit',
          openSessionId: 'sess-existing',
          limit: 5,
        }),
        text: async () => '',
      }),
    )
    render(<NewSessionForm />)
    fireEvent.change(screen.getByLabelText(/year/i), { target: { value: '2018' } })
    fireEvent.change(screen.getByLabelText(/make/i), { target: { value: 'Ford' } })
    fireEvent.change(screen.getByLabelText(/model/i), { target: { value: 'F-150' } })
    fireEvent.change(screen.getByLabelText(/customer complaint/i), {
      target: { value: 'loss of power going up hills' },
    })
    fireEvent.click(screen.getByRole('button', { name: /start/i }))

    // Form shows an explanatory alert that mentions the cap and the open count.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/5 open diagnos/i)
    })

    // It also offers a way to resume the existing session.
    const resumeLink = screen.getByRole('link', { name: /resume/i })
    expect(resumeLink).toHaveAttribute('href', '/sessions/sess-existing')

    // And it must NOT silently navigate the user away from the intake form.
    expect(mockPush).not.toHaveBeenCalled()
  })
})
