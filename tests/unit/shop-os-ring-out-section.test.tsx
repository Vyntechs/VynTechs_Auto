import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RingOutSection } from '@/components/screens/ring-out-section'
import type { TicketRingOut } from '@/lib/shop-os/ring-out'

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const TICKET = '00000000-0000-4000-8000-000000000020'
const REQUEST = '00000000-0000-4000-8000-000000000099'

const OPEN: TicketRingOut = {
  ticketId: TICKET,
  status: 'open',
  owed: {
    subtotalCents: 15_000,
    taxCents: 800,
    totalCents: 15_800,
    jobs: [
      { jobId: '00000000-0000-4000-8000-000000000030', title: 'Front brakes', subtotalCents: 10_000 },
      { jobId: '00000000-0000-4000-8000-000000000031', title: 'Oil change', subtotalCents: 5_000 },
    ],
  },
  paidCents: 0,
  balanceCents: 15_800,
  payments: [],
  canRecordPayment: true,
  canClose: false,
  closedAt: null,
}

const PAID: TicketRingOut = {
  ...OPEN,
  paidCents: 15_800,
  balanceCents: 0,
  payments: [{
    id: '00000000-0000-4000-8000-000000000060',
    amountCents: 15_800, method: 'cash', note: null, recordedAt: '2026-07-19T10:00:00.000Z',
  }],
  canRecordPayment: false,
  canClose: true,
}

const CLOSED: TicketRingOut = {
  ...PAID,
  status: 'closed',
  canClose: false,
  closedAt: '2026-07-19T10:01:00.000Z',
}

describe('RingOutSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    router.refresh.mockClear()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => REQUEST) })
  })

  it('shows the bill and a prefilled payment form before anything is paid', () => {
    render(<RingOutSection ticketId={TICKET} initialRingOut={OPEN} />)
    expect(screen.getByRole('heading', { name: 'Ring out' })).toBeInTheDocument()
    expect(screen.getByText('Front brakes')).toBeInTheDocument()
    const total = screen.getByText('Total').closest('div') as HTMLElement
    expect(within(total).getByText('$158.00')).toBeInTheDocument()
    const balance = screen.getByText('Balance').closest('div') as HTMLElement
    expect(within(balance).getByText('$158.00')).toBeInTheDocument()
    expect((screen.getByLabelText('Payment amount') as HTMLInputElement).value).toBe('158.00')
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /close ticket/i })).toBeNull()
  })

  it('records a payment then closes, sending the exact money to the server', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ringOut: PAID }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ringOut: CLOSED }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<RingOutSection ticketId={TICKET} initialRingOut={OPEN} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`/api/tickets/${TICKET}/payments`)
    expect(JSON.parse(String(init?.body))).toEqual({
      requestKey: REQUEST, amountCents: 15_800, method: 'cash', note: null,
    })

    // Balance is cleared; the close action replaces the payment form.
    expect(await screen.findByRole('button', { name: 'Mark paid & close ticket' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Record payment' })).toBeNull()
    const tally = screen.getByText('Balance').closest('div') as HTMLElement
    expect(within(tally).getByText('$0.00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mark paid & close ticket' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/tickets/${TICKET}/close`)

    expect(await screen.findByRole('heading', { name: 'Receipt' })).toBeInTheDocument()
    expect(screen.getByText(/Closed/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /close ticket/i })).toBeNull()
    expect(router.refresh).toHaveBeenCalled()
  })

  it('surfaces an overpayment rejection without changing the balance', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false, status: 422, json: async () => ({ error: 'overpayment' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<RingOutSection ticketId={TICKET} initialRingOut={OPEN} />)
    fireEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/more than the balance owed/i)
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument()
  })

  it('renders a read-only receipt for a closed ticket', () => {
    render(<RingOutSection ticketId={TICKET} initialRingOut={CLOSED} />)
    expect(screen.getByRole('heading', { name: 'Receipt' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('Cash')).toBeInTheDocument()
  })
})
