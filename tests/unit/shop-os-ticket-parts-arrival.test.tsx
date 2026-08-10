import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { TicketPartsArrival } from '@/components/screens/ticket-parts-arrival'
import type { PartsArrivalJobView } from '@/lib/shop-os/parts-arrival-ui'

const JOB = '00000000-0000-4000-8000-000000000030'
const LINE = '00000000-0000-4000-8000-000000000050'
const ticketId = '00000000-0000-4000-8000-000000000020'

const job = (overrides: Partial<PartsArrivalJobView> = {}): PartsArrivalJobView => ({
  jobId: JOB,
  approvedQuoteVersionId: '00000000-0000-4000-8000-000000000040',
  title: 'Front brake service',
  readOnly: false,
  receivedCount: 0,
  totalCount: 2,
  allHere: false,
  lines: [
    {
      id: LINE, description: 'Front brake pads', quantity: '1', partNumber: 'PAD-1', brand: 'ACME',
      state: 'needs_order', nextAction: 'mark_ordered', ordered: null, received: null,
    },
    {
      id: '00000000-0000-4000-8000-000000000051', description: 'Front brake rotor', quantity: '1', partNumber: 'ROT-1', brand: 'ACME',
      state: 'ordered', nextAction: 'mark_received', ordered: { actorName: 'Pat Parts', at: '2026-08-09T20:00:00.000Z' }, received: null,
    },
  ],
  ...overrides,
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TicketPartsArrival', () => {
  it('renders the approved three-stop rail, partial count, receipts, and one legal action per line', () => {
    render(<TicketPartsArrival ticketId={ticketId} initialJob={job()} />)
    expect(screen.getByRole('heading', { name: 'Parts arrival' })).toBeInTheDocument()
    expect(screen.getByText('0 of 2 received')).toBeInTheDocument()
    expect(screen.getAllByText('Needs order')).toHaveLength(2)
    expect(screen.getAllByText('Ordered')).toHaveLength(2)
    expect(screen.getAllByText('Received')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Mark Front brake pads ordered' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mark Front brake rotor received' })).toBeInTheDocument()
    expect(screen.getByText(/Pat Parts/)).toBeInTheDocument()
  })

  it('renders technician truth without mutation controls', () => {
    render(<TicketPartsArrival ticketId={ticketId} initialJob={job({
      readOnly: true,
      lines: job().lines.map((line) => ({ ...line, nextAction: null })),
    })} />)
    expect(screen.getByText('Read-only for technicians')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('settles only from validated server truth and keeps the remaining part partial', async () => {
    const updated = job({
      lines: job().lines.map((line) => line.id === LINE ? {
        ...line, state: 'ordered', nextAction: 'mark_received',
        ordered: { actorName: 'Pat Parts', at: '2026-08-09T20:01:00.000Z' },
      } : line),
    })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ changed: true, job: updated }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<TicketPartsArrival ticketId={ticketId} initialJob={job()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark Front brake pads ordered' }))
    expect(screen.getByRole('button', { name: 'Saving Front brake pads' })).toBeDisabled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark Front brake pads received' })).toHaveFocus())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText('0 of 2 received')).toBeInTheDocument()
  })

  it('reconciles a lost mutation response and installs server truth without asking for a duplicate tap', async () => {
    const updated = job({
      lines: job().lines.map((line) => line.id === LINE ? {
        ...line, state: 'ordered', nextAction: 'mark_received',
        ordered: { actorName: 'Pat Parts', at: '2026-08-09T20:01:00.000Z' },
      } : line),
    })
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ job: updated }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<TicketPartsArrival ticketId={ticketId} initialJob={job()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Mark Front brake pads ordered' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Mark Front brake pads received' })).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps current truth and explains failure when mutation and reconciliation are not trustworthy', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ changed: true, job: { unsafe: true } }) })
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'conflict' }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<TicketPartsArrival ticketId={ticketId} initialJob={job()} />)
    const pads = screen.getByText('Front brake pads').closest('li')!
    fireEvent.click(within(pads).getByRole('button'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Not saved'))
    expect(screen.getByRole('button', { name: 'Mark Front brake pads ordered' })).toBeInTheDocument()
  })

  it('reports all parts here while explicitly preserving the human-controlled hold', () => {
    const receivedLines = job().lines.map((line) => ({
      ...line,
      state: 'received' as const,
      nextAction: null,
      received: { actorName: 'Pat Parts', at: '2026-08-09T20:02:00.000Z' },
    }))
    render(<TicketPartsArrival ticketId={ticketId} initialJob={job({
      receivedCount: 2, allHere: true, lines: receivedLines,
    })} />)
    expect(screen.getByText('All parts here')).toBeInTheDocument()
    expect(screen.getByText('Work stays on hold until someone resumes it.')).toBeInTheDocument()
  })
})
