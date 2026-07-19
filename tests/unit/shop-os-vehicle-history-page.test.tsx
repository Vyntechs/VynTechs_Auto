import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  historyScreenMock,
  limitMock,
  listTicketHistoryMock,
  listSessionsMock,
  requireUserMock,
  selectMock,
} = vi.hoisted(() => ({
  historyScreenMock: vi.fn(),
  limitMock: vi.fn(),
  listTicketHistoryMock: vi.fn(),
  listSessionsMock: vi.fn(),
  requireUserMock: vi.fn(),
  selectMock: vi.fn(),
}))

const whereMock = vi.fn(() => ({ limit: limitMock }))
const innerJoinMock = vi.fn(() => ({ where: whereMock }))
const fromMock = vi.fn(() => ({ innerJoin: innerJoinMock }))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(() => { throw new Error('not-found') }),
}))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: requireUserMock }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/db/client', () => ({ db: { select: selectMock } }))
vi.mock('@/lib/db/queries', () => ({ listSessionsForVehicle: listSessionsMock }))
vi.mock('@/lib/tickets', () => ({ listVehicleTicketHistory: listTicketHistoryMock }))
vi.mock('@/components/screens/vehicle-history', () => ({
  VehicleHistory: (props: unknown) => {
    historyScreenMock(props)
    return <div>Vehicle facts</div>
  },
}))

import VehicleHistoryPage from '@/app/(app)/vehicles/[vehicleId]/page'

describe('reachable vehicle history page without diagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectMock.mockReturnValue({ from: fromMock })
    requireUserMock.mockResolvedValue({
      user: { id: 'user-1', email: 'tech@shop.test' },
      profile: { id: 'profile-1', shopId: 'shop-1' },
    })
    limitMock.mockResolvedValue([{
      vehicle: {
        id: 'vehicle-1',
        customerId: 'customer-1',
        year: 2018,
        make: 'Toyota',
        model: 'Camry',
        vin: '4T1B11HK7JU000001',
        plate: 'ABC123',
      },
      customer: {
        id: 'customer-1',
        shopId: 'shop-1',
        name: 'Jane Doe',
      },
    }])
    listTicketHistoryMock.mockResolvedValue([])
    listSessionsMock.mockResolvedValue([])
  })

  it('loads vehicle/customer truth without a diagnostic-session query or prop', async () => {
    render(await VehicleHistoryPage({
      params: Promise.resolve({ vehicleId: 'vehicle-1' }),
    }))

    expect(screen.getByText('Vehicle facts')).toBeInTheDocument()
    expect(listSessionsMock).not.toHaveBeenCalled()
    expect(listTicketHistoryMock).toHaveBeenCalledWith(
      { select: selectMock },
      { shopId: 'shop-1', vehicleId: 'vehicle-1' },
    )
    expect(historyScreenMock).toHaveBeenCalledWith({
      vehicle: {
        id: 'vehicle-1',
        year: 2018,
        make: 'Toyota',
        model: 'Camry',
        vin: '4T1B11HK7JU000001',
        plate: 'ABC123',
      },
      customer: { id: 'customer-1', name: 'Jane Doe' },
      visits: [],
    })
  })

  it('contains no reachable diagnostic-session dependency', async () => {
    const source = await readFile(
      path.join(process.cwd(), 'app/(app)/vehicles/[vehicleId]/page.tsx'),
      'utf8',
    )

    expect(source).not.toMatch(/listSessionsForVehicle|sessions=/)
  })
})
