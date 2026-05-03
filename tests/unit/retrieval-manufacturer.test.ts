import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const HTML = `
<html><body>
<h1>Recall: Powertrain — F-150 EcoBoost</h1>
<p class="recall-summary">Wastegate vacuum line may degrade at high mileage. Replace per service bulletin TSB 18-1234.</p>
<a class="bulletin" href="/tsb/18-1234.pdf">TSB 18-1234</a>
</body></html>
`

describe('ManufacturerRecallAdapter', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => HTML,
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('parses recall summary from manufacturer HTML', async () => {
    const { ManufacturerRecallAdapter } = await import('@/lib/retrieval/adapters/manufacturer-recall')
    const a = new ManufacturerRecallAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150', vehicleEngine: '3.5L EcoBoost',
      complaintText: 'loss of power',
    }, new AbortController().signal)
    expect(r.length).toBeGreaterThan(0)
    expect(r[0].snippet.toLowerCase()).toContain('wastegate')
  })

  it('returns [] for an unsupported make', async () => {
    const { ManufacturerRecallAdapter } = await import('@/lib/retrieval/adapters/manufacturer-recall')
    const a = new ManufacturerRecallAdapter()
    const r = await a.query({
      vehicleYear: 2020, vehicleMake: 'Bugatti', vehicleModel: 'Chiron',
      complaintText: 'gremlins',
    }, new AbortController().signal)
    expect(r).toEqual([])
  })

  it('returns [] when the fetch fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network')))
    const { ManufacturerRecallAdapter } = await import('@/lib/retrieval/adapters/manufacturer-recall')
    const a = new ManufacturerRecallAdapter()
    const r = await a.query({
      vehicleYear: 2018, vehicleMake: 'Ford', vehicleModel: 'F-150',
      complaintText: 'loss of power',
    }, new AbortController().signal)
    expect(r).toEqual([])
  })
})
