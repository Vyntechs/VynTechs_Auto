import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
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
})
