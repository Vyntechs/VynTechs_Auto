import { describe, it, expect } from 'vitest'
import { refitThreshold } from '@/lib/calibration/refit'

describe('refitThreshold', () => {
  it('returns prior threshold when sample size is 0', () => {
    const r = refitThreshold({ priorThreshold: 0.9, successes: 0, comebacks: 0 })
    expect(r.newThreshold).toBe(0.9)
    expect(r.sampleSize).toBe(0)
    expect(r.comebackRate).toBe(0)
    expect(r.drift).toBe(0)
  })

  it('lowers threshold when comeback rate is low at adequate sample', () => {
    const r = refitThreshold({ priorThreshold: 0.9, successes: 95, comebacks: 5 })
    expect(r.newThreshold).toBeLessThan(0.9)
    expect(r.newThreshold).toBeGreaterThan(0.7)
  })

  it('raises threshold when comeback rate is high', () => {
    const r = refitThreshold({ priorThreshold: 0.7, successes: 60, comebacks: 40 })
    expect(r.newThreshold).toBeGreaterThan(0.7)
  })

  it('clamps above MAX when comebacks overwhelm a high-risk threshold', () => {
    const r = refitThreshold({ priorThreshold: 0.95, successes: 0, comebacks: 100 })
    expect(r.newThreshold).toBe(0.99)
  })

  it('clamps below MIN when low-risk threshold sees only successes', () => {
    const r = refitThreshold({ priorThreshold: 0.55, successes: 1000, comebacks: 0 })
    expect(r.newThreshold).toBe(0.5)
  })

  it('reports comebackRate as comebacks / sampleSize', () => {
    const r = refitThreshold({ priorThreshold: 0.9, successes: 80, comebacks: 20 })
    expect(r.sampleSize).toBe(100)
    expect(r.comebackRate).toBeCloseTo(0.2)
  })

  it('reports drift as |new - old|', () => {
    const r = refitThreshold({ priorThreshold: 0.7, successes: 60, comebacks: 40 })
    expect(r.drift).toBeCloseTo(Math.abs(r.newThreshold - 0.7))
  })
})
