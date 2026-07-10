import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PredictiveIntakeSearch } from '@/components/vt/intake-search'

const recents = [
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
]

const fetchOk = (body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))

describe('<PredictiveIntakeSearch>', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the search bar in resting state', () => {
    render(
      <PredictiveIntakeSearch
        recentCustomers={recents}
        onPickVehicle={vi.fn()}
        onCreateNew={vi.fn()}
      />,
    )
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('does not render the dead Scan VIN/plate coming-soon control', () => {
    render(
      <PredictiveIntakeSearch
        recentCustomers={recents}
        onPickVehicle={vi.fn()}
        onCreateNew={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: /scan vin\/plate/i })).toBeNull()
  })

  it('opens the dropdown with recent customers when the bar is focused', async () => {
    const user = userEvent.setup()
    render(
      <PredictiveIntakeSearch
        recentCustomers={recents}
        onPickVehicle={vi.fn()}
        onCreateNew={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByText('Sandoval')).toBeInTheDocument()
    expect(screen.getByText('Mendez')).toBeInTheDocument()
  })

  it('shows "+ Create new customer" at the bottom of the dropdown', async () => {
    const user = userEvent.setup()
    render(
      <PredictiveIntakeSearch
        recentCustomers={recents}
        onPickVehicle={vi.fn()}
        onCreateNew={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByText(/Create new customer/i)).toBeInTheDocument()
  })

  it('navigates rows with arrow keys', async () => {
    const user = userEvent.setup()
    render(
      <PredictiveIntakeSearch
        recentCustomers={recents}
        onPickVehicle={vi.fn()}
        onCreateNew={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', 'pis-row-0'))
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', 'pis-row-1'))
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', 'pis-row-0'))
  })

  describe('customer-pick routing', () => {
    it('routes customer click with 0 vehicles to onCreateNew with prefill', async () => {
      const onCreate = vi.fn()
      const onPick = vi.fn()
      const user = userEvent.setup()
      const zero = [
        {
          id: 'c-zero', name: 'Zero Customer', phone: '555-1', email: null,
          vehicleCount: 0, vehicles: [], lastVisit: new Date(),
        },
      ]
      render(
        <PredictiveIntakeSearch
          recentCustomers={zero}
          onPickVehicle={onPick}
          onCreateNew={onCreate}
        />,
      )
      await user.click(screen.getByRole('combobox'))
      await user.click(screen.getByText('Zero Customer'))
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Zero Customer', phone: '555-1' }),
      )
      expect(onPick).not.toHaveBeenCalled()
    })

    it('routes customer click with 1 vehicle to onPickVehicle (auto-pick)', async () => {
      const onCreate = vi.fn()
      const onPick = vi.fn()
      const user = userEvent.setup()
      const one = [
        {
          id: 'c-one', name: 'One Vehicle Customer', phone: '555-2', email: null,
          vehicleCount: 1,
          vehicles: [{
            id: 'v-1', year: 2020, make: 'Honda', model: 'Civic',
            engine: null, vin: null, plate: null, mileage: null, lastVisit: null,
          }],
          lastVisit: new Date(),
        },
      ]
      render(
        <PredictiveIntakeSearch
          recentCustomers={one}
          onPickVehicle={onPick}
          onCreateNew={onCreate}
        />,
      )
      await user.click(screen.getByRole('combobox'))
      await user.click(screen.getByText('One Vehicle Customer'))
      expect(onPick).toHaveBeenCalledWith('v-1')
      expect(onCreate).not.toHaveBeenCalled()
    })

    it('routes customer click with 2+ vehicles to the Which vehicle? tier', async () => {
      const user = userEvent.setup()
      const many = [
        {
          id: 'c-many', name: 'Multi Customer', phone: '555-3', email: null,
          vehicleCount: 2,
          vehicles: [
            { id: 'v-a', year: 2020, make: 'Honda', model: 'Civic',
              engine: null, vin: null, plate: null, mileage: null, lastVisit: null },
            { id: 'v-b', year: 2018, make: 'Ford', model: 'F-150',
              engine: null, vin: null, plate: null, mileage: null, lastVisit: null },
          ],
          lastVisit: new Date(),
        },
      ]
      const onPick = vi.fn()
      const onCreate = vi.fn()
      render(
        <PredictiveIntakeSearch
          recentCustomers={many}
          onPickVehicle={onPick}
          onCreateNew={onCreate}
        />,
      )
      await user.click(screen.getByRole('combobox'))
      await user.click(screen.getByText('Multi Customer'))
      expect(screen.getByText(/which vehicle\?/i)).toBeInTheDocument()
      expect(screen.getByText(/2020 Honda Civic/i)).toBeInTheDocument()
      expect(screen.getByText(/2018 Ford F-150/i)).toBeInTheDocument()
      expect(onPick).not.toHaveBeenCalled()
      expect(onCreate).not.toHaveBeenCalled()
    })

    it('picks a vehicle from the tier when its row is clicked', async () => {
      const onPick = vi.fn()
      const user = userEvent.setup()
      const many = [
        {
          id: 'c-many', name: 'Multi Customer', phone: '555-3', email: null,
          vehicleCount: 2,
          vehicles: [
            { id: 'v-a', year: 2020, make: 'Honda', model: 'Civic',
              engine: null, vin: null, plate: null, mileage: null, lastVisit: null },
            { id: 'v-b', year: 2018, make: 'Ford', model: 'F-150',
              engine: null, vin: null, plate: null, mileage: null, lastVisit: null },
          ],
          lastVisit: new Date(),
        },
      ]
      render(
        <PredictiveIntakeSearch
          recentCustomers={many}
          onPickVehicle={onPick}
          onCreateNew={vi.fn()}
        />,
      )
      await user.click(screen.getByRole('combobox'))
      await user.click(screen.getByText('Multi Customer'))
      await user.click(screen.getByText(/2018 Ford F-150/i))
      expect(onPick).toHaveBeenCalledWith('v-b')
    })

    it('tier "Add another vehicle" preserves customer prefill (not blank tokens)', async () => {
      const onCreate = vi.fn()
      const user = userEvent.setup()
      const many = [
        {
          id: 'c-many', name: 'Multi Customer', phone: '555-3', email: 'mc@x.test',
          vehicleCount: 2,
          vehicles: [
            { id: 'v-a', year: 2020, make: 'Honda', model: 'Civic',
              engine: null, vin: null, plate: null, mileage: null, lastVisit: null },
            { id: 'v-b', year: 2018, make: 'Ford', model: 'F-150',
              engine: null, vin: null, plate: null, mileage: null, lastVisit: null },
          ],
          lastVisit: new Date(),
        },
      ]
      render(
        <PredictiveIntakeSearch
          recentCustomers={many}
          onPickVehicle={vi.fn()}
          onCreateNew={onCreate}
        />,
      )
      await user.click(screen.getByRole('combobox'))
      await user.click(screen.getByText('Multi Customer'))
      await user.click(screen.getByText(/add another vehicle for this customer/i))
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Multi Customer',
          phone: '555-3',
          email: 'mc@x.test',
        }),
      )
    })
  })

  it('Shift+Enter activates "+ Create new" from anywhere in the list', async () => {
    const onCreate = vi.fn()
    const user = userEvent.setup()
    render(
      <PredictiveIntakeSearch
        recentCustomers={recents}
        onPickVehicle={vi.fn()}
        onCreateNew={onCreate}
      />,
    )
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(onCreate).toHaveBeenCalled()
  })

  it('Escape closes the dropdown', async () => {
    const user = userEvent.setup()
    render(
      <PredictiveIntakeSearch
        recentCustomers={recents}
        onPickVehicle={vi.fn()}
        onCreateNew={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox')
    await user.click(input)
    expect(screen.queryByText('Sandoval')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('Sandoval')).not.toBeInTheDocument()
  })

  it('does not crash when results contain ISO-string dates (wire-format)', async () => {
    // Reproduces a real PR-27 preview bug: /api/intake/search returns
    // lastVisit as an ISO string, but our types claimed Date. Calling
    // .getTime() on a string crashed the React tree → "page couldn't load".
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fetchOk({
          customers: [
            {
              id: 'c1',
              name: 'Sandoval',
              phone: '7705551234',
              email: null,
              vehicleCount: 1,
              lastVisit: '2026-05-11T10:24:00.000Z', // ← ISO string, like real JSON
            },
          ],
          vehicles: [
            {
              id: 'v1',
              year: 2014,
              make: 'BMW',
              model: '335i',
              engine: null,
              vin: null,
              plate: null,
              mileage: null,
              ownerId: 'c1',
              ownerName: 'Sandoval',
              lastVisit: '2026-05-11T10:24:00.000Z',
            },
          ],
          latencyMs: 5,
        }),
      ),
    )
    render(
      <PredictiveIntakeSearch
        recentCustomers={[]}
        onPickVehicle={vi.fn()}
        onCreateNew={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'sandoval')
    await new Promise((r) => setTimeout(r, 300))
    // Should not have thrown; the customer + vehicle rows should be there.
    const options = screen.queryAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
    expect(options.some((o) => o.textContent?.includes('Sandoval'))).toBe(true)
  })

  it('typing a query that matches a single-vehicle customer → picking it calls onPickVehicle', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fetchOk({
          customers: [
            {
              id: 'c1',
              name: 'Sandoval',
              phone: null,
              email: null,
              vehicleCount: 1,
              vehicles: [
                {
                  id: 'v1', year: 2014, make: 'BMW', model: '335i',
                  engine: null, vin: null, plate: null, mileage: null, lastVisit: null,
                },
              ],
              lastVisit: null,
            },
          ],
          vehicles: [
            {
              id: 'v1',
              year: 2014,
              make: 'BMW',
              model: '335i',
              engine: null,
              vin: null,
              plate: null,
              mileage: null,
              ownerId: 'c1',
              ownerName: 'Sandoval',
              lastVisit: null,
            },
          ],
          latencyMs: 5,
        }),
      ),
    )
    render(
      <PredictiveIntakeSearch
        recentCustomers={[]}
        onPickVehicle={onPick}
        onCreateNew={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'sandoval')
    await waitFor(() => expect(screen.getByText('Sandoval')).toBeInTheDocument())
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(onPick).toHaveBeenCalledWith('v1'))
  })

  it('shows the "which vehicle?" tier when a customer has >1 vehicle in the results', async () => {
    const onPick = vi.fn()
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        fetchOk({
          customers: [
            {
              id: 'c1',
              name: 'Sandoval',
              phone: null,
              email: null,
              vehicleCount: 2,
              vehicles: [
                {
                  id: 'v1', year: 2014, make: 'BMW', model: '335i',
                  engine: null, vin: 'A', plate: null, mileage: null, lastVisit: null,
                },
                {
                  id: 'v2', year: 2019, make: 'Honda', model: 'Pilot',
                  engine: null, vin: 'B', plate: null, mileage: null, lastVisit: null,
                },
              ],
              lastVisit: null,
            },
          ],
          vehicles: [
            {
              id: 'v1',
              year: 2014,
              make: 'BMW',
              model: '335i',
              engine: null,
              vin: 'A',
              plate: null,
              mileage: null,
              ownerId: 'c1',
              ownerName: 'Sandoval',
              lastVisit: null,
            },
            {
              id: 'v2',
              year: 2019,
              make: 'Honda',
              model: 'Pilot',
              engine: null,
              vin: 'B',
              plate: null,
              mileage: null,
              ownerId: 'c1',
              ownerName: 'Sandoval',
              lastVisit: null,
            },
          ],
          latencyMs: 5,
        }),
      ),
    )
    render(
      <PredictiveIntakeSearch
        recentCustomers={[]}
        onPickVehicle={onPick}
        onCreateNew={vi.fn()}
      />,
    )
    const input = screen.getByRole('combobox')
    await user.click(input)
    await user.type(input, 'sandoval')
    // Wait past the 150ms debounce + fetch + state update.
    // findByText/findByRole's default 1s poll can race with React 19's batched
    // state updates here; an explicit settle wait is more robust than polling.
    await new Promise((r) => setTimeout(r, 300))

    const options = screen.queryAllByRole('option')
    const customerRow = options.find((o) => o.textContent?.includes('Sandoval'))
    expect(customerRow).toBeDefined()
    await user.click(customerRow!)

    await waitFor(() => expect(screen.getByText(/which vehicle/i)).toBeInTheDocument())
    const tierOptions = screen.queryAllByRole('option')
    const firstVehicle = tierOptions.find((o) => o.textContent?.includes('BMW'))
    expect(firstVehicle).toBeDefined()
    await user.click(firstVehicle!)
    expect(onPick).toHaveBeenCalledWith('v1')
  })
})
