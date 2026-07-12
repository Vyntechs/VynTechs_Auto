import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManualQuoteBuilder } from '@/components/screens/manual-quote-builder'
import type { SafeCannedJobTemplate } from '@/lib/shop-os/canned-jobs-ui'
import type { SafeManualVendorAccount } from '@/lib/shop-os/parts-sourcing-ui'
import { parseQuoteBuilderProjection } from '@/lib/shop-os/quote-builder-ui'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'
import type { TicketDetail } from '@/lib/tickets'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}))

const router = { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }
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
const CANNED_ID = '00000000-0000-4000-8000-000000000501'
const CANNED_JOB_ID = '00000000-0000-4000-8000-000000000502'
const CANNED_PART_LINE_ID = '00000000-0000-4000-8000-000000000503'
const CANNED_LABOR_LINE_ID = '00000000-0000-4000-8000-000000000504'
const SOURCED_LINE_ID = '00000000-0000-4000-8000-000000000601'
const ACCOUNT_ID = '00000000-0000-4000-8000-000000000701'
const SECOND_JOB_ID = '00000000-0000-4000-8000-000000000202'

const vendorAccount: SafeManualVendorAccount = {
  id: ACCOUNT_ID,
  displayName: 'Metro Parts',
  mode: 'manual',
  enabled: true,
  updatedAt: '2026-07-12T05:00:00.000Z',
}

const cannedJob = {
  id: CANNED_ID,
  title: 'Oil service',
  kind: 'maintenance',
  defaultRequiredSkillTier: 1,
  sort: 10,
  lines: [
    { kind: 'part', description: 'Oil filter', sort: 10, quantity: '1', priceCents: 1_250, taxable: true },
    { kind: 'labor', description: 'Oil service labor', sort: 20, hours: '0.5', priceCents: 5_000, taxable: false, laborRateCents: 10_000 },
    { kind: 'fee', description: 'Disposal', sort: 30, priceCents: 500, taxable: true },
  ],
  fingerprint: 'a'.repeat(64),
  summary: { subtotalCents: 6_750, taxableSubtotalCents: 1_750, taxCents: 144, totalCents: 6_894 },
} satisfies SafeCannedJobTemplate

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
    source: 'manual', mutable: true,
    ...overrides,
  }
}

const jobFacts = {
  story: { content: null, source: null, reviewStatus: null, revision: 0 },
  storyMode: null,
  decisionEligible: false,
  approval: { state: 'pending_quote', quoteVersionId: null },
} as const

const activeVersion = (versionNumber = 3) => ({
  id: VERSION_ID,
  versionNumber,
  totalCents: 32_281,
  jobs: [{ jobId: JOB_ID, subtotalCents: 31_250 }],
})

function builder(overrides: Partial<Builder> = {}): Builder {
  return {
    ticket: { id: TICKET_ID, status: 'open', reconciled: true },
    configuration: {
      laborRateCents: 15_000, taxRateBps: 825,
      laborRateConfigured: true, taxRateConfigured: true,
    },
    jobs: [{
      id: JOB_ID, title: 'Replace front brakes', kind: 'repair', workStatus: 'open',
      ...jobFacts,
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
    capabilities: { canRecordCustomerApproval: true },
    activeVersion: activeVersion(),
    ...overrides,
  }
}

function builderWithAppliedCannedJob(overrides: Partial<Builder> = {}): Builder {
  return builder({
    activeVersion: null,
    jobs: [
      ...builder().jobs,
      {
        id: CANNED_JOB_ID, title: 'Oil service', kind: 'maintenance', workStatus: 'open',
        ...jobFacts,
        lines: [
          line({ id: CANNED_PART_LINE_ID, description: 'Oil filter', priceCents: 1_250,
            partNumber: null, brand: null, coreChargeCents: null, fitment: null }),
          line({ id: CANNED_LABOR_LINE_ID, kind: 'labor', description: 'Oil service labor', priceCents: 5_000,
            partNumber: null, brand: null, coreChargeCents: null, fitment: null,
            laborHours: '0.5', laborRateCents: 10_000, taxable: false }),
          line({ id: NEW_LINE_ID, kind: 'fee', description: 'Disposal', priceCents: 500,
            partNumber: null, brand: null, coreChargeCents: null, fitment: null,
            laborHours: null, laborRateCents: null }),
        ],
      },
    ],
    ...overrides,
  })
}

function reviewedDiagnosis(recommendation: string): Builder['jobs'][number] {
  return {
    id: '00000000-0000-4000-8000-000000000203',
    title: 'Brake diagnosis',
    kind: 'diagnostic',
    workStatus: 'open',
    story: {
      content: {
        whatYouToldUs: 'The brakes vibrate.',
        whatWeFound: 'The front pads are worn.',
        howWeKnow: [],
        whatItMeansIfWaived: 'Stopping distance may increase.',
        whatWeRecommend: recommendation,
      },
      source: 'ai', reviewStatus: 'reviewed', revision: 1,
    },
    storyMode: 'ordinary_locked_tree',
    decisionEligible: false,
    approval: { state: 'pending_quote', quoteVersionId: null },
    lines: [],
  }
}

function capturedOfferResponse(lineId = SOURCED_LINE_ID) {
  return {
    changed: true,
    line: {
      id: lineId, jobId: JOB_ID, kind: 'part', description: 'Sourced pad set',
      quantity: '1', priceCents: 14_000, taxable: true,
      partNumber: null, brand: null, fitment: null,
      source: 'vendor_offer', mutable: false,
    },
    sourcing: {
      vendorAccountId: ACCOUNT_ID, displayName: 'Metro Parts', externalOfferId: null,
      unitCostCents: 8_000, coreChargeCents: 0, availability: 'unknown',
      fulfillment: { method: 'unknown', locationLabel: null },
      fetchedAt: '2026-07-12T05:01:00.000Z',
    },
  }
}

describe('ManualQuoteBuilder', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    router.push.mockReset()
    router.replace.mockReset()
    router.refresh.mockReset()
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
    expect(within(tape).getByText('$322.81')).toBeInTheDocument()
    expect(within(tape).getByText('Job subtotal before tax')).toBeInTheDocument()
    expect(within(tape).getByText('Ticket total')).toBeInTheDocument()
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
        ...jobFacts,
        lines: [line({
          kind: 'labor', description: 'Inspection labor', priceCents: 9_000,
          partNumber: null, brand: null, coreChargeCents: null, fitment: null,
          laborHours: '1', laborRateCents: null,
        })],
      }],
      activeVersion: null,
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
      activeVersion: null,
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
        ...jobFacts,
        lines: [
          line({ id: LINE_ID, priceCents: Number.MAX_SAFE_INTEGER }),
          line({ id: LABOR_LINE_ID, priceCents: 1 }),
        ],
      }],
      activeVersion: null,
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
      jobs: [{ id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open', ...jobFacts, lines: [] }],
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
    expect(css).toMatch(/@media\s*\(min-width:\s*801px\)\s*and\s*\(max-width:\s*1290px\)[\s\S]*\.screenWithSourcing\s+\.workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    expect(css).toMatch(/@media\s*\(min-width:\s*801px\)\s*and\s*\(max-width:\s*1290px\)[\s\S]*\.screenWithSourcing\s+\.tape\s*\{[^}]*position:\s*static/)
    expect(css).toMatch(/\.jobHeader\s*>\s*div\s*\{[^}]*min-width:\s*0/)
    expect(css).toMatch(/\.jobHeader h3\s*\{[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/)
    expect(css).toMatch(/\.identity span\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/)
    expect(css).toMatch(/\.line:focus,[\s\S]*\.preparedState:focus\s*\{[^}]*outline:/)
    expect(css).toMatch(/@media\s*\(max-width:\s*800px\)[\s\S]*\.prepareAction\s*\{[^}]*position:\s*fixed[^}]*env\(safe-area-inset-bottom\)/)
    expect(css).toMatch(/@media\s*\(max-width:\s*800px\)[\s\S]*\.workspace:has\(\.editor:focus-within\)\s+\.prepareAction\s*\{[^}]*position:\s*static/)
    expect(css).toMatch(/@media\s*\(max-width:\s*600px\)[\s\S]*\.error\s*\{[^}]*position:\s*static/)
    expect(css).toMatch(/\.cannedPicker select\s*\{[^}]*min-height:\s*44px/)
    expect(css).toMatch(/\.cannedApply\s*\{[^}]*min-height:\s*44px/)
    expect(css).toMatch(/\.job:focus\s*\{[^}]*outline:/)

    const ledger = screen.getByRole('region', { name: 'Quote ledger' })
    const tape = screen.getByRole('complementary', { name: 'Quote totals' })
    expect(ledger.compareDocumentPosition(tape) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe('ManualQuoteBuilder canned application', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    router.push.mockReset()
    router.replace.mockReset()
    router.refresh.mockReset()
  })

  it('previews exact selected lines and totals before an explicit add', () => {
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} cannedJobs={[cannedJob]} />)
    fireEvent.change(screen.getByLabelText('Canned job'), { target: { value: CANNED_ID } })
    expect(screen.getByText('Maintenance · Tier 1')).toBeInTheDocument()
    expect(screen.getByText('Part · Qty 1 · Oil filter')).toBeInTheDocument()
    expect(screen.getByText('Labor · 0.5 hr · Oil service labor')).toBeInTheDocument()
    expect(screen.getByText('Fee · Disposal')).toBeInTheDocument()
    expect(screen.getByText('$67.50')).toBeInTheDocument()
    expect(screen.getByText('$1.44')).toBeInTheDocument()
    expect(screen.getByText('$68.94')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add canned job' })).toBeEnabled()
    expect(document.body.textContent).not.toMatch(/unit cost|vendor|approve|authorize|start work/i)
  })

  it('applies the exact selection, validates refreshed truth, and focuses the new job', async () => {
    const nextBuilder = builderWithAppliedCannedJob()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, {
        changed: true,
        job: { id: CANNED_JOB_ID, title: 'Oil service', kind: 'maintenance', requiredSkillTier: 1, lineCount: 3 },
      }))
      .mockResolvedValueOnce(response(200, { builder: nextBuilder }))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} cannedJobs={[cannedJob]} />)
    fireEvent.change(screen.getByLabelText('Canned job'), { target: { value: CANNED_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'Add canned job' }))
    await screen.findByRole('heading', { name: 'Oil service' })
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    expect(requestBody).toMatchObject({
      cannedJobId: CANNED_ID,
      expectedFingerprint: cannedJob.fingerprint,
      expectedTaxRateBps: 825,
    })
    expect(requestBody.clientKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/tickets/${TICKET_ID}/quote`)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Oil service' }).closest('li'))
    expect(screen.getByLabelText('Canned job')).toHaveValue('')
  })

  it('rejects an apply response that does not exactly match the selected template', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(201, {
      changed: true,
      job: { id: CANNED_JOB_ID, title: 'Different work', kind: 'maintenance', requiredSkillTier: 1, lineCount: 3 },
    }))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} cannedJobs={[cannedJob]} />)
    fireEvent.change(screen.getByLabelText('Canned job'), { target: { value: CANNED_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'Add canned job' }))
    expect(await screen.findByText('Review the visible fields, then refresh and retry.')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Canned job')).toHaveValue(CANNED_ID)
  })

  it('rejects refreshed truth without the returned job and preserves the retry key', async () => {
    const applied = {
      changed: true,
      job: { id: CANNED_JOB_ID, title: 'Oil service', kind: 'maintenance', requiredSkillTier: 1, lineCount: 3 },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, applied))
      .mockResolvedValueOnce(response(200, { builder: builder({ activeVersion: null }) }))
      .mockResolvedValueOnce(response(201, applied))
      .mockResolvedValueOnce(response(200, { builder: builderWithAppliedCannedJob() }))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} cannedJobs={[cannedJob]} />)
    fireEvent.change(screen.getByLabelText('Canned job'), { target: { value: CANNED_ID } })
    const add = screen.getByRole('button', { name: 'Add canned job' })
    fireEvent.click(add)
    expect(await screen.findByText('Review the visible fields, then refresh and retry.')).toBeInTheDocument()
    expect(screen.getByLabelText('Canned job')).toHaveValue(CANNED_ID)
    fireEvent.click(add)
    await screen.findByRole('heading', { name: 'Oil service' })
    const first = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    const second = JSON.parse(fetchMock.mock.calls[2][1]!.body as string)
    expect(second.clientKey).toBe(first.clientKey)
  })

  it('rejects refreshed truth while a prepared version remains active', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, {
        changed: true,
        job: { id: CANNED_JOB_ID, title: 'Oil service', kind: 'maintenance', requiredSkillTier: 1, lineCount: 3 },
      }))
      .mockResolvedValueOnce(response(200, {
        builder: builderWithAppliedCannedJob({ activeVersion: activeVersion() }),
      }))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} cannedJobs={[cannedJob]} />)
    fireEvent.change(screen.getByLabelText('Canned job'), { target: { value: CANNED_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'Add canned job' }))
    expect(await screen.findByText('Review the visible fields, then refresh and retry.')).toBeInTheDocument()
    expect(screen.getByLabelText('Canned job')).toHaveValue(CANNED_ID)
  })

  it('keeps one apply key across an ambiguous retry and refreshes a stale catalog explicitly', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response(409, { error: 'conflict', retryable: false }))
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} cannedJobs={[cannedJob]} />)
    fireEvent.change(screen.getByLabelText('Canned job'), { target: { value: CANNED_ID } })
    const add = screen.getByRole('button', { name: 'Add canned job' })
    fireEvent.click(add)
    await screen.findByText('Connection interrupted. Retry with the same details.')
    fireEvent.click(add)
    await screen.findByText('Quote or canned-job context changed. Refresh canned jobs and choose again.')
    const first = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    const second = JSON.parse(fetchMock.mock.calls[1][1]!.body as string)
    expect(second.clientKey).toBe(first.clientKey)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh canned jobs' }))
    expect(router.refresh).toHaveBeenCalledTimes(1)
  })

  it('reconciles a stale catalog refresh, resets changed selection, and restores focus', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(409, { error: 'conflict', retryable: false }))
      .mockRejectedValueOnce(new Error('offline'))
    const view = render(<ManualQuoteBuilder ticket={ticket} builder={builder()} cannedJobs={[cannedJob]} />)
    fireEvent.change(screen.getByLabelText('Canned job'), { target: { value: CANNED_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'Add canned job' }))
    await screen.findByText('Quote or canned-job context changed. Refresh canned jobs and choose again.')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh canned jobs' }))
    view.rerender(<ManualQuoteBuilder
      ticket={ticket}
      builder={builder({ configuration: { ...builder().configuration, taxRateBps: 900 } })}
      cannedJobs={[cannedJob]}
    />)
    await waitFor(() => expect(screen.getByLabelText('Canned job')).toHaveFocus())
    expect(screen.getByLabelText('Canned job')).toHaveValue('')
    expect(screen.queryByText('Quote or canned-job context changed. Refresh canned jobs and choose again.')).toBeNull()
    fireEvent.change(screen.getByLabelText('Canned job'), { target: { value: CANNED_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'Add canned job' }))
    await screen.findByText('Connection interrupted. Retry with the same details.')
    const beforeRefresh = JSON.parse(fetchMock.mock.calls[0][1]!.body as string)
    const afterRefresh = JSON.parse(fetchMock.mock.calls[1][1]!.body as string)
    expect(afterRefresh.clientKey).not.toBe(beforeRefresh.clientKey)
    expect(afterRefresh.expectedTaxRateBps).toBe(900)
  })

  it('fails closed when the catalog cannot be trusted or apply success is malformed', async () => {
    const { rerender } = render(
      <ManualQuoteBuilder ticket={ticket} builder={builder()} cannedCatalogAvailable={false} />,
    )
    expect(screen.getByText('Canned jobs unavailable')).toBeInTheDocument()
    expect(screen.queryByLabelText('Canned job')).toBeNull()
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(201, {
      changed: true,
      job: { id: CANNED_JOB_ID, title: 'Oil service', kind: 'maintenance', requiredSkillTier: 1, lineCount: 3, extra: true },
    }))
    rerender(<ManualQuoteBuilder ticket={ticket} builder={builder()} cannedJobs={[cannedJob]} />)
    fireEvent.change(screen.getByLabelText('Canned job'), { target: { value: CANNED_ID } })
    fireEvent.click(screen.getByRole('button', { name: 'Add canned job' }))
    expect(await screen.findByText('Review the visible fields, then refresh and retry.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Oil service' })).toBeNull()
  })
})

describe('ManualQuoteBuilder sourcing integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => SOURCED_LINE_ID) })
    router.push.mockReset()
    router.replace.mockReset()
  })

  it('offers one sourcing surface only for open or blocked repair and maintenance jobs', () => {
    const jobs: Builder['jobs'] = [
      { ...builder().jobs[0], id: JOB_ID, title: 'Open repair', kind: 'repair', workStatus: 'open', lines: [] },
      { ...builder().jobs[0], id: SECOND_JOB_ID, title: 'Blocked maintenance', kind: 'maintenance', workStatus: 'blocked', lines: [] },
      { ...builder().jobs[0], id: '00000000-0000-4000-8000-000000000204', title: 'Active repair', kind: 'repair', workStatus: 'in_progress', lines: [] },
      { ...reviewedDiagnosis('Replace the pad set.'), id: '00000000-0000-4000-8000-000000000205' },
    ]
    render(<ManualQuoteBuilder ticket={ticket} builder={builder({ jobs, activeVersion: null })} />)

    expect(screen.getAllByRole('button', { name: 'Source part' })).toHaveLength(2)
    fireEvent.click(screen.getAllByRole('button', { name: 'Source part' })[0])
    expect(screen.getByRole('dialog', { name: 'Source part for Open repair' })).toBeInTheDocument()
    expect(screen.getAllByRole('dialog', { name: /Source part for/ })).toHaveLength(1)
    expect(screen.getByTestId('quote-background')).toHaveAttribute('inert')
    const otherSource = screen.getAllByRole('button', { name: 'Source part' })[1]
    expect(otherSource).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Part description'), { target: { value: 'Dirty sourced draft' } })
    fireEvent.click(otherSource)
    expect(screen.getByRole('dialog', { name: 'Source part for Open repair' })).toBeInTheDocument()
    expect(screen.getByLabelText('Part description')).toHaveValue('Dirty sourced draft')
  })

  it('passes safe quote context, supplier permission, and only one unambiguous diagnosis seed', () => {
    const state = builder({
      jobs: [builder().jobs[0], reviewedDiagnosis('Use ceramic front pads.')],
      activeVersion: null,
    })
    const { unmount } = render(<ManualQuoteBuilder
      ticket={ticket}
      builder={state}
      vendorAccounts={[vendorAccount]}
      vendorCatalogAvailable
      canCreateVendorAccount={false}
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Source part' }))

    expect(screen.getByText('2019 Ford F-150 · Repair order 000042')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Metro Parts' })).toBeChecked()
    expect(screen.getByText('Use ceramic front pads.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close part sourcing' }))

    unmount()
    const secondDiagnosis = {
      ...reviewedDiagnosis('A second recommendation.'),
      id: '00000000-0000-4000-8000-000000000206',
    }
    render(<ManualQuoteBuilder
      ticket={ticket}
      builder={{ ...state, jobs: [...state.jobs, secondDiagnosis] }}
      vendorAccounts={[]}
      vendorCatalogAvailable
      canCreateVendorAccount
    />)
    fireEvent.click(screen.getByRole('button', { name: 'Source part' }))
    expect(screen.getByRole('button', { name: 'Add supplier' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Starting point from locked diagnosis')).toBeNull()
  })

  it('refreshes strict server truth after capture, updates totals, closes, and focuses the sourced line', async () => {
    const initial = builder({ jobs: [{ ...builder().jobs[0], lines: [] }], activeVersion: null })
    const sourced = line({
      id: SOURCED_LINE_ID, description: 'Sourced pad set', priceCents: 14_000,
      source: 'vendor_offer', mutable: false, coreChargeCents: null,
      partNumber: null, brand: null, fitment: null,
    })
    const refreshed = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    let resolveCapture!: (result: Response) => void
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => new Promise((resolve) => { resolveCapture = resolve }))
      .mockResolvedValueOnce(response(200, { builder: refreshed }))
    render(<ManualQuoteBuilder
      ticket={ticket} builder={initial} vendorAccounts={[vendorAccount]}
      vendorCatalogAvailable canCreateVendorAccount={false}
    />)

    fireEvent.click(screen.getByRole('button', { name: 'Source part' }))
    fireEvent.change(screen.getByLabelText('Part description'), { target: { value: 'Sourced pad set' } })
    fireEvent.change(screen.getByLabelText('Supplier unit cost'), { target: { value: '80.00' } })
    fireEvent.change(screen.getByLabelText('Customer line price'), { target: { value: '140.00' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 Sourced pad set · Customer price $140.00' }))

    expect(await screen.findByRole('button', { name: 'Adding sourced part…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add part' })).toBeDisabled()
    resolveCapture(response(201, capturedOfferResponse()))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Source part for/ })).toBeNull())
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/tickets/${TICKET_ID}/quote`, expect.objectContaining({ method: 'GET' }))
    expect(within(screen.getByRole('complementary', { name: 'Quote totals' })).getAllByText('$140.00')).toHaveLength(2)
    expect(document.activeElement).toHaveTextContent('Sourced pad set')
  })

  it.each([
    ['description', { description: 'Different pad set' }],
    ['quantity', { quantity: '2' }],
    ['priceCents', { priceCents: 14_001 }],
    ['taxable', { taxable: false }],
    ['partNumber', { partNumber: 'PAD-OTHER' }],
    ['brand', { brand: 'Other brand' }],
    ['fitment', { fitment: 'Rear axle' }],
  ] satisfies Array<[string, Partial<BuilderLine>]>)('rejects a same-id sourced refresh with mismatched %s', async (_field, mismatch) => {
    const initial = builder({ jobs: [{ ...builder().jobs[0], lines: [] }], activeVersion: null })
    const mismatched = line({
      id: SOURCED_LINE_ID, description: 'Sourced pad set', priceCents: 14_000,
      source: 'vendor_offer', mutable: false, coreChargeCents: null,
      partNumber: null, brand: null, fitment: null,
      ...mismatch,
    })
    const refreshed = builder({ jobs: [{ ...builder().jobs[0], lines: [mismatched] }], activeVersion: null })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, capturedOfferResponse()))
      .mockResolvedValueOnce(response(200, { builder: refreshed }))
    render(<ManualQuoteBuilder ticket={ticket} builder={initial} vendorAccounts={[vendorAccount]} vendorCatalogAvailable />)

    fireEvent.click(screen.getByRole('button', { name: 'Source part' }))
    fireEvent.change(screen.getByLabelText('Part description'), { target: { value: 'Sourced pad set' } })
    fireEvent.change(screen.getByLabelText('Supplier unit cost'), { target: { value: '80' } })
    fireEvent.change(screen.getByLabelText('Customer line price'), { target: { value: '140' } })
    fireEvent.click(screen.getByRole('button', { name: /Add 1 Sourced pad set/ }))

    expect(await screen.findByText('Part saved. Refresh the quote to see current totals.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: /Source part for/ })).toBeInTheDocument()
  })

  it('keeps saved state after a hostile refresh and retries GET without reposting capture', async () => {
    const initial = builder({ jobs: [{ ...builder().jobs[0], lines: [] }], activeVersion: null })
    const sourced = line({
      id: SOURCED_LINE_ID, description: 'Sourced pad set', priceCents: 14_000,
      source: 'vendor_offer', mutable: false, coreChargeCents: null,
      partNumber: null, brand: null, fitment: null,
    })
    const refreshed = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, capturedOfferResponse()))
      .mockResolvedValueOnce(response(200, { builder: { hostile: true } }))
      .mockResolvedValueOnce(response(200, { builder: refreshed }))
    render(<ManualQuoteBuilder ticket={ticket} builder={initial} vendorAccounts={[vendorAccount]} vendorCatalogAvailable />)

    fireEvent.click(screen.getByRole('button', { name: 'Source part' }))
    fireEvent.change(screen.getByLabelText('Part description'), { target: { value: 'Sourced pad set' } })
    fireEvent.change(screen.getByLabelText('Supplier unit cost'), { target: { value: '80' } })
    fireEvent.change(screen.getByLabelText('Customer line price'), { target: { value: '140' } })
    fireEvent.click(screen.getByRole('button', { name: /Add 1 Sourced pad set/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('Part saved. Refresh the quote to see current totals.')
    expect(within(screen.getByRole('complementary', { name: 'Quote totals' })).queryByText('$140.00')).toBeNull()
    fireEvent.click(within(screen.getByRole('dialog', { name: /Source part for/ })).getByRole('button', { name: 'Refresh quote' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Source part for/ })).toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
  })

  it('recovers retryable capture conflict through the parent GET-only quote refresh', async () => {
    const initial = builder({ jobs: [{ ...builder().jobs[0], lines: [] }], activeVersion: null })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(409, { error: 'conflict', retryable: true }))
      .mockResolvedValueOnce(response(200, { builder: initial }))
    render(<ManualQuoteBuilder ticket={ticket} builder={initial} vendorAccounts={[vendorAccount]} vendorCatalogAvailable />)

    fireEvent.click(screen.getByRole('button', { name: 'Source part' }))
    fireEvent.change(screen.getByLabelText('Part description'), { target: { value: 'Sourced pad set' } })
    fireEvent.change(screen.getByLabelText('Supplier unit cost'), { target: { value: '80' } })
    fireEvent.change(screen.getByLabelText('Customer line price'), { target: { value: '140' } })
    fireEvent.click(screen.getByRole('button', { name: /Add 1 Sourced pad set/ }))

    expect(await screen.findByText('This quote changed elsewhere. Refresh and retry.')).toBeInTheDocument()
    fireEvent.click(within(screen.getByRole('dialog', { name: /Source part for/ })).getByRole('button', { name: 'Refresh quote' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET'])
    expect(screen.getByRole('dialog', { name: /Source part for/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Part description')).toHaveValue('Sourced pad set')
    expect(screen.getByRole('button', { name: /Add 1 Sourced pad set/ })).toBeEnabled()
  })

  it('rejects capture refresh truth while a stale active quote version exists', async () => {
    const initial = builder({ jobs: [{ ...builder().jobs[0], lines: [] }], activeVersion: null })
    const sourced = line({ id: SOURCED_LINE_ID, description: 'Sourced pad set', priceCents: 14_000, source: 'vendor_offer', mutable: false, coreChargeCents: null })
    const staleVersion = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: activeVersion() })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, capturedOfferResponse()))
      .mockResolvedValueOnce(response(200, { builder: staleVersion }))
    render(<ManualQuoteBuilder ticket={ticket} builder={initial} vendorAccounts={[vendorAccount]} vendorCatalogAvailable />)

    fireEvent.click(screen.getByRole('button', { name: 'Source part' }))
    fireEvent.change(screen.getByLabelText('Part description'), { target: { value: 'Sourced pad set' } })
    fireEvent.change(screen.getByLabelText('Supplier unit cost'), { target: { value: '80' } })
    fireEvent.change(screen.getByLabelText('Customer line price'), { target: { value: '140' } })
    fireEvent.click(screen.getByRole('button', { name: /Add 1 Sourced pad set/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('Part saved. Refresh the quote to see current totals.')
    expect(screen.getByRole('dialog', { name: /Source part for/ })).toBeInTheDocument()
    expect(within(screen.getByRole('complementary', { name: 'Quote totals' })).queryByText('$140.00')).toBeNull()
  })

  it('rejects same-ticket stale capture truth until the selected job contains the immutable sourced part', async () => {
    const initial = builder({ jobs: [{ ...builder().jobs[0], lines: [] }], activeVersion: null })
    const stale = builder({ jobs: [{ ...builder().jobs[0], lines: [] }], activeVersion: null })
    const mutableManual = builder({ jobs: [{
      ...builder().jobs[0],
      lines: [line({ id: SOURCED_LINE_ID, description: 'Stale manual part' })],
    }], activeVersion: null })
    const sourced = line({
      id: SOURCED_LINE_ID, description: 'Sourced pad set', priceCents: 14_000,
      source: 'vendor_offer', mutable: false, coreChargeCents: null,
      partNumber: null, brand: null, fitment: null,
    })
    const refreshed = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, capturedOfferResponse()))
      .mockResolvedValueOnce(response(200, { builder: stale }))
      .mockResolvedValueOnce(response(200, { builder: mutableManual }))
      .mockResolvedValueOnce(response(200, { builder: refreshed }))
    render(<ManualQuoteBuilder ticket={ticket} builder={initial} vendorAccounts={[vendorAccount]} vendorCatalogAvailable />)

    fireEvent.click(screen.getByRole('button', { name: 'Source part' }))
    fireEvent.change(screen.getByLabelText('Part description'), { target: { value: 'Sourced pad set' } })
    fireEvent.change(screen.getByLabelText('Supplier unit cost'), { target: { value: '80' } })
    fireEvent.change(screen.getByLabelText('Customer line price'), { target: { value: '140' } })
    fireEvent.click(screen.getByRole('button', { name: /Add 1 Sourced pad set/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('Part saved. Refresh the quote to see current totals.')
    expect(screen.getByRole('dialog', { name: /Source part for/ })).toBeInTheDocument()
    expect(within(screen.getByRole('complementary', { name: 'Quote totals' })).queryByText('$140.00')).toBeNull()
    fireEvent.click(within(screen.getByRole('dialog', { name: /Source part for/ })).getByRole('button', { name: 'Refresh quote' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(screen.getByRole('dialog', { name: /Source part for/ })).toBeInTheDocument()
    expect(screen.queryByText('Stale manual part')).toBeNull()
    fireEvent.click(within(screen.getByRole('dialog', { name: /Source part for/ })).getByRole('button', { name: 'Refresh quote' }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Source part for/ })).toBeNull())
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'GET', 'GET', 'GET'])
    expect(document.activeElement).toHaveTextContent('Sourced pad set')
  })

  it('removes sourced rows only through the dedicated contract and returns focus to Source part', async () => {
    const sourced = line({ id: SOURCED_LINE_ID, description: 'Sourced pad set', source: 'vendor_offer', mutable: false, coreChargeCents: null })
    const initial = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    const refreshed = builder({ jobs: [{ ...builder().jobs[0], lines: [] }], activeVersion: null })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(200, { changed: true }))
      .mockResolvedValueOnce(response(200, { builder: refreshed }))
    render(<ManualQuoteBuilder ticket={ticket} builder={initial} />)

    expect(screen.getByText('Sourced · read-only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Sourced pad set' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove Sourced pad set' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Remove sourced part: Sourced pad set' }))
    const removalDialog = screen.getByRole('alertdialog', { name: 'Remove sourced part?' })
    const removalTarget = within(removalDialog).getByText('Sourced pad set')
    expect(removalDialog).toHaveAttribute('aria-describedby', removalTarget.id)
    expect(screen.getByRole('button', { name: 'Keep sourced part' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))

    await screen.findByText('No quote lines yet.')
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/tickets/${TICKET_ID}/quote/jobs/${JOB_ID}/parts/manual-offers/${SOURCED_LINE_ID}`)
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'DELETE' })
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/tickets/${TICKET_ID}/quote`)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Source part' }))
  })

  it('fails sourced removal closed, restores focus, preserves the row, and leaks no sourcing fields', async () => {
    const sourced = line({ id: SOURCED_LINE_ID, description: 'Sourced pad set', source: 'vendor_offer', mutable: false, coreChargeCents: null })
    const state = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    Object.assign(state.jobs[0].lines[0], { unitCostCents: 8_000, vendorAccountId: ACCOUNT_ID, vendorSnapshot: 'SECRET_SNAPSHOT' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response(200, { changed: true, secret: 'NO' }))
    render(<ManualQuoteBuilder ticket={ticket} builder={state} />)
    const remove = screen.getByRole('button', { name: 'Remove sourced part: Sourced pad set' })
    fireEvent.click(remove)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))

    expect(await screen.findByText('Review the visible fields, then refresh and retry.')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByText('Sourced pad set')).toBeInTheDocument()
    await waitFor(() => expect(document.activeElement).toBe(remove))
    expect(document.body.textContent).not.toMatch(/SECRET_SNAPSHOT|Metro Parts|unit cost|vendor account|NO/)
  })

  it.each([
    ['same-ticket stale truth', response(200, { builder: builder({
      jobs: [{ ...builder().jobs[0], lines: [line({
        id: SOURCED_LINE_ID, description: 'Sourced pad set', source: 'vendor_offer',
        mutable: false, coreChargeCents: null,
      })] }],
      activeVersion: null,
    }) })],
    ['malformed truth', response(200, { builder: { hostile: true } })],
    ['failed GET', response(503, { error: 'unavailable' })],
  ])('rejects %s after sourced deletion and restores the exact remove invoker', async (_label, refreshResponse) => {
    const sourced = line({
      id: SOURCED_LINE_ID, description: 'Sourced pad set', priceCents: 14_000,
      source: 'vendor_offer', mutable: false, coreChargeCents: null,
    })
    const initial = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(200, { changed: true }))
      .mockResolvedValueOnce(refreshResponse)
    render(<ManualQuoteBuilder ticket={ticket} builder={initial} />)
    const remove = screen.getByRole('button', { name: 'Remove sourced part: Sourced pad set' })

    fireEvent.click(remove)
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))

    expect(await screen.findByText('Review the visible fields, then refresh and retry.')).toBeInTheDocument()
    expect(screen.getByText('Sourced pad set')).toBeInTheDocument()
    expect(within(screen.getByRole('complementary', { name: 'Quote totals' })).getAllByText('$140.00')).toHaveLength(2)
    await waitFor(() => expect(document.activeElement).toBe(remove))
    expect(screen.getByRole('button', { name: 'Refresh quote' })).toBeInTheDocument()
  })

  it('preserves sourced-removal recovery after a transport failure and retries GET only', async () => {
    const sourced = line({
      id: SOURCED_LINE_ID, description: 'Sourced pad set', priceCents: 14_000,
      source: 'vendor_offer', mutable: false, coreChargeCents: null,
    })
    const initial = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    const absent = builder({ jobs: [{ ...builder().jobs[0], lines: [] }], activeVersion: null })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(200, { changed: true }))
      .mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(response(200, { builder: absent }))
    render(<ManualQuoteBuilder ticket={ticket} builder={initial} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove sourced part: Sourced pad set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))

    expect(await screen.findByText('Connection interrupted. Retry with the same details.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }))

    await waitFor(() => expect(screen.queryByText('Sourced pad set')).toBeNull())
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['DELETE', 'GET', 'GET'])
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Source part' }))
  })

  it('keeps sourced-removal recovery strict when the visible refresh still receives stale truth', async () => {
    const sourced = line({
      id: SOURCED_LINE_ID, description: 'Sourced pad set', priceCents: 14_000,
      source: 'vendor_offer', mutable: false, coreChargeCents: null,
    })
    const stale = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    const initial = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(200, { changed: true }))
      .mockResolvedValueOnce(response(200, { builder: stale }))
      .mockResolvedValueOnce(response(200, { builder: stale }))
    render(<ManualQuoteBuilder ticket={ticket} builder={initial} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove sourced part: Sourced pad set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh quote' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['DELETE', 'GET', 'GET'])
    expect(screen.getByText('Review the visible fields, then refresh and retry.')).toBeInTheDocument()
    expect(screen.getByText('Sourced pad set')).toBeInTheDocument()
    expect(within(screen.getByRole('complementary', { name: 'Quote totals' })).getAllByText('$140.00')).toHaveLength(2)
  })

  it('recovers a sourced removal with GET only and focuses Source part after absent truth', async () => {
    const sourced = line({
      id: SOURCED_LINE_ID, description: 'Sourced pad set', priceCents: 14_000,
      source: 'vendor_offer', mutable: false, coreChargeCents: null,
    })
    const stale = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    const absent = builder({ jobs: [{ ...builder().jobs[0], lines: [] }], activeVersion: null })
    const initial = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(200, { changed: true }))
      .mockResolvedValueOnce(response(200, { builder: stale }))
      .mockResolvedValueOnce(response(200, { builder: absent }))
    render(<ManualQuoteBuilder ticket={ticket} builder={initial} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove sourced part: Sourced pad set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Refresh quote' }))

    await waitFor(() => expect(screen.queryByText('Sourced pad set')).toBeNull())
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['DELETE', 'GET', 'GET'])
    expect(screen.queryByText('Review the visible fields, then refresh and retry.')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Source part' }))
  })

  it.each(['initial removal refresh', 'pending removal recovery'])('rejects absent sourced truth with a stale active version during %s', async (phase) => {
    const sourced = line({
      id: SOURCED_LINE_ID, description: 'Sourced pad set', priceCents: 14_000,
      source: 'vendor_offer', mutable: false, coreChargeCents: null,
    })
    const initial = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    const staleLine = builder({ jobs: [{ ...builder().jobs[0], lines: [sourced] }], activeVersion: null })
    const absentWithVersion = builder({ jobs: [{ ...builder().jobs[0], lines: [] }], activeVersion: activeVersion() })
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(200, { changed: true }))
      .mockResolvedValueOnce(response(200, { builder: phase === 'initial removal refresh' ? absentWithVersion : staleLine }))
      .mockResolvedValueOnce(response(200, { builder: absentWithVersion }))
    render(<ManualQuoteBuilder ticket={ticket} builder={initial} />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove sourced part: Sourced pad set' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm removal' }))
    if (phase === 'pending removal recovery') {
      fireEvent.click(await screen.findByRole('button', { name: 'Refresh quote' }))
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    }

    expect(await screen.findByText('Review the visible fields, then refresh and retry.')).toBeInTheDocument()
    expect(screen.getByText('Sourced pad set')).toBeInTheDocument()
    expect(within(screen.getByRole('complementary', { name: 'Quote totals' })).getAllByText('$140.00')).toHaveLength(2)
  })

  it('restores Source part focus after clean close and dirty discard', async () => {
    render(<ManualQuoteBuilder ticket={ticket} builder={builder()} vendorAccounts={[vendorAccount]} vendorCatalogAvailable />)
    const source = screen.getByRole('button', { name: 'Source part' })

    fireEvent.click(source)
    fireEvent.click(screen.getByRole('button', { name: 'Close part sourcing' }))
    await waitFor(() => expect(document.activeElement).toBe(source))

    fireEvent.click(source)
    fireEvent.change(screen.getByLabelText('Part description'), { target: { value: 'Dirty draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close part sourcing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discard draft' }))
    await waitFor(() => expect(document.activeElement).toBe(source))
  })

  it('reserves desktop panel width without changing the mobile workspace contract', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/screens/manual-quote-builder.module.css'), 'utf8')
    expect(css).toMatch(/\.screenWithSourcing\s*\{[^}]*width:\s*min\(calc\(100% - min\(440px, 42vw\)\), 1240px\)[^}]*margin-left:\s*0/)
    expect(css).toMatch(/@media\s*\(max-width:\s*800px\)[\s\S]*\.screenWithSourcing\s*\{[^}]*width:\s*min\(100%, 1240px\)[^}]*margin:\s*0 auto/)
  })
})

describe('ManualQuoteBuilder line mutations', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    router.push.mockReset()
    router.replace.mockReset()
  })

  it('renders sourced lines read-only without leaking supplier cost or ordinary controls', () => {
    const sourced = line({
      description: 'Sourced pad set', source: 'vendor_offer', mutable: false,
      coreChargeCents: null,
    })
    const strict = parseQuoteBuilderProjection(builder({
      jobs: [{ ...builder().jobs[0], lines: [sourced] }],
      activeVersion: null,
    }))
    if (!strict) throw new Error('sourced projection rejected')
    render(<ManualQuoteBuilder ticket={ticket} builder={strict} />)

    expect(screen.getByText('Sourced · read-only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit Sourced pad set' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Remove Sourced pad set' })).toBeNull()
    const tape = screen.getByRole('complementary', { name: 'Quote totals' })
    expect(within(tape).getAllByText('$120.00')).toHaveLength(2)
    expect(document.body.textContent).not.toMatch(/supplier cost|unit cost|vendor account/i)
  })

  it('creates with one retry key, waits for refreshed truth, and returns focus to the line', async () => {
    const empty = builder({
      jobs: [{ id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open', ...jobFacts, lines: [] }],
      activeVersion: activeVersion(),
    })
    const refreshed = builder({
      jobs: [{
        id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open',
        ...jobFacts,
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
    const empty = builder({ activeVersion: null, jobs: [{
      id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open', ...jobFacts, lines: [],
    }] })
    const refreshed = builder({ activeVersion: null, jobs: [{
      id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open',
      ...jobFacts,
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
    const removalDialog = screen.getByRole('alertdialog', { name: 'Remove this quote line?' })
    const removalTarget = within(removalDialog).getByText('Edited pads')
    expect(removalDialog).toHaveAttribute('aria-describedby', removalTarget.id)
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
        ...jobFacts,
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
      id: JOB_ID, title: 'Brake service', kind: 'repair', workStatus: 'open', ...jobFacts, lines: [pinned],
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
    const prepared = { id: VERSION_ID, versionNumber: 4 }
    const active = activeVersion(4)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(status, { changed, version: prepared }))
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
    const prepared = { id: VERSION_ID, versionNumber: 4 }
    const active = activeVersion(4)
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, { changed: true, version: prepared, extra: true }))
      .mockResolvedValueOnce(response(200, { builder: ready({ activeVersion: active }) }))
    render(<ManualQuoteBuilder ticket={ticket} builder={ready()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Prepare quote' }))
    await screen.findByText('Review the visible fields, then refresh and retry.')
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quote' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Prepared version V4')
  })

  it('rejects refreshed truth that does not contain the exact prepared version', async () => {
    const version = { id: VERSION_ID, versionNumber: 4 }
    const active = activeVersion(4)
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(201, { changed: true, version }))
      .mockResolvedValueOnce(response(200, { builder: ready() }))
      .mockResolvedValueOnce(response(200, { builder: ready({ activeVersion: active }) }))
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
