import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

import { WriteUp } from '@/components/screens/write-up'
import { encodeTicketIntakeDraft, ticketIntakeDraftKey } from '@/lib/intake/ticket-intake-draft'

const draftActorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const draftKey = ticketIntakeDraftKey(draftActorId, 'write_up')!

describe('WriteUp page wiring (search + form)', () => {
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
    sessionStorage.clear()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    mockPush.mockReset()
  })

  it('renders the search combobox above the customer form', () => {
    render(
      <WriteUp actorId={draftActorId}
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
      <WriteUp actorId={draftActorId}
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
    render(<WriteUp actorId={draftActorId} userEmail="test@example.com" recentCustomers={[]} />)
    // Customer + Vehicle groups are visible.
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/vin/i)).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('refuses an empty form by naming the first missing field, not by going dead', () => {
    render(<WriteUp actorId={draftActorId} userEmail="test@example.com" recentCustomers={[]} />)
    const submits = screen.getAllByRole('button', { name: /create repair order/i })
    submits.forEach((b) => expect(b).toBeEnabled())
    fireEvent.click(submits[0])
    expect(screen.getByRole('alert')).toHaveTextContent('Add the customer’s name.')
    expect(screen.getByLabelText(/^name$/i)).toHaveFocus()
  })

  it('passes recentCustomers={[]} when prop is omitted (no crash)', () => {
    render(<WriteUp actorId={draftActorId} userEmail="test@example.com" />)
    expect(screen.getByPlaceholderText(/customer name, phone, vin/i)).toBeInTheDocument()
  })

  it('preserves a picked vehicle and sends the exact existing-vehicle maintenance ticket body', async () => {
    const user = userEvent.setup()
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({ ticket: { id: '33333333-3333-4333-8333-333333333333' } }),
    } as Response)
    render(
      <WriteUp actorId={draftActorId}
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
    fireEvent.change(screen.getByLabelText(/^requested work$/i), {
      target: { value: 'Change engine oil and filter' },
    })
    fireEvent.change(screen.getByLabelText(/^work type$/i), {
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
      clientKey: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      ),
      vehicleMode: 'existing',
      existingVehicleId: '11111111-1111-4111-8111-111111111111',
      mileage: 121000,
      concern: 'Oil service due',
      whenStarted: null,
      howOften: null,
      work: {
        mode: 'manual',
        kind: 'maintenance',
        description: 'Change engine oil and filter',
      },
      assignedTechId: null,
    })
    expect(mockPush).toHaveBeenCalledWith('/tickets/33333333-3333-4333-8333-333333333333')
  })

  it('keeps discard and cancel routed to Today and never claims repair approval', async () => {
    const user = userEvent.setup()
    render(<WriteUp actorId={draftActorId} userEmail="test@example.com" />)
    expect(screen.queryByText(/repair approved|approved repair/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /discard/i }))
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(mockPush).toHaveBeenNthCalledWith(1, '/today')
    expect(mockPush).toHaveBeenNthCalledWith(2, '/today')
  })

  it('restores same-actor typed intake work once, keeps its retry identity, and lets the writer discard it', async () => {
    const user = userEvent.setup()
    const encoded = encodeTicketIntakeDraft({
      actorId: draftActorId,
      surface: 'write_up',
      form: {
        existingVehicleId: null, name: 'Marisol Vega', phone: '(214) 555-0197', email: 'marisol@example.com',
        year: '2019', make: 'Ford', model: 'F-150', engine: '3.5L', vin: '1FTFW1E41KFA00001', mileage: '88420',
        plate: 'TEX-4192', concern: 'Rough idle after warm-up', assignedTechId: null, intent: 'known',
        diagnosticMode: 'manual', knownWorkMode: 'manual', selectedDiagnostic: null, selectedKnownWork: null,
        customDiagnosticDescription: '', customDiagnosticHours: '', customDiagnosticPrice: '', requestedServiceKind: 'repair',
        requestedServiceDescription: 'Check ignition coils', customerSuppliedPartsNote: 'Customer has plugs',
        quoteMode: 'manual', selectedCannedJob: null, workKind: 'repair', requestedWork: '',
      },
      pending: { signature: 'stable-counter-signature', clientKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
    })!
    sessionStorage.setItem(draftKey, encoded)

    render(<WriteUp actorId={draftActorId} userEmail="test@example.com" />)

    expect(await screen.findByRole('status', { name: /draft restored/i })).toHaveTextContent('Draft restored')
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Marisol Vega')
    expect(screen.getByLabelText(/what brought them in/i)).toHaveValue('Rough idle after warm-up')
    expect(screen.getByLabelText(/^requested work$/i)).toHaveValue('Check ignition coils')
    expect(sessionStorage.getItem(draftKey)).not.toBeNull()

    await user.click(screen.getByRole('button', { name: /discard draft/i }))
    expect(sessionStorage.getItem(draftKey)).toBeNull()
    expect(mockPush).toHaveBeenCalledWith('/today')
  })
})
