import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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
            lastVisit: new Date(),
          },
        ]}
      />,
    )
    expect(screen.getByRole('combobox')).toBeInTheDocument()
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
            lastVisit: new Date(),
          },
          {
            id: 'c2',
            name: 'Mendez',
            phone: '7205557710',
            email: null,
            vehicleCount: 2,
            lastVisit: new Date(),
          },
        ]}
      />,
    )
    await user.click(screen.getByRole('combobox'))
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
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })
})
