import { describe, expect, it } from 'vitest'
import {
  formatMoneyCents,
  parseMoneyToCents,
  summarizeQuoteMoney,
} from '@/lib/shop-os/quote-builder-ui'

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
