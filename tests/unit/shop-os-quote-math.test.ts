import { describe, expect, it } from 'vitest'
import {
  calculateLaborPriceCents,
  calculateTicketTotals,
  buildQuoteStoryMeta,
  canonicalizeJson,
  formatScaledDecimal,
  parseScaledDecimal,
  quoteSnapshotContentIdentity,
  resolveLaborPriceCents,
  sortBySnapshotOrder,
  stableStringify,
  type JsonObject,
  type QuoteSnapshotV1,
} from '@/lib/shop-os/quote-math'

describe('Shop OS quote decimal math', () => {
  it('parses quantities and hours into canonical scaled integers', () => {
    expect(parseScaledDecimal('001.20', 2)).toBe(120n)
    expect(formatScaledDecimal(120n, 2)).toBe('1.2')
    expect(parseScaledDecimal('2.345', 3)).toBe(2345n)
    expect(formatScaledDecimal(2345n, 3)).toBe('2.345')
    expect(formatScaledDecimal(2000n, 3)).toBe('2')
  })

  it.each(['-1', '+1', '1e2', ' 1', '.5', '1.', '1.001'])('rejects invalid hours %s', (value) => {
    expect(() => parseScaledDecimal(value, 2)).toThrow()
  })

  it('rejects negative, unsafe, and unsupported-scale values', () => {
    expect(() => formatScaledDecimal(-1n, 2)).toThrow()
    expect(() => parseScaledDecimal('9007199254740992', 2)).toThrow()
    expect(() => parseScaledDecimal('1', -1)).toThrow()
  })

  it('accepts the exact safe scaled-decimal boundary and rejects quantity fourth decimals', () => {
    expect(parseScaledDecimal('90071992547409.91', 2)).toBe(BigInt(Number.MAX_SAFE_INTEGER))
    expect(parseScaledDecimal('9007199254740.991', 3)).toBe(BigInt(Number.MAX_SAFE_INTEGER))
    expect(() => parseScaledDecimal('1.0001', 3)).toThrow()
  })
})

describe('Shop OS quote totals', () => {
  it('rounds labor half-up at the half-cent boundary', () => {
    expect(calculateLaborPriceCents(1n, 49)).toBe(0)
    expect(calculateLaborPriceCents(1n, 50)).toBe(1)
    expect(calculateLaborPriceCents(125n, 10_000)).toBe(12_500)
  })

  it('supports pinned fallback and explicit labor override primitives', () => {
    const fallbackRate = 12_345
    const pinnedRate = 15_000
    const hoursHundredths = parseScaledDecimal('1.25', 2)
    expect(resolveLaborPriceCents({ hoursHundredths, shopRateCents: fallbackRate })).toEqual({
      priceCents: 15_431,
      laborRateCents: fallbackRate,
    })
    expect(
      resolveLaborPriceCents({ hoursHundredths, shopRateCents: fallbackRate, pinnedRateCents: pinnedRate }),
    ).toEqual({ priceCents: 18_750, laborRateCents: pinnedRate })
    expect(
      resolveLaborPriceCents({
        hoursHundredths,
        shopRateCents: fallbackRate,
        pinnedRateCents: pinnedRate,
        explicitPriceCents: 17_500,
      }),
    ).toEqual({ priceCents: 17_500, laborRateCents: pinnedRate })
    expect(() => resolveLaborPriceCents({ hoursHundredths, shopRateCents: null })).toThrow()
  })

  it('preserves an explicitly null pinned rate across shop-default changes', () => {
    const hoursHundredths = parseScaledDecimal('1.25', 2)
    expect(
      resolveLaborPriceCents({
        hoursHundredths,
        shopRateCents: 22_000,
        pinnedRateCents: null,
        explicitPriceCents: 17_500,
      }),
    ).toEqual({ priceCents: 17_500, laborRateCents: null })
    expect(() =>
      resolveLaborPriceCents({
        hoursHundredths: -1n,
        shopRateCents: 22_000,
        pinnedRateCents: null,
        explicitPriceCents: 17_500,
      }),
    ).toThrow()
  })

  it('sums multiple taxable lines and rounds tax half-up', () => {
    expect(
      calculateTicketTotals(
        [
          { extendedCents: 101, taxable: true },
          { extendedCents: 99, taxable: true },
          { extendedCents: 50, taxable: false },
        ],
        725,
      ),
    ).toEqual({ subtotalCents: 250, taxableSubtotalCents: 200, taxCents: 15, totalCents: 265 })

    expect(calculateTicketTotals([{ extendedCents: 1, taxable: true }], 5_000).taxCents).toBe(1)
    expect(calculateTicketTotals([{ extendedCents: 1, taxable: true }], 4_999).taxCents).toBe(0)
    expect(calculateTicketTotals([{ extendedCents: 100, taxable: true }], 0).taxCents).toBe(0)
  })

  it('permits an above-safe BigInt numerator when the rounded result is safe', () => {
    expect(calculateLaborPriceCents(100n, Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER)
  })

  it('rejects unsafe inputs and unsafe final totals', () => {
    expect(() => calculateLaborPriceCents(100n, Number.MAX_SAFE_INTEGER + 1)).toThrow()
    expect(() =>
      calculateTicketTotals(
        [
          { extendedCents: Number.MAX_SAFE_INTEGER, taxable: false },
          { extendedCents: 1, taxable: false },
        ],
        0,
      ),
    ).toThrow()
    expect(() => calculateTicketTotals([{ extendedCents: -1, taxable: true }], 100)).toThrow()
  })

  it('accepts an exact maximum-safe ticket and rejects tax-rate and total overflow', () => {
    expect(
      calculateTicketTotals([{ extendedCents: Number.MAX_SAFE_INTEGER, taxable: false }], 10_000),
    ).toEqual({
      subtotalCents: Number.MAX_SAFE_INTEGER,
      taxableSubtotalCents: 0,
      taxCents: 0,
      totalCents: Number.MAX_SAFE_INTEGER,
    })
    expect(() => calculateTicketTotals([{ extendedCents: 1, taxable: true }], 10_001)).toThrow()
    expect(() =>
      calculateTicketTotals([{ extendedCents: Number.MAX_SAFE_INTEGER, taxable: true }], 1),
    ).toThrow()
  })
})

describe('Shop OS immutable quote snapshot identity', () => {
  const snapshot = (_vendorContext: JsonObject): QuoteSnapshotV1 => ({
    schemaVersion: 1,
    ticket: {
      id: 'ticket-1',
      number: 42,
      customerId: 'customer-1',
      vehicleId: 'vehicle-1',
      laborRateCents: 15_000,
      taxRateBps: 725,
    },
    jobs: [
      {
        id: 'job-1',
        title: 'Brake service',
        kind: 'repair',
        customerStory: {
          whatYouToldUs: 'noise', whatWeFound: 'worn pads', howWeKnow: [],
          whatItMeansIfWaived: 'longer stopping', whatWeRecommend: 'replace pads',
        },
        storyMeta: null,
        lines: [
          {
            id: 'line-1',
            kind: 'part',
            description: 'Pad set',
            quantity: '1',
            priceCents: 12_000,
            taxable: true,
            partNumber: 'PAD-1',
            brand: 'ACME',
            coreChargeCents: null,
            fitment: null,
            laborHours: null,
            laborRateCents: null,
            source: 'manual',
            vendorContext: null,
          },
        ],
        attachments: [{ id: 'attachment-1', jobId: 'job-1', kind: 'photo' }],
        totals: { subtotalCents: 12_000, taxableSubtotalCents: 12_000 },
      },
    ],
    totals: {
      subtotalCents: 12_000,
      taxableSubtotalCents: 12_000,
      taxCents: 870,
      totalCents: 12_870,
    },
  })

  it('recursively canonicalizes nested object keys while preserving array order', () => {
    const canonical = canonicalizeJson({ z: [{ b: 2, a: 1 }, 3], a: { d: 4, c: 3 } })
    expect(stableStringify(canonical)).toBe('{"a":{"c":3,"d":4},"z":[{"a":1,"b":2},3]}')
    expect(stableStringify(canonicalizeJson({ values: [2, 1] }))).not.toBe(
      stableStringify(canonicalizeJson({ values: [1, 2] })),
    )
    expect(stableStringify(JSON.parse('{"__proto__":{"x":1},"a":2}'))).toBe(
      '{"__proto__":{"x":1},"a":2}',
    )
  })

  it('keeps content identity independent of excluded external vendor JSON', () => {
    const first = snapshot({ offer: { z: 2, a: 1 }, tiers: [{ y: 2, x: 1 }] })
    const second = snapshot({ tiers: [{ x: 1, y: 2 }], offer: { a: 1, z: 2 } })
    expect(quoteSnapshotContentIdentity(first)).toBe(quoteSnapshotContentIdentity(second))
  })

  it('excludes volatile actor and time fields from story metadata identity', () => {
    const first = snapshot({ offer: { amount: 1 } })
    first.jobs[0].storyMeta = buildQuoteStoryMeta({
      source: 'ai',
      sessionId: 'session-1',
      generatedAt: '2026-01-01',
      lastEditedByProfileId: 'actor-1',
      generationClientKey: 'key-1',
      generationRequestFingerprint: 'request-1',
      generatedByProfileId: 'generator-1',
      storyRevision: 1,
      reviewStatus: 'pending',
    })
    const second = snapshot({ offer: { amount: 1 } })
    second.jobs[0].storyMeta = buildQuoteStoryMeta({
      source: 'ai',
      sessionId: 'session-1',
      generatedAt: '2026-07-10',
      lastEditedByProfileId: 'actor-2',
      generationClientKey: 'key-2',
      generationRequestFingerprint: 'request-2',
      generatedByProfileId: 'generator-2',
      storyRevision: 99,
      reviewStatus: 'reviewed',
    })
    expect(first.jobs[0].storyMeta).toEqual({
      source: 'ai',
      sessionId: 'session-1',
    })
    Object.assign(first.jobs[0].storyMeta!, {
      generatedAt: '2026-01-01',
      lastEditedByProfileId: 'actor-1',
    })
    Object.assign(second.jobs[0].storyMeta!, {
      generatedAt: '2026-07-10',
      lastEditedByProfileId: 'actor-2',
    })
    expect(quoteSnapshotContentIdentity(first)).toBe(quoteSnapshotContentIdentity(second))
  })

  it('sorts persisted records by sort, creation time, then immutable ID', () => {
    const records = [
      { id: 'b', sort: 1, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'c', sort: 0, createdAt: '2026-01-02T00:00:00.000Z' },
      { id: 'a', sort: 1, createdAt: '2026-01-01T00:00:00.000Z' },
    ]
    expect(sortBySnapshotOrder(records).map(({ id }) => id)).toEqual(['c', 'a', 'b'])
    expect(records.map(({ id }) => id)).toEqual(['b', 'c', 'a'])
  })
})
