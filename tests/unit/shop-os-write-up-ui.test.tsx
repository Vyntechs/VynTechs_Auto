import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WriteUp } from '@/components/screens/write-up'
import { encodeTicketIntakeDraft, ticketIntakeDraftKey, type TicketIntakeDraft } from '@/lib/intake/ticket-intake-draft'

const { mockPush } = vi.hoisted(() => ({ mockPush: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const key = ticketIntakeDraftKey(actorId, 'write_up')!
const emptyDraftForm = {
  existingVehicleId: null, name: '', phone: '', email: '', year: '', make: '', model: '', engine: '', vin: '', mileage: '', plate: '', concern: '', assignedTechId: null,
  intent: 'known', diagnosticMode: 'manual', knownWorkMode: 'manual', selectedDiagnostic: null, selectedKnownWork: null,
  customDiagnosticDescription: '', customDiagnosticHours: '', customDiagnosticPrice: '', requestedServiceKind: 'repair', requestedServiceDescription: '', customerSuppliedPartsNote: '', quoteMode: 'manual', selectedCannedJob: null, workKind: 'repair', requestedWork: '',
} satisfies TicketIntakeDraft['form']
const diagnosticJob = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Initial diagnosis', kind: 'diagnostic' as const,
  defaultRequiredSkillTier: 1 as const, sort: 1, fingerprint: 'a'.repeat(64),
  lines: [{ kind: 'labor' as const, description: 'Test', sort: 1, hours: '1', priceCents: 10_000, taxable: false, laborRateCents: 10_000 }],
  summary: { subtotalCents: 10_000, taxableSubtotalCents: 0, taxCents: 0, totalCents: 10_000 },
}

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
    const encoded = encodeTicketIntakeDraft({
      actorId, surface: 'write_up',
      form: {
        existingVehicleId: null, name: 'Marisol Vega', phone: '2145550197', email: '', year: '2019', make: 'Ford', model: 'F-150', engine: '', vin: '', mileage: '', plate: '', concern: 'Misfire', assignedTechId: null,
        intent: 'known', diagnosticMode: 'manual', knownWorkMode: 'canned', selectedDiagnostic: null,
        selectedKnownWork: { id: '11111111-1111-4111-8111-111111111111', fingerprint: 'a'.repeat(64) },
        customDiagnosticDescription: '', customDiagnosticHours: '', customDiagnosticPrice: '', requestedServiceKind: 'repair', requestedServiceDescription: 'Keep this typed work', customerSuppliedPartsNote: '', quoteMode: 'manual', selectedCannedJob: null, workKind: 'repair', requestedWork: '',
      }, pending: null,
    })!
    sessionStorage.setItem(key, encoded)

    const { container } = render(<WriteUp actorId={actorId} cannedJobs={[]} cannedCatalogAvailable={false} />)

    expect(await screen.findByRole('alert')).toHaveTextContent(/choose.*type/i)
    expect(screen.getByLabelText(/^name$/i)).toHaveValue('Marisol Vega')
    expect(screen.getByLabelText(/what brought them in/i)).toHaveValue('Misfire')
    expect(screen.getByLabelText(/^requested work$/i)).toHaveValue('Keep this typed work')
    expect(container.textContent).not.toContain(encoded)
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    expect(sessionStorage.getItem(key)).toBeNull()
    expect(mockPush).toHaveBeenCalledWith('/today')
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

  it('does not persist or warn on unload for untouched default canned work', () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    render(<WriteUp actorId={actorId} cannedJobs={[diagnosticJob]} />)

    expect(sessionStorage.getItem(key)).toBeNull()
    expect(addListener).not.toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })

  it.each([
    ['corrupt', '{not json'],
    ['expired', encodeTicketIntakeDraft({ actorId, surface: 'write_up', form: emptyDraftForm, pending: null }, new Date(0))!],
    ['another actor', encodeTicketIntakeDraft({ actorId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', surface: 'write_up', form: emptyDraftForm, pending: null })!],
  ])('deletes a %s stored draft instead of recovering it', async (_case, raw) => {
    sessionStorage.setItem(key, raw)
    render(<WriteUp actorId={actorId} />)

    await waitFor(() => expect(sessionStorage.getItem(key)).toBeNull())
    expect(screen.queryByText('Draft restored')).toBeNull()
  })

  it('retains saved work when an OK counter response has the wrong success status', async () => {
    const addListener = vi.spyOn(window, 'addEventListener')
    const removeListener = vi.spyOn(window, 'removeEventListener')
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ ticket: { id: '33333333-3333-4333-8333-333333333333' } }),
    } as Response)
    render(<WriteUp actorId={actorId} />)
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: 'Marisol Vega' } })
    fireEvent.change(screen.getByLabelText(/^phone$/i), { target: { value: '2145550197' } })
    fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2019' } })
    fireEvent.change(screen.getByLabelText(/^make$/i), { target: { value: 'Ford' } })
    fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: 'F-150' } })
    fireEvent.change(screen.getByLabelText(/what brought them in/i), { target: { value: 'Misfire' } })
    fireEvent.change(screen.getByLabelText(/^requested work$/i), { target: { value: 'Check ignition coils' } })
    fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])

    await screen.findByRole('alert')
    expect(sessionStorage.getItem(key)).not.toBeNull()
    expect(mockPush).not.toHaveBeenCalled()
    expect(addListener).toHaveBeenCalledWith('beforeunload', expect.any(Function))

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true, status: 201, json: async () => { throw new Error('truncated') },
    } as unknown as Response)
    fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    expect(sessionStorage.getItem(key)).not.toBeNull()
    expect(mockPush).not.toHaveBeenCalled()

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true, status: 201, json: async () => ({ ticket: { id: 'not-a-ticket-id' } }),
    } as Response)
    fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3))
    expect(sessionStorage.getItem(key)).not.toBeNull()
    expect(mockPush).not.toHaveBeenCalled()

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true, status: 201, json: async () => ({ ticket: { id: '33333333-3333-4333-8333-333333333333' } }),
    } as Response)
    fireEvent.click(screen.getAllByRole('button', { name: /create repair order/i })[0])
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/tickets/33333333-3333-4333-8333-333333333333'))
    expect(sessionStorage.getItem(key)).toBeNull()
    expect(removeListener).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })
})
