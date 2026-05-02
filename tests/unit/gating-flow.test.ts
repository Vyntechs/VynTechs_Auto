import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/gating/risk-classifier', () => ({
  classifyAction: vi.fn().mockResolvedValue({
    riskClass: 'destructive',
    rationale: 'wire cut',
    reversible: false,
    source: 'rule',
  }),
}))

vi.mock('@/lib/db/queries', () => ({
  getThreshold: vi.fn().mockResolvedValue(0.95),
}))

describe('gating flow contract — risk_class × confidence', () => {
  it('blocks destructive action with 90% confidence (below 0.95 threshold)', async () => {
    const { gateProposedAction } = await import('@/lib/gating/gap-handler')
    const r = await gateProposedAction({
      db: {} as never,
      action: { description: 'Cut the K-CAN-H wire at pin 7', confidence: 0.9 },
      vehicleFamily: 'bmw-3-series',
      symptomClass: 'power_loss',
    })
    expect(r.allow).toBe(false)
    expect(r.riskClass).toBe('destructive')
    expect(r.options).toEqual(['gather_more_low_risk', 'decline', 'defer'])
    expect(r.gap).toMatch(/95%/)
  })

  it('allows destructive action with 96% confidence (above 0.95 threshold)', async () => {
    const { gateProposedAction } = await import('@/lib/gating/gap-handler')
    const r = await gateProposedAction({
      db: {} as never,
      action: { description: 'Cut the K-CAN-H wire at pin 7', confidence: 0.96 },
      vehicleFamily: 'bmw-3-series',
      symptomClass: 'power_loss',
    })
    expect(r.allow).toBe(true)
    expect(r.options).toBeUndefined()
  })
})
