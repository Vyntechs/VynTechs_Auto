export type PlatformResolveInput = {
  year: number
  make: string
  model: string
  engine: string
}

// Does the engine string identify the 6.7L Power Stroke diesel?
// On a Ford Super Duty (F-250/350/450/550) "6.7" can ONLY be the 6.7L Power
// Stroke — there is no 6.7L gas option in that truck line — so a bare "6.7"
// or "6.7L" is enough. The "power stroke" / "psd" / "diesel" wording is
// optional confirmation, not a requirement. Techs routinely just type "6.7".
function isFord67Psd(engine: string): boolean {
  const e = engine.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!e) return false
  return /\b6\.7\b/.test(e) || /\b6\.7l\b/.test(e)
}

// Super Duty model codes, normalized: hyphens and spaces stripped so
// "F-350", "F350", and "f 350" all match.
const FORD_67_PSD_MODELS = ['f250', 'f350', 'f450', 'f550']

export function resolvePlatformSlug(input: PlatformResolveInput): string | null {
  const make = (input.make ?? '').toLowerCase().trim()
  const model = (input.model ?? '').toLowerCase().replace(/[\s-]/g, '')
  const engine = (input.engine ?? '').trim()

  const isFordSuperDuty =
    make === 'ford' && FORD_67_PSD_MODELS.some((m) => model.startsWith(m))

  if (isFordSuperDuty && isFord67Psd(engine)) {
    if (input.year >= 2017 && input.year <= 2022) {
      return 'ford-super-duty-4th-gen-67-psd'
    }
  }

  return null
}
