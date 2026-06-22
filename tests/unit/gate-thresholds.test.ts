import { describe, it, expect } from 'vitest'
import { getGateThreshold } from '../../lib/diagnostics/gate-thresholds'

describe('getGateThreshold', () => {
  it('returns 0.85 for the full p0087 slug', () => {
    expect(getGateThreshold('p0087-fuel-rail-pressure-too-low')).toBe(0.85)
  })

  it('returns 0.85 for the full p0088 slug', () => {
    expect(getGateThreshold('p0088-fuel-rail-pressure-too-high')).toBe(0.85)
  })

  it('returns the DEFAULT 0.8 for an unknown slug', () => {
    expect(getGateThreshold('totally-unknown-slug')).toBe(0.8)
  })
})
