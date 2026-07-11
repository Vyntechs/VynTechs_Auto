import { calculateTicketTotals } from '@/lib/shop-os/quote-math'

const MAX_SAFE_CENTS = BigInt(Number.MAX_SAFE_INTEGER)

export function parseMoneyToCents(value: string): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value)
  if (!match) throw new RangeError('money must be a nonnegative plain decimal')

  const cents = BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0') || '0')
  if (cents > MAX_SAFE_CENTS) throw new RangeError('money exceeds the safe-integer range')
  return Number(cents)
}

export function formatMoneyCents(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) {
    throw new RangeError('money must be a nonnegative safe integer')
  }
  const value = BigInt(cents)
  const whole = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const fraction = (value % 100n).toString().padStart(2, '0')
  return `$${whole}.${fraction}`
}

export type QuoteMoneySummary =
  | {
    ok: true
    subtotalCents: number
    taxableSubtotalCents: number
    taxCents: number
    totalCents: number
    taxConfigured: true
  }
  | {
    ok: true
    subtotalCents: number
    taxableSubtotalCents: number
    taxCents: null
    totalCents: null
    taxConfigured: false
  }
  | { ok: false }

export function summarizeQuoteMoney(
  lines: readonly { priceCents: number; taxable: boolean }[],
  taxRateBps: number | null,
): QuoteMoneySummary {
  try {
    const totals = calculateTicketTotals(
      lines.map((line) => ({
        extendedCents: line.priceCents,
        taxable: line.taxable,
      })),
      taxRateBps ?? 0,
    )
    const known = {
      ok: true as const,
      subtotalCents: totals.subtotalCents,
      taxableSubtotalCents: totals.taxableSubtotalCents,
    }
    return taxRateBps === null
      ? { ...known, taxCents: null, totalCents: null, taxConfigured: false }
      : {
        ...known,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        taxConfigured: true,
      }
  } catch {
    return { ok: false }
  }
}
