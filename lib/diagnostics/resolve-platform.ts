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

  return null
}
