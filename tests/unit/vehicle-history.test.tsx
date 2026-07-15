import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { VehicleHistory } from '@/components/screens/vehicle-history'

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

describe('VehicleHistory', () => {
  it('renders the vehicle header with year, make, model, VIN, and plate', () => {
    render(<VehicleHistory vehicle={vehicle} customer={customer} />)

    // Year/make/model intentionally appear twice (page meta + vehicle module).
    expect(screen.getAllByText(/2018/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Toyota/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Camry/).length).toBeGreaterThan(0)
    expect(screen.getByText(/4T1B11HK7JU000001/)).toBeTruthy()
    expect(screen.getByText(/ABC123/)).toBeTruthy()
    expect(screen.getAllByText(/Jane Doe/).length).toBeGreaterThan(0)
  })

  it('shows vehicle and customer truth without diagnostic session cards or links', () => {
    render(<VehicleHistory vehicle={vehicle} customer={customer} />)

    expect(screen.queryByText(/sessions|rough idle|root cause/i)).toBeNull()
    expect(document.querySelector('a[href^="/sessions/"]')).toBeNull()
    expect(screen.getByRole('link', { name: 'Back to Intake' })).toHaveAttribute('href', '/intake')
  })
})
