import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))

import { AddDiagnosticTime } from '@/components/screens/add-diagnostic-time'
import type { SafeCannedJobTemplate } from '@/lib/shop-os/canned-jobs-ui'

const TICKET_ID = '00000000-0000-4000-8000-000000000401'

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
      render(<AddDiagnosticTime ticketId={TICKET_ID} templates={[nvhTemplate]} />)
      fireEvent.change(screen.getByLabelText(/saved diagnostic/i), {
        target: { value: nvhTemplate.id },
      })
      fireEvent.change(screen.getByLabelText(/price/i), { target: { value: '100' } })
      fireEvent.click(screen.getByRole('button', { name: /add diagnostic time/i }))

      await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1))
      const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]!.body as string)
      expect(body).toEqual({
        description: 'NVH DIAGNOSTICS',
        laborHours: 1,
        priceCents: 10_000,
      })
    })

    it('returns to a blank form after a save so the next job starts clean', async () => {
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
