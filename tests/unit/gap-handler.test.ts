import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/gating/risk-classifier', () => ({
  classifyAction: vi.fn().mockResolvedValue({
    riskClass: 'high',
    rationale: 'back-probe of CAN bus',
    reversible: true,
    source: 'rule',
  }),
}))

vi.mock('@/lib/db/queries', () => ({
  getThreshold: vi.fn().mockResolvedValue(0.9),
}))

describe('gateProposedAction', () => {
  it('passes when confidence meets threshold', async () => {
    const { gateProposedAction } = await import('@/lib/gating/gap-handler')
    const r = await gateProposedAction({
      db: {} as never,
      action: { description: 'back-probe CAN bus', confidence: 0.92 },
      vehicleFamily: 'ford-f-truck',
      symptomClass: 'power_loss',
    })
    expect(r.allow).toBe(true)
    expect(r.riskClass).toBe('high')
    expect(r.threshold).toBeCloseTo(0.9)
  })

  it('passes when confidence exactly equals threshold', async () => {
    const { gateProposedAction } = await import('@/lib/gating/gap-handler')
    const r = await gateProposedAction({
      db: {} as never,
      action: { description: 'back-probe CAN bus', confidence: 0.9 },
    })
    expect(r.allow).toBe(true)
  })

  it('blocks when confidence is below threshold and surfaces three options', async () => {
    const { gateProposedAction } = await import('@/lib/gating/gap-handler')
    const r = await gateProposedAction({
      db: {} as never,
      action: { description: 'back-probe CAN bus', confidence: 0.74 },
      vehicleFamily: 'ford-f-truck',
      symptomClass: 'power_loss',
    })
    expect(r.allow).toBe(false)
    expect(r.gap).toMatch(/confidence/i)
    expect(r.options).toEqual(['gather_more_low_risk', 'defer'])
  })
})
