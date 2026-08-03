import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockRefresh, mockRandomUUID } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  mockRandomUUID: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))

import { AddDiagnosticTime } from '@/components/screens/add-diagnostic-time'
import type { SafeCannedJobTemplate } from '@/lib/shop-os/canned-jobs-ui'

const TICKET_ID = '00000000-0000-4000-8000-000000000401'
const CLIENT_KEY = '00000000-0000-4000-8000-000000000701'
const NEXT_CLIENT_KEY = '00000000-0000-4000-8000-000000000702'
const JOB_ID = '00000000-0000-8000-8000-000000000801'
const OTHER_JOB_ID = '00000000-0000-8000-8000-000000000802'

const refreshedTicket = {
  id: TICKET_ID,
  ticketNumber: 7,
  source: 'counter',
  status: 'open',
  concern: 'Intermittent no-start',
  whenStarted: null,
  howOften: null,
  diagnosticAuthorizedCents: null,
  diagnosticAuthorizationNote: null,
  customer: null,
  vehicle: null,
  jobs: [{
    id: JOB_ID,
    title: 'Additional diagnostic time',
    kind: 'diagnostic',
    requiredSkillTier: 2,
    assignedTechId: null,
    assignedTech: null,
    sessionId: null,
    workStatus: 'open',
    approvalState: 'pending_quote',
    customerSuppliedPartsNote: null,
    workNotes: null,
    diagnosticStartState: 'idle',
    diagnosticStartErrorCode: null,
    createdAt: '2026-08-03T12:00:00.000Z',
    updatedAt: '2026-08-03T12:00:00.000Z',
  }],
  activities: [],
  createdAt: '2026-08-03T12:00:00.000Z',
  updatedAt: '2026-08-03T12:00:00.000Z',
}

const defaultConfirmation = {
  clientKey: CLIENT_KEY,
  jobId: JOB_ID,
  title: 'Additional diagnostic time',
  laborHours: 1,
  priceCents: 12_000,
}

const successResponse = (
  ticket: unknown = refreshedTicket,
  confirmationOverrides: Partial<typeof defaultConfirmation> = {},
) => new Response(JSON.stringify({
  confirmation: { ...defaultConfirmation, ...confirmationOverrides },
  ticket,
}), { status: 201, headers: { 'content-type': 'application/json' } })

const refreshedTicketWithTitle = (title: string) => ({
  ...refreshedTicket,
  jobs: [{ ...refreshedTicket.jobs[0], title }],
})

/** The shop's real standing diagnostic: one hour of NVH work at $155. */
const nvhTemplate = {
  id: '00000000-0000-4000-8000-0000000004a1',
  title: 'NVH DIAGNOSTICS',
  kind: 'diagnostic',
  defaultRequiredSkillTier: 2,
  sort: 0,
  lines: [
    {
      kind: 'labor',
      description: 'DIAGNOSTIC FOR NOISE VIBRATION AND HARSHNESS',
      sort: 0,
      hours: '1',
      priceCents: 15_500,
      taxable: false,
    },
  ],
  fingerprint: 'b'.repeat(64),
  summary: { subtotalCents: 15_500, taxableSubtotalCents: 0, taxCents: 0, totalCents: 15_500 },
} satisfies SafeCannedJobTemplate

/** A two-line diagnostic, to prove the hours field sums labor rather than guessing. */
const extendedTemplate = {
  ...nvhTemplate,
  id: '00000000-0000-4000-8000-0000000004a2',
  title: 'DRIVEABILITY DIAGNOSTICS',
  lines: [
    { kind: 'labor', description: 'Scan and verify', sort: 0, hours: '0.5', priceCents: 7_750, taxable: false },
    { kind: 'labor', description: 'Road test', sort: 1, hours: '1.25', priceCents: 19_375, taxable: false },
  ],
  fingerprint: 'c'.repeat(64),
  summary: { subtotalCents: 27_125, taxableSubtotalCents: 0, taxCents: 0, totalCents: 27_125 },
} satisfies SafeCannedJobTemplate

describe('AddDiagnosticTime', () => {
  beforeEach(() => {
    mockRandomUUID.mockReset().mockReturnValue(CLIENT_KEY)
    vi.stubGlobal('crypto', { randomUUID: mockRandomUUID })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(successResponse()))
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    mockRefresh.mockReset()
  })

  it('posts the typed description, hours, and dollar price converted to cents', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(successResponse(
      refreshedTicketWithTitle('Deeper electrical trace'),
      { title: 'Deeper electrical trace', laborHours: 1.5, priceCents: 28_125 },
    ))
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
      clientKey: CLIENT_KEY,
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
    expect(body).toEqual({ clientKey: CLIENT_KEY, laborHours: 1, priceCents: 12_000 })
  })

  it('calls onAdded instead of router.refresh when the parent supplies it', async () => {
    const onAdded = vi.fn()
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(successResponse(
      refreshedTicket,
      { laborHours: 2, priceCents: 24_000 },
    ))
    render(<AddDiagnosticTime ticketId={TICKET_ID} onAdded={onAdded} />)
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '240' } })
    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
    expect(onAdded).toHaveBeenCalledWith(refreshedTicket)
    expect(mockRefresh).not.toHaveBeenCalled()
  })

  it('reuses one client key after a network failure and confirms only refreshed ticket truth', async () => {
    const onAdded = vi.fn()
    const confirmedTicket = refreshedTicketWithTitle('Deeper trace')
    vi.mocked(globalThis.fetch)
      .mockRejectedValueOnce(new Error('network interrupted'))
      .mockResolvedValueOnce(successResponse(confirmedTicket, { title: 'Deeper trace' }))
    render(<AddDiagnosticTime ticketId={TICKET_ID} onAdded={onAdded} />)
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Deeper trace' } })
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '120' } })

    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await screen.findByRole('alert')
    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(confirmedTicket))

    const bodies = vi.mocked(globalThis.fetch).mock.calls.map((call) => JSON.parse(call[1]!.body as string))
    expect(bodies).toHaveLength(2)
    expect(bodies[0].clientKey).toBe(CLIENT_KEY)
    expect(bodies[1].clientKey).toBe(CLIENT_KEY)
    expect(mockRandomUUID).toHaveBeenCalledTimes(1)
  })

  it('retains fields and the same key after malformed success, then clears after valid refreshed truth', async () => {
    const onAdded = vi.fn()
    const confirmedTicket = refreshedTicketWithTitle('Deeper trace')
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(successResponse({ id: TICKET_ID }, { title: 'Deeper trace' }))
      .mockResolvedValueOnce(successResponse(confirmedTicket, { title: 'Deeper trace' }))
    render(<AddDiagnosticTime ticketId={TICKET_ID} onAdded={onAdded} />)
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Deeper trace' } })
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '120' } })

    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await screen.findByRole('alert')
    expect(onAdded).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/description/i)).toHaveValue('Deeper trace')
    expect(screen.getByLabelText(/hours/i)).toHaveValue('1')
    expect(screen.getByLabelText(/price/i)).toHaveValue('120')

    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(confirmedTicket))
    const keys = vi.mocked(globalThis.fetch).mock.calls
      .map((call) => JSON.parse(call[1]!.body as string).clientKey)
    expect(keys).toEqual([CLIENT_KEY, CLIENT_KEY])
    expect(screen.getByLabelText(/description/i)).toHaveValue('')
  })

  it('rejects a plausible stale ticket that does not contain the exact created supplemental job', async () => {
    const onAdded = vi.fn()
    const confirmedTicket = refreshedTicketWithTitle('Deeper trace')
    const staleTicket = {
      ...refreshedTicket,
      jobs: [{
        ...refreshedTicket.jobs[0],
        id: OTHER_JOB_ID,
        title: 'Deeper trace',
      }],
    }
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(successResponse(staleTicket, { title: 'Deeper trace' }))
      .mockResolvedValueOnce(successResponse(confirmedTicket, { title: 'Deeper trace' }))
    render(<AddDiagnosticTime ticketId={TICKET_ID} onAdded={onAdded} />)
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Deeper trace' } })
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '120' } })

    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await screen.findByRole('alert')
    expect(onAdded).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/description/i)).toHaveValue('Deeper trace')

    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(confirmedTicket))
    const keys = vi.mocked(globalThis.fetch).mock.calls
      .map((call) => JSON.parse(call[1]!.body as string).clientKey)
    expect(keys).toEqual([CLIENT_KEY, CLIENT_KEY])
  })

  it.each([
    ['client key', { clientKey: NEXT_CLIENT_KEY }],
    ['job ID', { jobId: OTHER_JOB_ID }],
    ['title', { title: 'Different diagnostic' }],
    ['labor hours', { laborHours: 1.25 }],
    ['price', { priceCents: 12_001 }],
  ] as const)('rejects a success with the wrong confirmation %s before accepting exact truth', async (_field, wrong) => {
    const onAdded = vi.fn()
    const confirmedTicket = refreshedTicketWithTitle('Deeper trace')
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(successResponse(confirmedTicket, { title: 'Deeper trace', ...wrong }))
      .mockResolvedValueOnce(successResponse(confirmedTicket, { title: 'Deeper trace' }))
    render(<AddDiagnosticTime ticketId={TICKET_ID} onAdded={onAdded} />)
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Deeper trace' } })
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '120' } })

    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await screen.findByRole('alert')
    expect(onAdded).not.toHaveBeenCalled()
    expect(screen.getByLabelText(/description/i)).toHaveValue('Deeper trace')

    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(confirmedTicket))
    const keys = vi.mocked(globalThis.fetch).mock.calls
      .map((call) => JSON.parse(call[1]!.body as string).clientKey)
    expect(keys).toEqual([CLIENT_KEY, CLIENT_KEY])
  })

  it('accepts exact current ticket truth after the confirmed job lifecycle has advanced', async () => {
    const onAdded = vi.fn()
    const advancedTicket = {
      ...refreshedTicket,
      jobs: [{
        ...refreshedTicket.jobs[0],
        workStatus: 'in_progress',
        approvalState: 'approved',
      }],
    }
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(successResponse(advancedTicket))
    render(<AddDiagnosticTime ticketId={TICKET_ID} onAdded={onAdded} />)
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(advancedTicket))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('refreshes late saved truth without clearing newer typed intent and rotates the next request key', async () => {
    const onAdded = vi.fn()
    const oldTicket = refreshedTicketWithTitle('Old trace')
    let resolveFirst: ((response: Response) => void) | undefined
    mockRandomUUID
      .mockReset()
      .mockReturnValueOnce(CLIENT_KEY)
      .mockReturnValueOnce(NEXT_CLIENT_KEY)
    vi.mocked(globalThis.fetch)
      .mockReset()
      .mockReturnValueOnce(new Promise<Response>((resolve) => {
        resolveFirst = resolve
      }))
      .mockRejectedValueOnce(new Error('new request interrupted'))
    render(<AddDiagnosticTime ticketId={TICKET_ID} onAdded={onAdded} />)
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Old trace' } })
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))

    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'New trace' } })
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '240' } })
    resolveFirst?.(successResponse(oldTicket, { title: 'Old trace' }))

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(oldTicket))
    expect(screen.getByLabelText(/description/i)).toHaveValue('New trace')
    expect(screen.getByLabelText(/hours/i)).toHaveValue('2')
    expect(screen.getByLabelText(/price/i)).toHaveValue('240')

    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await screen.findByRole('alert')
    const bodies = vi.mocked(globalThis.fetch).mock.calls
      .map((call) => JSON.parse(call[1]!.body as string))
    expect(bodies).toEqual([
      { clientKey: CLIENT_KEY, description: 'Old trace', laborHours: 1, priceCents: 12_000 },
      { clientKey: NEXT_CLIENT_KEY, description: 'New trace', laborHours: 2, priceCents: 24_000 },
    ])
  })

  it('keeps the key for normalized-equivalent details and rotates it only when intent changes', async () => {
    mockRandomUUID
      .mockReset()
      .mockReturnValueOnce(CLIENT_KEY)
      .mockReturnValueOnce(NEXT_CLIENT_KEY)
    vi.mocked(globalThis.fetch)
      .mockRejectedValueOnce(new Error('first interrupted'))
      .mockRejectedValueOnce(new Error('second interrupted'))
      .mockResolvedValueOnce(successResponse(
        refreshedTicketWithTitle('Deeper trace'),
        {
          clientKey: NEXT_CLIENT_KEY,
          title: 'Deeper trace',
          priceCents: 12_100,
        },
      ))
    render(<AddDiagnosticTime ticketId={TICKET_ID} />)
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: '  Deeper trace  ' } })
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await screen.findByRole('alert')

    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'Deeper trace' } })
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1.0' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '120.00' } })
    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))

    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '121' } })
    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
    const keys = vi.mocked(globalThis.fetch).mock.calls
      .map((call) => JSON.parse(call[1]!.body as string).clientKey)
    expect(keys).toEqual([CLIENT_KEY, CLIENT_KEY, NEXT_CLIENT_KEY])
  })

  it('keeps the key when the default title is made explicit after an ambiguous failure', async () => {
    mockRandomUUID
      .mockReset()
      .mockReturnValueOnce(CLIENT_KEY)
      .mockReturnValueOnce(NEXT_CLIENT_KEY)
    vi.mocked(globalThis.fetch)
      .mockRejectedValueOnce(new Error('first interrupted'))
      .mockRejectedValueOnce(new Error('second interrupted'))
    render(<AddDiagnosticTime ticketId={TICKET_ID} />)
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await screen.findByRole('alert')

    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: 'Additional diagnostic time' },
    })
    fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2))
    const keys = vi.mocked(globalThis.fetch).mock.calls
      .map((call) => JSON.parse(call[1]!.body as string).clientKey)
    expect(keys).toEqual([CLIENT_KEY, CLIENT_KEY])
    expect(mockRandomUUID).toHaveBeenCalledTimes(1)
  })

  it('blocks duplicate mounted submits before React can repaint the busy state', async () => {
    let resolveFetch: ((value: ReturnType<typeof successResponse>) => void) | undefined
    vi.mocked(globalThis.fetch).mockReturnValueOnce(new Promise((resolve) => {
      resolveFetch = resolve
    }) as never)
    render(<AddDiagnosticTime ticketId={TICKET_ID} />)
    fireEvent.change(screen.getByLabelText(/hours/i), { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '120' } })
    const form = screen.getByRole('button', { name: /add diagnostic time/i }).closest('form')
    if (!form) throw new Error('form fixture missing')

    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
    resolveFetch?.(successResponse())
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
    expect(mockRandomUUID).toHaveBeenCalledTimes(1)
  })

  describe('saved diagnostics', () => {
    it('offers no template picker when the shop has saved none', () => {
      render(<AddDiagnosticTime ticketId={TICKET_ID} />)
      expect(screen.queryByLabelText(/saved diagnostic/i)).not.toBeInTheDocument()
    })

    it('fills description, hours, and price from the chosen saved diagnostic', () => {
      render(<AddDiagnosticTime ticketId={TICKET_ID} templates={[nvhTemplate]} />)
      fireEvent.change(screen.getByLabelText(/saved diagnostic/i), {
        target: { value: nvhTemplate.id },
      })

      expect(screen.getByLabelText(/description/i)).toHaveValue('NVH DIAGNOSTICS')
      expect(screen.getByLabelText(/hours/i)).toHaveValue('1')
      expect(screen.getByLabelText(/price/i)).toHaveValue('155.00')
    })

    it('sums the labor lines when a saved diagnostic carries more than one', () => {
      render(<AddDiagnosticTime ticketId={TICKET_ID} templates={[extendedTemplate]} />)
      fireEvent.change(screen.getByLabelText(/saved diagnostic/i), {
        target: { value: extendedTemplate.id },
      })

      expect(screen.getByLabelText(/hours/i)).toHaveValue('1.75')
      expect(screen.getByLabelText(/price/i)).toHaveValue('271.25')
    })

    // The shop bills one hour at $155, but a handful of legacy customers are
    // held at $100. A filled price the writer cannot correct would be worse
    // than no template at all.
    it('posts the corrected price when the writer overrides what the template filled', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(successResponse(
        refreshedTicketWithTitle('NVH DIAGNOSTICS'),
        { title: 'NVH DIAGNOSTICS', priceCents: 10_000 },
      ))
      render(<AddDiagnosticTime ticketId={TICKET_ID} templates={[nvhTemplate]} />)
      fireEvent.change(screen.getByLabelText(/saved diagnostic/i), {
        target: { value: nvhTemplate.id },
      })
      fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '100' } })
      fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))

      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
      const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
      expect(body).toEqual({
        clientKey: CLIENT_KEY,
        description: 'NVH DIAGNOSTICS',
        laborHours: 1,
        priceCents: 10_000,
      })
    })

    it('returns to a blank form after a save so the next job starts clean', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        successResponse(
          refreshedTicketWithTitle('NVH DIAGNOSTICS'),
          { title: 'NVH DIAGNOSTICS', priceCents: 15_500 },
        ),
      )
      render(<AddDiagnosticTime ticketId={TICKET_ID} templates={[nvhTemplate]} />)
      fireEvent.change(screen.getByLabelText(/saved diagnostic/i), {
        target: { value: nvhTemplate.id },
      })
      fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))

      await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1))
      expect(screen.getByLabelText(/saved diagnostic/i)).toHaveValue('')
      expect(screen.getByLabelText(/description/i)).toHaveValue('')
      expect(screen.getByLabelText(/price/i)).toHaveValue('')
    })
  })
})
