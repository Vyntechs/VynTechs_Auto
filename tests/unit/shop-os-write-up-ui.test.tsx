import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WriteUp } from '@/components/screens/write-up'
import { encodeTicketIntakeDraft, ticketIntakeDraftKey } from '@/lib/intake/ticket-intake-draft'

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const key = ticketIntakeDraftKey(actorId, 'write_up')!

describe('WriteUp saved work recovery', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
  })
  afterEach(() => {
    sessionStorage.clear()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('refuses a stale saved-work selection while preserving typed fields and naming the next action', async () => {
    sessionStorage.setItem(key, encodeTicketIntakeDraft({
      actorId, surface: 'write_up',
      form: {
        existingVehicleId: null, name: 'Marisol Vega', phone: '2145550197', email: '', year: '2019', make: 'Ford', model: 'F-150', engine: '', vin: '', mileage: '', plate: '', concern: 'Misfire', assignedTechId: null,
        intent: 'known', diagnosticMode: 'manual', knownWorkMode: 'canned', selectedDiagnostic: null,
        selectedKnownWork: { id: '11111111-1111-4111-8111-111111111111', fingerprint: 'a'.repeat(64) },
        customDiagnosticDescription: '', customDiagnosticHours: '', customDiagnosticPrice: '', requestedServiceKind: 'repair', requestedServiceDescription: 'Keep this typed work', customerSuppliedPartsNote: '', quoteMode: 'manual', selectedCannedJob: null, workKind: 'repair', requestedWork: '',
      }, pending: null,
    })!)

    render(<WriteUp actorId={actorId} cannedJobs={[]} cannedCatalogAvailable={false} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/choose.*type/i)
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Marisol Vega')
    expect(screen.getByLabelText(/what brought them in/i)).toHaveValue('Misfire')
    expect(screen.getByLabelText(/^requested work$/i)).toHaveValue('Keep this typed work')
  })

  it('keeps the pending client key after an ambiguous failure and reuses it after remount', async () => {
    const { unmount } = render(<WriteUp actorId={actorId} />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Marisol Vega' } })
    fireEvent.change(screen.getByLabelText(/^phone$/i), { target: { value: '2145550197' } })
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2019' } })
    fireEvent.change(screen.getByLabelText(/^make$/i), { target: { value: 'Ford' } })
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: 'F-150' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), { target: { value: 'Misfire' } })
    fireEvent.change(screen.getByLabelText(/^requested work$/i), { target: { value: 'Check ignition coils' } })
    fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith('/api/tickets/counter', expect.anything()))
    const firstKey = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string).clientKey
    unmount()
    render(<WriteUp actorId={actorId} />)
    await screen.findByText('Draft restored')
    fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    expect(JSON.parse(vi.mocked(globalThis.fetch).mock.calls[1][1]!.body as string).clientKey).toBe(firstKey)
  })
})
