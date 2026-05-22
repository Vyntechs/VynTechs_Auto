import { describe, it, expect } from 'vitest'
import {
  formatSymptomTitle,
  formatConnectionKind,
} from '@/components/topology/topology-format'

describe('formatSymptomTitle', () => {
  it('formats a DTC slug as "CODE — Title Case Name"', () => {
    expect(formatSymptomTitle('p0087-fuel-rail-pressure-too-low')).toBe(
      'P0087 — Fuel Rail Pressure Too Low',
    )
  })

  it('title-cases a non-DTC slug throughout', () => {
    expect(formatSymptomTitle('no-start-cranks-normally')).toBe(
      'No Start Cranks Normally',
    )
  })

  it('returns just the code when a DTC slug has no name segments', () => {
    expect(formatSymptomTitle('p0087')).toBe('P0087')
  })

  it('returns an empty string for an empty slug', () => {
    expect(formatSymptomTitle('')).toBe('')
  })
})

describe('formatConnectionKind', () => {
  it('maps known connection kinds to human labels', () => {
    expect(formatConnectionKind('reports_to')).toBe('Reports to')
    expect(formatConnectionKind('electrical-wire')).toBe('Electrical wire')
    expect(formatConnectionKind('can-bus')).toBe('CAN bus')
  })

  it('falls back to separator-stripped, capitalised text for unmapped kinds', () => {
    expect(formatConnectionKind('hydraulic_coupling')).toBe('Hydraulic coupling')
  })
})
