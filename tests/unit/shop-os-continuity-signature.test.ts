import type {
  BuildContinuitySignatureInputV1,
  ContinuitySignatureV1,
  LockedTicketGraphV1,
} from '@/lib/shop-os/continuity/mutation-foundation/contracts'
import { beforeAll, describe, expect, it } from 'vitest'

type SignatureModule = Readonly<Record<string, unknown>>
type MutableGraph = {
  ticket: Record<string, any>
  jobs: Array<Record<string, any>>
  lines: Array<Record<string, any>>
  versions: Array<Record<string, any>>
  events: Array<Record<string, any>>
}

let signatureModule: SignatureModule

beforeAll(async () => {
  signatureModule = (await import(
    '@/lib/shop-os/continuity/mutation-foundation/continuity-signature'
  )) as SignatureModule
})

function requiredFunction<T>(name: string): T {
  const value = signatureModule[name]
  expect(value, `${name} must be exported`).toBeTypeOf('function')
  return value as T
}

function job(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    shopId: '10000000-0000-0000-0000-000000000000',
    ticketId: '20000000-0000-0000-0000-000000000000',
    title: 'Excluded title',
    kind: 'repair',
    requiredSkillTier: 2,
    assignedTechId: '30000000-0000-0000-0000-000000000000',
    claimedAt: new Date('2026-07-15T08:00:00-05:00'),
    sessionId: '40000000-0000-0000-0000-000000000000',
    workStatus: 'open',
    approvalState: 'pending_quote',
    customerStory: { whatYouToldUs: 'Excluded story' },
    storyMeta: { source: 'manual' },
    workNotes: 'Excluded notes',
    approvedQuoteVersionId: null,
    sequenceNumber: 1,
    workStatement: 'Replace front pads',
    statementSource: 'advisor_added',
    statementReviewState: 'confirmed',
    statementConfirmedByProfileId: '50000000-0000-0000-0000-000000000000',
    statementConfirmedAt: new Date('2026-07-15T08:30:00-05:00'),
    whenStarted: 'Yesterday',
    howOften: 'Always',
    diagnosticAuthorizedCents: 10_000,
    diagnosticAuthorizationNote: 'Excluded authorization note',
    createdByProfileId: '60000000-0000-0000-0000-000000000000',
    creatorProvenance: 'direct',
    createdFromJobId: null,
    revision: 4n,
    approvedAuthorizationFingerprint: null,
    approvedApprovalEventId: null,
    diagnosticStartState: 'idle',
    diagnosticStartAttemptKey: null,
    diagnosticStartLeaseUntil: null,
    diagnosticStartErrorCode: null,
    createdAt: new Date('2026-07-15T09:00:00-05:00'),
    updatedAt: new Date('2026-07-15T09:30:00-05:00'),
    ...overrides,
  }
}

function line(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: '91000000-0000-0000-0000-000000000000',
    shopId: '10000000-0000-0000-0000-000000000000',
    jobId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    kind: 'part',
    description: 'Excluded description',
    sort: 1,
    quantity: 1,
    priceCents: 12_345,
    taxable: true,
    partNumber: 'EXCLUDED-PN',
    brand: 'Excluded brand',
    unitCostCents: 8_000,
    coreChargeCents: 0,
    fitment: 'Excluded fitment',
    vendorAccountId: null,
    externalOfferId: null,
    vendorSnapshot: null,
    partStatus: 'proposed',
    orderedAt: null,
    orderedByProfileId: null,
    receivedAt: null,
    receivedByProfileId: null,
    laborHours: null,
    laborRateCents: null,
    source: 'manual',
    createdAt: new Date('2026-07-15T10:00:00-05:00'),
    updatedAt: new Date('2026-07-15T10:30:00-05:00'),
    ...overrides,
  }
}

function graphFixture(): MutableGraph {
  return {
    ticket: {
      id: 'ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB',
      shopId: '10000000-0000-0000-0000-000000000000',
      ticketNumber: 101,
      source: 'quick_quote',
      customerId: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
      vehicleId: 'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC',
      concern: 'Excluded concern',
      whenStarted: 'Excluded timing',
      howOften: 'Excluded frequency',
      diagnosticAuthorizedCents: 12_500,
      diagnosticAuthorizationNote: 'Excluded authorization note',
      projectionRevision: 8n,
      continuityRevision: 3n,
      separateFromTicketId: null,
      separateReason: null,
      separateReasonNote: null,
      closeDisposition: null,
      closeNote: null,
      cancelReasonCode: null,
      status: 'open',
      createdByProfileId: '70000000-0000-0000-0000-000000000000',
      canceledAt: null,
      canceledByProfileId: null,
      canceledReason: null,
      deliveredAt: null,
      deliveredByProfileId: null,
      closedAt: null,
      closedByProfileId: null,
      createdAt: new Date('2026-07-14T12:00:00-05:00'),
      updatedAt: new Date('2026-07-15T12:00:00-05:00'),
    },
    jobs: [
      job({
        id: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
        sequenceNumber: 2,
        kind: 'maintenance',
        workStatement: 'Rotate tires',
        statementReviewState: 'review_required',
        workStatus: 'blocked',
        approvalState: 'quote_ready',
        approvedAuthorizationFingerprint: 'full-secret-fingerprint-b',
      }),
      job({
        id: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
        sequenceNumber: 1,
      }),
      job({
        id: 'DDDDDDDD-DDDD-DDDD-DDDD-DDDDDDDDDDDD',
        sequenceNumber: null,
        kind: 'diagnostic',
        workStatement: null,
        statementReviewState: null,
        createdAt: new Date('2026-07-15T11:00:00-05:00'),
      }),
      job({
        id: 'CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC',
        sequenceNumber: null,
        kind: 'repair',
        workStatement: 'Legacy repair',
        statementReviewState: 'confirmed',
        createdAt: new Date('2026-07-15T10:00:00-05:00'),
      }),
    ],
    lines: [
      line({
        id: '92000000-0000-0000-0000-000000000000',
        jobId: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
        sort: 2,
        partStatus: 'ordered',
      }),
      line({
        id: '91000000-0000-0000-0000-000000000002',
        jobId: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
        sort: 1,
        partStatus: 'received',
      }),
      line({
        id: '91000000-0000-0000-0000-000000000001',
        jobId: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
        sort: 1,
        partStatus: 'needs_order',
      }),
      line({
        id: '93000000-0000-0000-0000-000000000000',
        jobId: 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB',
        kind: 'labor',
        sort: 0,
        partStatus: 'installed',
      }),
      line({
        id: '94000000-0000-0000-0000-000000000000',
        jobId: 'AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA',
        sort: 1,
        partStatus: 'proposed',
      }),
    ],
    versions: [{ id: 'excluded-version', snapshot: { price: 100 } }],
    events: [{ id: 'excluded-event', body: 'excluded event body' }],
  }
}

function build(
  graph = graphFixture(),
  proofs: Readonly<{ customerBelongsToShop: boolean; vehicleBelongsToCustomer: boolean }> = {
    customerBelongsToShop: true,
    vehicleBelongsToCustomer: true,
  },
): ContinuitySignatureV1 {
  return requiredFunction<
    (input: BuildContinuitySignatureInputV1) => ContinuitySignatureV1
  >('buildContinuitySignatureV1')({
    graph: graph as unknown as LockedTicketGraphV1,
    ...proofs,
  })
}

function equal(left: ContinuitySignatureV1, right: ContinuitySignatureV1): boolean {
  return requiredFunction<
    (a: ContinuitySignatureV1, b: ContinuitySignatureV1) => boolean
  >('equalContinuitySignatureV1')(left, right)
}

describe('ShopOS continuity signature construction', () => {
  it('builds the exact normalized signature with deterministic job and part ordering', () => {
    expect(build()).toEqual({
      schemaVersion: 1,
      ticket: {
        id: 'abcdefab-cdef-abcd-efab-cdefabcdefab',
        customerId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        vehicleId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        reconciliationState: 'reconciled',
        status: 'open',
        deliveredAt: null,
        deliveredByProfileId: null,
        closedAt: null,
        closedByProfileId: null,
        closeDisposition: null,
        closeNote: null,
        canceledAt: null,
        canceledByProfileId: null,
        cancelReasonCode: null,
        canceledReason: null,
        separateFromTicketId: null,
        separateReason: null,
        separateReasonNote: null,
      },
      jobs: [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          kind: 'repair',
          workStatement: 'Replace front pads',
          statementReviewState: 'confirmed',
          workStatus: 'open',
          approvalState: 'pending_quote',
          approvedAuthorizationFingerprintPresent: false,
          partStatuses: ['proposed'],
        },
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          kind: 'maintenance',
          workStatement: 'Rotate tires',
          statementReviewState: 'review_required',
          workStatus: 'blocked',
          approvalState: 'quote_ready',
          approvedAuthorizationFingerprintPresent: true,
          partStatuses: ['needs_order', 'received', 'ordered'],
        },
        {
          id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          kind: 'repair',
          workStatement: 'Legacy repair',
          statementReviewState: 'confirmed',
          workStatus: 'open',
          approvalState: 'pending_quote',
          approvedAuthorizationFingerprintPresent: false,
          partStatuses: [],
        },
        {
          id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          kind: 'diagnostic',
          workStatement: null,
          statementReviewState: null,
          workStatus: 'open',
          approvalState: 'pending_quote',
          approvedAuthorizationFingerprintPresent: false,
          partStatuses: [],
        },
      ],
    })
  })

  it('normalizes offset timestamps to UTC without mutating any input row or array', () => {
    const graph = graphFixture()
    graph.ticket.deliveredAt = new Date('2026-07-15T12:34:56-05:00')
    graph.ticket.deliveredByProfileId = 'EEEEEEEE-EEEE-EEEE-EEEE-EEEEEEEEEEEE'
    const before = structuredClone(graph)

    expect(build(graph).ticket.deliveredAt).toBe('2026-07-15T17:34:56.000Z')
    expect(build(graph).ticket.deliveredByProfileId).toBe(
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    )
    expect(graph).toEqual(before)
  })

  it('derives provisional, reconciled, and every fail-closed inconsistent shape', () => {
    const provisional = graphFixture()
    provisional.ticket.source = 'tech_quick'
    provisional.ticket.customerId = null
    provisional.ticket.vehicleId = null
    expect(build(provisional).ticket.reconciliationState).toBe('provisional')

    const reconciled = graphFixture()
    expect(build(reconciled).ticket.reconciliationState).toBe('reconciled')

    const inconsistentCases: Array<
      Readonly<{
        source: string
        customerId: string | null
        vehicleId: string | null
        customerBelongsToShop: boolean
        vehicleBelongsToCustomer: boolean
      }>
    > = [
      {
        source: 'counter',
        customerId: null,
        vehicleId: null,
        customerBelongsToShop: false,
        vehicleBelongsToCustomer: false,
      },
      {
        source: 'tech_quick',
        customerId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        vehicleId: null,
        customerBelongsToShop: true,
        vehicleBelongsToCustomer: false,
      },
      {
        source: 'quick_quote',
        customerId: null,
        vehicleId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        customerBelongsToShop: false,
        vehicleBelongsToCustomer: true,
      },
      {
        source: 'quick_quote',
        customerId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        vehicleId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        customerBelongsToShop: false,
        vehicleBelongsToCustomer: true,
      },
      {
        source: 'quick_quote',
        customerId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        vehicleId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        customerBelongsToShop: true,
        vehicleBelongsToCustomer: false,
      },
    ]

    for (const candidate of inconsistentCases) {
      const graph = graphFixture()
      Object.assign(graph.ticket, candidate)
      expect(
        build(graph, {
          customerBelongsToShop: candidate.customerBelongsToShop,
          vehicleBelongsToCustomer: candidate.vehicleBelongsToCustomer,
        }).ticket.reconciliationState,
      ).toBe('inconsistent')
    }
  })
})

describe('ShopOS continuity signature sensitivity', () => {
  it('changes for every included ticket and job field, part status, and ordering input', () => {
    const baseline = build()
    const mutations: Array<Readonly<[string, (graph: MutableGraph) => void]>> = [
      ['ticket.id', (graph) => { graph.ticket.id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['ticket.customerId', (graph) => { graph.ticket.customerId = '10000000-0000-0000-0000-000000000001' }],
      ['ticket.vehicleId', (graph) => { graph.ticket.vehicleId = '10000000-0000-0000-0000-000000000002' }],
      ['ticket.status', (graph) => { graph.ticket.status = 'closed' }],
      ['ticket.deliveredAt', (graph) => { graph.ticket.deliveredAt = new Date('2026-07-16T00:00:00Z') }],
      ['ticket.deliveredByProfileId', (graph) => { graph.ticket.deliveredByProfileId = '10000000-0000-0000-0000-000000000003' }],
      ['ticket.closedAt', (graph) => { graph.ticket.closedAt = new Date('2026-07-16T00:00:00Z') }],
      ['ticket.closedByProfileId', (graph) => { graph.ticket.closedByProfileId = '10000000-0000-0000-0000-000000000004' }],
      ['ticket.closeDisposition', (graph) => { graph.ticket.closeDisposition = 'delivered' }],
      ['ticket.closeNote', (graph) => { graph.ticket.closeNote = 'Changed close note' }],
      ['ticket.canceledAt', (graph) => { graph.ticket.canceledAt = new Date('2026-07-16T00:00:00Z') }],
      ['ticket.canceledByProfileId', (graph) => { graph.ticket.canceledByProfileId = '10000000-0000-0000-0000-000000000005' }],
      ['ticket.cancelReasonCode', (graph) => { graph.ticket.cancelReasonCode = 'administrative_error' }],
      ['ticket.canceledReason', (graph) => { graph.ticket.canceledReason = 'Changed cancel reason' }],
      ['ticket.separateFromTicketId', (graph) => { graph.ticket.separateFromTicketId = '10000000-0000-0000-0000-000000000006' }],
      ['ticket.separateReason', (graph) => { graph.ticket.separateReason = 'comeback' }],
      ['ticket.separateReasonNote', (graph) => { graph.ticket.separateReasonNote = 'Changed separate note' }],
      ['job.id', (graph) => { graph.jobs[0]!.id = '10000000-0000-0000-0000-000000000007'; for (const candidate of graph.lines) if (candidate.jobId.toLowerCase() === 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') candidate.jobId = graph.jobs[0]!.id }],
      ['job.kind', (graph) => { graph.jobs[0]!.kind = 'repair' }],
      ['job.workStatement', (graph) => { graph.jobs[0]!.workStatement = 'Changed statement' }],
      ['job.statementReviewState', (graph) => { graph.jobs[0]!.statementReviewState = 'confirmed' }],
      ['job.workStatus', (graph) => { graph.jobs[0]!.workStatus = 'done' }],
      ['job.approvalState', (graph) => { graph.jobs[0]!.approvalState = 'approved' }],
      ['job.approvedAuthorizationFingerprintPresent', (graph) => { graph.jobs[1]!.approvedAuthorizationFingerprint = 'now-present' }],
      ['job.partStatuses', (graph) => { graph.lines[0]!.partStatus = 'installed' }],
      ['job.sequence order', (graph) => { graph.jobs[0]!.sequenceNumber = 1; graph.jobs[1]!.sequenceNumber = 2 }],
      ['legacy created order', (graph) => { graph.jobs[2]!.createdAt = new Date('2026-07-15T09:00:00Z') }],
      ['part sort order', (graph) => { graph.lines[0]!.sort = 0 }],
    ]

    for (const [name, mutate] of mutations) {
      const changed = graphFixture()
      mutate(changed)
      expect(equal(baseline, build(changed)), name).toBe(false)
    }

    const changedReconciliation = graphFixture()
    expect(
      equal(
        baseline,
        build(changedReconciliation, {
          customerBelongsToShop: false,
          vehicleBelongsToCustomer: true,
        }),
      ),
      'ticket.reconciliationState',
    ).toBe(false)
  })

  it('ignores every explicitly excluded ticket, job, line, quote, and event field', () => {
    const baseline = build()
    const mutations: Array<Readonly<[string, (graph: MutableGraph) => void]>> = [
      ['ticket.shopId', (graph) => { graph.ticket.shopId = 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['ticket.ticketNumber', (graph) => { graph.ticket.ticketNumber = 999 }],
      ['ticket.source', (graph) => { graph.ticket.source = 'counter' }],
      ['ticket.concern', (graph) => { graph.ticket.concern = 'Changed concern' }],
      ['ticket.whenStarted', (graph) => { graph.ticket.whenStarted = 'Changed timing' }],
      ['ticket.howOften', (graph) => { graph.ticket.howOften = 'Changed frequency' }],
      ['ticket.diagnosticAuthorizedCents', (graph) => { graph.ticket.diagnosticAuthorizedCents = 1 }],
      ['ticket.diagnosticAuthorizationNote', (graph) => { graph.ticket.diagnosticAuthorizationNote = 'Changed note' }],
      ['ticket.projectionRevision', (graph) => { graph.ticket.projectionRevision = 999n }],
      ['ticket.continuityRevision', (graph) => { graph.ticket.continuityRevision = 999n }],
      ['ticket.createdByProfileId', (graph) => { graph.ticket.createdByProfileId = 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['ticket.createdAt', (graph) => { graph.ticket.createdAt = new Date('2020-01-01T00:00:00Z') }],
      ['ticket.updatedAt', (graph) => { graph.ticket.updatedAt = new Date('2030-01-01T00:00:00Z') }],
      ['job.shopId', (graph) => { graph.jobs[0]!.shopId = 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['job.ticketId', (graph) => { graph.jobs[0]!.ticketId = 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['job.title', (graph) => { graph.jobs[0]!.title = 'Changed title' }],
      ['job.requiredSkillTier', (graph) => { graph.jobs[0]!.requiredSkillTier = 3 }],
      ['job.assignedTechId', (graph) => { graph.jobs[0]!.assignedTechId = null }],
      ['job.claimedAt', (graph) => { graph.jobs[0]!.claimedAt = null }],
      ['job.sessionId', (graph) => { graph.jobs[0]!.sessionId = null }],
      ['job.customerStory', (graph) => { graph.jobs[0]!.customerStory = { changed: true } }],
      ['job.storyMeta', (graph) => { graph.jobs[0]!.storyMeta = { changed: true } }],
      ['job.workNotes', (graph) => { graph.jobs[0]!.workNotes = 'Changed work notes' }],
      ['job.approvedQuoteVersionId', (graph) => { graph.jobs[0]!.approvedQuoteVersionId = 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['job.statementSource', (graph) => { graph.jobs[0]!.statementSource = 'customer_request' }],
      ['job.statementConfirmedByProfileId', (graph) => { graph.jobs[0]!.statementConfirmedByProfileId = null }],
      ['job.statementConfirmedAt', (graph) => { graph.jobs[0]!.statementConfirmedAt = null }],
      ['job.whenStarted', (graph) => { graph.jobs[0]!.whenStarted = 'Changed' }],
      ['job.howOften', (graph) => { graph.jobs[0]!.howOften = 'Changed' }],
      ['job.diagnosticAuthorizedCents', (graph) => { graph.jobs[0]!.diagnosticAuthorizedCents = 1 }],
      ['job.diagnosticAuthorizationNote', (graph) => { graph.jobs[0]!.diagnosticAuthorizationNote = 'Changed' }],
      ['job.createdByProfileId', (graph) => { graph.jobs[0]!.createdByProfileId = null }],
      ['job.creatorProvenance', (graph) => { graph.jobs[0]!.creatorProvenance = 'ticket_creator_backfill' }],
      ['job.createdFromJobId', (graph) => { graph.jobs[0]!.createdFromJobId = 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['job.revision', (graph) => { graph.jobs[0]!.revision = 999n }],
      ['job.full fingerprint value', (graph) => { graph.jobs[0]!.approvedAuthorizationFingerprint = 'different-full-fingerprint' }],
      ['job.approvedApprovalEventId', (graph) => { graph.jobs[0]!.approvedApprovalEventId = 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['job.diagnosticStartState', (graph) => { graph.jobs[0]!.diagnosticStartState = 'failed' }],
      ['job.diagnosticStartAttemptKey', (graph) => { graph.jobs[0]!.diagnosticStartAttemptKey = 'changed-attempt' }],
      ['job.diagnosticStartLeaseUntil', (graph) => { graph.jobs[0]!.diagnosticStartLeaseUntil = new Date('2030-01-01T00:00:00Z') }],
      ['job.diagnosticStartErrorCode', (graph) => { graph.jobs[0]!.diagnosticStartErrorCode = 'changed-error' }],
      ['job.updatedAt', (graph) => { graph.jobs[0]!.updatedAt = new Date('2030-01-01T00:00:00Z') }],
      ['line.shopId', (graph) => { graph.lines[0]!.shopId = 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['line.description', (graph) => { graph.lines[0]!.description = 'Changed description' }],
      ['line.quantity', (graph) => { graph.lines[0]!.quantity = 99 }],
      ['line.priceCents', (graph) => { graph.lines[0]!.priceCents = 99 }],
      ['line.taxable', (graph) => { graph.lines[0]!.taxable = false }],
      ['line.partNumber', (graph) => { graph.lines[0]!.partNumber = 'CHANGED' }],
      ['line.brand', (graph) => { graph.lines[0]!.brand = 'Changed brand' }],
      ['line.unitCostCents', (graph) => { graph.lines[0]!.unitCostCents = 99 }],
      ['line.coreChargeCents', (graph) => { graph.lines[0]!.coreChargeCents = 99 }],
      ['line.fitment', (graph) => { graph.lines[0]!.fitment = 'Changed fitment' }],
      ['line.vendorAccountId', (graph) => { graph.lines[0]!.vendorAccountId = 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['line.externalOfferId', (graph) => { graph.lines[0]!.externalOfferId = 'changed-offer' }],
      ['line.vendorSnapshot', (graph) => { graph.lines[0]!.vendorSnapshot = { changed: true } }],
      ['line.orderedAt', (graph) => { graph.lines[0]!.orderedAt = new Date('2030-01-01T00:00:00Z') }],
      ['line.orderedByProfileId', (graph) => { graph.lines[0]!.orderedByProfileId = 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['line.receivedAt', (graph) => { graph.lines[0]!.receivedAt = new Date('2030-01-01T00:00:00Z') }],
      ['line.receivedByProfileId', (graph) => { graph.lines[0]!.receivedByProfileId = 'ffffffff-ffff-ffff-ffff-ffffffffffff' }],
      ['line.laborHours', (graph) => { graph.lines[0]!.laborHours = 99 }],
      ['line.laborRateCents', (graph) => { graph.lines[0]!.laborRateCents = 99 }],
      ['line.source', (graph) => { graph.lines[0]!.source = 'guide' }],
      ['line.createdAt', (graph) => { graph.lines[0]!.createdAt = new Date('2020-01-01T00:00:00Z') }],
      ['line.updatedAt', (graph) => { graph.lines[0]!.updatedAt = new Date('2030-01-01T00:00:00Z') }],
      ['non-part line', (graph) => { Object.assign(graph.lines[3]!, { description: 'Changed labor', priceCents: 1, partStatus: 'returned' }) }],
      ['quote versions', (graph) => { graph.versions = [{ entirely: 'changed' }] }],
      ['quote events', (graph) => { graph.events = [{ entirely: 'changed' }] }],
    ]

    for (const [name, mutate] of mutations) {
      const changed = graphFixture()
      mutate(changed)
      expect(equal(baseline, build(changed)), name).toBe(true)
    }
  })
})

describe('ShopOS continuity signature serialization and rejection', () => {
  it('serializes canonically and compares through the same one-field-list contract', () => {
    const serialize = requiredFunction<(value: ContinuitySignatureV1) => string>(
      'serializeContinuitySignatureV1',
    )
    const signature = build()
    const clone = structuredClone(signature)
    const changed = structuredClone(signature) as {
      ticket: { closeNote: string | null }
    } & ContinuitySignatureV1
    changed.ticket.closeNote = 'changed'

    expect(serialize(signature)).toBe(serialize(clone))
    expect(serialize(signature).startsWith('{"jobs":[')).toBe(true)
    expect(equal(signature, clone)).toBe(true)
    expect(equal(signature, changed)).toBe(false)
  })

  it('fails closed on invalid UUIDs, dates, enums, orphan lines, and non-row values without echoes', () => {
    const invalidMutations: Array<(graph: MutableGraph) => void> = [
      (graph) => { graph.ticket.id = 'do-not-echo-invalid-ticket' },
      (graph) => { graph.ticket.deliveredAt = new Date('invalid') },
      (graph) => { graph.ticket.status = 'invented' },
      (graph) => { graph.jobs[0]!.id = 'invalid-job' },
      (graph) => { graph.jobs[0]!.createdAt = new Date('invalid') },
      (graph) => { graph.jobs[0]!.kind = 'invented' },
      (graph) => { graph.jobs[0]!.sequenceNumber = 1.5 },
      (graph) => { graph.lines[0]!.id = 'invalid-line' },
      (graph) => { graph.lines[0]!.sort = 1.5 },
      (graph) => { graph.lines[0]!.partStatus = 'invented' },
      (graph) => { graph.lines[0]!.jobId = 'ffffffff-ffff-ffff-ffff-ffffffffffff' },
    ]

    for (const mutate of invalidMutations) {
      const invalid = graphFixture()
      mutate(invalid)
      expect(() => build(invalid)).toThrowError('invalid_continuity_signature')
    }
    try {
      const invalid = graphFixture()
      invalid.ticket.id = 'do-not-echo-invalid-ticket'
      build(invalid)
    } catch (error) {
      expect(String(error)).toBe('Error: invalid_continuity_signature')
    }
  })
})
