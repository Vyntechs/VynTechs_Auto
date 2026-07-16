import {
  CANCEL_REASON_CODES,
  CLOSE_DISPOSITIONS,
  PART_STATUSES,
  SEPARATE_REASONS,
  TICKET_MUTATION_KINDS,
} from '../../../db/schema'
import type {
  jobLines,
  quoteEvents,
  quoteVersions,
  ticketJobs,
  tickets,
} from '../../../db/schema'

export {
  CANCEL_REASON_CODES,
  CLOSE_DISPOSITIONS,
  PART_STATUSES,
  SEPARATE_REASONS,
  TICKET_MUTATION_KINDS,
}

export type RevisionDecimal = string & { readonly __revisionDecimal: unique symbol }
export type TicketMutationKind = (typeof TICKET_MUTATION_KINDS)[number]
export const TICKET_CREATING_MUTATION_KINDS_V1 = [
  'create_repair_order',
  'create_separate_repair_order',
] as const
export type TicketOperationOriginV1 = 'counter' | 'quick_quote' | 'tech_quick'
export type SeparateReason = (typeof SEPARATE_REASONS)[number]
export type CloseDisposition = (typeof CLOSE_DISPOSITIONS)[number]
export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number]
export type PartStatus = (typeof PART_STATUSES)[number]

export type CanonicalValue =
  | null
  | boolean
  | string
  | number
  | readonly CanonicalValue[]
  | Readonly<{ [key: string]: CanonicalValue }>

export type CandidateBindingV1 = Readonly<{
  ticketId: string
  continuityRevision: RevisionDecimal
}>

declare const mutationFingerprintKeyringBrand: unique symbol
export type MutationFingerprintKeyringV1 = Readonly<{
  [mutationFingerprintKeyringBrand]: true
}>

export type CanonicalMutationEnvelopeV1 = Readonly<{
  schemaVersion: 1
  mutationKind: TicketMutationKind
  operationOrigin: TicketOperationOriginV1 | null
  actorProfileId: string
  target: Readonly<Record<string, CanonicalValue>>
  candidates: readonly CandidateBindingV1[]
  payload: Readonly<Record<string, CanonicalValue>>
}>

declare const resolvedTicketCreationBrand: unique symbol
export type ResolvedTicketCreationV1 = Readonly<{
  [resolvedTicketCreationBrand]: true
}>
declare const finalizedTicketCreationBrand: unique symbol
export type FinalizedTicketCreationV1 = Readonly<{
  [finalizedTicketCreationBrand]: true
}>
declare const canonicalQuickReceiptRequestBrand: unique symbol
export type CanonicalQuickReceiptRequestV1 = Readonly<{
  [canonicalQuickReceiptRequestBrand]: true
}>
declare const resolvedTicketIntakeIdentityBrand: unique symbol
export type ResolvedTicketIntakeIdentityV1 = Readonly<{
  [resolvedTicketIntakeIdentityBrand]: true
}>
declare const materializedTicketIntakeIdentityBrand: unique symbol
export type MaterializedTicketIntakeIdentityV1 = Readonly<{
  [materializedTicketIntakeIdentityBrand]: true
}>
declare const resolvedQuickTemplateBrand: unique symbol
export type ResolvedQuickTemplateV1 = Readonly<{
  [resolvedQuickTemplateBrand]: true
}>
declare const resolvedLockedQuickTemplateBrand: unique symbol
export type ResolvedLockedQuickTemplateV1 = Readonly<{
  [resolvedLockedQuickTemplateBrand]: true
}>
export type TicketCreatingEnvelopeBaseV1 = Readonly<
  Omit<CanonicalMutationEnvelopeV1, 'operationOrigin' | 'actorProfileId'>
>

declare const lockedActorBrand: unique symbol
declare const mutationAttemptCapabilityBrand: unique symbol

export type MutationAttemptCapabilityV1 = Readonly<{
  [mutationAttemptCapabilityBrand]: true
}>

export type MutationAttemptContextV1 = Readonly<{
  capability: MutationAttemptCapabilityV1
  ordinal: 1 | 2
  purpose: 'primary' | 'unique_collision_recovery'
}>

export type LockedActiveActorV1 = Readonly<{
  [lockedActorBrand]: true
  id: string
  shopId: string
  role: 'tech' | 'advisor' | 'parts' | 'owner'
  skillTier: 1 | 2 | 3 | null
}>

export type MutationInsertionIntentsV1 = Readonly<{
  sessions: readonly Readonly<{ id: string; shopId: string; techId: string }>[]
  customers: readonly Readonly<{ id: string; shopId: string }>[]
  vehicles: readonly Readonly<{ id: string; customerId: string }>[]
  tickets: readonly string[]
  jobs: readonly Readonly<{ id: string; ticketId: string }>[]
}>

export type MutationLockExtensionV1 = Readonly<{
  lockShop: boolean
  customerIds: readonly string[]
  vehicleIds: readonly string[]
  ticketIds: readonly string[]
  jobIds: readonly string[]
  includeAllJobsForTickets: boolean
  includeAllLinesForJobs: boolean
  includeAllQuoteVersionsForTickets: boolean
  includeAllQuoteEventsForTickets: boolean
  sessionIds: readonly string[]
  sessionEventIds: readonly string[]
  vendorAccountIds: readonly string[]
  cannedJobIds: readonly string[]
  insertionIntents: MutationInsertionIntentsV1
}>

export type NormalizedMutationLockRequestV1 = Readonly<{
  shopId: string
  actorProfileId: string
  profileIds: readonly string[]
  lockShop: boolean
  customerIds: readonly string[]
  vehicleIds: readonly string[]
  ticketIds: readonly string[]
  jobIds: readonly string[]
  includeAllJobsForTickets: boolean
  includeAllLinesForJobs: boolean
  includeAllQuoteVersionsForTickets: boolean
  includeAllQuoteEventsForTickets: boolean
  sessionIds: readonly string[]
  sessionEventIds: readonly string[]
  vendorAccountIds: readonly string[]
  cannedJobIds: readonly string[]
  receiptRequestKey: string | null
  receiptConditionalInsert:
    | null
    | Readonly<{ kind: 'prepared'; extension: MutationLockExtensionV1 }>
    | Readonly<{ kind: 'unavailable' }>
  insertionIntents: MutationInsertionIntentsV1
}>

export type LockedTicketGraphV1 = Readonly<{
  ticket: typeof tickets.$inferSelect
  jobs: readonly (typeof ticketJobs.$inferSelect)[]
  lines: readonly (typeof jobLines.$inferSelect)[]
  versions: readonly (typeof quoteVersions.$inferSelect)[]
  events: readonly (typeof quoteEvents.$inferSelect)[]
}>

export type BuildContinuitySignatureInputV1 = Readonly<{
  graph: LockedTicketGraphV1
  customerBelongsToShop: boolean
  vehicleBelongsToCustomer: boolean
}>

declare const trustedTicketOriginBrand: unique symbol
export type TrustedTicketOriginV1 = Readonly<{
  [trustedTicketOriginBrand]: true
}>

export type NormalizedTicketCreateV1 = Readonly<{
  id: string
  customerId: string | null
  vehicleId: string | null
  concern: string
  whenStarted: string | null
  howOften: string | null
  diagnosticAuthorizedCents: number | null
  diagnosticAuthorizationNote: string | null
}>

export type NormalizedTicketJobCreateV1 = Readonly<{
  id: string
  title: string
  kind: 'diagnostic' | 'repair' | 'maintenance'
  requiredSkillTier: 1 | 2 | 3
  assignedTechId: string | null
  sessionId: string | null
  createdFromJobId: string | null
}>

type NormalizedSeedLineBaseV1 = Readonly<{
  description: string
  sort: number
  priceCents: number
  taxable: boolean
}>

export type NormalizedJobLineCreateV1 =
  | Readonly<
      NormalizedSeedLineBaseV1 & {
        kind: 'part'
        quantity: number
        partNumber: string | null
        brand: string | null
      }
    >
  | Readonly<
      NormalizedSeedLineBaseV1 & {
        kind: 'labor'
        laborHours: number
        laborRateCents: number | null
      }
    >
  | Readonly<NormalizedSeedLineBaseV1 & { kind: 'fee' }>

export type CreatedTicketBatchV1 = Readonly<{
  ticketId: string
  jobIds: readonly string[]
}>

export type ContinuitySignatureV1 = Readonly<{
  schemaVersion: 1
  ticket: Readonly<{
    id: string
    customerId: string | null
    vehicleId: string | null
    reconciliationState: 'reconciled' | 'provisional' | 'inconsistent'
    status: 'open' | 'closed' | 'canceled'
    deliveredAt: string | null
    deliveredByProfileId: string | null
    closedAt: string | null
    closedByProfileId: string | null
    closeDisposition: CloseDisposition | null
    closeNote: string | null
    canceledAt: string | null
    canceledByProfileId: string | null
    cancelReasonCode: CancelReasonCode | null
    canceledReason: string | null
    separateFromTicketId: string | null
    separateReason: SeparateReason | null
    separateReasonNote: string | null
  }>
  jobs: readonly Readonly<{
    id: string
    kind: 'diagnostic' | 'repair' | 'maintenance'
    workStatement: string | null
    statementReviewState: 'confirmed' | 'review_required' | null
    workStatus: 'open' | 'in_progress' | 'blocked' | 'done' | 'canceled'
    approvalState: 'pending_quote' | 'quote_ready' | 'sent' | 'approved' | 'declined'
    approvedAuthorizationFingerprintPresent: boolean
    partStatuses: readonly PartStatus[]
  }>[]
}>

export class ShopOsMutationNotFound extends Error {
  readonly code = 'not_found'

  constructor() {
    super('shop_os_mutation_not_found')
    this.name = 'ShopOsMutationNotFound'
  }
}
