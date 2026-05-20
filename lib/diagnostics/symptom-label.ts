/**
 * Converts a symptom slug into a short human-readable label.
 *
 * DTC slug (starts with a code like p0087, b1234, c0456, u0100):
 *   p0087-fuel-rail-pressure-too-low → "P0087 — Fuel rail pressure too low"
 *
 * Non-DTC slug:
 *   no-start-cranks-normally-fuel-system-suspect → "No start cranks normally fuel system suspect"
 */
export function symptomLabel(slug: string): string {
  const dtcMatch = slug.match(/^([pbcu][0-9]{4})(-.+)?$/i)
  if (dtcMatch) {
    const code = dtcMatch[1].toUpperCase()
    const rest = dtcMatch[2] ? dtcMatch[2].slice(1).replace(/-/g, ' ') : ''
    if (!rest) return code
    return `${code} — ${rest.charAt(0).toUpperCase()}${rest.slice(1)}`
  }
  const label = slug.replace(/-/g, ' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}
