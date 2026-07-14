import { parseEvidenceReceipt } from '@/lib/autoeye/receipt/parse'
import type {
  AbsenceCategory,
  AbsenceEntry,
  BlockedState,
  EvidenceCategory,
  EvidenceItem,
  EvidenceReceipt,
  ReporterRole,
  SourceClass,
} from '@/lib/autoeye/receipt/types'
import styles from './evidence-receipt-preview.module.css'

// Read-only Evidence-Receipt preview for the existing diagnostic-job action
// slot (wedge decision, receipt lane gate 3). Consumes ONLY the receipt —
// never internal cause-family rankings — and preserves the contract's
// evidence-versus-guidance boundary: nothing here is an action, priority,
// question, recommendation, next step, or implied test, and there are no
// interactive elements anywhere in the section. A receipt that fails the
// strict contract-v0 parse renders only the unavailable state, never a
// partial receipt. Fed statically from a vendored SYNTHETIC fixture; the
// feature makes no network calls.

type Props = {
  receiptData: unknown
}

const EVIDENCE_CATEGORY_LABEL: Record<EvidenceCategory, string> = {
  reported_concern: 'Reported concern',
  operating_context: 'Operating context',
  dtc_family: 'DTC family',
  scan_observation: 'Scan observation',
  physical_observation: 'Physical observation',
  completed_test_result: 'Completed test result',
  first_party_measurement: 'First-party measurement',
}

const SOURCE_CLASS_LABEL: Record<SourceClass, string> = {
  FIRST_PARTY_OBSERVATION: 'first-party observation',
  FIRST_PARTY_MEASUREMENT: 'first-party measurement',
  CUSTOMER_REPORT: 'customer report',
  SHOP_SYSTEM_RECORD: 'shop system record',
  SCAN_TOOL_OUTPUT: 'scan tool output',
}

const REPORTER_ROLE_LABEL: Record<ReporterRole, string> = {
  technician: 'technician',
  service_advisor: 'service advisor',
  vehicle_owner: 'vehicle owner',
  shop_system: 'shop system',
  measurement_device: 'measurement device',
}

// Category names only (the contract's naming style) — an absence names what
// category of evidence is not present, never which test would produce it.
const ABSENCE_CATEGORY_LABEL: Record<AbsenceCategory, string> = {
  operating_context_evidence: 'operating-context evidence',
  reported_concern_evidence: 'reported-concern evidence',
  dtc_scan_evidence: 'DTC-scan evidence',
  scan_data_evidence: 'scan-data evidence',
  physical_observation_evidence: 'physical-observation evidence',
  physical_response_evidence: 'physical-response evidence',
  measurement_evidence: 'measurement evidence',
  completed_test_evidence: 'completed-test evidence',
  service_history_evidence: 'service-history evidence',
  environmental_condition_evidence: 'environmental-condition evidence',
  symptom_reproduction_evidence: 'symptom-reproduction evidence',
  component_condition_evidence: 'component-condition evidence',
}

const BLOCKED_STATE_LABEL: Record<BlockedState, string> = {
  blocked: 'Blocked',
  unsupported: 'Unsupported',
  insufficient_evidence: 'Insufficient evidence',
}

export function EvidenceReceiptPreview({ receiptData }: Props) {
  const parsed = parseEvidenceReceipt(receiptData)

  return (
    <section
      className={styles.receipt}
      aria-label="Evidence receipt (preview — synthetic data)"
    >
      <p className={styles.syntheticBanner}>
        SYNTHETIC PREVIEW — not live data, not diagnostic guidance
      </p>
      <h4 className={styles.title}>Evidence receipt (preview — synthetic data)</h4>
      {parsed.ok ? (
        <ReceiptBody receipt={parsed.receipt} />
      ) : (
        <p className={styles.unavailable}>
          Receipt unavailable — does not conform to contract v0.
        </p>
      )}
    </section>
  )
}

function ReceiptBody({ receipt }: { receipt: EvidenceReceipt }) {
  const { derived, rights_summary: rightsSummary } = receipt

  return (
    <>
      <p className={styles.meta}>
        Receipt {receipt.receipt_id} · Case {receipt.case_id} · Contract v
        {receipt.contract_version} · Status {receipt.status.replace('_', ' ')}
      </p>

      <section className={styles.section} aria-label="Typed evidence">
        <h5 className={styles.sectionHeading}>Typed evidence</h5>
        {(Object.keys(EVIDENCE_CATEGORY_LABEL) as EvidenceCategory[]).map((category) => {
          const items = receipt.evidence.filter((item) => item.category === category)
          if (items.length === 0) return null
          return (
            <div key={category} className={styles.categoryGroup}>
              <h6 className={styles.categoryHeading}>{EVIDENCE_CATEGORY_LABEL[category]}</h6>
              <ul className={styles.itemList}>
                {items.map((item) => (
                  <EvidenceRow key={item.id} item={item} />
                ))}
              </ul>
            </div>
          )
        })}
      </section>

      {derived.known_facts.length > 0 && (
        <section className={styles.section} aria-label="Known facts">
          <h5 className={styles.sectionHeading}>Known facts</h5>
          <ul className={styles.itemList}>
            {derived.known_facts.map((fact) => (
              <li key={fact.statement} className={styles.item}>
                <span className={styles.statement}>{fact.statement}</span>
                <span className={styles.provenance}>
                  evidence {fact.evidence_ids.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {derived.contradictions.length > 0 && (
        <section className={styles.section} aria-label="Contradictions">
          <h5 className={styles.sectionHeading}>Contradictions</h5>
          <ul className={styles.itemList}>
            {derived.contradictions.map((contradiction) => (
              <li key={contradiction.description} className={styles.item}>
                <span className={styles.statement}>{contradiction.description}</span>
                <span className={styles.provenance}>
                  evidence {contradiction.evidence_ids.join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {derived.material_unknowns.length > 0 && (
        <AbsenceSection label="Material unknowns" entries={derived.material_unknowns} />
      )}
      {derived.descriptive_absences.length > 0 && (
        <AbsenceSection label="Descriptive absences" entries={derived.descriptive_absences} />
      )}

      <section className={styles.section} aria-label="Blocked or unsupported">
        <h5 className={styles.sectionHeading}>Blocked or unsupported</h5>
        {receipt.blocked_or_unsupported.length === 0 ? (
          <p className={styles.emptyNote}>None recorded in this receipt.</p>
        ) : (
          <ul className={styles.itemList}>
            {receipt.blocked_or_unsupported.map((entry) => (
              <li key={`${entry.scope_type}:${entry.scope}`} className={styles.item}>
                <span className={styles.statement}>
                  {BLOCKED_STATE_LABEL[entry.state]} —{' '}
                  {entry.reason_category.replaceAll('_', ' ')}
                </span>
                <span className={styles.provenance}>
                  {entry.scope_type.replaceAll('_', ' ')}: {entry.scope}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className={styles.rightsLine}>
        Rights {rightsSummary.rights_statuses.join(', ') || 'none'} · Sources{' '}
        {rightsSummary.source_classes.map((s) => SOURCE_CLASS_LABEL[s]).join(', ') || 'none'} ·
        Lifecycle {rightsSummary.lifecycle_statuses.join(', ') || 'none'}
      </p>
    </>
  )
}

function EvidenceRow({ item }: { item: EvidenceItem }) {
  const provenance = item.provenance
  const timestamp = provenance.observed_at
    ? `observed ${provenance.observed_at}`
    : `tested ${provenance.tested_at}`
  return (
    <li className={styles.item}>
      <span className={styles.statement}>{item.statement}</span>
      {item.measurement && (
        <span className={styles.measurement}>
          {item.measurement.value} {item.measurement.units} — {item.measurement.conditions}
        </span>
      )}
      <span className={styles.provenance}>
        {item.id} · {SOURCE_CLASS_LABEL[provenance.source_class]} ·{' '}
        {REPORTER_ROLE_LABEL[provenance.reporter_role]} · {timestamp}
      </span>
    </li>
  )
}

// Unknowns/absences are an UNORDERED set: displayed alphabetically (a
// neutral, meaning-free order), as uniform bulleted text with no numbering,
// no emphasis gradient, and no interactive or action affordance of any kind.
function AbsenceSection({ label, entries }: { label: string; entries: AbsenceEntry[] }) {
  const alphabetical = [...entries].sort((a, b) =>
    a.description === b.description
      ? a.category.localeCompare(b.category)
      : a.description.localeCompare(b.description),
  )
  return (
    <section className={styles.section} aria-label={label}>
      <h5 className={styles.sectionHeading}>{label}</h5>
      <ul className={styles.absenceList}>
        {alphabetical.map((entry) => (
          <li key={`${entry.category}:${entry.description}`} className={styles.absenceItem}>
            {entry.description}{' '}
            <span className={styles.absenceCategory}>
              ({ABSENCE_CATEGORY_LABEL[entry.category]})
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
