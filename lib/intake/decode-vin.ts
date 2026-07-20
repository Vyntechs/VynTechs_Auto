export type VinDecodeResult =
  | { year: number; make: string; model: string; engine: string }
  | { error: 'invalid' | 'unavailable' }

const NHTSA_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues'
const TIMEOUT_MS = 5_000
const CACHE_MAX = 1_000
const MAX_PROVIDER_CONCURRENCY = 8
const VIN_PATTERN = /^[A-HJ-NPR-Z0-9]{17}$/

// Simple LRU: Map preserves insertion order; bump-on-hit by delete+reinsert.
const cache = new Map<string, VinDecodeResult>()
const inFlight = new Map<string, Promise<VinDecodeResult>>()
let activeProviderRequests = 0

export function _clearCacheForTest(): void {
  cache.clear()
  inFlight.clear()
  activeProviderRequests = 0
}

export function normalizeVin(rawVin: string): string | null {
  const vin = rawVin.trim().toUpperCase()
  return VIN_PATTERN.test(vin) ? vin : null
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

async function fetchVin(vin: string): Promise<VinDecodeResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(
      `${NHTSA_URL}/${encodeURIComponent(vin)}?format=json`,
      { signal: controller.signal },
    )
    if (!response.ok) return { error: 'unavailable' }

    const body = (await response.json()) as { Results?: NhtsaVar[] }
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
  } catch {
    return { error: 'unavailable' }
  } finally {
    clearTimeout(timer)
  }
}

export async function decodeVin(rawVin: string): Promise<VinDecodeResult> {
  const vin = normalizeVin(rawVin)
  if (!vin) return { error: 'invalid' }

  const cached = cache.get(vin)
  if (cached !== undefined) {
    bumpLru(vin, cached)
    return cached
  }

  const existing = inFlight.get(vin)
  if (existing) return existing
  if (activeProviderRequests >= MAX_PROVIDER_CONCURRENCY) {
    return { error: 'unavailable' }
  }

  activeProviderRequests += 1
  const pending = fetchVin(vin).finally(() => {
    activeProviderRequests -= 1
    inFlight.delete(vin)
  })
  inFlight.set(vin, pending)
  return pending
}
