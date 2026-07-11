import { render, screen, within } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ManualQuoteBuilder } from '@/components/screens/manual-quote-builder'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'
import type { TicketDetail } from '@/lib/tickets'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={String(href)} {...props}>{children}</a>
  ),
}))

type Builder = Extract<QuoteBuilderResult, { ok: true }>['builder']
type BuilderLine = Builder['jobs'][number]['lines'][number]

const ticket: TicketDetail = {
  id: 'ticket-1', ticketNumber: 42, source: 'counter', status: 'open',
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
    id: 'line-1', kind: 'part', description: 'Front pad set', sort: 0,
    quantity: '1', priceCents: 12_000, taxable: true,
    partNumber: 'PAD-1', brand: 'ACME', coreChargeCents: 2_500,
    fitment: 'Front axle', laborHours: null, laborRateCents: null,
    ...overrides,
  }
}

function builder(overrides: Partial<Builder> = {}): Builder {
  return {
    ticket: { id: 'ticket-1', status: 'open', reconciled: true },
    configuration: {
      laborRateCents: 15_000, taxRateBps: 825,
      laborRateConfigured: true, taxRateConfigured: true,
    },
    jobs: [{
      id: 'job-1', title: 'Replace front brakes', kind: 'repair', workStatus: 'open',
      lines: [
        line(),
        line({
          id: 'line-2', kind: 'labor', description: 'Brake labor', quantity: '1',
          priceCents: 18_750, taxable: false, partNumber: null, brand: null,
          coreChargeCents: null, fitment: null, laborHours: '1.25', laborRateCents: 15_000,
        }),
        line({
          id: 'line-3', kind: 'fee', description: 'Shop supplies', quantity: '1',
          priceCents: 500, taxable: true, partNumber: null, brand: null,
          coreChargeCents: null, fitment: null, laborHours: null, laborRateCents: null,
        }),
      ],
    }],
    activeVersion: { id: 'version-1', versionNumber: 3 },
    ...overrides,
  }
}

describe('ManualQuoteBuilder', () => {
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
    expect(screen.getByText('Current prepared version · V3')).toBeInTheDocument()

    const tape = screen.getByRole('complementary', { name: 'Quote totals' })
    expect(within(tape).getByText('$312.50')).toBeInTheDocument()
    expect(within(tape).getByText('$125.00')).toBeInTheDocument()
    expect(within(tape).getByText('$10.31')).toBeInTheDocument()
    expect(within(tape).getByText('$322.81')).toBeInTheDocument()
    expect(within(tape).queryByText('$337.50')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows provisional and missing-rate truth without invalidating explicitly priced labor', () => {
    render(<ManualQuoteBuilder ticket={{ ...ticket, customer: null, vehicle: null }} builder={builder({
      ticket: { id: 'ticket-1', status: 'open', reconciled: false },
      configuration: {
        laborRateCents: null, taxRateBps: 825,
        laborRateConfigured: false, taxRateConfigured: true,
      },
      jobs: [{
        id: 'job-1', title: 'Inspect brakes', kind: 'maintenance', workStatus: 'open',
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
        id: 'job-1', title: 'Overflow quote', kind: 'repair', workStatus: 'open',
        lines: [
          line({ id: 'line-1', priceCents: Number.MAX_SAFE_INTEGER }),
          line({ id: 'line-2', priceCents: 1 }),
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
      jobs: [{ id: 'job-1', title: 'Brake service', kind: 'repair', workStatus: 'open', lines: [] }],
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

  it('declares sticky desktop tape, 375px reflow, mono money, and focus visibility', () => {
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

    const ledger = screen.getByRole('region', { name: 'Quote ledger' })
    const tape = screen.getByRole('complementary', { name: 'Quote totals' })
    expect(ledger.compareDocumentPosition(tape) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
