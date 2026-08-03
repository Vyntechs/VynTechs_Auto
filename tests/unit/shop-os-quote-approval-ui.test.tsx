import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
const NEXT_REQUEST = '00000000-0000-4000-8000-000000000902'
const THIRD_REQUEST = '00000000-0000-4000-8000-000000000903'
const ticket = { id: TICKET, ticketNumber: 42, concern: 'Brake vibration', customer: { name: 'Marisol Vega' }, vehicle: { year: 2019, make: 'Ford', model: 'F-150' } }
function builder(canApprove = true, approval: Builder['jobs'][number]['approval'] = { state: 'quote_ready', quoteVersionId: null }): Builder {
  return {
    ticket: { id: TICKET, status: 'open', reconciled: true }, configuration: { laborRateCents: 12000, taxRateBps: 825, partsMarkupBps: null, laborRateConfigured: true, taxRateConfigured: true },
    jobs: [{ id: JOB, title: 'Front brake repair', kind: 'repair', workStatus: 'open', story: { content: null, source: null, reviewStatus: null, revision: 0 }, storyMode: null, decisionEligible: true, approval, lines: [] }],
    capabilities: { canRecordCustomerApproval: canApprove },
    activeVersion: { id: VERSION, versionNumber: 3, totalCents: 91638, jobs: [{ jobId: JOB, subtotalCents: 84217 }] },
  }
}

describe('Shop OS exact-version approval UI', () => {
  beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.stubGlobal('crypto', { randomUUID: vi.fn(() => REQUEST) }) })
  afterEach(() => { vi.useRealTimers() })

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

  it('creates and copies one exact-version customer link without claiming it was delivered', async () => {
    const writeText = vi.fn(async (_value: string) => undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => REQUEST),
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        bytes.fill(7)
        return bytes
      }),
      subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(2).buffer) },
    })
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        changed: true,
        link: {
          id: '00000000-0000-4000-8000-000000000601',
          quoteVersionId: VERSION,
          versionNumber: 3,
          expiresAt: '2026-08-09T12:00:00.000Z',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy customer link' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(fetchMock).toHaveBeenCalledWith(`/api/tickets/${TICKET}/quote/approval-links`, expect.objectContaining({
      method: 'POST',
    }))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      requestKey: REQUEST,
      quoteVersionId: VERSION,
      tokenHash: '02'.repeat(32),
    })
    expect(writeText.mock.calls[0][0]).toMatch(/^http:\/\/localhost:\d+\/approve#[A-Za-z0-9_-]{43}$/)
    expect(within(screen.getByRole('region', { name: 'Customer approval link' }))
      .getByRole('status', { name: 'Customer link update' })).toHaveTextContent('Link copied · V3')
    expect(document.body).not.toHaveTextContent(/sent|delivered/i)
  })

  it('quietly refreshes mounted advisor truth after the customer opens the link', async () => {
    vi.useFakeTimers()
    const onProjection = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ builder: builder(true, { state: 'sent', quoteVersionId: null }) }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} onProjection={onProjection} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add part' }))
    const draft = screen.getByLabelText('Description')
    fireEvent.change(draft, { target: { value: 'Do not replace this unsaved draft' } })
    draft.focus()

    expect(onProjection).toHaveBeenLastCalledWith([
      { id: JOB, workStatus: 'open', approvalState: 'quote_ready' },
    ])
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })

    expect(fetchMock).toHaveBeenCalledWith(`/api/tickets/${TICKET}/quote`, {
      method: 'GET',
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
    expect(onProjection).toHaveBeenLastCalledWith([
      { id: JOB, workStatus: 'open', approvalState: 'sent' },
    ])
    expect(draft).toHaveValue('Do not replace this unsaved draft')
    expect(draft).toHaveFocus()
    expect(within(screen.getByRole('region', { name: 'Authorization for Front brake repair' }))
      .getByText('Link opened · waiting on decision')).toBeInTheDocument()
  })

  it('preserves a mounted draft and offers recovery when the prepared version changes elsewhere', async () => {
    vi.useFakeTimers()
    const newer = builder()
    newer.activeVersion = {
      id: NEWER_VERSION,
      versionNumber: 4,
      totalCents: 92_500,
      jobs: [{ jobId: JOB, subtotalCents: 85_000 }],
    }
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ builder: newer }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add part' }))
    const draft = screen.getByLabelText('Description')
    fireEvent.change(draft, { target: { value: 'Keep this exact local draft' } })
    draft.focus()

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })

    expect(draft).toHaveValue('Keep this exact local draft')
    expect(draft).toHaveFocus()
    expect(screen.getByText('Quote changed elsewhere. Finish or cancel this edit, then refresh.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh quote' })).toBeInTheDocument()
    expect(screen.getByText('Prepared version V3')).toBeInTheDocument()
  })

  it('queues approval truth while a local mutation is unresolved and revalidates after it settles', async () => {
    vi.useFakeTimers()
    const writeText = vi.fn(async (_value: string) => undefined)
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => REQUEST),
      getRandomValues: vi.fn((bytes: Uint8Array) => { bytes.fill(7); return bytes }),
      subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(2).buffer) },
    })
    let releaseLink!: (value: {
      status: number
      json: () => Promise<unknown>
    }) => void
    const pendingLink = new Promise<{ status: number; json: () => Promise<unknown> }>((resolvePromise) => {
      releaseLink = resolvePromise
    })
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/approval-links')) return pendingLink
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ builder: builder(true, { state: 'approved', quoteVersionId: VERSION }) }),
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy customer link' }))
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(fetchMock.mock.calls.filter(([url]) => url === `/api/tickets/${TICKET}/quote`)).toHaveLength(0)

    await act(async () => {
      releaseLink({
        status: 201,
        json: async () => ({
          changed: true,
          link: {
            id: '00000000-0000-4000-8000-000000000601',
            quoteVersionId: VERSION,
            versionNumber: 3,
            expiresAt: '2026-08-09T12:00:00.000Z',
          },
        }),
      })
      await Promise.resolve()
      await Promise.resolve()
      vi.runAllTicks()
      await Promise.resolve()
    })

    expect(fetchMock.mock.calls.filter(([url]) => url === `/api/tickets/${TICKET}/quote`)).toHaveLength(1)
    expect(screen.getByText('Approved · V3')).toBeInTheDocument()
  })

  it('keeps Copy available after a view while hiding it after a terminal decision', () => {
    render(<ManualQuoteBuilder ticket={ticket} builder={builder(true, { state: 'sent', quoteVersionId: null })} />)
    expect(screen.getByRole('button', { name: 'Copy customer link' })).toBeInTheDocument()
  })

  it('turns a successful Copy into an explicit fresh bearer replacement', async () => {
    const writeText = vi.fn(async (_value: string) => undefined)
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } })
    let randomFill = 6
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValueOnce(REQUEST).mockReturnValueOnce(NEXT_REQUEST),
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        bytes.fill(++randomFill)
        return bytes
      }),
      subtle: { digest: vi.fn()
        .mockResolvedValueOnce(new Uint8Array(32).fill(2).buffer)
        .mockResolvedValueOnce(new Uint8Array(32).fill(3).buffer) },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 201, json: async () => ({
        changed: true,
        link: { id: '00000000-0000-4000-8000-000000000601', quoteVersionId: VERSION, versionNumber: 3, expiresAt: '2026-08-09T12:00:00.000Z' },
      }) })
      .mockResolvedValueOnce({ status: 201, json: async () => ({
        changed: true,
        link: { id: '00000000-0000-4000-8000-000000000602', quoteVersionId: VERSION, versionNumber: 3, expiresAt: '2026-08-09T12:01:00.000Z' },
      }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy customer link' }))
    expect(await screen.findByRole('button', { name: 'Replace customer link' })).toBeInTheDocument()
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    const firstUrl = writeText.mock.calls[0]?.[0]

    fireEvent.click(screen.getByRole('button', { name: 'Replace customer link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    const replacementBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))
    const replacementUrl = writeText.mock.calls[1]?.[0]

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(firstBody).toEqual({ requestKey: REQUEST, quoteVersionId: VERSION, tokenHash: '02'.repeat(32) })
    expect(replacementBody).toEqual({ requestKey: NEXT_REQUEST, quoteVersionId: VERSION, tokenHash: '03'.repeat(32) })
    expect(replacementUrl).not.toBe(firstUrl)
    expect(screen.getByRole('button', { name: 'Replace customer link' })).toBeInTheDocument()
  })

  it.each([
    ['approved', VERSION],
    ['declined', null],
    ['deferred', null],
  ] as const)('hides Copy when the exact-version job is %s', (state, quoteVersionId) => {
    render(<ManualQuoteBuilder ticket={ticket} builder={builder(true, { state, quoteVersionId })} />)
    expect(screen.queryByRole('button', { name: 'Copy customer link' })).toBeNull()
  })

  it('retries a blocked clipboard without creating or expiring another link', async () => {
    const writeText = vi.fn(async (_value: string) => undefined)
      .mockRejectedValueOnce(new Error('clipboard blocked'))
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => REQUEST),
      getRandomValues: vi.fn((bytes: Uint8Array) => {
        bytes.fill(7)
        return bytes
      }),
      subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(2).buffer) },
    })
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      json: async () => ({
        changed: true,
        link: {
          id: '00000000-0000-4000-8000-000000000601',
          quoteVersionId: VERSION,
          versionNumber: 3,
          expiresAt: '2026-08-09T12:00:00.000Z',
        },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy customer link' }))
    expect(await screen.findByText('The link is ready, but the clipboard was interrupted. Try Copy again.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy customer link' }))

    expect(await screen.findByText('Link copied · V3')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map((call) => call[1]?.body)).toEqual([
      fetchMock.mock.calls[0]?.[1]?.body,
      fetchMock.mock.calls[0]?.[1]?.body,
    ])
  })

  it('keeps the exact draft through retryable link contention', async () => {
    const writeText = vi.fn(async (_value: string) => undefined)
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => REQUEST),
      getRandomValues: vi.fn((bytes: Uint8Array) => { bytes.fill(7); return bytes }),
      subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(2).buffer) },
    })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 409, json: async () => ({ error: 'conflict', retryable: true }) })
      .mockResolvedValueOnce({ status: 201, json: async () => ({
        changed: true,
        link: { id: '00000000-0000-4000-8000-000000000601', quoteVersionId: VERSION, versionNumber: 3, expiresAt: '2026-08-09T12:00:00.000Z' },
      }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy customer link' }))
    expect(await screen.findByText('The secure link is busy. Retry the same Copy action.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy customer link' }))

    expect(await screen.findByText('Link copied · V3')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(fetchMock.mock.calls[1]?.[1]?.body)
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it.each([404, 409])('revalidates a copied link, refreshes non-retryable %s drift, and clears the dead draft', async (status) => {
    const writeText = vi.fn(async (_value: string) => undefined)
    Object.defineProperty(window.navigator, 'clipboard', { configurable: true, value: { writeText } })
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn()
        .mockReturnValueOnce(REQUEST)
        .mockReturnValueOnce(NEXT_REQUEST)
        .mockReturnValueOnce(THIRD_REQUEST),
      getRandomValues: vi.fn((bytes: Uint8Array) => { bytes.fill(7); return bytes }),
      subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(2).buffer) },
    })
    const created = {
      changed: true,
      link: { id: '00000000-0000-4000-8000-000000000601', quoteVersionId: VERSION, versionNumber: 3, expiresAt: '2026-08-09T12:00:00.000Z' },
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ status: 201, json: async () => created })
      .mockResolvedValueOnce({ status, json: async () => ({ error: status === 404 ? 'not_found' : 'conflict' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ builder: builder() }) })
      .mockResolvedValueOnce({ status: 201, json: async () => created })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy customer link' }))
    expect(await screen.findByText('Link copied · V3')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Replace customer link' }))
    expect(await screen.findByText('The prepared quote was refreshed. Copy again for its current link.')).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    fireEvent.click(screen.getByRole('button', { name: 'Copy customer link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    const freshBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body))
    expect(freshBody.requestKey).toBe(THIRD_REQUEST)
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
    expect(css).toMatch(/\.decisionDialog textarea[\s\S]*?min-height:\s*96px/)
  })

  it('keeps a deferred job on the mounted quote so its decision can resume without a new page', async () => {
    const deferred = builder(true, { state: 'deferred', quoteVersionId: null })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({
        changed: true,
        event: { id: '00000000-0000-4000-8000-000000000501', kind: 'deferred', quoteVersionId: VERSION, jobId: JOB, approvedVia: null },
        projection: { approvalState: 'deferred', approvedQuoteVersionId: null },
      }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ builder: deferred }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Defer decision' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Defer customer decision?' })
    fireEvent.change(within(dialog).getByLabelText('What are we waiting for?'), {
      target: { value: 'Customer is reviewing the estimate with their spouse.' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Defer decision' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      requestKey: REQUEST,
      jobId: JOB,
      quoteVersionId: VERSION,
      decision: 'deferred',
      reason: 'Customer is reviewing the estimate with their spouse.',
    })
    expect(screen.getByText('Deferred · follow up · V3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Phone approval' })).toBeInTheDocument()
  })
})
