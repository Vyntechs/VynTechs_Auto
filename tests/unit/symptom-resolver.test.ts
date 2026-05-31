import { describe, it, expect } from 'vitest'
import { resolveSymptomSlug } from '@/lib/diagnostics/symptom-resolver'

describe('resolveSymptomSlug (pure)', () => {
  it('selectedSymptomSlug wins over DTC and complaint text', () => {
    expect(
      resolveSymptomSlug({
        selectedSymptomSlug: 'p0087-fuel-rail-pressure-too-low',
        dtcCodes: ['P0088'],
        complaintText: 'truck cranks but will not start',
      }),
    ).toBe('p0087-fuel-rail-pressure-too-low')
  })

  it('normalizes the first DTC code to lowercase slug form when no chip', () => {
    expect(resolveSymptomSlug({ dtcCodes: ['P0087'] })).toBe('p0087')
    expect(resolveSymptomSlug({ dtcCodes: ['  p0193  '] })).toBe('p0193')
  })

  it('matches the cranks-no-start complaint pattern FIRST', () => {
    // Real shop inputs (feedback_validate_with_real_inputs).
    for (const text of [
      'truck cranks but will not start',
      'engine cranks but does not start',
      'crank no fire',
      "cranks won't start",
    ]) {
      expect(resolveSymptomSlug({ complaintText: text })).toBe('cranks-no-start')
    }
  })

  it('returns null when nothing matches', () => {
    expect(resolveSymptomSlug({ complaintText: 'wipers stopped working' })).toBeNull()
    expect(resolveSymptomSlug({})).toBeNull()
    expect(resolveSymptomSlug({ dtcCodes: ['  ', ''] })).toBeNull()
  })

  it('falls through chip -> dtc -> complaint in priority order', () => {
    // No chip, no dtc -> complaint pattern fires.
    expect(
      resolveSymptomSlug({ complaintText: 'cranks but will not start' }),
    ).toBe('cranks-no-start')
    // dtc beats complaint when no chip.
    expect(
      resolveSymptomSlug({ dtcCodes: ['P0088'], complaintText: 'cranks no start' }),
    ).toBe('p0088')
  })
})
