import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TicketLookupPanel } from '@/components/screens/ticket-lookup-panel'

const closedHit = {
  ticketId: '11111111-1111-4111-8111-111111111111',
  ticketNumber: 412,
  status: 'closed' as const,
  concern: 'engine ticking cold and hot',
  customerName: 'Drew G',
  vehicle: { year: 2021, make: 'RAM', model: '2500' },
  openedAt: '2026-07-01T15:00:00.000Z',
  closedAt: '2026-07-02T18:30:00.000Z',
}

const respond = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }))

describe('<TicketLookupPanel>', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('finds a closed repair order and links straight to it', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond({ tickets: [closedHit] }))
    const user = userEvent.setup()
    render(<TicketLookupPanel />)

    await user.type(screen.getByLabelText('Find a repair order'), 'RO 412')

    const link = await screen.findByRole('link', { name: /RO 412/ })
    expect(link).toHaveAttribute('href', `/tickets/${closedHit.ticketId}`)
    expect(link).toHaveTextContent('Drew G')
    expect(link).toHaveTextContent('2021 RAM 2500')
    expect(link).toHaveTextContent('engine ticking cold and hot')
  })

  it('sends the typed query to the lookup route', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => respond({ tickets: [] }))
    const user = userEvent.setup()
    render(<TicketLookupPanel />)

    await user.type(screen.getByLabelText('Find a repair order'), 'drew')

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const [url, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1]
    expect(url).toBe('/api/tickets/lookup')
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ q: 'drew' })
  })

  // The intake search collapses a failed request into "nothing matches" and
  // then offers to create the customer again. This panel must not repeat it:
  // a lookup that failed is not a repair order that does not exist.
  it('says the lookup failed rather than that nothing matched', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond({ error: 'rate_limited' }, 429))
    const user = userEvent.setup()
    render(<TicketLookupPanel />)

    await user.type(screen.getByLabelText('Find a repair order'), '412')

    expect(await screen.findByText(/Lookup is unavailable right now/)).toBeInTheDocument()
    expect(screen.queryByText(/Nothing matches/)).not.toBeInTheDocument()
  })

  it('reports an empty result as an empty result', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => respond({ tickets: [] }))
    const user = userEvent.setup()
    render(<TicketLookupPanel />)

    await user.type(screen.getByLabelText('Find a repair order'), 'nobody')

    expect(await screen.findByText(/Nothing matches/)).toBeInTheDocument()
  })

  it('asks nothing until something is typed', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => respond({ tickets: [] }))
    const user = userEvent.setup()
    render(<TicketLookupPanel />)

    await user.type(screen.getByLabelText('Find a repair order'), '  ')

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
