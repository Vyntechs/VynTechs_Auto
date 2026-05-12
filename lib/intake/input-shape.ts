import { KNOWN_MAKES } from './known-makes'

export type InputShape =
  | { kind: 'phone'; value: string }
  | { kind: 'vin'; value: string }
  | { kind: 'year'; value: number }
  | { kind: 'make'; value: string }
  | { kind: 'email'; value: string }
  | { kind: 'plate'; value: string }
  | { kind: 'name'; value: string }

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/
const PHONE_DIGITS_RE = /^\d{10}$/
const YEAR_MIN = 1980
const YEAR_MAX = new Date().getUTCFullYear() + 1
const PLATE_RE = /^[A-Z0-9]{5,8}$/i

function stripPhoneFormatting(s: string): string {
  return s.replace(/[\s()\-.+]/g, '')
}

export function detectInputShape(raw: string): InputShape {
  const trimmed = raw.trim()
  if (trimmed === '') return { kind: 'name', value: '' }

  // Email — cheapest unique signal.
  if (trimmed.includes('@')) {
    return { kind: 'email', value: trimmed.toLowerCase() }
  }

  // Phone — must be exactly 10 digits after stripping formatting.
  const phoneStripped = stripPhoneFormatting(trimmed)
  if (PHONE_DIGITS_RE.test(phoneStripped)) {
    return { kind: 'phone', value: phoneStripped }
  }

  // VIN — 17 chars, uppercase, no I/O/Q.
  const upper = trimmed.toUpperCase()
  if (VIN_RE.test(upper)) {
    return { kind: 'vin', value: upper }
  }

  // Year — 4 digits, in range.
  if (/^\d{4}$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10)
    if (n >= YEAR_MIN && n <= YEAR_MAX) {
      return { kind: 'year', value: n }
    }
  }

  // Known make — case-insensitive match against canonical casing.
  const lower = trimmed.toLowerCase()
  for (const canonical of KNOWN_MAKES) {
    if (canonical.toLowerCase() === lower) {
      return { kind: 'make', value: canonical }
    }
  }

  // Plate — 5-8 alphanumeric, no spaces, mixed letters AND digits.
  // Pure letters (e.g. "Smith") fall through to name; pure digits never
  // reach here (phone/year ate them already).
  if (PLATE_RE.test(trimmed) && /[A-Za-z]/.test(trimmed) && /\d/.test(trimmed)) {
    return { kind: 'plate', value: trimmed.toUpperCase() }
  }

  // Fall through to name.
  return { kind: 'name', value: trimmed }
}
