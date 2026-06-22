import { describe, it, expect } from 'vitest'
import { accumulateConfidence } from '@/lib/diagnostics/diagram/confidence'

describe('accumulateConfidence', () => {
  it('sums the confirmed-check boosts', () => {
    expect(accumulateConfidence([5, 15, 12])).toBe(32)
  })

  it('clamps a sum over 100 to 100', () => {
    expect(accumulateConfidence([60, 60])).toBe(100)
  })

  it('empty -> 0', () => {
    expect(accumulateConfidence([])).toBe(0)
  })

  it('ignores non-finite and negative entries', () => {
    expect(accumulateConfidence([NaN, -5, 10])).toBe(10)
  })
})
