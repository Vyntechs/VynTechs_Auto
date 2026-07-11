import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ManualQuoteBuilder } from '@/components/screens/manual-quote-builder'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={String(href)} {...props}>{children}</a> }))
const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
vi.mock('next/navigation', () => ({ useRouter: () => router }))
type Builder = Extract<QuoteBuilderResult, { ok: true }>['builder']
const TICKET = '00000000-0000-4000-8000-000000000101'
const JOB = '00000000-0000-4000-8000-000000000201'
const VERSION = '00000000-0000-4000-8000-000000000401'
const NEWER_VERSION = '00000000-0000-4000-8000-000000000402'
const REQUEST = '00000000-0000-4000-8000-000000000901'
const ticket = { id: TICKET, ticketNumber: 42, concern: 'Brake vibration', customer: { name: 'Marisol Vega' }, vehicle: { year: 2019, make: 'Ford', model: 'F-150' } }
function builder(canApprove = true, approval: Builder['jobs'][number]['approval'] = { state: 'quote_ready', quoteVersionId: null }): Builder {
  return {
    ticket: { id: TICKET, status: 'open', reconciled: true }, configuration: { laborRateCents: 12000, taxRateBps: 825, laborRateConfigured: true, taxRateConfigured: true },
    jobs: [{ id: JOB, title: 'Front brake repair', kind: 'repair', workStatus: 'open', story: { content: null, source: null, reviewStatus: null, revision: 0 }, storyMode: null, decisionEligible: true, approval, lines: [] }],
    capabilities: { canRecordCustomerApproval: canApprove },
    activeVersion: { id: VERSION, versionNumber: 3, totalCents: 91638, jobs: [{ jobId: JOB, subtotalCents: 84217 }] },
  }
}

describe('Shop OS exact-version approval UI', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.stubGlobal('crypto', { randomUUID: vi.fn(() => REQUEST) }) })

  it('binds immutable facts into a two-tap phone confirmation and retains request identity through retry', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ changed: true, event: { id: '00000000-0000-4000-8000-000000000501', kind: 'approved', quoteVersionId: VERSION, jobId: JOB, approvedVia: 'phone' }, projection: { approvalState: 'approved', approvedQuoteVersionId: VERSION } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ builder: builder(true, { state: 'approved', quoteVersionId: VERSION }) }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)

    const strip = screen.getByRole('region', { name: 'Authorization for Front brake repair' })
    expect(within(strip).getByText('Quote V3 · immutable')).toBeInTheDocument()
    expect(within(strip).getByText('$842.17')).toBeInTheDocument()
    expect(within(strip).getByText('$916.38')).toBeInTheDocument()
    fireEvent.click(within(strip).getByRole('button', { name: 'Phone approval' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Record phone approval?' })
    expect(within(dialog).getByText(/V3/)).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record approval' }))
    expect(await screen.findByText('Connection interrupted. Retry with the same decision.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record approval' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    const retry = JSON.parse(String(fetchMock.mock.calls[1][1]?.body))
    expect(first.requestKey).toBe(REQUEST)
    expect(retry.requestKey).toBe(REQUEST)
    expect(first).toMatchObject({ jobId: JOB, quoteVersionId: VERSION, decision: 'approved', approvedVia: 'phone' })
    expect(await screen.findByText('Approved · V3')).toBeInTheDocument()
    expect(screen.queryByText('Approved · Phone · V3')).toBeNull()
  })

  it('shows decision truth without enabled controls for tech or parts capability', () => {
    render(<ManualQuoteBuilder ticket={ticket} builder={builder(false)} />)
    expect(screen.getByText('Advisor or owner records the customer decision.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approval|declined/i })).toBeNull()
  })

  it('shows an honest non-action state when the prepared job is not decision eligible', () => {
    const blocked = builder(true)
    blocked.jobs[0] = { ...blocked.jobs[0], workStatus: 'in_progress', decisionEligible: false }
    render(<ManualQuoteBuilder ticket={ticket} builder={blocked} />)
    expect(screen.getByText('Customer decision is unavailable for this job’s current state.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approval|declined/i })).toBeNull()
  })

  it('renders canonical retry truth instead of the attempted approval channel', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ changed: false, event: { id: '00000000-0000-4000-8000-000000000501', kind: 'declined', quoteVersionId: VERSION, jobId: JOB, approvedVia: null }, projection: { approvalState: 'declined', approvedQuoteVersionId: null } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ builder: builder(true, { state: 'declined', quoteVersionId: null }) }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Phone approval' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Record approval' }))
    expect(await screen.findByText('Declined · V3')).toBeInTheDocument()
    expect(screen.queryByText(/Approved · Phone/)).toBeNull()
  })

  it('refreshes an exact retry on a newer version without labeling the attempted version', async () => {
    const newer = builder(true, { state: 'approved', quoteVersionId: NEWER_VERSION })
    newer.activeVersion = { id: NEWER_VERSION, versionNumber: 4, totalCents: 92500, jobs: [{ jobId: JOB, subtotalCents: 85000 }] }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ changed: false, event: { id: '00000000-0000-4000-8000-000000000501', kind: 'approved', quoteVersionId: NEWER_VERSION, jobId: JOB, approvedVia: 'in_person' }, projection: { approvalState: 'approved', approvedQuoteVersionId: NEWER_VERSION } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ builder: newer }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Phone approval' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Record approval' }))
    expect(await screen.findByText('Approved · V4')).toBeInTheDocument()
    expect(screen.queryByText(/Approved · Phone · V3|Approved · In person · V3/)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('records an in-person decline intent against the exact version and exposes bay-safe CSS', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ changed: true, event: { id: '00000000-0000-4000-8000-000000000501', kind: 'declined', quoteVersionId: VERSION, jobId: JOB, approvedVia: null }, projection: { approvalState: 'declined', approvedQuoteVersionId: null } }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ builder: builder(true, { state: 'declined', quoteVersionId: null }) }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)
    const strip = screen.getByRole('region', { name: 'Authorization for Front brake repair' })
    expect(within(strip).getByRole('button', { name: 'In-person approval' })).toBeInTheDocument()
    fireEvent.click(within(strip).getByRole('button', { name: 'Record declined' }))
    fireEvent.click(within(screen.getByRole('alertdialog', { name: 'Record declined?' })).getByRole('button', { name: 'Record declined' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ requestKey: REQUEST, jobId: JOB, quoteVersionId: VERSION, decision: 'declined' })
    expect(screen.getByText('Declined · V3')).toBeInTheDocument()

    const css = readFileSync(resolve(process.cwd(), 'components/screens/manual-quote-builder.module.css'), 'utf8')
    expect(css).toMatch(/\.storyAction,[\s\S]*\.decisionActions button[\s\S]*min-height:\s*48px/)
    expect(css).toMatch(/@media \(max-width:\s*600px\)/)
    expect(css).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/)
    expect(css).toMatch(/max-height:\s*calc\(100dvh - 36px\)/)
  })
})
