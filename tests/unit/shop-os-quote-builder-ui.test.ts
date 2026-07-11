import { describe, expect, it } from 'vitest'
import {
  buildManualLineInput,
  classifyQuoteFailure,
  formatMoneyCents,
  parseMoneyToCents,
  parseQuoteBuilderProjection,
  summarizeQuoteMoney,
} from '@/lib/shop-os/quote-builder-ui'

describe('quote builder refresh projection validation', () => {
  const valid = {
    ticket: { id: '00000000-0000-4000-8000-000000000101', status: 'open', reconciled: true },
    configuration: {
      laborRateCents: 15_000, taxRateBps: 825,
      laborRateConfigured: true, taxRateConfigured: true,
    },
    jobs: [{
      id: '00000000-0000-4000-8000-000000000201', title: 'Brake service', kind: 'repair', workStatus: 'open',
      lines: [{
        id: '00000000-0000-4000-8000-000000000301', kind: 'fee', description: 'Fee', sort: 0, quantity: '1',
        priceCents: 500, taxable: true, partNumber: null, brand: null,
        coreChargeCents: null, fitment: null, laborHours: null, laborRateCents: null,
      }],
    }],
    activeVersion: null,
  }

  it('accepts the complete exact safe projection', () => {
    expect(parseQuoteBuilderProjection(valid)).toEqual(valid)
  })

  it('accepts exact row-17 quantity/hour caps and rejects cap plus one', () => {
    const part = {
      ...valid.jobs[0].lines[0], kind: 'part', quantity: '999999999.999',
    }
    const labor = {
      ...valid.jobs[0].lines[0], kind: 'labor', quantity: '1',
      laborHours: '999999.99', laborRateCents: 15_000,
    }
    expect(parseQuoteBuilderProjection({
      ...valid, jobs: [{ ...valid.jobs[0], lines: [part, { ...labor, id: '00000000-0000-4000-8000-000000000302' }] }],
    })).not.toBeNull()
    expect(parseQuoteBuilderProjection({
      ...valid, jobs: [{ ...valid.jobs[0], lines: [{ ...part, quantity: '1000000000' }] }],
    })).toBeNull()
    expect(parseQuoteBuilderProjection({
      ...valid, jobs: [{ ...valid.jobs[0], lines: [{ ...labor, laborHours: '1000000' }] }],
    })).toBeNull()
  })

  it.each([
    {},
    { ...valid, hiddenVendorState: 'SECRET' },
    { ...valid, ticket: { ...valid.ticket, id: 'not-a-uuid' } },
    { ...valid, jobs: [{ ...valid.jobs[0], lines: [{ ...valid.jobs[0].lines[0], priceCents: -1 }] }] },
    { ...valid, jobs: [{ ...valid.jobs[0], lines: [{ ...valid.jobs[0].lines[0], quantity: '01' }] }] },
    { ...valid, jobs: [{ ...valid.jobs[0], lines: [{ ...valid.jobs[0].lines[0], quantity: '1'.repeat(33) }] }] },
    { ...valid, jobs: [valid.jobs[0], valid.jobs[0]] },
    { ...valid, jobs: [{ ...valid.jobs[0], lines: [{ ...valid.jobs[0].lines[0], unitCostCents: 1 }] }] },
  ])('rejects incomplete, malformed, or hidden-extra projections', (hostile) => {
    expect(parseQuoteBuilderProjection(hostile)).toBeNull()
  })
})

describe('quote builder UI money', () => {
  it('parses and formats dollars through exact BigInt quotient and remainder math', () => {
    expect(parseMoneyToCents('001.20')).toBe(120)
    expect(parseMoneyToCents('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER)
    expect(formatMoneyCents(Number.MAX_SAFE_INTEGER)).toBe('$90,071,992,547,409.91')
  })

  it.each(['-1', '+1', '1e2', '.50', '1.', '1.001', ' 1', '$1.00']) (
    'rejects invalid money input %s',
    (value) => expect(() => parseMoneyToCents(value)).toThrow(),
  )

  it('uses row-17 totals and preserves half-up tax edges', () => {
    expect(summarizeQuoteMoney([
      { priceCents: 1, taxable: true },
      { priceCents: 99, taxable: false },
    ], 5_000)).toEqual({
      ok: true,
      subtotalCents: 100,
      taxableSubtotalCents: 1,
      taxCents: 1,
      totalCents: 101,
      taxConfigured: true,
    })
    expect(summarizeQuoteMoney([{ priceCents: 1, taxable: true }], 4_999)).toMatchObject({
      ok: true,
      taxCents: 0,
    })
  })

  it('keeps known subtotals but withholds tax and total when tax is not configured', () => {
    expect(summarizeQuoteMoney([
      { priceCents: 12_000, taxable: true },
      { priceCents: 2_500, taxable: false },
    ], null)).toEqual({
      ok: true,
      subtotalCents: 14_500,
      taxableSubtotalCents: 12_000,
      taxCents: null,
      totalCents: null,
      taxConfigured: false,
    })
  })

  it('fails closed on aggregate overflow or corrupt persisted money', () => {
    expect(summarizeQuoteMoney([
      { priceCents: Number.MAX_SAFE_INTEGER, taxable: false },
      { priceCents: 1, taxable: false },
    ], 0)).toEqual({ ok: false })
    expect(summarizeQuoteMoney([{ priceCents: -1, taxable: true }], 825)).toEqual({ ok: false })
    expect(() => formatMoneyCents(Number.MAX_SAFE_INTEGER + 1)).toThrow()
  })
})

describe('quote builder UI mutation inputs', () => {
  const common = {
    description: '  Brake service  ', quantity: '1', hours: '1.25',
    price: '187.50', taxable: true, partNumber: '', brand: '', fitment: '',
  }

  it('builds strict customer-price payloads without hidden cost or core fields', () => {
    expect(buildManualLineInput('part', {
      ...common, quantity: '2.500', price: '120.00', partNumber: ' PAD-1 ', brand: ' ACME ',
      fitment: ' Front ',
    }, 15_000)).toEqual({
      kind: 'part', description: 'Brake service', sort: 0, taxable: true,
      quantity: '2.5', priceCents: 12_000, partNumber: 'PAD-1', brand: 'ACME',
      fitment: 'Front',
    })
    expect(JSON.stringify(buildManualLineInput('part', common, 15_000))).not.toMatch(
      /unitCost|coreCharge|vendor/i,
    )
  })

  it('calculates configured-rate labor exactly and requires explicit price without a rate', () => {
    expect(buildManualLineInput('labor', common, 15_000)).toEqual({
      kind: 'labor', description: 'Brake service', sort: 0, taxable: true,
      laborHours: '1.25', laborRateCents: 15_000, priceCents: 18_750,
    })
    expect(() => buildManualLineInput('labor', { ...common, price: '' }, null)).toThrow()
    expect(buildManualLineInput('labor', common, null)).toMatchObject({
      laborRateCents: null, priceCents: 18_750,
    })
  })

  it('rejects hostile decimals and builds fee input', () => {
    expect(() => buildManualLineInput('part', { ...common, quantity: '1e2' }, 15_000)).toThrow()
    expect(() => buildManualLineInput('labor', { ...common, hours: '1.001' }, 15_000)).toThrow()
    expect(() => buildManualLineInput('fee', { ...common, price: '-1' }, 15_000)).toThrow()
    expect(buildManualLineInput('fee', common, 15_000)).toEqual({
      kind: 'fee', description: 'Brake service', sort: 0, taxable: true,
      priceCents: 18_750,
    })
  })

  it('maps only documented access and conflict outcomes', () => {
    expect(classifyQuoteFailure(401, {} , '/tickets/t/quote')).toEqual({
      kind: 'navigate', href: '/sign-in?next=%2Ftickets%2Ft%2Fquote',
    })
    expect(classifyQuoteFailure(403, { error: 'deactivated' }, '/x')).toEqual({
      kind: 'navigate', href: '/deactivated',
    })
    expect(classifyQuoteFailure(403, { error: 'paywall' }, '/x')).toEqual({
      kind: 'navigate', href: '/subscribe',
    })
    expect(classifyQuoteFailure(404, {}, '/tickets/t/quote')).toEqual({
      kind: 'navigate', href: '/tickets/t',
    })
    expect(classifyQuoteFailure(409, { retryable: true }, '/x')).toEqual({
      kind: 'error', message: 'Quote is busy. Refresh and retry.', refresh: true,
    })
    expect(classifyQuoteFailure(422, { feedback: 'SECRET' }, '/x')).toEqual({
      kind: 'error', message: 'Review the visible fields, then refresh and retry.', refresh: false,
    })
  })
})
