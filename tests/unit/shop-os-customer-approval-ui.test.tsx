import { createHash, webcrypto } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CustomerApproval } from '@/components/screens/customer-approval'
import {
  createCustomerApprovalSecret,
  parseCustomerApprovalReceipt,
  type CustomerApprovalQuote,
} from '@/lib/shop-os/customer-approval-ui'

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('next/navigation', () => ({ notFound: notFoundMock }))

import ApprovalPage from '@/app/approve/page'

const TOKEN = 'A'.repeat(43)
const JOB_ONE = '00000000-0000-4000-8000-000000000011'
const JOB_TWO = '00000000-0000-4000-8000-000000000012'

const quote: CustomerApprovalQuote = {
  shop: { name: 'Approval Auto', phone: '555-0100' },
  customer: { name: 'Casey Customer' },
  vehicle: { year: 2020, make: 'Ford', model: 'F-150' },
  ticketNumber: 42,
  versionNumber: 1,
  expiresAt: '2026-08-09T12:00:00.000Z',
  jobs: [
    {
      id: JOB_ONE,
      title: 'Front brake repair',
      story: null,
      lines: [{ kind: 'labor', description: 'Replace front brake pads', quantity: '1', priceCents: 10_000 }],
      subtotalCents: 10_000,
      taxableSubtotalCents: 0,
    },
    {
      id: JOB_TWO,
      title: 'Brake fluid service',
      story: null,
      lines: [{ kind: 'fee', description: 'Brake fluid', quantity: '1', priceCents: 5_000 }],
      subtotalCents: 5_000,
      taxableSubtotalCents: 0,
    },
  ],
  totals: { subtotalCents: 15_000, taxCents: 0, totalCents: 15_000 },
  taxRateBps: 0,
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('customer approval surface', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    notFoundMock.mockClear()
    window.history.replaceState(null, '', '/approve')
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('returns the public page as not found when the release flag is absent', () => {
    vi.stubEnv('SHOP_OS_CUSTOMER_APPROVAL_ENABLED', undefined)
    expect(() => ApprovalPage()).toThrow('NEXT_NOT_FOUND')
    expect(notFoundMock).toHaveBeenCalledTimes(1)
  })

  it('creates the exact hash the server will verify for the copied bearer value', async () => {
    vi.stubGlobal('crypto', webcrypto)
    const secret = await createCustomerApprovalSecret()
    expect(secret).not.toBeNull()
    expect(secret?.tokenHash).toBe(
      createHash('sha256').update(secret?.rawToken ?? '').digest('hex'),
    )
  })

  it('reads the fragment once, removes it from the address, and renders only customer-safe quote truth', async () => {
    window.location.hash = TOKEN
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ quote }))
    render(<CustomerApproval />)

    expect(await screen.findByRole('heading', { name: 'Review your repair order' })).toBeInTheDocument()
    expect(window.location.hash).toBe('')
    expect(fetchMock).toHaveBeenCalledWith('/api/public/quote-approval', {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${TOKEN}` },
    })
    expect(screen.getByText('2020 Ford F-150')).toBeInTheDocument()
    expect(screen.getByText('Front brake repair')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Decision for Front brake repair' })).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/cost|margin|technician|vendor/i)
  })

  it('scrubs the bearer and private quote before browser history can preserve the page', async () => {
    window.location.hash = TOKEN
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ quote }))
    render(<CustomerApproval />)

    expect(await screen.findByText('Casey Customer')).toBeInTheDocument()
    const pageHide = new Event('pagehide')
    Object.defineProperty(pageHide, 'persisted', { value: true })
    fireEvent(window, pageHide)

    expect(await screen.findByRole('heading', { name: 'This link is no longer available' })).toBeInTheDocument()
    expect(screen.queryByText('Casey Customer')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve Front brake repair' })).not.toBeInTheDocument()

    const pageShow = new Event('pageshow')
    Object.defineProperty(pageShow, 'persisted', { value: true })
    fireEvent(window, pageShow)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('formats sparse vehicle truth, part quantity, and the concise customer story without internal provenance', async () => {
    window.location.hash = TOKEN
    const customerQuote = structuredClone(quote) as CustomerApprovalQuote
    customerQuote.vehicle = { year: null, make: 'Ford', model: null }
    customerQuote.jobs[0]!.story = {
      whatYouToldUs: 'The brakes grind at low speed.',
      whatWeFound: 'The front pads are below service thickness.',
      howWeKnow: [{ claim: 'The pad gauge measured below the service limit.' }],
      whatItMeansIfWaived: 'Stopping distance can increase.',
      whatWeRecommend: 'Replace the front brake pads.',
    }
    customerQuote.jobs[0]!.lines = [{
      kind: 'part', description: 'Front brake pads', quantity: '2', priceCents: 10_000,
    }]
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ quote: customerQuote }))
    render(<CustomerApproval />)

    expect(await screen.findByText('Ford')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/\bnull\b/i)
    expect(screen.getByText(/Qty 2.*Front brake pads/)).toBeInTheDocument()
    for (const text of [
      'The brakes grind at low speed.',
      'The front pads are below service thickness.',
      'The pad gauge measured below the service limit.',
      'Stopping distance can increase.',
      'Replace the front brake pads.',
    ]) expect(screen.getByText(text)).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/sourceEventIds|sourceArtifactIds|sessionId/i)
  })

  it('accepts only an exact server receipt for the loaded version and submitted full job set', () => {
    const decisions = [
      { jobId: JOB_ONE, decision: 'approved' as const },
      { jobId: JOB_TWO, decision: 'declined' as const },
    ]
    const exact = {
      changed: false,
      receipt: { versionNumber: 1, decisions, approvedTotalCents: 10_000 },
    }
    expect(parseCustomerApprovalReceipt(200, exact, quote, decisions)).toEqual(exact.receipt)

    const malformed = [
      [201, exact],
      [200, { ...exact, changed: true }],
      [200, { ...exact, receipt: { ...exact.receipt, versionNumber: 2 } }],
      [200, { ...exact, receipt: { ...exact.receipt, approvedTotalCents: 9_999 } }],
      [200, { ...exact, receipt: { ...exact.receipt, decisions: [decisions[0]] } }],
      [200, { ...exact, receipt: { ...exact.receipt, decisions: [decisions[0], decisions[0]] } }],
      [200, { ...exact, receipt: { ...exact.receipt, decisions: [
        decisions[0], { jobId: JOB_TWO, decision: 'approved' },
      ] } }],
    ] as const
    for (const [status, payload] of malformed) {
      expect(parseCustomerApprovalReceipt(status, payload, quote, decisions)).toBeNull()
    }
  })

  it('keeps refusal beside the action, updates the exact selected total, and settles into a receipt', async () => {
    window.location.hash = TOKEN
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ quote }))
      .mockResolvedValueOnce(response({
        changed: true,
        receipt: {
          versionNumber: 1,
          decisions: [
            { jobId: JOB_ONE, decision: 'approved' },
            { jobId: JOB_TWO, decision: 'declined' },
          ],
          approvedTotalCents: 10_000,
        },
      }, 201))
    render(<CustomerApproval />)
    const first = await screen.findByRole('article', { name: 'Front brake repair' })
    fireEvent.click(within(first).getByRole('button', { name: 'Approve Front brake repair' }))
    expect(screen.getByText('$100.00 approved')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Send decisions' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Choose approve or decline for 1 remaining job.')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const second = screen.getByRole('article', { name: 'Brake fluid service' })
    fireEvent.click(within(second).getByRole('button', { name: 'Decline Brake fluid service' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send decisions' }))

    expect(await screen.findByRole('heading', { name: 'Your decisions are recorded' })).toBeInTheDocument()
    const receiptRegion = screen.getByRole('region', { name: 'Your decisions are recorded' })
    await waitFor(() => expect(receiptRegion).toHaveFocus())
    expect(screen.getByText(/RO 42 · V1/)).toBeInTheDocument()
    expect(screen.getByText('$100.00 approved')).toBeInTheDocument()
    const request = fetchMock.mock.calls[1]!
    expect(request[0]).toBe('/api/public/quote-approval')
    expect(request[1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    })
    const body = JSON.parse(String(request[1]?.body))
    expect(body.requestKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.decisions).toEqual([
      { jobId: JOB_ONE, decision: 'approved' },
      { jobId: JOB_TWO, decision: 'declined' },
    ])
    expect(JSON.stringify(body)).not.toContain(TOKEN)
  })

  it.each([
    ['network loss', 'network'],
    ['a malformed success', 'malformed'],
    ['rate limiting', '429'],
    ['temporary unavailability', '503'],
  ] as const)('locks the exact submission through %s and replays it to the unchanged receipt', async (_label, failure) => {
    window.location.hash = TOKEN
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response({ quote }))
    if (failure === 'network') fetchMock.mockRejectedValueOnce(new Error('offline'))
    else if (failure === 'malformed') fetchMock.mockResolvedValueOnce(response({ changed: true }, 201))
    else fetchMock.mockResolvedValueOnce(response({ error: 'temporarily_unavailable' }, Number(failure)))
    fetchMock.mockResolvedValueOnce(response({
      changed: false,
      receipt: {
        versionNumber: 1,
        decisions: [
          { jobId: JOB_ONE, decision: 'approved' },
          { jobId: JOB_TWO, decision: 'declined' },
        ],
        approvedTotalCents: 10_000,
      },
    }))
    render(<CustomerApproval />)

    const first = await screen.findByRole('article', { name: 'Front brake repair' })
    const second = screen.getByRole('article', { name: 'Brake fluid service' })
    fireEvent.click(within(first).getByRole('button', { name: 'Approve Front brake repair' }))
    fireEvent.click(within(second).getByRole('button', { name: 'Decline Brake fluid service' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send decisions' }))

    expect(await screen.findByRole('button', { name: 'Try sending again' })).toBeInTheDocument()
    expect(within(first).getByRole('button', { name: 'Approve Front brake repair' })).toBeDisabled()
    expect(within(first).getByRole('button', { name: 'Decline Front brake repair' })).toBeDisabled()
    expect(within(second).getByRole('button', { name: 'Approve Brake fluid service' })).toBeDisabled()
    expect(within(second).getByRole('button', { name: 'Decline Brake fluid service' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Try sending again' }))
    expect(await screen.findByRole('heading', { name: 'Your decisions are recorded' })).toBeInTheDocument()
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(fetchMock.mock.calls[2]?.[1]?.body)
  })

  it.each([400, 409, 415, 422])('moves a definite %s submission refusal to the safe unavailable state', async (status) => {
    window.location.hash = TOKEN
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ quote }))
      .mockResolvedValueOnce(response({ error: 'invalid_input' }, status))
    render(<CustomerApproval />)

    const first = await screen.findByRole('article', { name: 'Front brake repair' })
    const second = screen.getByRole('article', { name: 'Brake fluid service' })
    fireEvent.click(within(first).getByRole('button', { name: 'Approve Front brake repair' }))
    fireEvent.click(within(second).getByRole('button', { name: 'Decline Brake fluid service' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send decisions' }))

    expect(await screen.findByRole('heading', { name: 'This link is no longer available' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('gives one safe recovery state for missing or unusable links', async () => {
    render(<CustomerApproval />)
    expect(await screen.findByRole('heading', { name: 'This link is no longer available' })).toBeInTheDocument()
    expect(screen.getByText('Contact the shop for the current repair order.')).toBeInTheDocument()

    window.location.hash = TOKEN
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ error: 'unavailable' }, 404))
    render(<CustomerApproval />)
    await waitFor(() => expect(screen.getAllByRole('heading', { name: 'This link is no longer available' })).toHaveLength(2))
  })

  it('offers one retry when the secure service is briefly busy without discarding the link', async () => {
    window.location.hash = TOKEN
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ error: 'unavailable', retryable: true }, 503))
      .mockResolvedValueOnce(response({ quote }))
    render(<CustomerApproval />)

    expect(await screen.findByRole('heading', { name: 'The connection paused' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: 'Review your repair order' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { authorization: `Bearer ${TOKEN}` },
    })
  })

  it('pins the restrained precision-instrument visual contract', () => {
    const css = readFileSync(join(process.cwd(), 'components/screens/customer-approval.module.css'), 'utf8')
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/)
    const transitions = [...css.matchAll(/transition:\s*([^;]+)/g)]
      .flatMap((match) => match[1]!.split(','))
      .map((item) => item.trim().split(/\s+/)[0])
      .filter((property) => property !== 'none')
    expect(transitions.length).toBeGreaterThan(0)
    expect(new Set(transitions)).toEqual(new Set(['transform', 'opacity']))
    expect(css).toMatch(/\.job\[data-choice='approved'\][\s\S]*?#c78035/)
    expect(css).toMatch(/\.receiptTotal[\s\S]*?#31533e/)
    expect(css).toMatch(/min-height:\s*48px/)
    expect(css).not.toMatch(/linear-gradient|radial-gradient|sparkle|confetti/i)
  })
})
