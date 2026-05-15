import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { VehicleHistory } from '@/components/screens/vehicle-history'
import type { Session } from '@/lib/db/schema'

// The component renders AppHeader, which transitively pulls in
// AppHeaderMenu (useRouter), SignOutButton (useRouter), WhatsNewBadge
// (usePathname). Stub them out for the test renderer.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/vehicles',
  useSearchParams: () => new URLSearchParams(),
}))

const baseIntake = {
  vehicleYear: 2018,
  vehicleMake: 'Toyota',
  vehicleModel: 'Camry',
  customerComplaint: 'rough idle',
}

const baseTree = {
  nodes: [{ id: 'root', label: 'pull DTCs', status: 'active' as const }],
  currentNodeId: 'root',
  message: 'go',
}

function mkSession(over: Partial<Session>): Session {
  return {
    id: 'sess-1',
    shopId: 'shop-1',
    techId: 'tech-1',
    vehicleId: 'veh-1',
    status: 'open',
    intake: baseIntake,
    treeState: baseTree,
    outcome: null,
    createdAt: new Date('2026-03-01T10:00:00Z'),
    closedAt: null,
    curatorNote: null,
    curatorOverrideAction: null,
    maxCorpusSimilarity: null,
    ...over,
  } as Session
}

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
    render(<VehicleHistory vehicle={vehicle} customer={customer} sessions={[]} />)

    // Year/make/model intentionally appear twice (page meta + vehicle module).
    expect(screen.getAllByText(/2018/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Toyota/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Camry/).length).toBeGreaterThan(0)
    expect(screen.getByText(/4T1B11HK7JU000001/)).toBeTruthy()
    expect(screen.getByText(/ABC123/)).toBeTruthy()
    expect(screen.getAllByText(/Jane Doe/).length).toBeGreaterThan(0)
  })

  it('shows the empty-state copy when there are no sessions', () => {
    render(<VehicleHistory vehicle={vehicle} customer={customer} sessions={[]} />)

    expect(screen.getByText(/No prior sessions for this vehicle/i)).toBeTruthy()
  })

  it('renders one card per session with complaint and status, linking to the session detail', () => {
    const sessions: Session[] = [
      mkSession({
        id: 'sess-newest',
        status: 'open',
        intake: { ...baseIntake, customerComplaint: 'rough idle at start' },
        createdAt: new Date('2026-03-01T10:00:00Z'),
      }),
      mkSession({
        id: 'sess-closed',
        status: 'closed',
        intake: { ...baseIntake, customerComplaint: 'misfire on cyl 3' },
        outcome: {
          rootCause: 'Failed ignition coil cyl 3',
          actionType: 'part_replacement',
          partInfo: { name: 'Denso ignition coil' },
          verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
          diagMinutes: 30,
          repairMinutes: 40,
        },
        closedAt: new Date('2026-02-02T11:00:00Z'),
        createdAt: new Date('2026-02-01T10:00:00Z'),
      }),
    ]

    render(<VehicleHistory vehicle={vehicle} customer={customer} sessions={sessions} />)

    const openLink = screen.getByRole('link', { name: /rough idle at start/i })
    expect(openLink.getAttribute('href')).toBe('/sessions/sess-newest')

    const closedLink = screen.getByRole('link', { name: /misfire on cyl 3/i })
    expect(closedLink.getAttribute('href')).toBe('/sessions/sess-closed')

    // Closed sessions surface the root-cause summary on the card.
    expect(within(closedLink).getByText(/Failed ignition coil cyl 3/i)).toBeTruthy()
  })
})
