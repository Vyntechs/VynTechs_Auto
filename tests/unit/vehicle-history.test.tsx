import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VehicleHistory } from '@/components/screens/vehicle-history'
import type { VehicleHistoryTicket } from '@/lib/tickets'

// The component renders AppHeader, which transitively pulls in
// AppHeaderMenu (useRouter), SignOutButton (useRouter), WhatsNewBadge
// (usePathname). Stub them out for the test renderer.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/vehicles',
  useSearchParams: () => new URLSearchParams(),
}))

const vehicle = {
  id: 'veh-1',
  year: 2018,
  make: 'Toyota',
  model: 'Camry',
  vin: '4T1B11HK7JU000001',
  plate: 'ABC123',
}

const customer = { id: 'cust-1', name: 'Jane Doe' }

function ticket(over: Partial<VehicleHistoryTicket>): VehicleHistoryTicket {
  return {
    id: 't1',
    ticketNumber: 12,
    concern: 'Grinding noise when braking',
    status: 'closed',
    createdAt: new Date('2026-06-01T12:00:00Z'),
    closedAt: new Date('2026-06-01T15:00:00Z'),
    jobs: [],
    ...over,
  }
}

describe('VehicleHistory', () => {
  it('renders the vehicle header with year, make, model, VIN, and plate', () => {
    render(<VehicleHistory vehicle={vehicle} customer={customer} visits={[]} />)

    // Year/make/model intentionally appear twice (page meta + vehicle module).
    expect(screen.getAllByText(/2018/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Toyota/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Camry/).length).toBeGreaterThan(0)
    expect(screen.getByText(/4T1B11HK7JU000001/)).toBeTruthy()
    expect(screen.getByText(/ABC123/)).toBeTruthy()
    expect(screen.getAllByText(/Jane Doe/).length).toBeGreaterThan(0)
  })

  it('shows vehicle and customer truth without diagnostic session cards or links', () => {
    render(<VehicleHistory vehicle={vehicle} customer={customer} visits={[]} />)

    expect(screen.queryByText(/sessions|rough idle|root cause/i)).toBeNull()
    expect(document.querySelector('a[href^="/sessions/"]')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to Intake' })).toHaveAttribute('href', '/intake')
  })

  it('surfaces declined work as recommended, linked to its ticket', () => {
    const visits: VehicleHistoryTicket[] = [
      ticket({
        id: 't-42',
        ticketNumber: 42,
        jobs: [
          { id: 'j1', ticketId: 't-42', ticketNumber: 42, title: 'Replace rear rotors', kind: 'repair', approvalState: 'declined', workStatus: 'open' },
          { id: 'j2', ticketId: 't-42', ticketNumber: 42, title: 'Oil change', kind: 'maintenance', approvalState: 'approved', workStatus: 'done' },
        ],
      }),
    ]

    render(<VehicleHistory vehicle={vehicle} customer={customer} visits={visits} />)

    expect(screen.getByText('Recommended · not done yet')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Replace rear rotors' })
    expect(link).toHaveAttribute('href', '/tickets/t-42')
    expect(screen.getAllByText(/RO 000042/).length).toBeGreaterThan(0)
  })

  it('shows past visits and no recommended section when nothing was declined', () => {
    const visits: VehicleHistoryTicket[] = [
      ticket({
        id: 't-7',
        ticketNumber: 7,
        concern: 'AC not cold',
        jobs: [
          { id: 'j9', ticketId: 't-7', ticketNumber: 7, title: 'Recharge AC', kind: 'repair', approvalState: 'approved', workStatus: 'done' },
        ],
      }),
    ]

    render(<VehicleHistory vehicle={vehicle} customer={customer} visits={visits} />)

    expect(screen.queryByText('Recommended · not done yet')).not.toBeInTheDocument()
    expect(screen.getByText('AC not cold')).toBeInTheDocument()
    expect(screen.getByText(/RO 000007/)).toBeInTheDocument()
  })

  it('shows an honest empty state when there are no visits', () => {
    render(<VehicleHistory vehicle={vehicle} customer={customer} visits={[]} />)

    expect(screen.getByText(/No past visits recorded/i)).toBeInTheDocument()
  })

  it('honestly signals when older stored visits are outside the bounded view', () => {
    render(<VehicleHistory vehicle={vehicle} customer={customer} visits={[ticket({})]} hasMore />)

    expect(screen.getByText('Showing the 100 most recent visits. Older repair orders remain stored.')).toBeInTheDocument()
  })
})
