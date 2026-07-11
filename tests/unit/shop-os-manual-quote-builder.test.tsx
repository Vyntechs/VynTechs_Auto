import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualQuoteBuilder } from '@/components/screens/manual-quote-builder'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'
import type { TicketDetail } from '@/lib/tickets'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}))

const router = { push: vi.fn(), replace: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))

type Builder = Extract<QuoteBuilderResult, { ok: true }>['builder']
type BuilderLine = Builder['jobs'][number]['lines'][number]

const TICKET_ID = '00000000-0000-4000-8000-000000000101'
const JOB_ID = '00000000-0000-4000-8000-000000000201'
const LINE_ID = '00000000-0000-4000-8000-000000000301'
const LABOR_LINE_ID = '00000000-0000-4000-8000-000000000302'
const FEE_LINE_ID = '00000000-0000-4000-8000-000000000303'
const NEW_LINE_ID = '00000000-0000-4000-8000-000000000304'
const PINNED_LINE_ID = '00000000-0000-4000-8000-000000000305'
const VERSION_ID = '00000000-0000-4000-8000-000000000401'

const ticket: TicketDetail = {
  id: TICKET_ID, ticketNumber: 42, source: 'counter', status: 'open',
  concern: 'Brake vibration', whenStarted: null, howOften: null,
  diagnosticAuthorizedCents: null, diagnosticAuthorizationNote: null,
  customer: { id: 'customer-1', name: 'Marisol Vega', phone: '2145550197', email: null },
  vehicle: {
    id: 'vehicle-1', year: 2019, make: 'Ford', model: 'F-150', engine: '3.5L',
    vin: null, mileage: null, plate: null,
  },
  jobs: [], createdAt: new Date('2026-07-10T12:00:00Z'),
  updatedAt: new Date('2026-07-10T12:00:00Z'),
}

function line(overrides: Partial<BuilderLine> = {}): BuilderLine {
  return {
    id: LINE_ID, kind: 'part', description: 'Front pad set', sort: 0,
    quantity: '1', priceCents: 12_000, taxable: true,
    partNumber: 'PAD-1', brand: 'ACME', coreChargeCents: 2_500,
    fitment: 'Front axle', laborHours: null, laborRateCents: null,
    ...overrides,
  }
}

function builder(overrides: Partial<Builder> = {}): Builder {
  return {
    ticket: { id: TICKET_ID, status: 'open', reconciled: true },
    configuration: {
      laborRateCents: 15_000, taxRateBps: 825,
      laborRateConfigured: true, taxRateConfigured: true,
    },
    jobs: [{
      id: JOB_ID, title: 'Replace front brakes', kind: 'repair', workStatus: 'open',
      lines: [
        line(),
        line({
          id: LABOR_LINE_ID, kind: 'labor', description: 'Brake labor', quantity: '1',
          priceCents: 18_750, taxable: false, partNumber: null, brand: null,
          coreChargeCents: null, fitment: null, laborHours: '1.25', laborRateCents: 15_000,
        }),
        line({
          id: FEE_LINE_ID, kind: 'fee', description: 'Shop supplies', quantity: '1',
          priceCents: 500, taxable: true, partNumber: null, brand: null,
          coreChargeCents: null, fitment: null, laborHours: null, laborRateCents: null,
        }),
      ],
    }],
    activeVersion: { id: VERSION_ID, versionNumber: 3 },
    ...overrides,
  }
}

describe('ManualQuoteBuilder', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    router.push.mockReset()
    router.replace.mockReset()
  })
  it('renders customer-safe job and manual line truth with the calibrated quote tape', () => {
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Build quote' })).toBeInTheDocument()
    expect(screen.getByText('Marisol Vega')).toBeInTheDocument()
    expect(screen.getByText('2019 Ford F-150')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Replace front brakes' })).toBeInTheDocument()
    expect(screen.getByText('Part · Qty 1')).toBeInTheDocument()
    expect(screen.getByText('Labor · 1.25 hr')).toBeInTheDocument()
    expect(screen.getByText('Fee')).toBeInTheDocument()
    expect(screen.getByText('PAD-1 · ACME')).toBeInTheDocument()
    expect(screen.getByText('Fitment · Front axle')).toBeInTheDocument()
    expect(screen.getByText('Included in line price · $25.00')).toBeInTheDocument()
    expect(screen.getAllByText('Prepared version V3')).toHaveLength(1)

    const tape = screen.getByRole('complementary', { name: 'Quote totals' })
    expect(within(tape).getByText('$312.50')).toBeInTheDocument()
    expect(within(tape).getByText('$125.00')).toBeInTheDocument()
    expect(within(tape).getByText('$10.31')).toBeInTheDocument()
    expect(within(tape).getByText('$322.81')).toBeInTheDocument()
    expect(within(tape).queryByText('$337.50')).toBeNull()
    expect(screen.queryByRole('button', { name: /Prepare quote/i })).toBeNull()
  })

  it('shows provisional and missing-rate truth without invalidating explicitly priced labor', () => {
    render(<ManualQuoteBuilder ticket={{ ...ticket, customer: null, vehicle: null }} builder={builder({
      ticket: { id: TICKET_ID, status: 'open', reconciled: false },
      configuration: {
        laborRateCents: null, taxRateBps: 825,
        laborRateConfigured: false, taxRateConfigured: true,
      },
      jobs: [{
        id: JOB_ID, title: 'Inspect brakes', kind: 'maintenance', workStatus: 'open',
        lines: [line({
          kind: 'labor', description: 'Inspection labor', priceCents: 9_000,
          partNumber: null, brand: null, coreChargeCents: null, fitment: null,
          laborHours: '1', laborRateCents: null,
        })],
      }],
    })} />)

    expect(screen.getByText(/Draft quote lines now/)).toBeInTheDocument()
    expect(screen.getByText('Labor rate · Not configured')).toBeInTheDocument()
    expect(screen.getAllByText('$90.00')).toHaveLength(3)
    expect(screen.queryByText(/Total unavailable/)).toBeNull()
  })

  it('shows known subtotals and withholds tax and total when tax is not configured', () => {
    render(<ManualQuoteBuilder ticket={ticket} builder={builder({
      configuration: {
        laborRateCents: 15_000, taxRateBps: null,
        laborRateConfigured: true, taxRateConfigured: false,
      },
    })} />)

    const tape = screen.getByRole('complementary', { name: 'Quote totals' })
    expect(within(tape).getByText('Tax — Not configured')).toBeInTheDocument()
    expect(within(tape).getByText('Total unavailable')).toBeInTheDocument()
    expect(within(tape).getByText('$312.50')).toBeInTheDocument()
    expect(within(tape).getByText('$125.00')).toBeInTheDocument()
  })

  it('fails closed on total overflow and never renders unsafe derived money', () => {
    render(<ManualQuoteBuilder ticket={ticket} builder={builder({
      jobs: [{
        id: JOB_ID, title: 'Overflow quote', kind: 'repair', workStatus: 'open',
        lines: [
          line({ id: LINE_ID, priceCents: Number.MAX_SAFE_INTEGER }),
          line({ id: LABOR_LINE_ID, priceCents: 1 }),
        ],
      }],
    })} />)

    expect(screen.getByText('Totals unavailable')).toBeInTheDocument()
    expect(screen.getByText(/could not be totaled safely/)).toBeInTheDocument()
    expect(screen.queryByText('$90,071,992,547,409.92')).toBeNull()
  })

  it('renders honest empty and no-current-version states', () => {
    const { rerender } = render(<ManualQuoteBuilder ticket={ticket} builder={builder({
      jobs: [], activeVersion: null,
    })} />)
    expect(screen.getByText('No eligible jobs on this ticket.')).toBeInTheDocument()
    expect(screen.getByText('No prepared version')).toBeInTheDocument()

    rerender(<ManualQuoteBuilder ticket={ticket} builder={builder({
      jobs: [{ id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open', lines: [] }],
      activeVersion: null,
    })} />)
    expect(screen.getByText('No quote lines yet.')).toBeInTheDocument()
  })

  it('selects safe fields instead of reflecting hidden data', () => {
    const unsafe = builder()
    Object.assign(unsafe.jobs[0].lines[0], {
      unitCostCents: 1,
      vendorSnapshot: 'SECRET_VENDOR_PAYLOAD',
      approvalProjection: 'SECRET_APPROVAL',
    })
    render(<ManualQuoteBuilder ticket={ticket} builder={unsafe} />)
    expect(screen.queryByText(/SECRET_/)).toBeNull()
    expect(screen.queryByText(/Unit cost/i)).toBeNull()
    expect(screen.queryByText(/Vendor/i)).toBeNull()
  })

  it('declares desktop and 375px tape behavior, safe-area clearance, resilient totals, and focus visibility', () => {
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)
    const css = readFileSync(
      resolve(process.cwd(), 'components/screens/manual-quote-builder.module.css'),
      'utf8',
    )
    expect(css).toMatch(/\.tape[\s\S]*position:\s*sticky/)
    expect(css).toMatch(/\.money[\s\S]*font-family:\s*var\(--vt-font-mono\)/)
    expect(css).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*grid-template-columns:\s*1fr/)
    expect(css).not.toMatch(/\.tape\s*\{[^}]*grid-row:\s*1/)
    expect(css).toMatch(/\.header a:focus-visible[\s\S]*outline:/)
    expect(css).toMatch(/\.totalList\s*>\s*div\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/)
    expect(css).toMatch(/\.workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(320px,\s*360px\)/)
    expect(css).toMatch(/\.line:focus,[\s\S]*\.preparedState:focus\s*\{[^}]*outline:/)
    expect(css).toMatch(/@media\s*\(max-width:\s*800px\)[\s\S]*\.prepareAction\s*\{[^}]*position:\s*fixed[^}]*env\(safe-area-inset-bottom\)/)
    expect(css).toMatch(/@media\s*\(max-width:\s*800px\)[\s\S]*\.workspace:has\(\.editor:focus-within\)\s+\.prepareAction\s*\{[^}]*position:\s*static/)
    expect(css).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*\.error\s*\{[^}]*position:\s*static/)

    const ledger = screen.getByRole('region', { name: 'Quote ledger' })
    const tape = screen.getByRole('complementary', { name: 'Quote totals' })
    expect(ledger.compareDocumentPosition(tape) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('ManualQuoteBuilder line mutations', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    router.push.mockReset()
    router.replace.mockReset()
  })

  it('creates with one retry key, waits for refreshed truth, and returns focus to the line', async () => {
    const empty = builder({
      jobs: [{ id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open', lines: [] }],
      activeVersion: { id: VERSION_ID, versionNumber: 3 },
    })
    const refreshed = builder({
      jobs: [{
        id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open',
        lines: [line({ id: NEW_LINE_ID, description: 'Premium pad set' })],
      }],
      activeVersion: null,
    })
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000501')
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, { changed: true, line: { id: NEW_LINE_ID } }))
      .mockResolvedValueOnce(response(200, { builder: refreshed }))

    render(<ManualQuoteBuilder ticket={ticket} builder={empty} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add part' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Premium pad set' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Line price'), { target: { value: '120.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))

    await waitFor(() => expect(screen.getByText('Premium pad set')).toBeInTheDocument())
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/tickets/${TICKET_ID}/quote/jobs/${JOB_ID}/lines`)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      clientKey: '00000000-0000-4000-8000-000000000501',
      line: expect.objectContaining({ kind: 'part', description: 'Premium pad set', priceCents: 12_000 }),
    })
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/tickets/${TICKET_ID}/quote`, expect.objectContaining({ method: 'GET' }))
    expect(screen.getByText('No prepared version')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare quote' })).toBeEnabled()
    expect(document.activeElement).toHaveTextContent('Premium pad set')
  })

  it('keeps a create key across network retry and rotates it when input changes', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000501')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000502')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000503')
      .mockReturnValue('00000000-0000-4000-8000-000000000504')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)

    fireEvent.click(screen.getAllByRole('button', { name: 'Add fee' })[0])
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Shop fee' } })
    fireEvent.change(screen.getByLabelText('Line price'), { target: { value: '5.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))
    await screen.findByText('Connection interrupted. Retry with the same details.')
    const firstKey = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).clientKey

    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).clientKey).toBe(firstKey)

    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Changed fee' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).clientKey).not.toBe(firstKey)
  })

  it('keeps totals on server truth while a mutation is still pending', async () => {
    const empty = builder({ jobs: [{
      id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open', lines: [],
    }] })
    const refreshed = builder({ jobs: [{
      id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open',
      lines: [line({ id: NEW_LINE_ID, description: 'Server line', priceCents: 10_000 })],
    }] })
    let resolveMutation!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveMutation = resolve }))
      .mockResolvedValueOnce(response(200, { builder: refreshed }))
    render(<ManualQuoteBuilder ticket={ticket} builder={empty} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add fee' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Pending fee' } })
    fireEvent.change(screen.getByLabelText('Line price'), { target: { value: '100.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))
    fireEvent.submit(screen.getByRole('button', { name: 'Saving…' }).closest('form') as HTMLFormElement)

    const tape = screen.getByRole('complementary', { name: 'Quote totals' })
    expect(within(tape).getAllByText('$0.00')).toHaveLength(4)
    expect(within(tape).queryByText('$100.00')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add part' })).toBeDisabled()

    resolveMutation(response(201, { changed: true, line: { id: NEW_LINE_ID } }))
    await screen.findByText('Server line')
    expect(within(tape).getAllByText('$100.00')).toHaveLength(2)
  })

  it('uses one focus-safe modal before switching a dirty editor', async () => {
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Add part' })[0])
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Dirty' } })
    const switchButton = screen.getAllByRole('button', { name: 'Add labor' })[0]
    fireEvent.click(switchButton)
    const dialog = screen.getByRole('alertdialog', { name: 'Discard unsaved line changes?' })
    expect(screen.getByTestId('quote-background')).toHaveAttribute('inert')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('heading', { name: 'Add part line' })).toBeInTheDocument()
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(screen.queryByText('Discard unsaved line changes?')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(switchButton))
    fireEvent.click(screen.getAllByRole('button', { name: 'Add labor' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByRole('heading', { name: 'Add labor line' })).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Description')))
  })

  it('PUTs an edit, confirms idempotent removal, and refreshes server truth', async () => {
    const afterEdit = builder({ jobs: [{ ...builder().jobs[0], lines: [line({ description: 'Edited pads' })] }] })
    const afterDelete = builder({ jobs: [{ ...builder().jobs[0], lines: [] }], activeVersion: null })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(200, { changed: false, line: { id: LINE_ID } }))
      .mockResolvedValueOnce(response(200, { builder: afterEdit }))
      .mockResolvedValueOnce(response(200, { changed: false }))
      .mockResolvedValueOnce(response(200, { builder: afterDelete }))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Front pad set' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Edited pads' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))
    await screen.findByText('Edited pads')
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PUT' })

    fireEvent.click(screen.getByRole('button', { name: 'Remove Edited pads' }))
    expect(screen.getByText('Remove this quote line?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    await screen.findByText('No quote lines yet.')
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'DELETE' })
  })

  it('preserves persisted labor rate, exact price, and nonzero sort on description-only edit', async () => {
    const pinned = line({
      id: PINNED_LINE_ID, kind: 'labor', description: 'Pinned labor', sort: 7,
      quantity: '1', laborHours: '1.25', laborRateCents: 12_500,
      priceCents: 16_000, partNumber: null, brand: null, coreChargeCents: null,
      fitment: null, taxable: false,
    })
    const state = builder({
      configuration: {
        laborRateCents: 15_000, taxRateBps: 825,
        laborRateConfigured: true, taxRateConfigured: true,
      },
      jobs: [{
        id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open', lines: [pinned],
      }],
    })
    const refreshed = {
      ...state,
      jobs: [{ ...state.jobs[0], lines: [{ ...pinned, description: 'Renamed labor' }] }],
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(200, { changed: true, line: { id: pinned.id } }))
      .mockResolvedValueOnce(response(200, { builder: refreshed }))
    render(<ManualQuoteBuilder ticket={ticket} builder={state} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Pinned labor' }))
    expect(screen.getByText('Stored line price · $160.00')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Renamed labor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))
    await screen.findByText('Renamed labor')

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      description: 'Renamed labor', sort: 7, laborRateCents: 12_500, priceCents: 16_000,
    })
  })

  it('recalculates edited labor at its pinned rate only after hours change', async () => {
    const pinned = line({
      id: PINNED_LINE_ID, kind: 'labor', description: 'Pinned labor', sort: 7,
      laborHours: '1.25', laborRateCents: 12_500, priceCents: 16_000,
      partNumber: null, brand: null, coreChargeCents: null, fitment: null,
    })
    const state = builder({ jobs: [{
      id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open', lines: [pinned],
    }] })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(200, { changed: true, line: { id: pinned.id } }))
      .mockResolvedValueOnce(response(200, { builder: state }))
    render(<ManualQuoteBuilder ticket={ticket} builder={state} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Pinned labor' }))
    fireEvent.change(screen.getByLabelText('Hours'), { target: { value: '2' } })
    expect(screen.getByText('Calculated line price · $250.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      sort: 7, laborHours: '2', laborRateCents: 12_500, priceCents: 25_000,
    })
  })

  it('maps retryable conflict and privacy/access boundaries without server-detail leakage', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(409, { error: 'conflict', retryable: true, secret: 'NO' }))
      .mockResolvedValueOnce(response(401, { error: 'unauthenticated' }))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Add fee' })[0])
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Fee' } })
    fireEvent.change(screen.getByLabelText('Line price'), { target: { value: '5.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))
    expect(await screen.findByText('Quote is busy. Refresh and retry.')).toBeInTheDocument()
    expect(screen.queryByText(/NO/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Refresh quote' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/sign-in?next=${encodeURIComponent(`/tickets/${TICKET_ID}/quote`)}`))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('traps one remove modal and blocks background actions during deletion', async () => {
    let resolveDelete!: (response: Response) => void
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveDelete = resolve }))
      .mockResolvedValueOnce(response(200, { builder: builder({
        jobs: [{ ...builder().jobs[0], lines: [] }],
      }) }))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Front pad set' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Remove this quote line?' })
    const keep = screen.getByRole('button', { name: 'Keep line' })
    const confirm = screen.getByRole('button', { name: 'Confirm remove' })
    expect(document.activeElement).toBe(keep)
    confirm.focus()
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(keep)
    fireEvent.click(confirm)
    expect(confirm).toBeDisabled()
    expect(keep).toBeDisabled()
    expect(document.activeElement).toBe(dialog)
    fireEvent.keyDown(dialog, { key: 'Tab' })
    expect(document.activeElement).toBe(dialog)
    expect(screen.getByRole('button', { name: 'Add labor' })).toBeDisabled()
    expect(screen.queryByText('Discard unsaved line changes?')).toBeNull()
    resolveDelete(response(200, { changed: true }))
    await screen.findByText('No quote lines yet.')
  })

  it.each([
    [response(409, { error: 'conflict', retryable: true }), 'Quote is busy. Refresh and retry.'],
    [null, 'Connection interrupted. Retry with the same details.'],
  ] as const)('closes remove modal so delete failure is accessible', async (failure, message) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    if (failure) fetchMock.mockResolvedValueOnce(failure)
    else fetchMock.mockRejectedValueOnce(new Error('offline'))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)
    const remove = screen.getByRole('button', { name: 'Remove Front pad set' })
    fireEvent.click(remove)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId('quote-background')).not.toHaveAttribute('inert')
    await waitFor(() => expect(document.activeElement).toBe(remove))
  })

  it.each([
    {},
    { ticket: { id: TICKET_ID, status: 'open', reconciled: true } },
    { ...builder(), ticket: { ...builder().ticket, id: '00000000-0000-4000-8000-000000000999' } },
    { ...builder(), jobs: [{ ...builder().jobs[0], lines: [{ ...builder().jobs[0].lines[0], unitCostCents: 1 }] }] },
  ])('rejects hostile 200 refresh without replacing truth or closing the editor', async (hostile) => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, { changed: true, line: { id: NEW_LINE_ID } }))
      .mockResolvedValueOnce(response(200, { builder: hostile }))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add fee' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Pending fee' } })
    fireEvent.change(screen.getByLabelText('Line price'), { target: { value: '5.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))
    expect(await screen.findByText('Review the visible fields, then refresh and retry.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh quote' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Add fee line' })).toBeInTheDocument()
    expect(screen.getByText('Front pad set')).toBeInTheDocument()
  })

  it('closes an edit when refreshed server truth no longer contains its line', async () => {
    const withoutLine = builder({
      jobs: [{ ...builder().jobs[0], lines: builder().jobs[0].lines.slice(1) }],
    })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(409, { error: 'conflict', retryable: true }))
      .mockResolvedValueOnce(response(200, { builder: withoutLine }))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Front pad set' }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Locally edited' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))
    await screen.findByText('Quote is busy. Refresh and retry.')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }))
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Edit part line' })).toBeNull())
    expect(screen.queryByText('Front pad set')).toBeNull()
  })

  it('uses labeled decimal keyboards, 44px controls, and never renders hidden quote controls', () => {
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Add labor' })[0])
    expect(screen.getByLabelText('Hours')).toHaveAttribute('inputmode', 'decimal')
    expect(screen.getByLabelText('Hours')).toHaveAttribute('autocomplete', 'off')
    expect(screen.queryByLabelText(/Unit cost|Core charge|Vendor/i)).toBeNull()
    expect(screen.queryByText(/autosav/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Prepare quote/i })).toBeNull()

    const css = readFileSync(resolve(process.cwd(), 'components/screens/manual-quote-builder.module.css'), 'utf8')
    expect(css).toMatch(/\.lineAction[\s\S]*min-height:\s*44px/)
    expect(css).toMatch(/\.editor input[\s\S]*min-height:\s*44px/)
  })
})

describe('ManualQuoteBuilder preparation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    router.push.mockReset()
    router.replace.mockReset()
  })

  function ready(overrides: Partial<Builder> = {}): Builder {
    return builder({ activeVersion: null, ...overrides })
  }

  it('lists visible reasons and disables preparation until persisted truth is ready', () => {
    render(<ManualQuoteBuilder ticket={{ ...ticket, customer: null, vehicle: null }} builder={ready({
      ticket: { id: TICKET_ID, status: 'open', reconciled: false },
      configuration: {
        laborRateCents: null, taxRateBps: null,
        laborRateConfigured: false, taxRateConfigured: false,
      },
      jobs: [{ ...builder().jobs[0], lines: [] }],
    })} />)
    expect(screen.getByText('Add customer and vehicle.')).toBeInTheDocument()
    expect(screen.getByText('Configure a tax rate.')).toBeInTheDocument()
    expect(screen.getByText('Add at least one quote line.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare quote' })).toBeDisabled()
  })

  it('does not require a global labor rate for explicitly priced persisted labor', () => {
    const explicitLabor = line({
      id: PINNED_LINE_ID, kind: 'labor', description: 'Explicit labor', quantity: '1',
      laborHours: '1', laborRateCents: null, priceCents: 10_000,
      partNumber: null, brand: null, coreChargeCents: null, fitment: null,
    })
    render(<ManualQuoteBuilder ticket={ticket} builder={ready({
      configuration: {
        laborRateCents: null, taxRateBps: 825,
        laborRateConfigured: false, taxRateConfigured: true,
      },
      jobs: [{ ...builder().jobs[0], lines: [explicitLabor] }],
    })} />)
    expect(screen.getByRole('button', { name: 'Prepare quote' })).toBeEnabled()
    expect(screen.queryByText(/Configure a labor rate/i)).toBeNull()
  })

  it('blocks preparation while a no-rate labor editor has no explicit line price', () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(<ManualQuoteBuilder ticket={ticket} builder={ready({
      configuration: {
        laborRateCents: null, taxRateBps: 825,
        laborRateConfigured: false, taxRateConfigured: true,
      },
    })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add labor' }))
    expect(screen.getByText('Finish or cancel the open line editor.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare quote' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Labor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save line' }))
    expect(screen.getByText('Review the visible fields, then refresh and retry.')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    [201, true],
    [200, false],
  ])('prepares through a bodyless %i response then mandatory refreshed truth', async (status, changed) => {
    const active = { id: VERSION_ID, versionNumber: 4 }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(status, { changed, version: active }))
      .mockResolvedValueOnce(response(200, { builder: ready({ activeVersion: active }) }))
    render(<ManualQuoteBuilder ticket={ticket} builder={ready()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare quote' }))
    const preparedStatus = await screen.findByRole('status')
    expect(preparedStatus).toHaveTextContent('Prepared version V4')
    expect(preparedStatus).toHaveAttribute('aria-live', 'polite')
    expect(document.activeElement).toBe(preparedStatus)

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/tickets/${TICKET_ID}/quote/versions`)
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: 'POST', headers: { accept: 'application/json' },
    })
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/tickets/${TICKET_ID}/quote`)
    expect(screen.queryByRole('button', { name: 'Prepare quote' })).toBeNull()
  })

  it.each([
    [201, { changed: false, version: { id: VERSION_ID, versionNumber: 1 } }],
    [200, { changed: false, version: { id: 'bad', versionNumber: 1 } }],
    [201, { changed: true, version: { id: VERSION_ID, versionNumber: 1 }, extra: true }],
  ])('rejects malformed successful version response without replacing truth', async (status, body) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(status, body))
    render(<ManualQuoteBuilder ticket={ticket} builder={ready()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare quote' }))
    expect(await screen.findByText('Review the visible fields, then refresh and retry.')).toBeInTheDocument()
    expect(screen.getByText('No prepared version')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh quote' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recovers a malformed version success through a validated refresh', async () => {
    const active = { id: VERSION_ID, versionNumber: 4 }
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, { changed: true, version: active, extra: true }))
      .mockResolvedValueOnce(response(200, { builder: ready({ activeVersion: active }) }))
    render(<ManualQuoteBuilder ticket={ticket} builder={ready()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare quote' }))
    await screen.findByText('Review the visible fields, then refresh and retry.')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Prepared version V4')
  })

  it('rejects refreshed truth that does not contain the exact prepared version', async () => {
    const version = { id: VERSION_ID, versionNumber: 4 }
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, { changed: true, version }))
      .mockResolvedValueOnce(response(200, { builder: ready() }))
      .mockResolvedValueOnce(response(200, { builder: ready({ activeVersion: version }) }))
    render(<ManualQuoteBuilder ticket={ticket} builder={ready()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare quote' }))
    expect(await screen.findByText('Review the visible fields, then refresh and retry.')).toBeInTheDocument()
    expect(screen.getByText('No prepared version')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Prepared version V4')
  })

  it.each([
    [401, { error: 'unauthenticated' }, `/sign-in?next=${encodeURIComponent(`/tickets/${TICKET_ID}/quote`)}`],
    [403, { error: 'deactivated' }, '/deactivated'],
    [403, { error: 'paywall' }, '/subscribe'],
  ])('maps prepare access %i without issuing a refresh', async (status, body, destination) => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(status, body))
    render(<ManualQuoteBuilder ticket={ticket} builder={ready()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare quote' }))
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(destination))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('serializes rapid preparation and exposes retryable busy failure', async () => {
    let resolvePrepare!: (value: Response) => void
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePrepare = resolve }))
    render(<ManualQuoteBuilder ticket={ticket} builder={ready()} />)
    const prepare = screen.getByRole('button', { name: 'Prepare quote' })
    fireEvent.click(prepare)
    fireEvent.click(prepare)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    resolvePrepare(response(409, { error: 'conflict', retryable: true }))
    expect(await screen.findByText('Quote is busy. Refresh and retry.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh quote' })).toBeInTheDocument()
  })

  it('shows network failure without inventing a cause or forbidden action wording', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'))
    render(<ManualQuoteBuilder ticket={ticket} builder={ready()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare quote' }))
    expect(await screen.findByText('Connection interrupted. Retry with the same details.')).toBeInTheDocument()
    const actionCopy = screen.getAllByRole('button').map((button) => button.textContent).join(' ')
    expect(actionCopy).not.toMatch(/send|approve|authorize|start work/i)
  })

  it('keeps preparation at least 44px', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/screens/manual-quote-builder.module.css'), 'utf8')
    expect(css).toMatch(/\.prepareAction[\s\S]*min-height:\s*44px/)
  })
})

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
