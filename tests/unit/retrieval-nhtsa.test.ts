import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const SUCCESS_RESPONSE = {
  ok: true,
  json: async () => ({
    Count: 1,
    Results: [{
      Manufacturer: 'Ford Motor Company',
      NHTSACampaignNumber: '17V123000',
      ReportReceivedDate: '04/05/2017',
      Component: 'POWER TRAIN',
      Summary: 'Wastegate vacuum line may crack at high mileage causing underboost.',
      Consequence: 'Loss of power; check engine illuminated.',
      Remedy: 'Replace wastegate vacuum line with updated silicone part.',
    }],
  }),
}

describe('NHTSAAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(SUCCESS_RESPONSE))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('returns recall results for the vehicle', async () => {
    const { NHTSAAdapter } = await import('@/lib/retrieval/adapters/nhtsa')
    const adapter = new NHTSAAdapter()
    const results = await adapter.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'loss of power',
    }, new AbortController().signal)
    expect(results).toHaveLength(1)
    expect(results[0].source).toBe('nhtsa')
    expect(results[0].snippet).toContain('Wastegate')
  })

  it('returns [] when the API responds with !ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
    const { NHTSAAdapter } = await import('@/lib/retrieval/adapters/nhtsa')
    const adapter = new NHTSAAdapter()
    const results = await adapter.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'loss of power',
    }, new AbortController().signal)
    expect(results).toEqual([])
  })
})
