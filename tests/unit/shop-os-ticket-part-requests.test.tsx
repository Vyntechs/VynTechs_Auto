import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TicketPartRequests } from '@/components/screens/ticket-part-requests'
import type { TicketPartRequestView } from '@/lib/shop-os/part-requests-ui'

const router = { refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

const TICKET = '00000000-0000-4000-8000-000000000020'
const RID = '00000000-0000-4000-8000-000000000041'

const req = (overrides: Partial<TicketPartRequestView> = {}): TicketPartRequestView => ({
  id: RID, jobId: '00000000-0000-4000-8000-000000000030', description: 'Water pump', preference: 'Motorcraft',
  quantity: 1, status: 'requested', requestedAt: '2026-07-19T12:00:00.000Z', resolvedAt: null,
  jobTitle: 'Replace water pump', requestedByName: 'Alex Tech', ...overrides,
})

describe('TicketPartRequests', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    router.refresh.mockClear()
  })

  it('renders nothing when there are no requests', () => {
    const { container } = render(<TicketPartRequests ticketId={TICKET} requests={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a waiting request with who asked and marks it sourced', async () => {
    // The resolve route returns a bare request (no jobTitle / requestedByName).
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ request: {
        id: RID, jobId: '00000000-0000-4000-8000-000000000030', description: 'Water pump', preference: 'Motorcraft',
        quantity: 1, status: 'sourced', requestedAt: '2026-07-19T12:00:00.000Z', resolvedAt: '2026-07-19T12:05:00.000Z',
      } }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<TicketPartRequests ticketId={TICKET} requests={[req()]} />)
    expect(screen.getByText('Water pump')).toBeInTheDocument()
    expect(screen.getByText(/Alex Tech/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/tickets/${TICKET}/part-requests/${RID}`)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ status: 'sourced' })
    await waitFor(() => expect(router.refresh).toHaveBeenCalled())
  })

  it('shows handled requests read-only', () => {
    render(<TicketPartRequests ticketId={TICKET} requests={[req({ status: 'sourced', resolvedAt: '2026-07-19T12:05:00.000Z' })]} />)
    expect(screen.getByText('Got it')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
