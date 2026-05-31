export type PlatformResolveInput = {
  year: number
  make: string
  model: string
  engine: string
}

// Engine-string patterns considered "6.7L PSD" — covers shop slang + AI variants.
// All matching is case-insensitive; normalize first.
function isFord67Psd(engine: string): boolean {
  const e = engine.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!e) return false
  // Must mention "6.7" AND one of: psd / power stroke (one or two words) / powerstroke.
  if (!/\b6\.7l?\b/.test(e)) return false
  return /psd|power\s?stroke|powerstroke/.test(e)
}

// Engine-string patterns considered "6.0L PSD" — covers shop slang + bare "6.0" entries.
// A bare "6.0" or "6.0L" with no qualifier is treated as 6.0L PSD when make/model/year
// already narrow to a Ford Super Duty in 2003-2007, since no other significant 6.0 option
// existed on that platform during that generation.
function isFord60Psd(engine: string): boolean {
  const e = engine.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!e) return false
  // Must mention "6.0" (with or without "L")
  if (!/\b6\.0l?\b/.test(e)) return false
  // Accept bare "6.0"/"6.0L" OR when accompanied by PSD/powerstroke qualifiers
  return true
}

// Normalizes messy real-world Super Duty model strings to a canonical kebabed form.
// Handles: "F250", "F-250", "F250 Super Duty", "f-250 superduty", "F-350 Super Duty", etc.
// Returns the normalized model if it's one of the known Super Duty slugs; null otherwise.
// NOTE: Applied ONLY to the 6.0L branch — the 6.7L branch is intentionally unchanged.
function normalizeFordSuperDutyModel(model: string): string | null {
  const SUPER_DUTY_MODELS = new Set(['f-250', 'f-350', 'f-450', 'f-550'])
  let m = model.toLowerCase().trim()
  // Strip trailing "super duty" or "superduty" (with optional whitespace)
  m = m.replace(/\s+super\s*duty\s*$/i, '').trim()
  // Collapse internal whitespace
  m = m.replace(/\s+/g, '')
  // Normalize "f250" → "f-250", "f350" → "f-350", etc.
  m = m.replace(/^(f)(\d{3})$/, '$1-$2')
  return SUPER_DUTY_MODELS.has(m) ? m : null
}

const FORD_67_PSD_MODELS = new Set(['f-250', 'f-350', 'f-450', 'f-550'])

export function resolvePlatformSlug(input: PlatformResolveInput): string | null {
  const make = (input.make ?? '').toLowerCase().trim()
  const model = (input.model ?? '').toLowerCase().trim()
  const engine = (input.engine ?? '').trim()

  if (make === 'ford' && FORD_67_PSD_MODELS.has(model) && isFord67Psd(engine)) {
    if (input.year >= 2017 && input.year <= 2022) {
      return 'ford-super-duty-4th-gen-67-psd'
    }
  }

  if (make === 'ford' && isFord60Psd(engine)) {
    const normalizedModel = normalizeFordSuperDutyModel(model)
    if (normalizedModel !== null && input.year >= 2003 && input.year <= 2007) {
      return 'ford-super-duty-3rd-gen-60-psd'
    }
  }

  return null
}
