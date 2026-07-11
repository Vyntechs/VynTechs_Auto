import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const { mockPush, mockRefresh, mockAuth, mockRecents, mockAccess, mockCannedList } = vi.hoisted(() => ({
  mockPush: vi.fn(),
  mockRefresh: vi.fn(),
  mockAuth: vi.fn(),
  mockRecents: vi.fn(),
  mockAccess: vi.fn(),
  mockCannedList: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  redirect: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`)
  }),
}))
vi.mock('@/lib/db/client', () => ({ db: { name: 'test-db' } }))
vi.mock('@/lib/supabase-server', () => ({ getServerSupabase: vi.fn(async () => ({})) }))
vi.mock('@/lib/auth', () => ({ requireUserAndProfile: mockAuth }))
vi.mock('@/lib/auth-access', () => ({ checkAccess: mockAccess }))
vi.mock('@/lib/shop-os/canned-jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/shop-os/canned-jobs')>()
  return { ...actual, listCannedJobs: mockCannedList }
})
vi.mock('@/lib/intake/use-search', () => ({
  useIntakeSearch: () => ({ state: { kind: 'idle' }, setQuery: vi.fn() }),
}))
vi.mock('@/lib/intake/recent-customers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/intake/recent-customers')>()
  return { ...actual, getRecentIntakeCustomers: mockRecents }
})

import QuickTicketPage from '@/app/(app)/tickets/new/page'
import { QuickTicket } from '@/components/screens/quick-ticket'

const vehicleId = '11111111-1111-4111-8111-111111111111'
const ticketId = '33333333-3333-4333-8333-333333333333'
const cannedId = '44444444-4444-4444-8444-444444444444'
const cannedJob = {
  id: cannedId,
  title: 'Oil service',
  kind: 'maintenance' as const,
  defaultRequiredSkillTier: 1 as const,
  sort: 10,
  lines: [
    { kind: 'part' as const, description: 'Oil filter', sort: 10, quantity: '1', priceCents: 1_250, taxable: true },
    { kind: 'labor' as const, description: 'Oil service labor', sort: 20, hours: '0.5', priceCents: 5_000, taxable: false, laborRateCents: 10_000 },
    { kind: 'fee' as const, description: 'Disposal', sort: 30, priceCents: 500, taxable: true },
  ],
  fingerprint: 'a'.repeat(64),
  summary: { subtotalCents: 6_750, taxableSubtotalCents: 1_750, taxCents: 144, totalCents: 6_894 },
}
const recentCustomers = [
  {
    id: 'customer-1',
    name: 'Marisol Vega',
    phone: '(214) 555-0197',
    email: 'marisol@example.com',
    vehicleCount: 1,
    vehicles: [
      {
        id: vehicleId,
        year: 2019,
        make: 'Ford',
        model: 'F-150',
        engine: '3.5L EcoBoost',
        vin: '1FTFW1E41KFA00001',
        plate: 'TEX-4192',
        mileage: 88420,
        lastVisit: new Date('2026-07-10T14:00:00Z'),
      },
    ],
    lastVisit: new Date('2026-07-10T14:00:00Z'),
  },
  {
    id: 'customer-2',
    name: 'Jordan Lee',
    phone: '(214) 555-0188',
    email: null,
    vehicleCount: 1,
    vehicles: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        year: 2021,
        make: 'Honda',
        model: 'Civic',
        engine: '2.0L',
        vin: '2HGFC2F59MH000001',
        plate: 'CIV-2100',
        mileage: 41200,
        lastVisit: new Date('2026-07-10T13:00:00Z'),
      },
    ],
    lastVisit: new Date('2026-07-10T13:00:00Z'),
  },
]

function fillNewTicket(kind: 'repair' | 'maintenance' = 'repair', includeMileage = true) {
  fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: ' Robert Sandoval ' } })
  fireEvent.change(screen.getByLabelText(/^phone$/i), { target: { value: ' (303) 555-0142 ' } })
  fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: '' } })
  fireEvent.change(screen.getByLabelText(/^year$/i), { target: { value: '2014' } })
  fireEvent.change(screen.getByLabelText(/^make$/i), { target: { value: ' BMW ' } })
  fireEvent.change(screen.getByLabelText(/^model$/i), { target: { value: ' 335i ' } })
  fireEvent.change(screen.getByLabelText(/^engine$/i), { target: { value: ' N55 ' } })
  fireEvent.change(screen.getByLabelText(/^vin$/i), { target: { value: 'wba3a5c50ejf12345' } })
  if (includeMileage) {
    fireEvent.change(screen.getByLabelText(/mileage today/i), { target: { value: '121000' } })
  }
  fireEvent.change(screen.getByLabelText(/license plate/i), { target: { value: ' shop10 ' } })
  fireEvent.change(screen.getByLabelText(/work type/i), { target: { value: kind } })
  fireEvent.change(screen.getByLabelText(/requested work/i), {
    target: { value: kind === 'repair' ? ' Replace rear brake pads ' : ' Change engine oil ' },
  })
}

describe('QuickTicket', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ ticket: { id: ticketId } }),
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('states the honest boundary and renders no quote, approval, assignment, AI, or price theater', () => {
    render(<QuickTicket userEmail="avery@shop.test" />)

    expect(screen.getByRole('heading', { name: 'Quick quote' })).toBeInTheDocument()
    expect(screen.getByText(/nothing is prepared, sent, approved, or started here/i)).toBeInTheDocument()
    expect(screen.getByText(/manual capture creates an incomplete draft/i)).toBeInTheDocument()
    expect(screen.queryByText(/auto.?save|\bAI\b|send quote|assign technician|start work/i)).toBeNull()
  })

  it('requires one requested repair or maintenance description before creation', () => {
    render(<QuickTicket />)
    const createButtons = screen.getAllByRole('button', { name: /^Create quote/i })
    createButtons.forEach((button) => expect(button).toBeDisabled())

    fillNewTicket('maintenance')
    createButtons.forEach((button) => expect(button).toBeEnabled())
  })

  it.each([
    ['repair', 'Replace rear brake pads'],
    ['maintenance', 'Change engine oil'],
  ] as const)('POSTs the exact new-vehicle %s body and redirects only to ticket detail', async (kind, description) => {
    render(<QuickTicket userEmail="avery@shop.test" />)
    fillNewTicket(kind)
    fireEvent.submit(document.getElementById('quick-ticket-form')!)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/tickets/quick',
      expect.objectContaining({ method: 'POST' }),
    )
    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body).toMatchObject({
      vehicleMode: 'new',
      customer: {
        name: 'Robert Sandoval',
        phone: '(303) 555-0142',
        email: null,
      },
      vehicle: {
        year: 2014,
        make: 'BMW',
        model: '335i',
        engine: 'N55',
        vin: 'WBA3A5C50EJF12345',
        mileage: 121000,
        plate: 'shop10',
      },
      quote: { mode: 'manual', kind, description },
    })
    expect(body.clientKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.assignedTechId).toBeUndefined()
    expect(body.sessionId).toBeUndefined()
    expect(body.price).toBeUndefined()
    expect(mockPush).toHaveBeenCalledWith(`/tickets/${ticketId}/quote`)
  })

  it('reuses predictive search and POSTs the exact existing-vehicle body with true-open semantics', async () => {
    const user = userEvent.setup()
    render(<QuickTicket recentCustomers={recentCustomers} />)

    await user.click(screen.getByPlaceholderText(/customer name, phone, vin/i))
    await user.click(screen.getByText('Marisol Vega'))
    expect(screen.getByRole('status')).toHaveTextContent(/2019 Ford F-150 selected/i)
    expect(screen.queryByLabelText(/^name$/i)).toBeNull()

    fireEvent.change(screen.getByLabelText(/mileage today/i), { target: { value: '89000' } })
    fireEvent.change(screen.getByLabelText(/work type/i), { target: { value: 'maintenance' } })
    fireEvent.change(screen.getByLabelText(/requested work/i), {
      target: { value: 'Rotate tires' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: /^Create quote/i })[0])

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body).toMatchObject({
      vehicleMode: 'existing',
      existingVehicleId: vehicleId,
      mileage: 89000,
      quote: { mode: 'manual', kind: 'maintenance', description: 'Rotate tires' },
    })
    expect(body.clientKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.assignedTechId).toBeUndefined()
    expect(mockPush).toHaveBeenCalledWith(`/tickets/${ticketId}/quote`)
  })

  it('defaults to canned work and previews exact lines, tax, and total', () => {
    render(<QuickTicket cannedJobs={[cannedJob]} cannedTaxRateBps={825} />)
    expect(screen.getByLabelText('Source')).toHaveValue('canned')
    expect(screen.getByLabelText('Canned job')).toHaveValue(cannedId)
    const preview = screen.getByRole('region', { name: 'Exact quote preview' })
    expect(preview).toHaveTextContent('Oil service')
    expect(preview).toHaveTextContent('Oil filter')
    expect(preview).toHaveTextContent('Part · Qty 1 · Oil filter')
    expect(preview).toHaveTextContent('Labor · 0.5 hr · Oil service labor')
    expect(preview).toHaveTextContent('Fee · Disposal')
    expect(preview).toHaveTextContent('$67.50')
    expect(preview).toHaveTextContent('$1.44')
    expect(preview).toHaveTextContent('$68.94')
    expect(screen.queryByLabelText('Requested work')).toBeNull()
  })

  it('posts exact canned expectations and redirects to the quote builder', async () => {
    const user = userEvent.setup()
    render(<QuickTicket recentCustomers={recentCustomers} cannedJobs={[cannedJob]} cannedTaxRateBps={825} />)
    await user.click(screen.getByPlaceholderText(/customer name, phone, vin/i))
    await user.click(screen.getByText('Marisol Vega'))
    fireEvent.click(screen.getAllByRole('button', { name: /^Create quote/i })[0])
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body).toMatchObject({
      vehicleMode: 'existing',
      existingVehicleId: vehicleId,
      mileage: null,
      quote: {
        mode: 'canned',
        cannedJobId: cannedId,
        expectedFingerprint: 'a'.repeat(64),
        expectedTaxRateBps: 825,
      },
    })
    expect(body.clientKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.requestedWork).toBeUndefined()
    expect(mockPush).toHaveBeenCalledWith(`/tickets/${ticketId}/quote`)
  })

  it('reuses one request key for ambiguous retries and rotates it when normalized input changes', async () => {
    vi.mocked(globalThis.fetch)
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ ticket: { id: ticketId } }) } as Response)
    const user = userEvent.setup()
    render(<QuickTicket recentCustomers={recentCustomers} cannedJobs={[cannedJob]} cannedTaxRateBps={825} />)
    await user.click(screen.getByPlaceholderText(/customer name, phone, vin/i))
    await user.click(screen.getByText('Marisol Vega'))
    const create = screen.getAllByRole('button', { name: /^Create quote/i })[0]
    fireEvent.click(create)
    await screen.findByText('The quote service could not be reached. Retry with the same details.')
    fireEvent.click(create)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    fireEvent.change(screen.getByLabelText(/mileage today/i), { target: { value: '89001' } })
    fireEvent.click(create)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(3))
    const keys = vi.mocked(globalThis.fetch).mock.calls.map((call) =>
      JSON.parse(call[1]!.body as string).clientKey as string)
    expect(keys[1]).toBe(keys[0])
    expect(keys[2]).not.toBe(keys[0])
  })

  it.each([
    ['conflict', 409, { error: 'conflict', retryable: false }],
    ['retired template', 404, { error: 'not_found' }],
  ] as const)('refreshes %s canned context, reconciles selection, rotates identity, and restores focus', async (_case, status, errorBody) => {
    const refreshedJob = { ...cannedJob, title: 'Updated oil service', fingerprint: 'b'.repeat(64) }
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce({
        ok: false, status, json: async () => errorBody,
      } as Response)
      .mockResolvedValueOnce({
        ok: true, status: 201, json: async () => ({ ticket: { id: ticketId } }),
      } as Response)
    const user = userEvent.setup()
    const view = render(<QuickTicket
      recentCustomers={recentCustomers}
      cannedJobs={[cannedJob]}
      cannedTaxRateBps={825}
    />)
    await user.click(screen.getByPlaceholderText(/customer name, phone, vin/i))
    await user.click(screen.getByText('Marisol Vega'))
    fireEvent.click(screen.getAllByRole('button', { name: /^Create quote/i })[0])
    await screen.findByText('Quote or canned-job context changed. Refresh canned jobs and choose again.')
    screen.getAllByRole('button', { name: /^Create quote/i }).forEach((button) => expect(button).toBeDisabled())
    const first = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh canned jobs' }))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
    view.rerender(<QuickTicket
      recentCustomers={recentCustomers}
      cannedJobs={[refreshedJob]}
      cannedTaxRateBps={900}
    />)
    await waitFor(() => expect(screen.getByLabelText('Source')).toHaveFocus())
    screen.getAllByRole('button', { name: /^Create quote/i }).forEach((button) => expect(button).toBeEnabled())
    expect(screen.getByLabelText('Canned job')).toHaveValue(cannedId)
    expect(screen.getAllByText('Updated oil service')).toHaveLength(2)
    expect(screen.queryByText('Quote or canned-job context changed. Refresh canned jobs and choose again.')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /^Create quote/i })[0])
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    const second = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[1][1]!.body as string)
    expect(second.clientKey).not.toBe(first.clientKey)
    expect(second.quote).toMatchObject({ expectedFingerprint: 'b'.repeat(64), expectedTaxRateBps: 900 })
  })

  it('locks edits and navigation while creation is in flight', async () => {
    let resolveRequest!: (value: Response) => void
    vi.mocked(globalThis.fetch).mockReturnValueOnce(new Promise((resolve) => { resolveRequest = resolve }))
    const user = userEvent.setup()
    render(<QuickTicket recentCustomers={recentCustomers} cannedJobs={[cannedJob]} cannedTaxRateBps={825} />)
    await user.click(screen.getByPlaceholderText(/customer name, phone, vin/i))
    await user.click(screen.getByText('Marisol Vega'))
    fireEvent.click(screen.getAllByRole('button', { name: /^Create quote/i })[0])
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    expect(screen.getByLabelText('Source')).toBeDisabled()
    expect(screen.getByLabelText('Canned job')).toBeDisabled()
    screen.getAllByRole('button', { name: /discard|cancel/i }).forEach((button) => expect(button).toBeDisabled())
    expect(mockPush).not.toHaveBeenCalled()
    resolveRequest({ ok: true, status: 201, json: async () => ({ ticket: { id: ticketId } }) } as Response)
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/tickets/${ticketId}/quote`))
    expect(mockPush).not.toHaveBeenCalledWith('/today')
  })

  it('keeps null-tax canned work visibly incomplete and degrades to manual when the catalog fails', () => {
    const nullTaxJob = { ...cannedJob, summary: { ...cannedJob.summary, taxCents: null, totalCents: null } }
    const view = render(<QuickTicket cannedJobs={[nullTaxJob]} cannedTaxRateBps={null} />)
    const preview = screen.getByRole('region', { name: 'Exact quote preview' })
    expect(preview).toHaveTextContent('TaxUnavailable')
    expect(preview).toHaveTextContent('TotalUnavailable')
    expect(preview).toHaveTextContent(/remain an incomplete draft/i)
    view.rerender(<QuickTicket cannedCatalogAvailable={false} />)
    expect(screen.getByText(/canned jobs are unavailable/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Source')).toHaveValue('manual')
  })

  it('clears entity-specific mileage when switching from one existing vehicle to another', async () => {
    const user = userEvent.setup()
    render(<QuickTicket recentCustomers={recentCustomers} />)

    const search = screen.getByPlaceholderText(/customer name, phone, vin/i)
    await user.click(search)
    await user.click(screen.getByText('Marisol Vega'))
    fireEvent.change(screen.getByLabelText(/mileage today/i), { target: { value: '89000' } })

    await user.click(search)
    await user.click(screen.getByText('Jordan Lee'))
    expect(screen.getByLabelText(/mileage today/i)).toHaveValue(null)
    fireEvent.change(screen.getByLabelText(/requested work/i), { target: { value: 'Rotate tires' } })
    fireEvent.submit(document.getElementById('quick-ticket-form')!)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body).toMatchObject({
      vehicleMode: 'existing',
      existingVehicleId: '22222222-2222-4222-8222-222222222222',
      mileage: null,
    })
  })

  it('clears existing-vehicle mileage when Create new crosses back to the new form', async () => {
    const user = userEvent.setup()
    render(<QuickTicket recentCustomers={recentCustomers} />)

    const search = screen.getByPlaceholderText(/customer name, phone, vin/i)
    await user.click(search)
    await user.click(screen.getByText('Marisol Vega'))
    fireEvent.change(screen.getByLabelText(/mileage today/i), { target: { value: '89000' } })
    await user.click(search)
    fireEvent.keyDown(search, { key: 'Enter', shiftKey: true })

    expect(screen.getByLabelText(/mileage today/i)).toHaveValue(null)
    fillNewTicket('repair', false)
    fireEvent.submit(document.getElementById('quick-ticket-form')!)

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.vehicleMode).toBe('new')
    expect(body.vehicle.mileage).toBeNull()
  })

  it('clears existing-vehicle mileage when Change returns to the new form', async () => {
    const user = userEvent.setup()
    render(<QuickTicket recentCustomers={recentCustomers} />)

    await user.click(screen.getByPlaceholderText(/customer name, phone, vin/i))
    await user.click(screen.getByText('Marisol Vega'))
    fireEvent.change(screen.getByLabelText(/mileage today/i), { target: { value: '89000' } })
    await user.click(screen.getByRole('button', { name: 'Change' }))

    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/mileage today/i)).toHaveValue(null)
  })

  it.each([
    ['Command', { metaKey: true }],
    ['Control', { ctrlKey: true }],
  ])('makes the form the single %s+Enter owner while predictive search is open', async (_key, modifier) => {
    const user = userEvent.setup()
    render(<QuickTicket recentCustomers={recentCustomers} />)
    fillNewTicket()
    const search = screen.getByPlaceholderText(/customer name, phone, vin/i)
    await user.click(search)
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter', ...modifier })

    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
    expect(body.vehicleMode).toBe('new')
    expect(body.vehicle.make).toBe('BMW')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('mirrors every practical server field bound in native controls', () => {
    render(<QuickTicket />)

    expect(screen.getByLabelText(/^name$/i)).toHaveAttribute('maxlength', '200')
    expect(screen.getByLabelText(/^phone$/i)).toHaveAttribute('maxlength', '100')
    expect(screen.getByLabelText(/^email$/i)).toHaveAttribute('maxlength', '320')
    expect(screen.getByLabelText(/^year$/i)).toHaveAttribute('max', String(new Date().getFullYear() + 1))
    expect(screen.getByLabelText(/^make$/i)).toHaveAttribute('maxlength', '100')
    expect(screen.getByLabelText(/^model$/i)).toHaveAttribute('maxlength', '100')
    expect(screen.getByLabelText(/^engine$/i)).toHaveAttribute('maxlength', '200')
    expect(screen.getByLabelText(/^vin$/i)).toHaveAttribute('pattern', '.{17}')
    expect(screen.getByLabelText(/^vin$/i)).toHaveAttribute('maxlength', '17')
    expect(screen.getByLabelText(/mileage today/i)).toHaveAttribute('max', '2147483647')
    expect(screen.getByLabelText(/license plate/i)).toHaveAttribute('maxlength', '32')
    expect(screen.getByLabelText(/requested work/i)).toHaveAttribute('maxlength', '200')
  })

  it.each([
    ['VIN', /vin/i, 'SHORTVIN'],
    ['year', /^year$/i, String(new Date().getFullYear() + 2)],
    ['mileage', /mileage today/i, '2147483648'],
  ])('does not submit when %s violates the server contract', async (_name, label, invalidValue) => {
    render(<QuickTicket />)
    fillNewTicket()
    fireEvent.change(screen.getByLabelText(label), { target: { value: invalidValue } })
    fireEvent.submit(document.getElementById('quick-ticket-form')!)

    await Promise.resolve()
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })

  it('keeps the user in place and gives calm recovery copy for an API error envelope', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: 'not_found' }),
    } as Response)
    render(<QuickTicket />)
    fillNewTicket()
    fireEvent.submit(document.getElementById('quick-ticket-form')!)

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/choose the customer or vehicle again/i),
    )
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('does not redirect when a successful response lacks a real ticket id', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ ticket: {} }),
    } as Response)
    render(<QuickTicket />)
    fillNewTicket()
    fireEvent.submit(document.getElementById('quick-ticket-form')!)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/could not create/i))
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('pins 44px interactive targets and intentional 375px single-column layout', () => {
    const css = readFileSync(
      resolve(process.cwd(), 'components/screens/quick-ticket.module.css'),
      'utf8',
    )
    const allWidths = css.slice(0, css.indexOf('@media'))

    expect(css).toMatch(/@media\s*\(max-width:\s*767px\)/)
    expect(css).toMatch(/:global\(\.vt-form__group\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(css).toMatch(/:global\(\.vt-form__row\)[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(allWidths).toMatch(/:global\(\.vt-btn\)[\s\S]*min-block-size:\s*44px/)
    expect(allWidths).toMatch(/:global\(\.vt-field__input\)[\s\S]*min-block-size:\s*44px/)
    expect(allWidths).toMatch(/\.changeButton[\s\S]*min-block-size:\s*44px/)
    expect(allWidths).toMatch(/:global\(\.pis__row\)[\s\S]*min-block-size:\s*56px/)
    expect(css).toMatch(/:focus-visible/)
    expect(css).toMatch(/padding:\s*12px 18px calc\(12px \+ env\(safe-area-inset-bottom\)\)/)
  })
})

describe('/tickets/new page', () => {
  it('protects the page and loads recent customers only for the signed-in shop', async () => {
    mockAccess.mockResolvedValue({ kind: 'allow' })
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', email: 'avery@shop.test' },
      profile: { id: 'profile-1', shopId: 'shop-1', role: 'advisor' },
    })
    mockRecents.mockResolvedValue(recentCustomers)
    mockCannedList.mockResolvedValue({ ok: true, cannedJobs: [cannedJob], taxRateBps: 825 })

    const result = await QuickTicketPage()

    expect(mockRecents).toHaveBeenCalledWith({
      db: { name: 'test-db' },
      shopId: 'shop-1',
      withinHours: 12,
      limit: 8,
    })
    expect(result.type).toBe(QuickTicket)
    expect(result.props).toMatchObject({
      userEmail: 'avery@shop.test',
      recentCustomers,
      cannedJobs: [cannedJob],
      cannedTaxRateBps: 825,
      cannedCatalogAvailable: true,
    })
    expect(mockAccess).toHaveBeenCalledWith({ name: 'test-db' }, 'user-1')
  })

  it('keeps manual Quick Quote available when the optional canned catalog rejects', async () => {
    mockAccess.mockResolvedValue({ kind: 'allow' })
    mockAuth.mockResolvedValue({
      user: { id: 'user-1', email: 'avery@shop.test' },
      profile: { id: 'profile-1', shopId: 'shop-1', role: 'advisor' },
    })
    mockRecents.mockResolvedValue([])
    mockCannedList.mockRejectedValue(new Error('catalog unavailable'))
    const result = await QuickTicketPage()
    expect(result.props).toMatchObject({
      cannedJobs: [], cannedTaxRateBps: null, cannedCatalogAvailable: false,
    })
  })
})
