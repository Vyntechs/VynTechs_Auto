import { describe, expect, it } from 'vitest'
import { calculateTicketTotals } from '@/lib/shop-os/quote-math'
import { defaultLineTaxable } from '@/lib/shop-os/quote-builder-ui'
import { newCannedLine } from '@/lib/shop-os/canned-jobs-ui'

/**
 * Texas does not tax separately stated labor on motor vehicle repair. Every
 * hand-written line used to start taxable, so an advisor had to remember to
 * uncheck a box on each one, and forgetting billed the customer sales tax the
 * state does not levy — invisibly, because a quote shows the taxable subtotal
 * and never which lines went into it.
 */
describe('a labor line does not start taxable', () => {
  it('starts labor untaxed and leaves parts and fees alone', () => {
    expect(defaultLineTaxable('labor')).toBe(false)
    expect(defaultLineTaxable('part')).toBe(true)
    expect(defaultLineTaxable('fee')).toBe(true)
  })

  it('applies to a new canned-job line, which a shop reuses forever', () => {
    expect(newCannedLine('labor').taxable).toBe(false)
    expect(newCannedLine('part').taxable).toBe(true)
    expect(newCannedLine('fee').taxable).toBe(true)
  })

  // $155 of labor and $200 of parts at Young Motorsports' real 8.25%.
  it('bills tax on the parts only', () => {
    const totals = calculateTicketTotals(
      [
        { extendedCents: 15_500, taxable: defaultLineTaxable('labor') },
        { extendedCents: 20_000, taxable: defaultLineTaxable('part') },
      ],
      825,
    )

    expect(totals.subtotalCents).toBe(35_500)
    expect(totals.taxableSubtotalCents).toBe(20_000)
    expect(totals.taxCents).toBe(1_650)
    expect(totals.totalCents).toBe(37_150)
  })

  // The number this defect actually cost: the old default taxed the labor too.
  it('no longer charges the customer the tax the old default added to labor', () => {
    const everythingTaxable = calculateTicketTotals(
      [
        { extendedCents: 15_500, taxable: true },
        { extendedCents: 20_000, taxable: true },
      ],
      825,
    )

    expect(everythingTaxable.taxCents).toBe(2_929)
    expect(everythingTaxable.taxCents - 1_650).toBe(1_279)
  })

  // The checkbox is untouched: a shop in a state that taxes labor checks it and
  // the math follows, so this is a starting value and not a policy lock.
  it('still taxes labor when the writer checks the box', () => {
    const totals = calculateTicketTotals([{ extendedCents: 15_500, taxable: true }], 825)

    expect(totals.taxCents).toBe(1_279)
  })
})
