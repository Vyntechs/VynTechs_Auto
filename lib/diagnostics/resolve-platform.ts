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

// Engine-string patterns considered "6.7L Cummins" (Ram HD 2500/3500/4500/5500).
// A bare "6.7"/"6.7L" is accepted because no gas 6.7 was offered on a Ram HD —
// the 6.7 on those trucks is always the Cummins (same rationale as the bare-6.0 PSD case).
function isRam67Cummins(engine: string): boolean {
  const e = engine.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!e) return false
  return /\b6\.7l?\b/.test(e)
}

// Extracts the Ram Heavy-Duty model number from messy real-world strings.
// Handles "3500", "Ram 3500", "ram-3500", "Dodge Ram 2500", "RAM 3500 Tradesman".
// Returns the canonical HD number (2500/3500/4500/5500) or null for non-HD (e.g. 1500).
function normalizeRamHdModel(model: string): string | null {
  const match = model.toLowerCase().match(/\b(2500|3500|4500|5500)\b/)
  return match ? match[1] : null
}

// Normalizes messy real-world Super Duty model strings to a canonical kebabed form.
// Handles: "F250", "F-250", "F250 Super Duty", "f-250 superduty", "F-350 Super Duty", etc.
// Returns the normalized model if it's one of the known Super Duty slugs; null otherwise.
// NOTE: Applied to BOTH the 6.0L and 6.7L Super Duty branches for messy-input parity.
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

export function resolvePlatformSlug(input: PlatformResolveInput): string | null {
  const make = (input.make ?? '').toLowerCase().trim()
  const model = (input.model ?? '').toLowerCase().trim()
  const engine = (input.engine ?? '').trim()

  if (make === 'ford' && isFord67Psd(engine)) {
    const normalizedModel = normalizeFordSuperDutyModel(model)
    if (normalizedModel !== null) {
      if (input.year >= 2017 && input.year <= 2022) {
        return 'ford-super-duty-4th-gen-67-psd'
      }
      // 2011-2016: first-shop beachhead (6.7 debuted on the 2011-2016 Super Duty).
      if (input.year >= 2011 && input.year <= 2016) {
        return 'ford-super-duty-3rd-gen-67-psd'
      }
    }
  }

  if (make === 'ford' && isFord60Psd(engine)) {
    const normalizedModel = normalizeFordSuperDutyModel(model)
    if (normalizedModel !== null && input.year >= 2003 && input.year <= 2007) {
      return 'ford-super-duty-3rd-gen-60-psd'
    }
  }

  // Ram Heavy-Duty 6.7L Cummins (2500/3500/4500/5500). Recognized so real field
  // cases (un-deleted aftertreatment, 68RFE transmission, etc.) can route to
  // Ram coverage instead of falling through. "Dodge" accepted because pre-2010
  // brand-split trucks are still entered that way in the real world.
  if ((make === 'ram' || make === 'dodge') && isRam67Cummins(engine)) {
    const hdModel = normalizeRamHdModel(model)
    if (hdModel !== null) {
      if (input.year >= 2019 && input.year <= 2025) {
        return 'ram-heavy-duty-5th-gen-67-cummins'
      }
      if (input.year >= 2010 && input.year <= 2018) {
        return 'ram-heavy-duty-4th-gen-67-cummins'
      }
    }
  }

  return null
}
