// DTC = OBD-II Diagnostic Trouble Code. Canonical shape: one letter (P/B/C/U)
// followed by 4 hex chars (with the second char restricted to 0-3 per SAE J2012).
// An optional 2-hex-char "failure type byte" (FTB) tail comes after a `-` or `:`
// separator and carries fault-mode detail (e.g. P0420-11 = signal above range).
// We preserve the FTB tail as orthogonal metadata via `subCode`; the canonical
// base is the library-identity key (same fix recipe regardless of tail).
const DTC_BASE_RE = /^[PBCU][0-3][0-9A-F]{3}$/
const DTC_TAIL_RE = /^[0-9A-F]{2}$/

export type NormalizedDtc = { canonical: string; subCode: string | null }

export function normalizeDtc(input: string): NormalizedDtc | null {
  let s = input.trim()
  if (s.length === 0) return null
  s = s.toUpperCase()

  s = s.replace(/^(CODE|DTC)[\s:]+/, '')

  s = s.replace(/\s+/g, '')
  if (s.length === 0) return null

  // Find a `-` or `:` separator at position 5+ (i.e. AFTER the 5-char base).
  let base = s
  let tail: string | null = null
  let sepIdx = -1
  for (let i = 5; i < s.length; i++) {
    if (s[i] === '-' || s[i] === ':') {
      sepIdx = i
      break
    }
  }
  if (sepIdx !== -1) {
    base = s.slice(0, sepIdx)
    tail = s.slice(sepIdx + 1)
  }

  // Strip any `-` or `:` left inside the base (e.g. "P-0420" → "P0420").
  base = base.replace(/[-:]/g, '')

  // Letter-O → digit-0 fix in body positions only (first char untouched).
  if (base.length >= 1) {
    base = base[0] + base.slice(1).replace(/O/g, '0')
  }

  if (!DTC_BASE_RE.test(base)) return null

  const subCode = tail !== null && DTC_TAIL_RE.test(tail) ? tail : null

  return { canonical: base, subCode }
}

// TagInput-shaped wrapper: maps NormalizedDtc to the { value, suffix } shape
// expected by the TagInput's `normalize` prop.
export function normalizeDtcForChip(
  raw: string,
): { value: string; suffix: string | null } | null {
  const n = normalizeDtc(raw)
  if (!n) return null
  return { value: n.canonical, suffix: n.subCode }
}

// Owner-volunteered engine variants collapse to one canonical token so a
// rule like "6.7 Powerstroke" matches "6.7L Power Stroke" matches "6.7L
// PSD". Add new variants here as the shop's paste habits reveal them.
const ENGINE_ALIASES: Array<{ pattern: RegExp; canonical: string }> = [
  { pattern: /^6\.7\s*l?\s*(powerstroke|power\s+stroke|psd)$/i, canonical: '6.7L Powerstroke' },
  { pattern: /^6\.4\s*l?\s*(powerstroke|power\s+stroke|psd)$/i, canonical: '6.4L Powerstroke' },
  { pattern: /^6\.0\s*l?\s*(powerstroke|power\s+stroke|psd)$/i, canonical: '6.0L Powerstroke' },
  { pattern: /^7\.3\s*l?\s*(powerstroke|power\s+stroke|psd)$/i, canonical: '7.3L Powerstroke' },
]

export function normalizeEngine(input: string | null | undefined): string | null {
  if (!input) return null
  const trimmed = input.trim()
  if (trimmed.length === 0) return null
  for (const { pattern, canonical } of ENGINE_ALIASES) {
    if (pattern.test(trimmed)) return canonical
  }
  return trimmed
}
