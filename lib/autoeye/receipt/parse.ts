// Strict consumer-side parser/validator for Diagnostic Evidence Receipt
// contract v0 (evidence_receipt.schema.json in this directory; canonical
// source Vyntechs/AUTOEYE — see README.md). No dependencies.
//
// Mirrors the schema exactly: unknown keys are rejected at every level
// (additionalProperties false), contract_version must be the const "0",
// every required section must be present, and the schema's conditionals
// (provenance oneOf, measurement iff first_party_measurement, minimum one
// blocked entry for non-completed receipts) are enforced. It also enforces
// the contract-doc invariants a conforming consumer can check mechanically:
// evidence-id cross-references, the rights/source coherence matrix, the
// rights_summary audit equality, canonical (category, description) sort
// order for absences/unknowns, and input_item_count reconciliation
// ("unsupported never means silently discarded").
//
// A failed parse yields errors only — never a partial receipt. The
// producer-side value-level guidance lint and PII sweep live in the
// canonical validator (scripts/validate_evidence_receipt.py); they are
// producer conformance obligations, not consumer parsing.

import type {
  AbsenceCategory,
  BlockedReasonCategory,
  BlockedScopeType,
  BlockedState,
  EvidenceCategory,
  EvidenceReceipt,
  LifecycleStatus,
  ReceiptStatus,
  ReporterRole,
  RightsStatus,
  SourceClass,
} from './types'

export const RECEIPT_CONTRACT_VERSION = '0'

export type ParseReceiptResult =
  | { ok: true; receipt: EvidenceReceipt }
  | { ok: false; errors: string[] }

const RECEIPT_STATUSES: readonly ReceiptStatus[] = [
  'completed',
  'blocked',
  'unsupported',
  'human_review',
]

const EVIDENCE_CATEGORIES: readonly EvidenceCategory[] = [
  'reported_concern',
  'operating_context',
  'dtc_family',
  'scan_observation',
  'physical_observation',
  'completed_test_result',
  'first_party_measurement',
]

const ABSENCE_CATEGORIES: readonly AbsenceCategory[] = [
  'operating_context_evidence',
  'reported_concern_evidence',
  'dtc_scan_evidence',
  'scan_data_evidence',
  'physical_observation_evidence',
  'physical_response_evidence',
  'measurement_evidence',
  'completed_test_evidence',
  'service_history_evidence',
  'environmental_condition_evidence',
  'symptom_reproduction_evidence',
  'component_condition_evidence',
]

const RIGHTS_STATUSES: readonly RightsStatus[] = [
  'RIGHTS.FIRST_PARTY_OBSERVED',
  'RIGHTS.CLEAN_ORIGINAL',
]

const SOURCE_CLASSES: readonly SourceClass[] = [
  'FIRST_PARTY_OBSERVATION',
  'FIRST_PARTY_MEASUREMENT',
  'CUSTOMER_REPORT',
  'SHOP_SYSTEM_RECORD',
  'SCAN_TOOL_OUTPUT',
]

const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = ['RECEIVED', 'NORMALIZED']

const REPORTER_ROLES: readonly ReporterRole[] = [
  'technician',
  'service_advisor',
  'vehicle_owner',
  'shop_system',
  'measurement_device',
]

const BLOCKED_STATES: readonly BlockedState[] = [
  'blocked',
  'unsupported',
  'insufficient_evidence',
]

const BLOCKED_SCOPE_TYPES: readonly BlockedScopeType[] = ['input_item', 'section', 'request']

const BLOCKED_REASONS: readonly BlockedReasonCategory[] = [
  'out_of_envelope',
  'rights_unclear',
  'attachment_or_url_input',
  'restricted_content_input',
  'insufficient_evidence',
  'threshold_interpretation_requested',
  'human_review_required',
]

// Rights/source coherence matrix (contract doc "Rights/source coherence").
const RIGHTS_BY_SOURCE_CLASS: Record<SourceClass, RightsStatus> = {
  FIRST_PARTY_OBSERVATION: 'RIGHTS.FIRST_PARTY_OBSERVED',
  FIRST_PARTY_MEASUREMENT: 'RIGHTS.FIRST_PARTY_OBSERVED',
  SCAN_TOOL_OUTPUT: 'RIGHTS.FIRST_PARTY_OBSERVED',
  CUSTOMER_REPORT: 'RIGHTS.CLEAN_ORIGINAL',
  SHOP_SYSTEM_RECORD: 'RIGHTS.CLEAN_ORIGINAL',
}

const RECEIPT_ID_PATTERN = /^RCPT-[A-Z0-9][A-Z0-9-]*$/
const TENANT_ID_PATTERN = /^TEN-[A-Z0-9]{2,12}-[0-9]{3,6}$/
const CASE_ID_PATTERN = /^CAS-[A-Z0-9]{2,12}-[0-9]{3,6}$/
const EVIDENCE_ID_PATTERN = /^EV-[A-Z0-9][A-Z0-9-]*$/
const INPUT_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/
const UTC_TIMESTAMP_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

export function parseEvidenceReceipt(input: unknown): ParseReceiptResult {
  const errors: string[] = []
  const fail = (message: string) => {
    errors.push(message)
  }

  if (!isPlainObject(input)) {
    return { ok: false, errors: ['receipt: not a JSON object'] }
  }

  const rootKeys = [
    'contract_version',
    'receipt_id',
    'tenant_id',
    'case_id',
    'created_from',
    'status',
    'evidence',
    'derived',
    'rights_summary',
    'blocked_or_unsupported',
  ]
  for (const key of Object.keys(input)) {
    if (!rootKeys.includes(key)) fail(`receipt: unknown key "${key}"`)
  }
  for (const key of rootKeys) {
    if (!(key in input)) fail(`receipt: missing required section "${key}"`)
  }

  if (input.contract_version !== RECEIPT_CONTRACT_VERSION && 'contract_version' in input) {
    fail(
      `contract_version: must be "${RECEIPT_CONTRACT_VERSION}", got ${JSON.stringify(
        input.contract_version,
      )}`,
    )
  }
  if ('receipt_id' in input && !(isNonEmptyString(input.receipt_id) && RECEIPT_ID_PATTERN.test(input.receipt_id))) {
    fail('receipt_id: does not match RCPT- grammar')
  }
  if ('tenant_id' in input && !(isNonEmptyString(input.tenant_id) && TENANT_ID_PATTERN.test(input.tenant_id))) {
    fail('tenant_id: does not match opaque TEN- grammar')
  }
  if ('case_id' in input && !(isNonEmptyString(input.case_id) && CASE_ID_PATTERN.test(input.case_id))) {
    fail('case_id: does not match opaque CAS- grammar')
  }
  if ('status' in input && !isOneOf(input.status, RECEIPT_STATUSES)) {
    fail('status: not a valid receipt status')
  }

  // created_from
  let inputItemCount: number | null = null
  if ('created_from' in input) {
    const createdFrom = input.created_from
    if (!isPlainObject(createdFrom)) {
      fail('created_from: not an object')
    } else {
      for (const key of Object.keys(createdFrom)) {
        if (!['input_digest', 'input_content_type', 'input_item_count'].includes(key)) {
          fail(`created_from: unknown key "${key}"`)
        }
      }
      if (
        !(
          isNonEmptyString(createdFrom.input_digest) &&
          INPUT_DIGEST_PATTERN.test(createdFrom.input_digest)
        )
      ) {
        fail('created_from.input_digest: not a sha256:<hex> digest')
      }
      if ('input_content_type' in createdFrom && createdFrom.input_content_type !== 'application/json') {
        fail('created_from.input_content_type: must be "application/json"')
      }
      if (
        typeof createdFrom.input_item_count === 'number' &&
        Number.isInteger(createdFrom.input_item_count) &&
        createdFrom.input_item_count >= 0
      ) {
        inputItemCount = createdFrom.input_item_count
      } else {
        fail('created_from.input_item_count: not a non-negative integer')
      }
    }
  }

  // evidence
  const evidenceIds = new Set<string>()
  const evidenceRights = new Set<string>()
  const evidenceSources = new Set<string>()
  const evidenceLifecycles = new Set<string>()
  let evidenceCount = 0
  if ('evidence' in input) {
    if (!Array.isArray(input.evidence)) {
      fail('evidence: not an array')
    } else {
      evidenceCount = input.evidence.length
      input.evidence.forEach((item, index) => {
        const at = `evidence[${index}]`
        if (!isPlainObject(item)) {
          fail(`${at}: not an object`)
          return
        }
        const itemKeys = [
          'id',
          'category',
          'statement',
          'provenance',
          'rights_status',
          'lifecycle_status',
          'measurement',
        ]
        for (const key of Object.keys(item)) {
          if (!itemKeys.includes(key)) fail(`${at}: unknown key "${key}"`)
        }
        for (const key of itemKeys.slice(0, 6)) {
          if (!(key in item)) fail(`${at}: missing required "${key}"`)
        }
        if (isNonEmptyString(item.id) && EVIDENCE_ID_PATTERN.test(item.id)) {
          if (evidenceIds.has(item.id)) fail(`${at}: duplicate evidence id "${item.id}"`)
          evidenceIds.add(item.id)
        } else if ('id' in item) {
          fail(`${at}.id: does not match EV- grammar`)
        }
        const category = isOneOf(item.category, EVIDENCE_CATEGORIES) ? item.category : null
        if ('category' in item && !category) fail(`${at}.category: not a valid evidence category`)
        if ('statement' in item && !isNonEmptyString(item.statement)) {
          fail(`${at}.statement: not a non-empty string`)
        }

        // provenance
        let sourceClass: SourceClass | null = null
        if ('provenance' in item) {
          const provenance = item.provenance
          if (!isPlainObject(provenance)) {
            fail(`${at}.provenance: not an object`)
          } else {
            for (const key of Object.keys(provenance)) {
              if (!['source_class', 'reporter_role', 'observed_at', 'tested_at'].includes(key)) {
                fail(`${at}.provenance: unknown key "${key}"`)
              }
            }
            if (isOneOf(provenance.source_class, SOURCE_CLASSES)) {
              sourceClass = provenance.source_class
            } else {
              fail(`${at}.provenance.source_class: not a valid source class`)
            }
            if (!isOneOf(provenance.reporter_role, REPORTER_ROLES)) {
              fail(`${at}.provenance.reporter_role: not a valid reporter role`)
            }
            const hasObserved = 'observed_at' in provenance
            const hasTested = 'tested_at' in provenance
            if (hasObserved === hasTested) {
              fail(`${at}.provenance: exactly one of observed_at or tested_at is required`)
            }
            for (const key of ['observed_at', 'tested_at'] as const) {
              if (key in provenance) {
                const value = provenance[key]
                if (!(isNonEmptyString(value) && UTC_TIMESTAMP_PATTERN.test(value))) {
                  fail(`${at}.provenance.${key}: not an ISO 8601 UTC timestamp`)
                }
              }
            }
          }
        }

        if ('rights_status' in item && !isOneOf(item.rights_status, RIGHTS_STATUSES)) {
          fail(`${at}.rights_status: not a rights value permitted inside a receipt`)
        }
        if ('lifecycle_status' in item && !isOneOf(item.lifecycle_status, LIFECYCLE_STATUSES)) {
          fail(`${at}.lifecycle_status: not a lifecycle value permitted inside a receipt`)
        }
        if (
          sourceClass &&
          isOneOf(item.rights_status, RIGHTS_STATUSES) &&
          RIGHTS_BY_SOURCE_CLASS[sourceClass] !== item.rights_status
        ) {
          fail(`${at}: rights_status incoherent with source_class "${sourceClass}"`)
        }

        // measurement iff first_party_measurement
        if (category === 'first_party_measurement') {
          if (!('measurement' in item)) fail(`${at}: first_party_measurement requires measurement`)
        } else if (category && 'measurement' in item) {
          fail(`${at}: only first_party_measurement may carry a measurement`)
        }
        if ('measurement' in item) {
          const measurement = item.measurement
          if (!isPlainObject(measurement)) {
            fail(`${at}.measurement: not an object`)
          } else {
            for (const key of Object.keys(measurement)) {
              if (!['value', 'units', 'conditions'].includes(key)) {
                fail(`${at}.measurement: unknown key "${key}"`)
              }
            }
            for (const key of ['value', 'units', 'conditions']) {
              if (!isNonEmptyString(measurement[key])) {
                fail(`${at}.measurement.${key}: not a non-empty string`)
              }
            }
          }
        }

        if (isOneOf(item.rights_status, RIGHTS_STATUSES)) evidenceRights.add(item.rights_status)
        if (sourceClass) evidenceSources.add(sourceClass)
        if (isOneOf(item.lifecycle_status, LIFECYCLE_STATUSES)) {
          evidenceLifecycles.add(item.lifecycle_status)
        }
      })
    }
  }

  const checkEvidenceRefs = (at: string, value: unknown, minimum: number) => {
    if (!Array.isArray(value)) {
      fail(`${at}.evidence_ids: not an array`)
      return
    }
    if (value.length < minimum) fail(`${at}.evidence_ids: fewer than ${minimum} entries`)
    const seen = new Set<string>()
    value.forEach((id, index) => {
      if (!(isNonEmptyString(id) && EVIDENCE_ID_PATTERN.test(id))) {
        fail(`${at}.evidence_ids[${index}]: does not match EV- grammar`)
        return
      }
      if (seen.has(id)) fail(`${at}.evidence_ids: duplicate "${id}"`)
      seen.add(id)
      if (!evidenceIds.has(id)) {
        fail(`${at}.evidence_ids: "${id}" is not an evidence item in this receipt`)
      }
    })
  }

  const checkAbsenceList = (at: string, value: unknown) => {
    if (!Array.isArray(value)) {
      fail(`${at}: not an array`)
      return
    }
    let previous: { category: string; description: string } | null = null
    value.forEach((entry, index) => {
      const entryAt = `${at}[${index}]`
      if (!isPlainObject(entry)) {
        fail(`${entryAt}: not an object`)
        return
      }
      for (const key of Object.keys(entry)) {
        if (!['category', 'description'].includes(key)) fail(`${entryAt}: unknown key "${key}"`)
      }
      if (!isOneOf(entry.category, ABSENCE_CATEGORIES)) {
        fail(`${entryAt}.category: not a valid absence category`)
        return
      }
      if (!isNonEmptyString(entry.description)) {
        fail(`${entryAt}.description: not a non-empty string`)
        return
      }
      // Canonical (category, description) sort order, strictly increasing:
      // position can never carry priority, and duplicates are invalid.
      if (
        previous &&
        (previous.category > entry.category ||
          (previous.category === entry.category && previous.description >= entry.description))
      ) {
        fail(`${entryAt}: not in canonical (category, description) sort order`)
      }
      previous = { category: entry.category, description: entry.description }
    })
  }

  // derived
  if ('derived' in input) {
    const derived = input.derived
    if (!isPlainObject(derived)) {
      fail('derived: not an object')
    } else {
      const derivedKeys = ['known_facts', 'contradictions', 'material_unknowns', 'descriptive_absences']
      for (const key of Object.keys(derived)) {
        if (!derivedKeys.includes(key)) fail(`derived: unknown key "${key}"`)
      }
      for (const key of derivedKeys) {
        if (!(key in derived)) fail(`derived: missing required section "${key}"`)
      }
      if ('known_facts' in derived) {
        if (!Array.isArray(derived.known_facts)) {
          fail('derived.known_facts: not an array')
        } else {
          derived.known_facts.forEach((fact, index) => {
            const at = `derived.known_facts[${index}]`
            if (!isPlainObject(fact)) {
              fail(`${at}: not an object`)
              return
            }
            for (const key of Object.keys(fact)) {
              if (!['statement', 'evidence_ids'].includes(key)) fail(`${at}: unknown key "${key}"`)
            }
            if (!isNonEmptyString(fact.statement)) fail(`${at}.statement: not a non-empty string`)
            checkEvidenceRefs(at, fact.evidence_ids, 1)
          })
        }
      }
      if ('contradictions' in derived) {
        if (!Array.isArray(derived.contradictions)) {
          fail('derived.contradictions: not an array')
        } else {
          derived.contradictions.forEach((contradiction, index) => {
            const at = `derived.contradictions[${index}]`
            if (!isPlainObject(contradiction)) {
              fail(`${at}: not an object`)
              return
            }
            for (const key of Object.keys(contradiction)) {
              if (!['description', 'evidence_ids'].includes(key)) fail(`${at}: unknown key "${key}"`)
            }
            if (!isNonEmptyString(contradiction.description)) {
              fail(`${at}.description: not a non-empty string`)
            }
            checkEvidenceRefs(at, contradiction.evidence_ids, 2)
          })
        }
      }
      if ('material_unknowns' in derived) checkAbsenceList('derived.material_unknowns', derived.material_unknowns)
      if ('descriptive_absences' in derived) {
        checkAbsenceList('derived.descriptive_absences', derived.descriptive_absences)
      }
    }
  }

  // rights_summary: must equal exactly what the evidence items contain.
  if ('rights_summary' in input) {
    const summary = input.rights_summary
    if (!isPlainObject(summary)) {
      fail('rights_summary: not an object')
    } else {
      const summaryChecks: Array<{ key: string; expected: Set<string>; allowed: readonly string[] }> = [
        { key: 'rights_statuses', expected: evidenceRights, allowed: RIGHTS_STATUSES },
        { key: 'source_classes', expected: evidenceSources, allowed: SOURCE_CLASSES },
        { key: 'lifecycle_statuses', expected: evidenceLifecycles, allowed: LIFECYCLE_STATUSES },
      ]
      for (const key of Object.keys(summary)) {
        if (!summaryChecks.some((check) => check.key === key)) {
          fail(`rights_summary: unknown key "${key}"`)
        }
      }
      for (const { key, expected, allowed } of summaryChecks) {
        const value = summary[key]
        if (!Array.isArray(value)) {
          fail(`rights_summary.${key}: not an array`)
          continue
        }
        if (value.some((entry) => !isOneOf(entry, allowed))) {
          fail(`rights_summary.${key}: contains a value not permitted inside a receipt`)
          continue
        }
        const sortedExpected = [...expected].sort()
        if (JSON.stringify(value) !== JSON.stringify(sortedExpected)) {
          fail(`rights_summary.${key}: does not equal the sorted distinct evidence values`)
        }
      }
    }
  }

  // blocked_or_unsupported
  let inputItemBlockedCount = 0
  let blockedCount = 0
  if ('blocked_or_unsupported' in input) {
    if (!Array.isArray(input.blocked_or_unsupported)) {
      fail('blocked_or_unsupported: not an array')
    } else {
      blockedCount = input.blocked_or_unsupported.length
      input.blocked_or_unsupported.forEach((entry, index) => {
        const at = `blocked_or_unsupported[${index}]`
        if (!isPlainObject(entry)) {
          fail(`${at}: not an object`)
          return
        }
        const entryKeys = ['scope', 'scope_type', 'state', 'reason_category']
        for (const key of Object.keys(entry)) {
          if (!entryKeys.includes(key)) fail(`${at}: unknown key "${key}"`)
        }
        for (const key of entryKeys) {
          if (!(key in entry)) fail(`${at}: missing required "${key}"`)
        }
        if ('scope' in entry && !isNonEmptyString(entry.scope)) {
          fail(`${at}.scope: not a non-empty string`)
        }
        if ('scope_type' in entry && !isOneOf(entry.scope_type, BLOCKED_SCOPE_TYPES)) {
          fail(`${at}.scope_type: not a valid scope type`)
        }
        if ('state' in entry && !isOneOf(entry.state, BLOCKED_STATES)) {
          fail(`${at}.state: not a valid blocked/unsupported state`)
        }
        if ('reason_category' in entry && !isOneOf(entry.reason_category, BLOCKED_REASONS)) {
          fail(`${at}.reason_category: not a valid reason category`)
        }
        if (entry.scope_type === 'input_item') inputItemBlockedCount += 1
      })
    }
  }

  // Schema conditional: a non-completed receipt must state its reason.
  if (
    isOneOf(input.status, RECEIPT_STATUSES) &&
    input.status !== 'completed' &&
    Array.isArray(input.blocked_or_unsupported) &&
    blockedCount < 1
  ) {
    fail(`status "${input.status}": requires at least one blocked_or_unsupported entry`)
  }

  // Silent-discard reconciliation: every typed input item is either evidence
  // or visibly accounted for. Unsupported never means silently discarded.
  if (
    inputItemCount !== null &&
    Array.isArray(input.evidence) &&
    Array.isArray(input.blocked_or_unsupported) &&
    errors.length === 0 &&
    evidenceCount + inputItemBlockedCount !== inputItemCount
  ) {
    fail(
      `created_from.input_item_count: ${inputItemCount} does not reconcile with ` +
        `${evidenceCount} evidence + ${inputItemBlockedCount} input_item blocked entries`,
    )
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, receipt: input as EvidenceReceipt }
}
