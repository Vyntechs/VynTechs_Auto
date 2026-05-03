import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import { CounterIntake } from '@/components/screens/counter-intake'

describe('CounterIntake', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ draftId: 'draft-abc' }),
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    mockPush.mockReset()
  })

  it('renders the screen title', () => {
    render(<CounterIntake />)
    expect(screen.getByRole('heading', { name: /who's at the counter/i })).toBeInTheDocument()
  })

  it('renders the customer, vehicle, and complaint fields', () => {
    render(<CounterIntake />)
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/phone/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/vin/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/year/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/make/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/model/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/what brought them in/i)).toBeInTheDocument()
  })

  it('auto-uppercases VIN as the writer types', () => {
    render(<CounterIntake />)
    const vin = screen.getByLabelText(/vin/i) as HTMLInputElement
    fireEvent.change(vin, { target: { value: 'wba3a5c50ejf12345' } })
    expect(vin.value).toBe('WBA3A5C50EJF12345')
  })

  it('toggles VIN scan state when the scan button is clicked', () => {
    render(<CounterIntake />)
    const scanBtn = screen.getByRole('button', { name: /scan/i })
    expect(scanBtn).toHaveTextContent(/scan with camera/i)
    fireEvent.click(scanBtn)
    expect(scanBtn).toHaveTextContent(/scanned/i)
  })

  it('disables Submit to AI when required fields (name, VIN, complaint) are empty', () => {
    render(<CounterIntake />)
    // The screen has two Submit-to-AI buttons (header + form footer); both must be disabled.
    const submits = screen.getAllByRole('button', { name: /submit to ai/i })
    expect(submits.length).toBeGreaterThan(0)
    submits.forEach((btn) => expect(btn).toBeDisabled())
  })

  it('enables Submit to AI once name, VIN, and complaint are filled', () => {
    render(<CounterIntake />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Robert Sandoval' } })
    fireEvent.change(screen.getByLabelText(/vin/i), { target: { value: 'WBA3A5C50EJF12345' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), {
      target: { value: 'Crank-no-start' },
    })
    const submits = screen.getAllByRole('button', { name: /submit to ai/i })
    submits.forEach((btn) => expect(btn).toBeEnabled())
  })

  it('POSTs the form values to /api/intake/submit and navigates on success', async () => {
    render(<CounterIntake />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Robert Sandoval' } })
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '(303) 555-0142' } })
    fireEvent.change(screen.getByLabelText(/vin/i), { target: { value: 'WBA3A5C50EJF12345' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), {
      target: { value: 'Crank-no-start' },
    })

    // Click either Submit-to-AI button (both submit the same form).
    fireEvent.click(screen.getAllByRole('button', { name: /submit to ai/i })[0])

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/intake/submit',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({ 'content-type': 'application/json' }),
          body: expect.stringContaining('Robert Sandoval'),
        }),
      )
    })

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/intake/plan-quote/draft-abc')
    })
  })
})
