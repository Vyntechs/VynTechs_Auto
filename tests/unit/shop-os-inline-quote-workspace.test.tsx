import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { InlineQuoteWorkspace } from '@/components/screens/inline-quote-workspace'

const quoteBuilder = {
  ticket: { id: 'ticket-1', status: 'open', reconciled: true },
  configuration: { taxRateBps: 825 },
  jobs: [],
}

vi.mock('@/lib/shop-os/quote-builder-ui', () => ({
  parseQuoteBuilderProjection: (value: unknown) => (
    typeof value === 'object'
      && value !== null
      && 'ticket' in value
      && (value as { ticket?: { id?: unknown } }).ticket?.id === 'ticket-1'
      ? value
      : null
  ),
}))

vi.mock('@/lib/shop-os/canned-jobs-ui', () => ({
  parseCannedJobListResponse: (value: unknown) => (
    typeof value === 'object' && value !== null && 'cannedJobs' in value ? value : null
  ),
}))

vi.mock('@/lib/shop-os/parts-sourcing-ui', () => ({
  parseEnabledVendorAccountsResponse: (value: unknown) => (
    typeof value === 'object' && value !== null && 'vendorAccounts' in value
      ? (value as { vendorAccounts: unknown[] }).vendorAccounts
      : null
  ),
}))

vi.mock('@/components/screens/manual-quote-builder', () => ({
  ManualQuoteBuilder: (props: {
    builder: typeof quoteBuilder
    cannedJobs: unknown[]
    cannedCatalogAvailable: boolean
    vendorAccounts: unknown[]
    vendorCatalogAvailable: boolean
    embedded: boolean
    onClose: () => void
    onProjection: (jobs: unknown[]) => void
  }) => (
    <section aria-label="Loaded quote tool">
      <p>Quote loaded {props.builder.ticket.id}</p>
      <p>Canned {String(props.cannedCatalogAvailable)} · {props.cannedJobs.length}</p>
      <p>Vendors {String(props.vendorCatalogAvailable)} · {props.vendorAccounts.length}</p>
      <p>Embedded {String(props.embedded)}</p>
      <button type="button" onClick={props.onClose}>Close quote</button>
      <button type="button" onClick={() => props.onProjection([{ id: 'job-1' }])}>Publish quote state</button>
    </section>
  ),
}))

const ticket = {
  id: 'ticket-1',
  ticketNumber: 42,
  concern: 'Brake vibration',
  customer: { name: 'Marisol Vega' },
  vehicle: { year: 2019, make: 'Ford', model: 'F-150' },
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status })
}

describe('InlineQuoteWorkspace', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('lazy-loads the three bounded quote projections and forwards close and ledger events', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onProjection = vi.fn()
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/api/tickets/ticket-1/quote') return response({ builder: quoteBuilder })
      if (url === '/api/shop/canned-jobs') return response({ cannedJobs: [{ id: 'canned-1' }], taxRateBps: 825 })
      if (url === '/api/shop/vendor-accounts') return response({ vendorAccounts: [{ id: 'vendor-1' }] })
      return response({}, 404)
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<InlineQuoteWorkspace
      ticket={ticket}
      canCreateVendorAccount
      onClose={onClose}
      onProjection={onProjection}
    />)

    expect(await screen.findByText('Quote loaded ticket-1')).toBeInTheDocument()
    expect(screen.getByText('Canned true · 1')).toBeInTheDocument()
    expect(screen.getByText('Vendors true · 1')).toBeInTheDocument()
    expect(screen.getByText('Embedded true')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await user.click(screen.getByRole('button', { name: 'Publish quote state' }))
    expect(onProjection).toHaveBeenCalledWith([{ id: 'job-1' }])
    await user.click(screen.getByRole('button', { name: 'Close quote' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps manual quoting usable when optional accelerators fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/tickets/ticket-1/quote') return response({ builder: quoteBuilder })
      return response({ error: 'unavailable' }, 503)
    }))

    render(<InlineQuoteWorkspace ticket={ticket} onClose={vi.fn()} onProjection={vi.fn()} />)

    expect(await screen.findByText('Quote loaded ticket-1')).toBeInTheDocument()
    expect(screen.getByText('Canned false · 0')).toBeInTheDocument()
    expect(screen.getByText('Vendors false · 0')).toBeInTheDocument()
  })

  it('fails closed without replacing the repair order when required quote truth is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response({ builder: { unsafe: true } })))

    render(<InlineQuoteWorkspace ticket={ticket} onClose={vi.fn()} onProjection={vi.fn()} />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Quote could not be opened here')
    expect(screen.getByRole('link', { name: 'Open the full quote page' })).toHaveAttribute(
      'href',
      '/tickets/ticket-1/quote',
    )
    await waitFor(() => expect(screen.queryByText(/Quote loaded/)).toBeNull())
  })
})
