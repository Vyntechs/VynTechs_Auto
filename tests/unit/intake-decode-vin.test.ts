import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeVin, _clearCacheForTest } from '@/lib/intake/decode-vin'

const NHTSA_OK = {
  Results: [
    { Variable: 'Model Year', Value: '2014' },
    { Variable: 'Make', Value: 'BMW' },
    { Variable: 'Model', Value: '335i' },
    { Variable: 'Engine Model', Value: 'N55' },
    { Variable: 'Error Code', Value: '0' },
  ],
}

const NHTSA_INVALID = {
  Results: [{ Variable: 'Error Code', Value: '1' }],
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

  it('returns {error: "invalid"} on NHTSA error-code response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(NHTSA_INVALID), { status: 200 })))
    const result = await decodeVin('WBA3A5C50EJF99999')
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
