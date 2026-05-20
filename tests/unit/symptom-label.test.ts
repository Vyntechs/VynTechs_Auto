import { describe, it, expect } from 'vitest'
import { symptomLabel } from '@/lib/diagnostics/symptom-label'

describe('symptomLabel', () => {
  it('humanizes a DTC slug with code + description', () => {
    expect(symptomLabel('p0087-fuel-rail-pressure-too-low')).toBe(
      'P0087 — Fuel rail pressure too low',
    )
  })

  it('humanizes an uppercase DTC slug', () => {
    expect(symptomLabel('P0088-fuel-rail-pressure-too-high')).toBe(
      'P0088 — Fuel rail pressure too high',
    )
  })

  it('humanizes a bare DTC code slug (no description suffix)', () => {
    expect(symptomLabel('p0087')).toBe('P0087')
  })

  it('humanizes a non-DTC slug', () => {
    expect(symptomLabel('no-start-cranks-normally-fuel-system-suspect')).toBe(
      'No start cranks normally fuel system suspect',
    )
  })

  it('handles a single-word slug', () => {
    expect(symptomLabel('misfire')).toBe('Misfire')
  })
})
