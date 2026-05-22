/**
 * Pure display formatters for the topology UI. No React, no DOM — fully
 * unit-testable. Used by <TopologyDiagnostic> (the page heading) and
 * <TopologyDetailPanel> (the connection title).
 */

/** A diagnostic trouble code: letter P/B/C/U followed by four digits. */
const DTC_PATTERN = /^[pbcu]\d{4}$/i

/** Capitalise the first letter of a single word: "fuel" -> "Fuel". */
function titleCaseWord(word: string): string {
  if (word === '') return ''
  return word[0].toUpperCase() + word.slice(1)
}

/**
 * Turn a symptom slug into a short page title.
 *
 * A slug whose first segment is a DTC code (e.g. `p0087-fuel-rail-pressure-too-low`)
 * becomes `"P0087 — Fuel Rail Pressure Too Low"`. A DTC slug with no further
 * segments becomes just the code. A slug with no DTC prefix
 * (e.g. `no-start-cranks-normally`) is title-cased throughout.
 */
export function formatSymptomTitle(slug: string): string {
  const segments = slug.split('-').filter((s) => s !== '')
  if (segments.length === 0) return ''

  const [first, ...rest] = segments
  if (DTC_PATTERN.test(first)) {
    const code = first.toUpperCase()
    if (rest.length === 0) return code
    return `${code} — ${rest.map(titleCaseWord).join(' ')}`
  }
  return segments.map(titleCaseWord).join(' ')
}

/** `connection_kind` enum value -> human label. */
const CONNECTION_KIND_LABELS: Record<string, string> = {
  'electrical-wire': 'Electrical wire',
  'fluid-line': 'Fluid line',
  'mechanical-linkage': 'Mechanical linkage',
  'can-bus': 'CAN bus',
  'lin-bus': 'LIN bus',
  controlled_by: 'Controlled by',
  reports_to: 'Reports to',
}

/**
 * Turn a raw `connection_kind` enum value into a human-readable label.
 * Unmapped values fall back to separator-stripped, first-letter-capitalised text.
 */
export function formatConnectionKind(kind: string): string {
  const mapped = CONNECTION_KIND_LABELS[kind]
  if (mapped) return mapped
  const spaced = kind.replace(/[-_]/g, ' ').trim()
  if (spaced === '') return ''
  return spaced[0].toUpperCase() + spaced.slice(1)
}
