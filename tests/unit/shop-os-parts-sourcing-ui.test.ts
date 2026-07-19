import { describe, expect, it } from 'vitest'
import type { QuoteBuilderResult } from '@/lib/shop-os/quotes'
import {
  buildManualOfferPayload,
  deriveMarkupLinePrice,
  manualPartCommitLabel,
  normalizedManualPartSignature,
  parseCreatedVendorAccountResponse,
  parseEnabledVendorAccountsResponse,
  parseManualOfferRemovalResponse,
  parseManualOfferResponse,
  selectLockedDiagnosisSeed,
  type ManualPartDraft,
} from '@/lib/shop-os/parts-sourcing-ui'

const ACCOUNT_ID = '00000000-0000-4000-8000-000000000101'
const CLIENT_KEY = '00000000-0000-4000-8000-000000000102'
const JOB_ID = '00000000-0000-4000-8000-000000000103'
const LINE_ID = '00000000-0000-4000-8000-000000000104'

function manualPartDraft(overrides: Partial<ManualPartDraft> = {}): ManualPartDraft {
  return {
    vendorAccountId: '',
    description: '',
    quantity: '1',
    unitCost: '',
    customerPrice: '',
    taxable: true,
    partNumber: '',
    brand: '',
    fitment: '',
    externalOfferId: '',
    coreCharge: '0',
    availability: 'unknown',
    fulfillmentMethod: 'unknown',
    locationLabel: '',
    ...overrides,
  }
}

const account = {
  id: ACCOUNT_ID,
  displayName: 'Local Parts',
  mode: 'manual' as const,
  enabled: true,
  updatedAt: '2026-07-12T05:00:00.000Z',
}

const line = {
  id: LINE_ID,
  jobId: JOB_ID,
  kind: 'part' as const,
  description: 'Pad set',
  quantity: '2',
  priceCents: 24_000,
  taxable: true,
  partNumber: null,
  brand: null,
  fitment: null,
  source: 'vendor_offer' as const,
  mutable: false as const,
}

const sourcing = {
  vendorAccountId: ACCOUNT_ID,
  displayName: 'Local Parts',
  externalOfferId: null,
  unitCostCents: 8_000,
  coreChargeCents: 0,
  availability: 'unknown' as const,
  fulfillment: { method: 'unknown' as const, locationLabel: null },
  fetchedAt: '2026-07-12T05:01:00.000Z',
}

type BuilderJob = Extract<QuoteBuilderResult, { ok: true }>['builder']['jobs'][number]

function diagnosisJob(
  recommendation: string,
  overrides: Partial<BuilderJob> = {},
): BuilderJob {
  return {
    id: JOB_ID,
    title: 'Charging system',
    kind: 'diagnostic',
    workStatus: 'open',
    story: {
      content: {
        whatYouToldUs: 'The battery light is on.',
        whatWeFound: 'Alternator output is low.',
        howWeKnow: [],
        whatItMeansIfWaived: 'The battery may discharge.',
        whatWeRecommend: recommendation,
      },
      source: 'ai',
      reviewStatus: 'reviewed',
      revision: 1,
    },
    storyMode: 'ordinary_locked_tree',
    decisionEligible: false,
    approval: { state: 'pending_quote', quoteVersionId: null },
    lines: [],
    ...overrides,
  }
}

const reviewedOrdinaryJob = (recommendation: string) => diagnosisJob(recommendation)
const topologyJob = () => diagnosisJob('Topology recommendation', { storyMode: 'topology_manual' })
const pendingOrdinaryJob = () => diagnosisJob('Pending recommendation', {
  story: { ...diagnosisJob('Pending recommendation').story, reviewStatus: 'pending' },
})
const publishedWizardJob = () => diagnosisJob('Wizard recommendation', {
  storyMode: 'published_wizard_unsupported',
})

describe('strict sourcing response contracts', () => {
  it('accepts only clean enabled manual accounts and strict envelopes', () => {
    expect(parseEnabledVendorAccountsResponse({ vendorAccounts: [{
      id: ACCOUNT_ID, displayName: 'Local Parts', mode: 'manual', enabled: true,
      updatedAt: '2026-07-12T05:00:00.000Z',
    }] })?.[0].displayName).toBe('Local Parts')
    expect(parseEnabledVendorAccountsResponse({ vendorAccounts: [{
      id: ACCOUNT_ID, displayName: 'Local Parts', mode: 'manual', enabled: false,
      updatedAt: '2026-07-12T05:00:00.000Z',
    }] })).toBeNull()
    expect(parseEnabledVendorAccountsResponse({ vendorAccounts: [], secretRef: 'NO' })).toBeNull()
  })

  it('accepts only strict status-matched created-account responses', () => {
    expect(parseCreatedVendorAccountResponse(201, { changed: true, vendorAccount: account }))
      .toEqual({ changed: true, vendorAccount: account })
    expect(parseCreatedVendorAccountResponse(200, { changed: false, vendorAccount: account }))
      .toEqual({ changed: false, vendorAccount: account })
    expect(parseCreatedVendorAccountResponse(200, { changed: true, vendorAccount: account })).toBeNull()
    expect(parseCreatedVendorAccountResponse(201, { changed: false, vendorAccount: account })).toBeNull()
    expect(parseCreatedVendorAccountResponse(201, {
      changed: true, vendorAccount: account, secretRef: 'NO',
    })).toBeNull()
    expect(parseCreatedVendorAccountResponse(201, {
      changed: true, vendorAccount: { ...account, enabled: false },
    })).toBeNull()
  })

  it('accepts only strict capture status and shape combinations', () => {
    const created = { changed: true, line, sourcing }
    const retried = { changed: false, line, sourcing }
    const unavailable = { changed: false, unavailable: true }

    expect(parseManualOfferResponse(201, created)).toEqual(created)
    expect(parseManualOfferResponse(200, retried)).toEqual(retried)
    expect(parseManualOfferResponse(200, unavailable)).toEqual(unavailable)
    const row28UnknownLocation = {
      ...retried,
      sourcing: {
        ...sourcing,
        fulfillment: { method: 'unknown' as const, locationLabel: 'Counter' },
      },
    }
    expect(parseManualOfferResponse(200, row28UnknownLocation)).toEqual(row28UnknownLocation)
    const row28SnapshotDisplayName = {
      ...retried,
      sourcing: { ...sourcing, displayName: 'S'.repeat(200) },
    }
    expect(parseManualOfferResponse(200, row28SnapshotDisplayName)).toEqual(row28SnapshotDisplayName)

    for (const [status, value] of [
      [200, created],
      [201, retried],
      [201, unavailable],
      [204, retried],
      [201, { ...created, hidden: true }],
      [201, { ...created, line: { ...line, id: 'not-a-uuid' } }],
      [200, { ...unavailable, line }],
      [201, { changed: true, line }],
    ] as const) {
      expect(parseManualOfferResponse(status, value)).toBeNull()
    }
  })

  it('accepts removal only as 200 with one boolean field', () => {
    expect(parseManualOfferRemovalResponse(200, { changed: true })).toEqual({ changed: true })
    expect(parseManualOfferRemovalResponse(200, { changed: false })).toEqual({ changed: false })
    expect(parseManualOfferRemovalResponse(201, { changed: true })).toBeNull()
    expect(parseManualOfferRemovalResponse(200, { changed: true, line })).toBeNull()
    expect(parseManualOfferRemovalResponse(200, { changed: 'yes' })).toBeNull()
  })
})

describe('manual sourcing draft normalization', () => {
  it('normalizes one exact capture intent and keeps internal fields out of the label', () => {
    const draft = manualPartDraft({ vendorAccountId: ACCOUNT_ID, description: '  Pad set  ', quantity: '2.0', unitCost: '80', customerPrice: '240.00' })
    const payload = buildManualOfferPayload(draft, CLIENT_KEY)
    expect(payload).toEqual({
      clientKey: CLIENT_KEY, vendorAccountId: ACCOUNT_ID, description: 'Pad set',
      partNumber: null, brand: null, quantity: '2', priceCents: 24000,
      unitCostCents: 8000, coreChargeCents: 0, taxable: true,
      availability: 'unknown', fitment: null,
      fulfillment: { method: 'unknown', locationLabel: null }, externalOfferId: null,
    })
    expect(manualPartCommitLabel(draft)).toBe('Add 2 Pad set · Customer price $240.00')
    expect(manualPartCommitLabel(draft)).not.toMatch(/80|cost|supplier/i)
  })

  it('normalizes optional capture fields and discards location for unknown fulfillment', () => {
    const payload = buildManualOfferPayload(manualPartDraft({
      vendorAccountId: ACCOUNT_ID,
      description: ' Rotor ',
      quantity: '1.250',
      unitCost: '100.5',
      customerPrice: '175',
      coreCharge: '12.00',
      partNumber: ' R-1 ',
      brand: ' BrakeCo ',
      fitment: ' Front ',
      externalOfferId: ' REF-7 ',
      locationLabel: ' Aisle 4 ',
    }), CLIENT_KEY)

    expect(payload).toMatchObject({
      description: 'Rotor', quantity: '1.25', unitCostCents: 10_050,
      priceCents: 17_500, coreChargeCents: 1_200, partNumber: 'R-1',
      brand: 'BrakeCo', fitment: 'Front', externalOfferId: 'REF-7',
      fulfillment: { method: 'unknown', locationLabel: null },
    })
  })

  it.each([
    { description: '', failure: 'description' },
    { quantity: '0', failure: 'quantity' },
    { quantity: '-1', failure: 'quantity' },
    { quantity: '1000000000', failure: 'quantity' },
    { unitCost: '-1', failure: 'money' },
    { unitCost: '90071992547409.92', failure: 'money' },
    { customerPrice: '1.001', failure: 'money' },
    { coreCharge: '-0.01', failure: 'money' },
  ])('rejects invalid capture intent: $failure', (override) => {
    const { failure: _failure, ...fields } = override
    expect(() => buildManualOfferPayload(manualPartDraft({
      vendorAccountId: ACCOUNT_ID,
      description: 'Pad set',
      quantity: '1',
      unitCost: '80',
      customerPrice: '240',
      ...fields,
    }), CLIENT_KEY)).toThrow()
  })

  it('builds a total stable signature for valid and invalid drafts without hashing', () => {
    const normalized = normalizedManualPartSignature(manualPartDraft({
      vendorAccountId: ` ${ACCOUNT_ID.toUpperCase()} `,
      description: ' Pad set ',
      quantity: '2.0',
      unitCost: '080.00',
      customerPrice: '240.0',
    }))
    expect(normalized).toBe(normalizedManualPartSignature(manualPartDraft({
      vendorAccountId: ACCOUNT_ID,
      description: 'Pad set',
      quantity: '2',
      unitCost: '80',
      customerPrice: '240',
    })))
    expect(JSON.parse(normalized)).toMatchObject({
      vendorAccountId: ACCOUNT_ID,
      description: 'Pad set',
      quantity: '2',
      unitCost: '8000',
      customerPrice: '24000',
    })
    expect(normalized).not.toContain(CLIENT_KEY)
    expect(normalizedManualPartSignature(manualPartDraft({ quantity: ' bad ' })))
      .toContain('bad')
  })

  it('uses the generic action until the customer-visible commitment is valid', () => {
    expect(manualPartCommitLabel(manualPartDraft())).toBe('Add sourced part')
    expect(manualPartCommitLabel(manualPartDraft({
      description: 'Pad set', quantity: '0', customerPrice: '240',
    }))).toBe('Add sourced part')
    expect(manualPartCommitLabel(manualPartDraft({
      description: 'Pad set', quantity: '2', customerPrice: '-1',
    }))).toBe('Add sourced part')
  })
})

describe('locked diagnosis description seed', () => {
  it('returns one explicit description seed only for one reviewed ordinary lock', () => {
    expect(selectLockedDiagnosisSeed([reviewedOrdinaryJob('Replace the alternator and verify output.')]))
      .toEqual({ description: 'Replace the alternator and verify output.' })
    expect(selectLockedDiagnosisSeed([
      reviewedOrdinaryJob('First recommendation'), reviewedOrdinaryJob('Second recommendation'),
    ])).toBeNull()
    expect(selectLockedDiagnosisSeed([topologyJob(), pendingOrdinaryJob(), publishedWizardJob()]))
      .toBeNull()
  })

  it('returns only the explicit recommendation and rejects empty or non-diagnostic candidates', () => {
    expect(selectLockedDiagnosisSeed([reviewedOrdinaryJob('  Replace the belt.  ')]))
      .toEqual({ description: '  Replace the belt.  ' })
    expect(selectLockedDiagnosisSeed([reviewedOrdinaryJob('   ')])).toBeNull()
    expect(selectLockedDiagnosisSeed([diagnosisJob('Repair recommendation', {
      kind: 'repair', storyMode: null,
    })])).toBeNull()
  })
})

describe('deriveMarkupLinePrice', () => {
  it('applies the markup to unit cost for a single unit', () => {
    expect(deriveMarkupLinePrice('100.00', '1', 4000)).toBe('140.00')
  })

  it('extends the derived price by quantity (line total, not per-unit)', () => {
    // 4 rotors at $50 cost, 40% markup => $70 each => $280 line total.
    expect(deriveMarkupLinePrice('50.00', '4', 4000)).toBe('280.00')
  })

  it('returns the cost unchanged at a 0% markup', () => {
    expect(deriveMarkupLinePrice('10.00', '1', 0)).toBe('10.00')
  })

  it('rounds the customer cent half-up without floating error', () => {
    // 9.99 x 3 x 1.5 = 44.955 -> 44.96
    expect(deriveMarkupLinePrice('9.99', '3', 5000)).toBe('44.96')
  })

  it('handles fractional quantities', () => {
    // 2.5 units at $10 cost, 100% markup => $50 line total.
    expect(deriveMarkupLinePrice('10.00', '2.5', 10000)).toBe('50.00')
  })

  it('returns null for an unusable cost, quantity, or markup', () => {
    expect(deriveMarkupLinePrice('', '1', 4000)).toBeNull()
    expect(deriveMarkupLinePrice('abc', '1', 4000)).toBeNull()
    expect(deriveMarkupLinePrice('10.00', '0', 4000)).toBeNull()
    expect(deriveMarkupLinePrice('10.00', '1', -1)).toBeNull()
    expect(deriveMarkupLinePrice('10.00', '1', 1.5)).toBeNull()
  })
})
