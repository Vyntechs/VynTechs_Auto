import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropdownWhichVehicle } from '@/components/vt/intake-search/dropdown'
import type { CustomerVehicle } from '@/lib/intake/search'

const vehicles: CustomerVehicle[] = [
  {
    id: 'veh-1',
    year: 2018,
    make: 'Toyota',
    model: 'Camry',
    engine: null,
    vin: 'VIN1',
    plate: 'ABC1',
    mileage: 80000,
    lastVisit: null,
  },
  {
    id: 'veh-2',
    year: 2014,
    make: 'Honda',
    model: 'Civic',
    engine: null,
    vin: 'VIN2',
    plate: 'ABC2',
    mileage: 120000,
    lastVisit: null,
  },
]

describe('DropdownWhichVehicle history link', () => {
  it('renders a history link per vehicle pointing at /vehicles/[id]', () => {
    render(
      <DropdownWhichVehicle
        customerName="Jane Doe"
        vehicles={vehicles}
        focusedIdx={null}
        onBack={vi.fn()}
        onPickVehicle={vi.fn()}
        onCreateNew={vi.fn()}
      />,
    )

    const links = screen.getAllByRole('link', { name: /history/i })
    expect(links).toHaveLength(2)
    expect(links[0].getAttribute('href')).toBe('/vehicles/veh-1')
    expect(links[1].getAttribute('href')).toBe('/vehicles/veh-2')
  })

  it('clicking the history link does not trigger onPickVehicle', async () => {
    const user = userEvent.setup()
    const onPick = vi.fn()
    render(
      <DropdownWhichVehicle
        customerName="Jane Doe"
        vehicles={vehicles}
        focusedIdx={null}
        onBack={vi.fn()}
        onPickVehicle={onPick}
        onCreateNew={vi.fn()}
      />,
    )

    const link = screen.getAllByRole('link', { name: /history/i })[0]
    await user.click(link)

    expect(onPick).not.toHaveBeenCalled()
  })
})
