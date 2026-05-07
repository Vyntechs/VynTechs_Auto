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

  it('surfaces the open-session conflict with a resume link and does NOT auto-redirect', async () => {
    // The server enforces one open session per tech (HTTP 409 with the
    // existing session's id). Auto-redirecting silently makes the user
    // think their freshly-submitted intake was hijacked — instead the form
    // must explain the conflict and let the user choose what to do.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({ error: 'open_session', openSessionId: 'sess-existing' }),
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

    // Form shows an explanatory alert that mentions the open session.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/open (diagnosis|session)/i)
    })

    // It also offers a way to resume the existing session.
    const resumeLink = screen.getByRole('link', { name: /resume/i })
    expect(resumeLink).toHaveAttribute('href', '/sessions/sess-existing')

    // And it must NOT silently navigate the user away from the intake form.
    expect(mockPush).not.toHaveBeenCalled()
  })
})
