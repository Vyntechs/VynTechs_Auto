import { describe, expect, it } from 'vitest'
import {
  buildManualLineInput,
  classifyQuoteFailure,
  formatMoneyCents,
  getQuotePreparationState,
  parseMoneyToCents,
  parseCustomerStoryMutationResponse,
  parseCustomerStoryWorkspaceResponse,
  parseQuoteBuilderProjection,
  parsePreparedVersionResponse,
  parseQuoteDecisionResponse,
  summarizeQuoteMoney,
} from '@/lib/shop-os/quote-builder-ui'

describe('quote preparation readiness', () => {
  const readyBuilder = parseQuoteBuilderProjection({
    ticket: { id: '00000000-0000-4000-8000-000000000101', status: 'open', reconciled: true },
    configuration: {
      laborRateCents: null, taxRateBps: 825,
      laborRateConfigured: false, taxRateConfigured: true,
    },
    jobs: [{
      id: '00000000-0000-4000-8000-000000000201', title: 'Labor', kind: 'repair', workStatus: 'open',
      story: { content: null, source: null, reviewStatus: null, revision: 0 },
      storyMode: null,
      decisionEligible: false,
      approval: { state: 'pending_quote', quoteVersionId: null },
      lines: [{
        id: '00000000-0000-4000-8000-000000000301', kind: 'labor', description: 'Explicit labor',
        sort: 0, quantity: '1', priceCents: 10_000, taxable: false,
        partNumber: null, brand: null, coreChargeCents: null, fitment: null,
        laborHours: '1', laborRateCents: null,
      }],
    }],
    capabilities: { canRecordCustomerApproval: false },
    activeVersion: null,
  })!

  it('allows explicitly priced persisted labor without a global labor rate', () => {
    expect(getQuotePreparationState({
      builder: readyBuilder,
      totals: summarizeQuoteMoney(readyBuilder.jobs[0].lines, 825),
      editorOpen: false, modalOpen: false, busy: false,
    })).toEqual({ kind: 'ready', reasons: [] })
  })

  it('lists every actionable block without adding a labor-rate requirement', () => {
    const blocked = {
      ...readyBuilder,
      ticket: { ...readyBuilder.ticket, reconciled: false },
      configuration: { ...readyBuilder.configuration, taxRateBps: null, taxRateConfigured: false },
      jobs: [{ ...readyBuilder.jobs[0], lines: [] }],
    }
    expect(getQuotePreparationState({
      builder: blocked,
      totals: { ok: false }, editorOpen: true, modalOpen: true, busy: true,
    })).toEqual({ kind: 'blocked', reasons: [
      'Add customer and vehicle.', 'Configure a tax rate.', 'Add at least one quote line.',
      'Review stored quote amounts.', 'Finish or cancel the open line editor.',
      'Finish the open confirmation.', 'Wait for the current quote update.',
    ] })
  })

  it('treats an active version as already prepared', () => {
    const active = {
      ...readyBuilder,
      activeVersion: {
        id: '00000000-0000-4000-8000-000000000401', versionNumber: 4,
        totalCents: 10_825,
        jobs: [{ jobId: '00000000-0000-4000-8000-000000000201', subtotalCents: 10_000 }],
      },
    }
    expect(getQuotePreparationState({
      builder: active, totals: { ok: false }, editorOpen: true, modalOpen: true, busy: true,
    })).toEqual({ kind: 'prepared', version: active.activeVersion })
  })

  it('strictly validates exact-version decision responses', () => {
    const response = {
      changed: true,
      event: {
        id: '00000000-0000-4000-8000-000000000501', kind: 'approved',
        quoteVersionId: '00000000-0000-4000-8000-000000000401',
        jobId: '00000000-0000-4000-8000-000000000201', approvedVia: 'phone',
      },
      projection: {
        approvalState: 'approved',
        approvedQuoteVersionId: '00000000-0000-4000-8000-000000000401',
      },
    }
    expect(parseQuoteDecisionResponse(201, response)).toEqual(response)
    expect(parseQuoteDecisionResponse(200, { ...response, changed: false })).toEqual({ ...response, changed: false })
    expect(parseQuoteDecisionResponse(200, response)).toBeNull()
    expect(parseQuoteDecisionResponse(201, { ...response, changed: false })).toBeNull()
    expect(parseQuoteDecisionResponse(201, { ...response, hidden: true })).toBeNull()
    const decline = {
      ...response,
      event: { ...response.event, kind: 'declined', approvedVia: null },
      projection: { approvalState: 'approved', approvedQuoteVersionId: response.event.quoteVersionId },
    }
    expect(parseQuoteDecisionResponse(201, decline)).toBeNull()
    expect(parseQuoteDecisionResponse(200, { ...decline, changed: false })).toEqual({ ...decline, changed: false })
  })

  it('strictly validates 201-created and 200-existing version responses', () => {
    const version = { id: '00000000-0000-4000-8000-000000000401', versionNumber: 1 }
    expect(parsePreparedVersionResponse(201, { changed: true, version })).toEqual({ changed: true, version })
    expect(parsePreparedVersionResponse(200, { changed: false, version })).toEqual({ changed: false, version })
    expect(parsePreparedVersionResponse(200, { changed: true, version })).toBeNull()
    expect(parsePreparedVersionResponse(201, { changed: false, version })).toBeNull()
    expect(parsePreparedVersionResponse(201, { changed: true, version, extra: true })).toBeNull()
    expect(parsePreparedVersionResponse(201, { changed: true, version: { ...version, versionNumber: 0 } })).toBeNull()
  })
})

describe('customer story response validation', () => {
  const profileId = '00000000-0000-4000-8000-000000000601'
  const sessionId = '00000000-0000-4000-8000-000000000602'
  const eventId = '00000000-0000-4000-8000-000000000603'
  const story = {
    whatYouToldUs: 'Battery warning appears while driving.',
    whatWeFound: 'Alternator output is below specification.',
    howWeKnow: [{ claim: 'Charging output measured 11.8 volts.', sourceEventIds: [eventId], sourceArtifactIds: [] }],
    whatItMeansIfWaived: 'The diagnosed issue remains unresolved.',
    whatWeRecommend: 'Replace the alternator.',
  }
  const fullMeta = {
    source: 'ai' as const, sessionId, generatedAt: '2026-07-11T12:00:00.000Z',
    lastEditedByProfileId: profileId, lastEditedAt: '2026-07-11T12:00:00.000Z',
    generationClientKey: '00000000-0000-4000-8000-000000000604',
    generationRequestFingerprint: 'a'.repeat(64), generatedByProfileId: profileId,
    storyRevision: 1, reviewStatus: 'pending' as const,
  }

  it('parses a bounded row-20 workspace and strips actor metadata', () => {
    const workspace = {
      story,
      storyMeta: {
        source: 'ai', sessionId, generatedAt: fullMeta.generatedAt,
        lastEditedByProfileId: profileId, lastEditedAt: fullMeta.lastEditedAt,
        reviewStatus: 'pending',
      },
      storyRevision: 1,
      evidence: {
        events: [{ id: eventId, kind: 'observation', createdAt: fullMeta.generatedAt, label: 'Charging output measured 11.8 volts.' }],
        artifacts: [], nextEventCursor: null, nextArtifactCursor: null,
      },
    }
    expect(parseCustomerStoryWorkspaceResponse(workspace)).toEqual({
      ...workspace,
      storyMeta: {
        source: 'ai', sessionId, generatedAt: fullMeta.generatedAt,
        lastEditedAt: fullMeta.lastEditedAt, reviewStatus: 'pending',
      },
    })
    expect(JSON.stringify(parseCustomerStoryWorkspaceResponse(workspace))).not.toContain(profileId)
  })

  it('parses POST full metadata and PUT safe metadata into the same private-free mutation result', () => {
    const post = { changed: true, story, storyMeta: fullMeta, storyRevision: 1 }
    const safeMeta = {
      source: 'ai', sessionId, generatedAt: fullMeta.generatedAt,
      lastEditedAt: fullMeta.lastEditedAt, reviewStatus: 'pending', storyRevision: 1,
    }
    expect(parseCustomerStoryMutationResponse(post)).toEqual({ ...post, storyMeta: safeMeta })
    expect(parseCustomerStoryMutationResponse({ ...post, storyMeta: safeMeta })).toEqual({ ...post, storyMeta: safeMeta })
    expect(JSON.stringify(parseCustomerStoryMutationResponse(post))).not.toContain(profileId)
  })

  it.each([
    { story: null, storyMeta: null, storyRevision: 0, evidence: { events: [], artifacts: [], nextEventCursor: null, nextArtifactCursor: null }, extra: true },
    { story, storyMeta: null, storyRevision: 1, evidence: { events: [], artifacts: [], nextEventCursor: null, nextArtifactCursor: null } },
    { story: null, storyMeta: null, storyRevision: 0, evidence: { events: [{ id: 'bad', kind: 'observation', createdAt: fullMeta.generatedAt, label: 'x' }], artifacts: [], nextEventCursor: null, nextArtifactCursor: null } },
  ])('rejects hostile workspace payloads', (hostile) => {
    expect(parseCustomerStoryWorkspaceResponse(hostile)).toBeNull()
  })

  it.each([
    { changed: true, story, storyMeta: { ...fullMeta, generationClientKey: undefined }, storyRevision: 1 },
    { changed: true, story: { ...story, whatWeFound: ' trailing ' }, storyMeta: fullMeta, storyRevision: 1 },
    { changed: true, story, storyMeta: fullMeta, storyRevision: 2 },
    { changed: true, story, storyMeta: { ...fullMeta, hidden: true }, storyRevision: 1 },
  ])('rejects hostile story mutation payloads', (hostile) => {
    expect(parseCustomerStoryMutationResponse(hostile)).toBeNull()
  })
})

describe('quote builder refresh projection validation', () => {
  const valid = {
    ticket: { id: '00000000-0000-4000-8000-000000000101', status: 'open', reconciled: true },
    configuration: {
      laborRateCents: 15_000, taxRateBps: 825,
      laborRateConfigured: true, taxRateConfigured: true,
    },
    jobs: [{
      id: '00000000-0000-4000-8000-000000000201', title: 'Brake service', kind: 'repair', workStatus: 'open',
      story: { content: null, source: null, reviewStatus: null, revision: 0 },
      storyMode: null,
      decisionEligible: false,
      approval: { state: 'pending_quote', quoteVersionId: null },
      lines: [{
        id: '00000000-0000-4000-8000-000000000301', kind: 'fee', description: 'Fee', sort: 0, quantity: '1',
        priceCents: 500, taxable: true, partNumber: null, brand: null,
        coreChargeCents: null, fitment: null, laborHours: null, laborRateCents: null,
      }],
    }],
    capabilities: { canRecordCustomerApproval: false },
    activeVersion: null,
  }

  it('accepts the complete exact safe projection', () => {
    expect(parseQuoteBuilderProjection(valid)).toEqual(valid)
    const unavailable = {
      ...valid,
      jobs: [{ ...valid.jobs[0], kind: 'diagnostic', storyMode: 'unavailable' }],
    }
    expect(parseQuoteBuilderProjection(unavailable)).toEqual(unavailable)
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
    { ...valid, jobs: [{ ...valid.jobs[0], story: { ...valid.jobs[0].story, source: 'ai', content: null } }] },
    { ...valid, capabilities: { canRecordCustomerApproval: 'yes' } },
    { ...valid, jobs: [{ ...valid.jobs[0], decisionEligible: 'yes' }] },
    { ...valid, jobs: [{ ...valid.jobs[0], storyMode: 'ordinary_locked_tree' }] },
    { ...valid, jobs: [{ ...valid.jobs[0], kind: 'diagnostic', storyMode: 'not-a-mode' }] },
    { ...valid, activeVersion: {
      id: '00000000-0000-4000-8000-000000000401', versionNumber: 1, totalCents: 500,
      jobs: [{ jobId: valid.jobs[0].id, subtotalCents: 501 }],
    } },
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
