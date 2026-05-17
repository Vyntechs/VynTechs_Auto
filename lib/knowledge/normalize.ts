// DTCs are stored bare (no suffix) so retrieval matches across variants
// (`P0420-00` and `P0420-FF` collapse to `P0420`). UI re-displays the full
// code from the source paste; storage is the canonical form.
const DTC_RE = /^([PBCU])(\d{4})(?:-[0-9A-F]{2})?$/i

export function normalizeDtc(input: string): string | null {
  const match = input.trim().match(DTC_RE)
  if (!match) return null
  return `${match[1].toUpperCase()}${match[2]}`
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
