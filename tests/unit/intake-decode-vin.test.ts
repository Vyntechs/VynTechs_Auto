import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeVin, _clearCacheForTest } from '@/lib/intake/decode-vin'

// Shaped like a real `DecodeVinValues` body: one flat row, keys without spaces.
// These fixtures previously used the `{ Variable, Value }` pairs that the sibling
// `DecodeVin` endpoint returns, so the parser passed against a payload NHTSA
// never sends while production decoded nothing at all.
const NHTSA_OK = {
  Count: 1,
  Results: [{ ErrorCode: '0', ModelYear: '2014', Make: 'BMW', Model: '335i', EngineModel: 'N55', DisplacementL: '3.0' }],
}

// A real 2017 F-250 6.7 answers with no `EngineModel` at all — displacement is
// the only engine fact available, which is the common case on the shop's trucks.
const NHTSA_OK_DISPLACEMENT_ONLY = {
  Count: 1,
  Results: [{ ErrorCode: '0', ModelYear: '2017', Make: 'FORD', Model: 'F-250', EngineModel: '', DisplacementL: '6.7' }],
}

const NHTSA_INVALID = {
  Count: 1,
  Results: [{ ErrorCode: '1', ModelYear: '2014', Make: 'BMW', Model: '335i' }],
}

// NHTSA returns codes comma-separated; a clean decode is `0` and nothing else.
const NHTSA_MULTI_CODE = {
  Count: 1,
  Results: [{ ErrorCode: '1,4', ModelYear: '2014', Make: 'BMW', Model: '335i' }],
}

describe('decodeVin', () => {
  beforeEach(() => {
    _clearCacheForTest()
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns decoded fields on a valid NHTSA response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(NHTSA_OK), { status: 200 })))
    const result = await decodeVin('WBA3A5C50EJF12345')
    expect(result).toEqual({ year: 2014, make: 'BMW', model: '335i', engine: 'N55' })
  })

  it('falls back to displacement when NHTSA has no engine model', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(NHTSA_OK_DISPLACEMENT_ONLY), { status: 200 })))
    const result = await decodeVin('1FT7W2BT4HEB50000')
    expect(result).toEqual({ year: 2017, make: 'FORD', model: 'F-250', engine: '6.7' })
  })

  it('returns {error: "invalid"} on NHTSA error-code response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(NHTSA_INVALID), { status: 200 })))
    const result = await decodeVin('WBA3A5C50EJF99999')
    expect(result).toEqual({ error: 'invalid' })
  })

  it('refuses a decode NHTSA reported more than one problem with', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(NHTSA_MULTI_CODE), { status: 200 })))
    const result = await decodeVin('WBA3A5C50EJF88888')
    expect(result).toEqual({ error: 'invalid' })
  })

  it('returns {error: "unavailable"} on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('error', { status: 503 })))
    const result = await decodeVin('WBA3A5C50EJF12345')
    expect(result).toEqual({ error: 'unavailable' })
  })

  it('returns {error: "unavailable"} on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network failure') }))
    const result = await decodeVin('WBA3A5C50EJF12345')
    expect(result).toEqual({ error: 'unavailable' })
  })

  it('returns {error: "invalid"} on length !== 17 (no fetch)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await decodeVin('SHORT')
    expect(result).toEqual({ error: 'invalid' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    'WBA3A5C50EJF1234I',
    'WBA3A5C50EJF1234O',
    'WBA3A5C50EJF1234Q',
    'WBA3A5C50EJF1234-',
  ])('rejects non-canonical VIN alphabet input %s without fetch', async (vin) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await decodeVin(vin)).toEqual({ error: 'invalid' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('caches successful decodes — second call does not refetch', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(NHTSA_OK), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await decodeVin('WBA3A5C50EJF12345')
    await decodeVin('WBA3A5C50EJF12345')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('normalizes VIN case before caching (lowercase input hits same cache)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(NHTSA_OK), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await decodeVin('WBA3A5C50EJF12345')
    await decodeVin('wba3a5c50ejf12345')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent requests for the same VIN', async () => {
    let resolveFetch!: (response: Response) => void
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve
    }))
    vi.stubGlobal('fetch', fetchMock)

    const first = decodeVin('WBA3A5C50EJF12345')
    const second = decodeVin('wba3a5c50ejf12345')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    resolveFetch(new Response(JSON.stringify(NHTSA_OK), { status: 200 }))

    await expect(Promise.all([first, second])).resolves.toEqual([
      { year: 2014, make: 'BMW', model: '335i', engine: 'N55' },
      { year: 2014, make: 'BMW', model: '335i', engine: 'N55' },
    ])
  })

  it('allows no more than eight distinct provider requests at once', async () => {
    const resolvers: Array<(response: Response) => void> = []
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolvers.push(resolve)
    }))
    vi.stubGlobal('fetch', fetchMock)
    const vins = Array.from(
      { length: 9 },
      (_, index) => `1HGCM82633A00${String(4000 + index)}`,
    )

    const active = vins.slice(0, 8).map((vin) => decodeVin(vin))
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8))
    await expect(decodeVin(vins[8])).resolves.toEqual({ error: 'unavailable' })
    expect(fetchMock).toHaveBeenCalledTimes(8)

    resolvers.forEach((resolve) => {
      resolve(new Response(JSON.stringify(NHTSA_OK), { status: 200 }))
    })
    await Promise.all(active)
  })

  it('keeps the abort timeout active while the response body is being read', async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => ({
        ok: true,
        json: () => new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
      }))
      vi.stubGlobal('fetch', fetchMock)

      const result = decodeVin('WBA3A5C50EJF12345')
      await vi.advanceTimersByTimeAsync(5_001)
      await expect(result).resolves.toEqual({ error: 'unavailable' })
    } finally {
      vi.useRealTimers()
    }
  })
})
