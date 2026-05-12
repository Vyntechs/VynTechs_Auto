export type VinDecodeResult =
  | { year: number; make: string; model: string; engine: string }
  | { error: 'invalid' | 'unavailable' }

const NHTSA_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues'
const TIMEOUT_MS = 5_000
const CACHE_MAX = 1_000

// Simple LRU: Map preserves insertion order; bump-on-hit by delete+reinsert.
const cache = new Map<string, VinDecodeResult>()

export function _clearCacheForTest(): void {
  cache.clear()
}

function bumpLru(key: string, value: VinDecodeResult): void {
  cache.delete(key)
  cache.set(key, value)
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

type NhtsaVar = { Variable: string; Value: string | null }

function extract(results: NhtsaVar[], variable: string): string | null {
  const row = results.find((r) => r.Variable === variable)
  if (!row) return null
  const v = row.Value
  if (v === null || v === '' || v === 'Not Applicable') return null
  return v
}

export async function decodeVin(rawVin: string): Promise<VinDecodeResult> {
  const vin = rawVin.trim().toUpperCase()
  if (vin.length !== 17) return { error: 'invalid' }

  const cached = cache.get(vin)
  if (cached !== undefined) {
    bumpLru(vin, cached)
    return cached
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let response: Response
  try {
    response = await fetch(`${NHTSA_URL}/${vin}?format=json`, { signal: controller.signal })
  } catch {
    clearTimeout(timer)
    return { error: 'unavailable' }
  }
  clearTimeout(timer)

  if (!response.ok) {
    return { error: 'unavailable' }
  }

  let body: { Results?: NhtsaVar[] }
  try {
    body = (await response.json()) as { Results?: NhtsaVar[] }
  } catch {
    return { error: 'unavailable' }
  }
  const results = body.Results ?? []

  const errorCode = extract(results, 'Error Code')
  if (errorCode === null || errorCode !== '0') {
    const invalid: VinDecodeResult = { error: 'invalid' }
    bumpLru(vin, invalid)
    return invalid
  }

  const yearRaw = extract(results, 'Model Year')
  const make = extract(results, 'Make')
  const model = extract(results, 'Model')
  const engine = extract(results, 'Engine Model') ?? extract(results, 'Displacement (L)') ?? ''
  const year = yearRaw !== null ? Number.parseInt(yearRaw, 10) : Number.NaN

  if (!Number.isFinite(year) || !make || !model) {
    const invalid: VinDecodeResult = { error: 'invalid' }
    bumpLru(vin, invalid)
    return invalid
  }

  const decoded: VinDecodeResult = { year, make, model, engine }
  bumpLru(vin, decoded)
  return decoded
}
