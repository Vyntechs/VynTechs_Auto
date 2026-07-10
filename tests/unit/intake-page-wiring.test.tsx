import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import { CounterIntake } from '@/components/screens/counter-intake'

describe('CounterIntake page wiring (search + form)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ customers: [], vehicles: [], latencyMs: 5 }),
      }),
    )
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    mockPush.mockReset()
  })

  it('renders the search combobox above the customer form', () => {
    render(
      <CounterIntake
        userEmail="test@example.com"
        recentCustomers={[
          {
            id: 'c1',
            name: 'Sandoval',
            phone: '7705551234',
            email: null,
            vehicleCount: 1,
            vehicles: [],
            lastVisit: new Date(),
          },
        ]}
      />,
    )
    expect(screen.getByPlaceholderText(/customer name, phone, vin/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument()
  })

  it('focuses search box → shows recent customers from the prop', async () => {
    const user = userEvent.setup()
    render(
      <CounterIntake
        userEmail="test@example.com"
        recentCustomers={[
          {
            id: 'c1',
            name: 'Sandoval',
            phone: '7705551234',
            email: null,
            vehicleCount: 1,
            vehicles: [],
            lastVisit: new Date(),
          },
          {
            id: 'c2',
            name: 'Mendez',
            phone: '7205557710',
            email: null,
            vehicleCount: 2,
            vehicles: [],
            lastVisit: new Date(),
          },
        ]}
      />,
    )
    await user.click(screen.getByPlaceholderText(/customer name, phone, vin/i))
    expect(screen.getByText('Sandoval')).toBeInTheDocument()
    expect(screen.getByText('Mendez')).toBeInTheDocument()
  })

  it('shows the customer/vehicle form when no pick has been made', () => {
    render(<CounterIntake userEmail="test@example.com" recentCustomers={[]} />)
    // Customer + Vehicle groups are visible.
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/vin/i)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('disables Send to Techs initially (no name, no vin, no complaint)', () => {
    render(<CounterIntake userEmail="test@example.com" recentCustomers={[]} />)
    const submits = screen.getAllByRole('button', { name: /create repair order/i })
    submits.forEach((b) => expect(b).toBeDisabled())
  })

  it('passes recentCustomers={[]} when prop is omitted (no crash)', () => {
    render(<CounterIntake userEmail="test@example.com" />)
    expect(screen.getByPlaceholderText(/customer name, phone, vin/i)).toBeInTheDocument()
  })

  it('preserves a picked vehicle and sends the exact existing-vehicle maintenance ticket body', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: { id: 'ticket-existing' } }),
    } as Response)
    render(
      <CounterIntake
        userEmail="test@example.com"
        recentCustomers={[
          {
            id: 'c1',
            name: 'Sandoval',
            phone: '7705551234',
            email: null,
            vehicleCount: 1,
            vehicles: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                year: 2014,
                make: 'BMW',
                model: '335i',
                engine: 'N55',
                vin: 'WBA3A5C50EJF12345',
                plate: 'SHOP10',
                mileage: 120000,
                lastVisit: new Date(),
              },
            ],
            lastVisit: new Date(),
          },
        ]}
      />,
    )

    await user.click(screen.getByPlaceholderText(/customer name, phone, vin/i))
    await user.click(screen.getByText('Sandoval'))
    expect(screen.getByRole('status')).toHaveTextContent(/existing vehicle selected/i)
    expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/mileage today/i), { target: { value: '121000' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), {
      target: { value: 'Oil service due' },
    })
    fireEvent.change(screen.getByLabelText(/requested service description/i), {
      target: { value: 'Change engine oil and filter' },
    })
    fireEvent.change(screen.getByLabelText(/requested service kind/i), {
      target: { value: 'maintenance' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/tickets/counter',
      expect.objectContaining({ method: 'POST' }),
    ))
    const ticketCall = vi.mocked(globalThis.fetch).mock.calls.find(
      ([url]) => url === '/api/tickets/counter',
    )
    expect(JSON.parse(ticketCall![1]!.body as string)).toEqual({
      vehicleMode: 'existing',
      existingVehicleId: '11111111-1111-4111-8111-111111111111',
      mileage: 121000,
      concern: 'Oil service due',
      whenStarted: null,
      howOften: null,
      diagnosticAuthorization: { amountDollars: null, note: null },
      requestedService: {
        kind: 'maintenance',
        description: 'Change engine oil and filter',
      },
      assignedTechId: null,
    })
    expect(mockPush).toHaveBeenCalledWith('/tickets/ticket-existing')
  })

  it('keeps discard and cancel routed to Today and never claims repair approval', async () => {
    const user = userEvent.setup()
    render(<CounterIntake userEmail="test@example.com" />)
    expect(screen.queryByText(/repair approved|approved repair/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /discard/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockPush).toHaveBeenNthCalledWith(1, '/today')
    expect(mockPush).toHaveBeenNthCalledWith(2, '/today')
  })
})
