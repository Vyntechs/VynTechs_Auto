import { describe, it, expect } from 'vitest'
import { hasReachedGate } from '@/lib/diagnostics/diagram/verdict-gate'

describe('hasReachedGate', () => {
  it('p0087 long slug (gate 0.85): 84 below, 85 at, 90 above', () => {
    expect(hasReachedGate(84, 'p0087-fuel-rail-pressure-too-low')).toBe(false)
    expect(hasReachedGate(85, 'p0087-fuel-rail-pressure-too-low')).toBe(true)
    expect(hasReachedGate(90, 'p0087-fuel-rail-pressure-too-low')).toBe(true)
  })

  it('unknown slug uses the 0.8 default: 80 at, 79 below', () => {
    expect(hasReachedGate(80, 'totally-unknown-slug')).toBe(true)
    expect(hasReachedGate(79, 'totally-unknown-slug')).toBe(false)
  })
})
