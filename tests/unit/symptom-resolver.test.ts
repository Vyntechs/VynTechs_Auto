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

describe('resolveSymptomSlug — emissions / DEF limp-mode (6.7 beachhead)', () => {
  const DEF = 'reduced-power-limp-mode-emissions-suspect'

  // Real-shop emissions/limp-mode phrasing must resolve to the DEF/emissions slug.
  it.each([
    'truck went into limp mode',
    'reduced engine power warning',
    'reduced power, DEF light on',
    'DEF light came on',
    'exhaust fluid warning on dash',
    'diesel exhaust fluid system fault',
    "engine derate, won't go over 55",
    'SCR system fault',
    'NOx sensor code, low power',
    'stuck in regen, no power',
    'emissions system fault, limp home',
  ])('resolves emissions/limp complaint "%s" → DEF/emissions slug', (text) => {
    expect(resolveSymptomSlug({ complaintText: text })).toBe(DEF)
  })

  // Precision guard (DELIBERATE deviation from the plan's "check engine" trigger):
  // a bare check-engine complaint is too ambiguous to route to a DEF-specific flow.
  // It MUST fall through to the honestly-labeled AI path, not mis-route to the wizard.
  it('does NOT resolve a bare "check engine light" complaint to the DEF slug', () => {
    expect(resolveSymptomSlug({ complaintText: 'check engine light came on' })).toBeNull()
  })

  // Regression: the DEF pattern is additive (appended last); crank complaints still win.
  it('still resolves crank/no-start complaints to cranks-no-start', () => {
    expect(resolveSymptomSlug({ complaintText: 'cranks but will not start' })).toBe('cranks-no-start')
  })
})
