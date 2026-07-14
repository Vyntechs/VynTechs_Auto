// TypeScript mirror of the vendored Diagnostic Evidence Receipt contract v0
// (evidence_receipt.schema.json in this directory; canonical source is the
// Vyntechs/AUTOEYE repo — see README.md). These types are shape only; the
// strict runtime gate is parseEvidenceReceipt in ./parse.ts.
//
// The contract is evidence-only by construction: no field exists where a
// diagnosis, ranking, confidence score, next-test prescription, or repair
// direction could live, and additionalProperties is false at every level.

export type ReceiptContractVersion = '0'

export type ReceiptStatus = 'completed' | 'blocked' | 'unsupported' | 'human_review'

export type EvidenceCategory =
  | 'reported_concern'
  | 'operating_context'
  | 'dtc_family'
  | 'scan_observation'
  | 'physical_observation'
  | 'completed_test_result'
  | 'first_party_measurement'

export type AbsenceCategory =
  | 'operating_context_evidence'
  | 'reported_concern_evidence'
  | 'dtc_scan_evidence'
  | 'scan_data_evidence'
  | 'physical_observation_evidence'
  | 'physical_response_evidence'
  | 'measurement_evidence'
  | 'completed_test_evidence'
  | 'service_history_evidence'
  | 'environmental_condition_evidence'
  | 'symptom_reproduction_evidence'
  | 'component_condition_evidence'

// Only these two rights values may appear inside a receipt. QUARANTINED and
// REJECTED material never rides along as evidence — it surfaces only as a
// blocked_or_unsupported entry with a reason.
export type RightsStatus = 'RIGHTS.FIRST_PARTY_OBSERVED' | 'RIGHTS.CLEAN_ORIGINAL'

export type SourceClass =
  | 'FIRST_PARTY_OBSERVATION'
  | 'FIRST_PARTY_MEASUREMENT'
  | 'CUSTOMER_REPORT'
  | 'SHOP_SYSTEM_RECORD'
  | 'SCAN_TOOL_OUTPUT'

export type LifecycleStatus = 'RECEIVED' | 'NORMALIZED'

export type ReporterRole =
  | 'technician'
  | 'service_advisor'
  | 'vehicle_owner'
  | 'shop_system'
  | 'measurement_device'

// Exactly one of observed_at / tested_at is present (enforced by parse.ts).
export type Provenance = {
  source_class: SourceClass
  reporter_role: ReporterRole
  observed_at?: string
  tested_at?: string
}

export type Measurement = {
  value: string
  units: string
  conditions: string
}

// measurement is required iff category === 'first_party_measurement' and
// forbidden otherwise (enforced by parse.ts).
export type EvidenceItem = {
  id: string
  category: EvidenceCategory
  statement: string
  provenance: Provenance
  rights_status: RightsStatus
  lifecycle_status: LifecycleStatus
  measurement?: Measurement
}

export type KnownFact = {
  statement: string
  evidence_ids: string[]
}

export type Contradiction = {
  description: string
  evidence_ids: string[]
}

export type AbsenceEntry = {
  category: AbsenceCategory
  description: string
}

export type BlockedState = 'blocked' | 'unsupported' | 'insufficient_evidence'

export type BlockedScopeType = 'input_item' | 'section' | 'request'

export type BlockedReasonCategory =
  | 'out_of_envelope'
  | 'rights_unclear'
  | 'attachment_or_url_input'
  | 'restricted_content_input'
  | 'insufficient_evidence'
  | 'threshold_interpretation_requested'
  | 'human_review_required'

export type BlockedEntry = {
  scope: string
  scope_type: BlockedScopeType
  state: BlockedState
  reason_category: BlockedReasonCategory
}

export type CreatedFrom = {
  input_digest: string
  input_content_type?: 'application/json'
  input_item_count: number
}

export type DerivedSections = {
  known_facts: KnownFact[]
  contradictions: Contradiction[]
  material_unknowns: AbsenceEntry[]
  descriptive_absences: AbsenceEntry[]
}

export type RightsSummary = {
  rights_statuses: RightsStatus[]
  source_classes: SourceClass[]
  lifecycle_statuses: LifecycleStatus[]
}

export type EvidenceReceipt = {
  contract_version: ReceiptContractVersion
  receipt_id: string
  tenant_id: string
  case_id: string
  created_from: CreatedFrom
  status: ReceiptStatus
  evidence: EvidenceItem[]
  derived: DerivedSections
  rights_summary: RightsSummary
  blocked_or_unsupported: BlockedEntry[]
}
