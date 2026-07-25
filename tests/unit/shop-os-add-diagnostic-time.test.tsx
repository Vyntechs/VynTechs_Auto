import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))

import { AddDiagnosticTime } from '@/components/screens/add-diagnostic-time'

const TICKET_ID = '00000000-0000-4000-8000-000000000401'

describe('AddDiagnosticTime', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ticket: { id: TICKET_ID } }),
    }))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    mockRefresh.mockReset()
  })

  it('posts the typed description, hours, and dollar price converted to cents', async () => {
    render(<AddDiagnosticTime ticketId={TICKET_ID} />)
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: '  Deeper electrical trace  ' },
    })
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1.5' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '281.25' } })
    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(url).toBe(`/api/tickets/${TICKET_ID}/quote/diagnostic-time`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init!.body as string)).toEqual({
      description: 'Deeper electrical trace',
      laborHours: 1.5,
      priceCents: 28_125,
    })
  })

  it('omits the description when the writer leaves it blank and refreshes on success', async () => {
    render(<AddDiagnosticTime ticketId={TICKET_ID} />)
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))

    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body).toEqual({ laborHours: 1, priceCents: 12_000 })
  })

  it('calls onAdded instead of router.refresh when the parent supplies it', async () => {
    const onAdded = vi.fn()
    render(<AddDiagnosticTime ticketId={TICKET_ID} onAdded={onAdded} />)
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '240' } })
    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
