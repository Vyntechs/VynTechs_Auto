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
        json: async () => ({ sessionId: 'session-abc' }),
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    mockPush.mockReset()
  })

  it('renders the screen title', () => {
    render(<CounterIntake userEmail="test@example.com" />)
    expect(screen.getByRole('heading', { name: /who's at the counter/i })).toBeInTheDocument()
  })

  it('renders the customer, vehicle, and complaint fields', () => {
    render(<CounterIntake userEmail="test@example.com" />)
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
    render(<CounterIntake userEmail="test@example.com" />)
    const vin = screen.getByLabelText(/vin/i) as HTMLInputElement
    fireEvent.change(vin, { target: { value: 'wba3a5c50ejf12345' } })
    expect(vin.value).toBe('WBA3A5C50EJF12345')
  })

  it('toggles VIN scan state when the scan button is clicked', () => {
    render(<CounterIntake userEmail="test@example.com" />)
    // /scan/i would also match the disabled "Scan VIN/plate" placeholder in
    // the new PredictiveIntakeSearch bar; narrow to the form's scan toggle.
    const scanBtn = screen.getByRole('button', { name: /scan with camera/i })
    fireEvent.click(scanBtn)
    expect(scanBtn).toHaveTextContent(/scanned/i)
  })

  it('disables submit when required fields are empty', () => {
    render(<CounterIntake userEmail="test@example.com" />)
    // The screen has two submit buttons (header + form footer); both must be disabled.
    const submits = screen.getAllByRole('button', { name: /create repair order/i })
    expect(submits.length).toBeGreaterThan(0)
    submits.forEach((btn) => expect(btn).toBeDisabled())
  })

  it('enables submit once name, phone, year, make, model, and complaint are filled (VIN optional)', () => {
    // Real PR-27 preview bug: previously required VIN at the UI gate even
    // though /api/intake/submit doesn't. Counter staff with no VIN in hand
    // were locked out with no hint why.
    render(<CounterIntake userEmail="test@example.com" />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Brittney Nichols' } })
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '1235542121' } })
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2007' } })
    fireEvent.change(screen.getByLabelText(/^make$/i), { target: { value: 'Chevrolet' } })
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: 'Tahoe' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), {
      target: { value: 'Crank-no-start' },
    })
    // NOTE: VIN intentionally left blank.
    const submits = screen.getAllByRole('button', { name: /create repair order/i })
    submits.forEach((btn) => expect(btn).toBeEnabled())
  })

  it('shows the logged-in user email in the top bar (not the old "Diana" placeholder)', () => {
    render(<CounterIntake userEmail="brandon@vyntechs.com" />)
    expect(screen.getByText('brandon@vyntechs.com')).toBeInTheDocument()
    expect(screen.queryByText('Diana')).not.toBeInTheDocument()
  })

  it('soft-fails to "—" in the top bar when no userEmail is supplied (no crash, no build break)', () => {
    render(<CounterIntake />)
    // Two dashes render: one in the avatar circle, one in the name span.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText('Diana')).not.toBeInTheDocument()
  })

  it('POSTs the form values to /api/intake/submit and navigates on success', async () => {
    render(<CounterIntake userEmail="test@example.com" />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Robert Sandoval' } })
    fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '(303) 555-0142' } })
    fireEvent.change(screen.getByLabelText(/vin/i), { target: { value: 'WBA3A5C50EJF12345' } })
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2014' } })
    fireEvent.change(screen.getByLabelText(/^make$/i), { target: { value: 'BMW' } })
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: '335i' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), {
      target: { value: 'Crank-no-start' },
    })

    // Click either Send-to-Techs button (both submit the same form).
    fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])

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
      expect(mockPush).toHaveBeenCalledWith('/sessions/session-abc')
    })
  })
})
